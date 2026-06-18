import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentTraceEntry } from "../constructAgentRuntime";
import { AgentLogService } from "../ai/AgentLogService";
import { modelForAiFeature } from "../constructAiFeatures";
import {
  createConstructProtocolTools,
  type ConstructProtocolToolRecord
} from "../agent-tools/constructProtocolTools";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import type { StoredSettings } from "../config/constructConfig";
import { ConstructFlowMemoryService } from "./ConstructFlowMemoryService";
import type {
  ConstructFlowAction,
  ConstructFlowAgentInput,
  ConstructFlowAgentResult,
  ConstructFlowPathNode,
  ConstructFlowPracticeTask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowTimelinePart,
  ConstructFlowTaskBaseline,
  ConstructFlowTaskSubmission,
  ConstructFlowToolCallRecord
} from "../../shared/constructFlow";
import { CONSTRUCT_CONCEPT_LANGUAGES, type ConstructAgentContextWindow, type ConstructAgentRunEvent, type KnowledgeBaseRecord } from "../../shared/constructLearning";
import { ConstructLearningStore } from "../constructLearningStore";

const ignoredNames = new Set([".git", ".construct", "node_modules", "dist", "build", ".next", "coverage"]);
const maxBaselineFileBytes = 120_000;
const maxDiffChars = 18_000;
const conceptLanguageSchema = z.enum(CONSTRUCT_CONCEPT_LANGUAGES);

function estimateContextWindow(
  settings: StoredSettings["ai"] | undefined,
  renderedPrompt: string
): ConstructAgentContextWindow {
  const modelId = settings ? modelForAiFeature(settings, "construct-flow") : undefined;
  const usedTokens = Math.max(1, Math.ceil(renderedPrompt.length / 4));
  return {
    providerId: settings?.provider,
    modelId,
    usedTokens,
    inputTokens: usedTokens,
    outputTokens: 0,
    maxTokens: estimateModelContextTokens(modelId),
    source: "estimated",
    updatedAt: new Date().toISOString()
  };
}

function estimateModelContextTokens(modelId: string | undefined): number {
  const normalized = modelId?.toLowerCase() ?? "";
  if (normalized.includes("gemini")) return 1_000_000;
  if (normalized.includes("gpt-4.1")) return 1_048_576;
  if (normalized.includes("gpt-5")) return 258_000;
  if (normalized.includes("claude")) return 200_000;
  if (normalized.includes("deepseek")) return 128_000;
  return 128_000;
}

function buildFlowRuntimeErrorReply(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error || "Unknown runtime error");
  return [
    "Construct Flow could not finish because the model runtime failed.",
    "",
    message,
    "",
    "The activity above shows the last model/tool event that completed."
  ].join("\n");
}

export type ConstructFlowSessionEventSink = (event: ConstructFlowSessionEvent) => void;

export class ConstructFlowService {
  constructor(private readonly options: {
    workspace: ConstructProjectWorkspaceService;
    flowMemory: ConstructFlowMemoryService;
    latestTerminalOutput: (projectId: string) => string;
    logs: AgentLogService;
    learningStore: () => ConstructLearningStore;
    readSettings?: () => Promise<StoredSettings>;
  }) {}

  async runMainAgent(
    project: StoredFlowProject,
    input: ConstructFlowAgentInput,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const memory = await this.options.flowMemory.read(project, ["project.md", "path.md", "learner.md"]);
    const settings = await this.options.readSettings?.();
    const answeredSession = applyQuestionResponse(project, input.questionResponse);
    if (answeredSession) {
      onSessionEvent?.({
        type: "updated",
        projectId: project.id,
        session: cloneSession(answeredSession)
      });
    }
    const session = this.createSession(project, input);
    const startedAt = Date.now();
    const publish = (type: ConstructFlowSessionEvent["type"], result?: ConstructFlowAgentResult) => {
      session.updatedAt = new Date().toISOString();
      session.durationMs = Date.now() - startedAt;
      onSessionEvent?.({ type, projectId: project.id, session: cloneSession(session), result });
    };

    if (input.taskSubmission) {
      const task = project.flow.sessions
        .flatMap((s) => s.practiceTasks)
        .find((t) => t.id === input.taskSubmission?.taskId);
      if (task) {
        task.submissionSessionId = session.id;
      }
    }
    if (input.taskMessage) {
      const task = project.flow.sessions
        .flatMap((s) => s.practiceTasks)
        .find((t) => t.id === input.taskMessage?.taskId);
      if (task) {
        task.messages = [
          ...(task.messages ?? []),
          {
            id: randomUUID(),
            role: "user",
            content: input.message,
            createdAt: new Date().toISOString()
          }
        ];
      }
    }

    project.flow.sessions.push(session);
    trimSessions(project);
    publish("started");

    const actionsFromTools: ConstructFlowAction[] = [];
    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      tavilyApiKey: settings?.ai.tavilyApiKey,
      allowWorkspaceMutation: true,
      allowTerminalCommands: true,
      onToolCallStart: (record) => {
        session.toolCalls.push(toFlowToolRecord(record, "running"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, "running"));
        publish("updated");
      },
      onToolCall: (record) => {
        replaceToolRecord(session, toFlowToolRecord(record, record.status ?? "completed"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, record.status ?? "completed"));
        extractAction(record).forEach((action) => actionsFromTools.push(action));
        publish("updated");
      }
    });

    const store = this.options.learningStore();
    const learningState = await store.getState();
    const concepts = uniqueKnowledgeConcepts(Object.values(learningState.knowledgeBase.concepts));
    const mainPrompt = buildMainPrompt(project, input, memory, concepts);
    session.contextWindow = estimateContextWindow(settings?.ai, `${FLOW_MAIN_AGENT_PROMPT}\n\n${mainPrompt}`);
    publish("updated");

    const practiceTask = this.createPracticeTaskTool(project, session, publish);
    const planLearningPath = this.createPlanLearningPathTool(project, publish);
    const addConcept = this.createAddConceptTool(project, publish);
    const modifyConcept = this.createModifyConceptTool(project, publish);
    const removeConcept = this.createRemoveConceptTool(project, publish);
    const fetchConcepts = this.createFetchConceptsTool(project);
    const suggestConcept = this.createSuggestConceptTool(project, concepts, actionsFromTools, publish);
    const completeSubtask = this.createCompleteSubtaskTool(project, publish);
    const completeTask = this.createCompleteTaskTool(project, publish);
    const tools: ToolsInput = {
      ...pickFlowMainProtocolTools(protocol.tools),
      "plan-learning-path": planLearningPath,
      "practice-task": practiceTask,
      "suggest-existing-concept": suggestConcept,
      "fetch-concepts": fetchConcepts,
      "add-concept": addConcept,
      "modify-concept": modifyConcept,
      "remove-concept": removeConcept,
      "complete-subtask": completeSubtask,
      "complete-task": completeTask
    };

    let reply: string;
    let runError: unknown;
    try {
      const generated = await createConstructAgentRuntime().runAgentic({
        id: "construct-flow-agent",
        featureId: "construct-flow",
        name: "Construct Flow",
        purpose: "Construct Flow mentor agent",
        instructions: FLOW_MAIN_AGENT_PROMPT,
        prompt: mainPrompt,
        tools,
        maxSteps: 16,
        maxRetries: 2,
        onTrace: (entry) => {
          applyTrace(session, entry);
          if (entry.payload !== undefined) {
            this.options.logs.structured("flow", entry.title, entry.payload, entry.level ?? "debug");
          } else {
            this.options.logs.text("flow", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
          }
          publish("updated");
        }
      });
      const pendingQuestion = findPendingLearnerQuestion(session.toolCalls);
      reply = cleanReplyForPendingQuestion(
        generated.text.trim(),
        pendingQuestion
      ) || (pendingQuestion ? "I’ll wait for your answer below." : "I could not produce a response from the model, but the activity above shows the work completed.");
    } catch (error) {
      runError = error;
      reply = buildFlowRuntimeErrorReply(error);
    }

    const waiting = session.practiceTasks.some((task) => task.status === "waiting") || Boolean(findPendingLearnerQuestion(session.toolCalls));
    const actions = mergeActions([], actionsFromTools);
    session.actions = actions;
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });
    if (!session.timeline.some((part) => part.kind === "message" && part.text.trim())) {
      upsertTimelinePart(session.timeline, {
        id: `${session.id}:reply`,
        kind: "message",
        status: runError ? "error" : "completed",
        text: reply,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    session.status = runError ? "error" : waiting ? "waiting" : "completed";
    session.errorMessage = runError instanceof Error ? runError.message : undefined;
    project.flow.updatedAt = new Date().toISOString();

    const result: ConstructFlowAgentResult = {
      session: cloneSession(session),
      reply,
      actions
    };
    publish(runError ? "error" : waiting ? "waiting" : "completed", result);
    return result;
  }

  async runResearchAgent(
    project: StoredFlowProject,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const input: ConstructFlowAgentInput = {
      projectId: project.id,
      message: `Research this Flow project and update research.md. Project goal: ${project.flow.goal}${project.flow.stackPreference ? ` Stack preference: ${project.flow.stackPreference}` : ""}`,
      quickAction: "continue",
      threadId: `${project.flow.threadId}:research`
    };
    const session = this.createSession(project, input);
    const startedAt = Date.now();
    const publish = (type: ConstructFlowSessionEvent["type"], result?: ConstructFlowAgentResult) => {
      session.updatedAt = new Date().toISOString();
      session.durationMs = Date.now() - startedAt;
      onSessionEvent?.({ type, projectId: project.id, session: cloneSession(session), result });
    };
    project.flow.sessions.push(session);
    trimSessions(project);
    publish("started");

    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      tavilyApiKey: (await this.options.readSettings?.())?.ai.tavilyApiKey,
      allowWorkspaceMutation: false,
      allowTerminalCommands: false,
      onToolCallStart: (record) => {
        session.toolCalls.push(toFlowToolRecord(record, "running"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, "running"));
        publish("updated");
      },
      onToolCall: (record) => {
        replaceToolRecord(session, toFlowToolRecord(record, record.status ?? "completed"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, record.status ?? "completed"));
        publish("updated");
      }
    });

    let reply: string;
    try {
      const generated = await createConstructAgentRuntime().runAgentic({
        id: "construct-flow-research-agent",
        featureId: "construct-flow",
        name: "Construct Flow Research",
        purpose: "Construct Flow research agent",
        instructions: FLOW_RESEARCH_AGENT_PROMPT,
        prompt: buildResearchPrompt(project),
        tools: protocol.tools,
        maxSteps: 10,
        maxRetries: 2,
        onTrace: (entry) => {
          applyTrace(session, entry);
          publish("updated");
        }
      });
      reply = generated.text.trim() || "Research completed.";
    } catch (error) {
      reply = "Research failed before completion.";
      await this.options.flowMemory.update(project, [{
        file: "research.md",
        content: `# Research\n\nResearch failed before completion.\n\nError: ${error instanceof Error ? error.message : String(error)}\n`
      }]);
      session.status = "error";
      session.errorMessage = error instanceof Error ? error.message : String(error);
    }

    project.flow.researchCompletedAt = new Date().toISOString();
    project.flow.updatedAt = new Date().toISOString();
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });
    if (!session.timeline.some((part) => part.kind === "message" && part.text.trim())) {
      upsertTimelinePart(session.timeline, {
        id: `${session.id}:reply`,
        kind: "message",
        status: session.status === "error" ? "error" : "completed",
        text: reply,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    session.status = session.status === "error" ? "error" : "completed";
    const result: ConstructFlowAgentResult = {
      session: cloneSession(session),
      reply,
      actions: []
    };
    publish(session.status === "error" ? "error" : "completed", result);
    return result;
  }

  async submitPracticeTask(
    project: StoredFlowProject,
    taskId: string,
    note?: string,
    subtaskId?: string
  ): Promise<ConstructFlowTaskSubmission> {
    const task = findPracticeTask(project, taskId);
    const baseline = task.baseline;
    const current = await captureBaseline(project, this.options.workspace, task.taskFiles);
    const submission = diffBaseline(baseline, current, taskId, note);
    submission.subtaskId = subtaskId;
    submission.authoredBy = {
      actor: "learner",
      label: "Submitted by learner",
      reason: "Diff captured when the learner submitted the task.",
      createdAt: submission.submittedAt
    };
    task.status = "submitted";
    const activeSubtask = subtaskId
      ? task.subtasks?.find((candidate) => candidate.id === subtaskId)
      : task.subtasks?.find((candidate) => candidate.status === "active");
    if (activeSubtask) {
      activeSubtask.status = "submitted";
    }
    task.submittedAt = submission.submittedAt;
    task.learnerNote = note;
    task.submission = submission;
    project.flow.updatedAt = submission.submittedAt;
    return submission;
  }

  private createSession(project: StoredFlowProject, input: ConstructFlowAgentInput): ConstructFlowSession {
    const now = new Date().toISOString();
    const origin = input.taskSubmission
      ? "task-submission"
      : input.questionResponse
        ? "question-response"
        : input.startReason
          ? "system"
          : "user";
    const messages = origin === "question-response" || origin === "system"
      ? []
      : [{
          id: randomUUID(),
          role: "user" as const,
          content: input.taskSubmission
            ? `${input.message}\n\nTask submission:\n${input.taskSubmission.compactDiff}${input.taskSubmission.note ? `\n\nLearner note: ${input.taskSubmission.note}` : ""}`
            : input.message,
          createdAt: now
        }];
    return {
      id: randomUUID(),
      projectId: project.id,
      threadId: input.threadId ?? project.flow.threadId,
      origin,
      questionResponse: input.questionResponse,
      messages,
      status: "running",
      toolCalls: [],
      agentEvents: [],
      timeline: [],
      actions: [],
      practiceTasks: [],
      createdAt: now,
      updatedAt: now
    };
  }

  private createPlanLearningPathTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "plan-learning-path",
      description: "Create or revise the learner-aware Flow path after profiling the learner. Use after updating learner.md and whenever the path needs to change. This is the structured project path, not a filesystem path.",
      inputSchema: z.object({
        reason: z.string().min(1).max(800).describe("Why this path is being created or revised now"),
        currentNodeId: z.string().min(1).max(120).optional().describe("Node that should be active now. Defaults to the first non-completed node."),
        nodes: z.array(z.object({
          id: z.string().min(1).max(120).describe("Stable node id, e.g. swift-fundamentals or build-first-list"),
          title: z.string().min(1).max(120),
          summary: z.string().min(1).max(500),
          kind: z.enum(["profile", "foundation", "build", "connect", "polish", "ship", "custom"]).default("custom"),
          learnerLevel: z.enum(["new", "beginner", "comfortable", "advanced", "unknown"]).default("unknown"),
          concepts: z.array(z.string().min(1).max(120)).max(16).optional(),
          entryCriteria: z.array(z.string().min(1).max(220)).max(8).optional(),
          exitCriteria: z.array(z.string().min(1).max(220)).max(8).optional(),
          researchNotes: z.array(z.string().min(1).max(300)).max(8).optional(),
          status: z.enum(["planned", "active", "completed", "blocked", "revising"]).optional()
        })).min(1).max(14)
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const existingById = new Map((project.flow.pathNodes ?? []).map((node) => [node.id, node]));
        const completedIds = new Set((project.flow.pathNodes ?? [])
          .filter((node) => node.status === "completed")
          .map((node) => node.id));
        const explicitCurrent = toolInput.currentNodeId && toolInput.nodes.some((node) => node.id === toolInput.currentNodeId)
          ? toolInput.currentNodeId
          : null;
        const firstOpenNode = toolInput.nodes.find((node) => !completedIds.has(node.id) && node.status !== "completed");
        const currentNodeId = explicitCurrent ?? firstOpenNode?.id ?? toolInput.nodes[0]?.id ?? null;
        const previousTaskIdsByNode = collectTaskIdsByNode(project);

        const nextNodes: ConstructFlowPathNode[] = toolInput.nodes.map((node, index) => {
          const existing = existingById.get(node.id);
          const status = node.status
            ?? (completedIds.has(node.id) ? "completed" : node.id === currentNodeId ? "active" : "planned");
          return {
            id: node.id,
            title: node.title,
            summary: node.summary,
            status,
            order: index,
            kind: node.kind,
            learnerLevel: node.learnerLevel,
            concepts: normalizeConceptIds(node.concepts ?? [], project),
            taskIds: previousTaskIdsByNode.get(node.id) ?? existing?.taskIds ?? [],
            entryCriteria: node.entryCriteria,
            exitCriteria: node.exitCriteria,
            researchNotes: node.researchNotes,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            completedAt: status === "completed" ? existing?.completedAt ?? now : undefined
          };
        });

        project.flow.pathNodes = nextNodes;
        project.flow.currentPathNodeId = currentNodeId;
        project.flow.pathCreatedAt ??= now;
        project.flow.pathUpdatedAt = now;
        project.flow.updatedAt = now;
        project.progress = this.options.workspace.calculateProgress(project);

        await this.options.flowMemory.updateWithDiff(project, [{
          file: "path.md",
          reason: toolInput.reason,
          content: formatPathMemory(project, toolInput.reason)
        }]);

        publish("updated");
        return {
          planned: true,
          reason: toolInput.reason,
          currentNodeId,
          nodeCount: nextNodes.length,
          nodes: nextNodes
        };
      }
    });
  }

  private createPracticeTaskTool(
    project: StoredFlowProject,
    session: ConstructFlowSession,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "practice-task",
      description: "Create a real learner coding task in the workspace only after the required concepts have been introduced. Prepare files, capture a baseline of relevant task files, focus code, and wait for the learner to submit.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(2_000),
        focus: z.object({
          path: z.string().min(1),
          line: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional()
        }).optional(),
        pathNodeId: z.string().min(1).max(120).optional().describe("Path node this task belongs to. Defaults to the current active path node."),
        taskFiles: z.array(z.string().min(1)).min(1).describe("List of files relevant to this task for scoped diffing"),
        successCriteria: z.array(z.string().min(1).max(300)).min(1).max(8).optional().describe("What must be true before this task is done"),
        subtasks: z.array(z.object({
          title: z.string().min(1).max(120),
          prompt: z.string().min(1).max(1_200),
          successCriteria: z.array(z.string().min(1).max(300)).max(6).optional()
        })).max(8).optional().describe("Optional ordered subtasks for the learner"),
        preparations: z.array(z.object({
          path: z.string().min(1),
          content: z.string(),
          mode: z.enum(["create", "overwrite", "replace"]),
          find: z.string().optional()
        })).optional().describe("Files to prepare/scaffold for the learner"),
        introducedConceptIds: z.array(z.string().min(1)).min(1).describe("Concept IDs already introduced before this task. Required; if none exist yet, explain and record the concept before creating the task."),
        conceptIds: z.array(z.string().min(1)).optional().describe("Optional extra related concept IDs; introducedConceptIds is the required prerequisite set")
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const pathNodeId = toolInput.pathNodeId ?? project.flow.currentPathNodeId ?? firstActivePathNode(project)?.id;
        const introducedConceptIds = normalizeConceptIds(toolInput.introducedConceptIds, project);
        const relatedConceptIds = normalizeConceptIds(toolInput.conceptIds ?? toolInput.introducedConceptIds, project);
        const store = this.options.learningStore();
        const state = await store.getState();
        const knownConceptIds = new Set(uniqueKnowledgeConcepts(Object.values(state.knowledgeBase.concepts)).map((concept) => concept.id));
        const missingConceptIds = introducedConceptIds.filter((conceptId) => !knownConceptIds.has(conceptId));
        if (missingConceptIds.length > 0) {
          throw new Error(`Practice tasks require introduced concepts. Missing concept records: ${missingConceptIds.join(", ")}.`);
        }
        if (toolInput.preparations && toolInput.preparations.length > 0) {
          await applyTaskPreparations(project, this.options.workspace, toolInput.preparations);
        }
        const baseline = await captureBaseline(project, this.options.workspace, toolInput.taskFiles);
        const task: ConstructFlowPracticeTask = {
          id: randomUUID(),
          projectId: project.id,
          sessionId: session.id,
          pathNodeId,
          title: toolInput.title,
          prompt: toolInput.prompt,
          focus: toolInput.focus,
          status: "waiting",
          baseline,
          createdAt: now,
          taskFiles: toolInput.taskFiles,
          conceptIds: relatedConceptIds,
          introducedConceptIds,
          successCriteria: toolInput.successCriteria,
          subtasks: (toolInput.subtasks?.length ? toolInput.subtasks : [{
            title: toolInput.title,
            prompt: toolInput.prompt,
            successCriteria: toolInput.successCriteria
          }]).map((subtask, index) => ({
            id: randomUUID(),
            title: subtask.title,
            prompt: subtask.prompt,
            successCriteria: subtask.successCriteria,
            status: index === 0 ? "active" : "ready"
          })),
          preparedFiles: toolInput.preparations?.map((prep) => ({
            path: prep.path,
            mode: prep.mode,
            authoredBy: {
              actor: "agent",
              label: "Prepared by Flow agent",
              reason: "Task setup prepared before learner work.",
              createdAt: now
            }
          })),
          authoredBy: {
            actor: "agent",
            label: "Created by Flow agent",
            reason: "Practice task authored by the mentor after checking concept readiness.",
            createdAt: now
          }
        };
        if (pathNodeId) {
          attachTaskToPathNode(project, pathNodeId, task.id);
        }
        session.practiceTasks.push(task);
        project.flow.updatedAt = now;
        publish("updated");
        return {
          created: true,
          taskId: task.id,
          pathNodeId: task.pathNodeId,
          title: task.title,
          prompt: task.prompt,
          focus: task.focus,
          taskFiles: task.taskFiles,
          conceptIds: task.conceptIds,
          introducedConceptIds: task.introducedConceptIds,
          successCriteria: task.successCriteria,
          subtasks: task.subtasks,
          preparedFiles: task.preparedFiles
        };
      }
    });
  }

  private createAddConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "add-concept",
      description: "Introduce a new concept with a dot-notated hierarchical ID, title, and content. Parent concepts will be auto-created if they do not exist.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The dot-notated hierarchical ID, e.g., 'typescript.syntax.interface'"),
        title: z.string().min(1).describe("Short user-friendly title of the concept"),
        language: conceptLanguageSchema.default("unknown").describe("Primary programming language family for the concept. Use unknown only when it genuinely is not language-specific."),
        technology: z.string().min(1).max(80).optional().describe("Primary framework, library, API, or platform, e.g. SwiftUI, GLFW, OpenGL, React."),
        content: z.string().min(1).describe("Rich, detailed free-form markdown explanation of the concept"),
        examples: z.array(z.string()).optional().describe("Code examples illustrating the concept"),
        relatedConcepts: z.array(z.string()).optional().describe("IDs of related concepts"),
        confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional().default("unknown").describe("Learner's current confidence level with this concept"),
        reason: z.string().min(1).max(700).describe("Exact reason this concept is being created now"),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8).describe("Concrete evidence from the learner, task diff, project, or conversation"),
        confidenceReason: z.string().max(700).optional().describe("Required when confidence is not unknown"),
        authoredBy: z.enum(["learner", "agent", "mixed", "system"]).default("agent"),
        agentContributionPercent: z.number().min(0).max(100).optional()
      }).strict().superRefine((input, ctx) => {
        if (input.confidence && input.confidence !== "unknown" && !input.confidenceReason?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confidenceReason"],
            message: "Concept confidence changes require an exact confidence reason."
          });
        }
      }),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const store = this.options.learningStore();
        const state = await store.getState();
        const conceptId = normalizeConceptId(toolInput.id, project);
        const existingConcepts = uniqueKnowledgeConcepts(Object.values(state.knowledgeBase.concepts));
        const existingRecord = findKnowledgeConceptById(existingConcepts, conceptId);

        const parts = conceptId.split(".");
        for (let i = 1; i < parts.length; i++) {
          const parentId = parts.slice(0, i).join(".");
          const parentExists = existingConcepts.some((c) => c.id === parentId);
          if (!parentExists) {
            const parentParts = parentId.split(".");
            const parentTitle = parentParts[parentParts.length - 1];
            const friendlyParentTitle = parentTitle.charAt(0).toUpperCase() + parentTitle.slice(1);
            const parentStub: KnowledgeBaseRecord = {
              id: parentId,
              sourceProjectId: project.id,
              sourceProjectTitle: project.title,
              title: friendlyParentTitle,
              kind: "concept",
              language: toolInput.language,
              technology: toolInput.technology,
              tags: [],
              summary: `Parent concept stub for ${parentId}`,
              why: "",
              examples: [],
              docs: [],
              content: "",
              confidence: "unknown",
              lastChangeReason: `Auto-created parent while adding ${conceptId}.`,
              learnerEvidence: [`Parent concept required for hierarchy ${conceptId}.`],
              authoredBy: "system",
              agentContributionPercent: 100,
              parentId: parentParts.length > 1 ? parentParts.slice(0, -1).join(".") : null,
              savedAt: now,
              openCount: 0,
              usedInRecall: false,
              lastModifiedAt: now
            };
            await store.saveKnowledgeConcept(parentStub);
          }
        }

        const parentId = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
        const newRecord: KnowledgeBaseRecord = {
          ...existingRecord,
          id: conceptId,
          sourceProjectId: existingRecord?.sourceProjectId ?? project.id,
          sourceProjectTitle: existingRecord?.sourceProjectTitle ?? project.title,
          title: toolInput.title,
          kind: "concept",
          language: toolInput.language,
          technology: toolInput.technology,
          tags: parts.slice(0, -1),
          summary: toolInput.content.split("\n")[0] || toolInput.title,
          why: "",
          example: toolInput.examples?.[0] || "",
          examples: toolInput.examples ?? [],
          docs: [],
          content: toolInput.content,
          confidence: toolInput.confidence,
          lastChangeReason: toolInput.reason,
          learnerEvidence: toolInput.evidence,
          confidenceReason: toolInput.confidenceReason,
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent,
          relatedConcepts: toolInput.relatedConcepts ?? [],
          parentId,
          savedAt: existingRecord?.savedAt ?? now,
          openedAt: existingRecord?.openedAt,
          openCount: existingRecord?.openCount ?? 0,
          usedInRecall: existingRecord?.usedInRecall ?? false,
          lastModifiedAt: now
        };

        await store.saveKnowledgeConcept(newRecord);
        publish("updated");

        return {
          introduced: !existingRecord,
          created: !existingRecord,
          canonicalId: conceptId,
          normalizedFrom: conceptId === toolInput.id ? undefined : toolInput.id,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          confidenceReason: toolInput.confidenceReason,
          concept: newRecord
        };
      }
    });
  }

  private createModifyConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "modify-concept",
      description: "Modify an existing concept. Only the fields provided in the patch will be updated.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The ID of the concept to modify"),
        title: z.string().optional().describe("New title"),
        language: conceptLanguageSchema.optional().describe("Updated primary programming language family for the concept"),
        technology: z.string().min(1).max(80).optional().describe("Updated primary framework, library, API, or platform"),
        content: z.string().optional().describe("New markdown explanation"),
        examples: z.array(z.string()).optional().describe("New code examples"),
        relatedConcepts: z.array(z.string()).optional().describe("New related concepts"),
        confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional().describe("Updated learner confidence level"),
        reason: z.string().min(1).max(700).describe("Exact reason this concept is changing"),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8).describe("Concrete evidence that justifies this change"),
        confidenceReason: z.string().max(700).optional().describe("Required when confidence is provided"),
        authoredBy: z.enum(["learner", "agent", "mixed", "system"]).default("agent"),
        agentContributionPercent: z.number().min(0).max(100).optional()
      }).strict().superRefine((input, ctx) => {
        if (input.confidence && !input.confidenceReason?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confidenceReason"],
            message: "Concept confidence changes require an exact confidence reason."
          });
        }
      }),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const store = this.options.learningStore();
        const state = await store.getState();
        const conceptId = normalizeConceptId(toolInput.id, project);
        const existing = findKnowledgeConceptById(Object.values(state.knowledgeBase.concepts), conceptId);
        if (!existing) {
          throw new Error(`Concept with ID ${conceptId} not found in the learner's global concepts.`);
        }

        const updatedRecord: KnowledgeBaseRecord = {
          ...existing,
          id: conceptId,
          title: toolInput.title ?? existing.title,
          language: toolInput.language ?? existing.language,
          technology: toolInput.technology ?? existing.technology,
          content: toolInput.content ?? existing.content,
          example: toolInput.examples ? (toolInput.examples[0] || "") : existing.example,
          examples: toolInput.examples ?? existing.examples,
          relatedConcepts: toolInput.relatedConcepts ?? existing.relatedConcepts,
          confidence: toolInput.confidence ?? existing.confidence,
          lastChangeReason: toolInput.reason,
          learnerEvidence: toolInput.evidence,
          confidenceReason: toolInput.confidenceReason ?? existing.confidenceReason,
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent ?? existing.agentContributionPercent,
          lastModifiedAt: now
        };

        if (toolInput.content) {
          updatedRecord.summary = toolInput.content.split("\n")[0] || updatedRecord.title;
        }

        await store.saveKnowledgeConcept(updatedRecord);
        publish("updated");

        return {
          modified: true,
          canonicalId: conceptId,
          normalizedFrom: conceptId === toolInput.id ? undefined : toolInput.id,
          previousConfidence: existing.confidence,
          nextConfidence: updatedRecord.confidence,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          confidenceReason: toolInput.confidenceReason,
          concept: updatedRecord
        };
      }
    });
  }

  private createRemoveConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "remove-concept",
      description: "Remove a concept by ID.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The ID of the concept to remove"),
        reason: z.string().min(1).max(700).describe("Exact reason the concept should be removed"),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8).describe("Concrete evidence that removal is appropriate")
      }).strict(),
      execute: async (toolInput) => {
        const store = this.options.learningStore();
        const state = await store.getState();
        const conceptId = normalizeConceptId(toolInput.id, project);
        const existing = findKnowledgeConceptById(Object.values(state.knowledgeBase.concepts), conceptId);
        await store.removeKnowledgeConcept(existing?.sourceProjectId ?? project.id, conceptId);
        publish("updated");

        return {
          removed: true,
          id: conceptId,
          normalizedFrom: conceptId === toolInput.id ? undefined : toolInput.id,
          reason: toolInput.reason,
          evidence: toolInput.evidence
        };
      }
    });
  }

  private createFetchConceptsTool(project: StoredFlowProject): ToolsInput[string] {
    return createTool({
      id: "fetch-concepts",
      description: "Read the learner's global concept records by exact ID or search query before citing, updating, or teaching from them.",
      inputSchema: z.object({
        conceptIds: z.array(z.string().min(1)).max(8).optional().describe("Exact concept IDs to fetch when known"),
        query: z.string().min(1).max(160).optional().describe("Search query for concept ID, title, summary, content, evidence, tags, language, or technology"),
        includeContent: z.boolean().default(false).describe("Include full content/examples/evidence details when the summary is not enough"),
        limit: z.number().int().min(1).max(12).default(8).describe("Maximum number of concepts to return")
      }).strict().superRefine((input, ctx) => {
        if (!input.conceptIds?.length && !input.query?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query"],
            message: "Provide conceptIds or query."
          });
        }
      }),
      execute: async (toolInput) => {
        const store = this.options.learningStore();
        const state = await store.getState();
        const concepts = uniqueKnowledgeConcepts(Object.values(state.knowledgeBase.concepts));
        const selected = new Map<string, KnowledgeBaseRecord>();
        const limit = toolInput.limit ?? 8;
        const includeContent = toolInput.includeContent ?? false;
        const normalizedIds = normalizeConceptIds(toolInput.conceptIds ?? [], project);

        for (const conceptId of normalizedIds) {
          const concept = findKnowledgeConceptById(concepts, conceptId);
          if (concept) selected.set(concept.id, concept);
        }

        const query = toolInput.query?.trim();
        if (query) {
          const normalizedQuery = query.toLowerCase();
          const terms = normalizedQuery.split(/[^a-z0-9#.+-]+/i).filter(Boolean);
          const matches = concepts
            .map((concept) => ({
              concept,
              score: scoreConceptMatch(concept, normalizedQuery, terms)
            }))
            .filter((match) => match.score > 0)
            .sort((a, b) => b.score - a.score || a.concept.id.localeCompare(b.concept.id));

          for (const match of matches) {
            selected.set(match.concept.id, match.concept);
            if (selected.size >= limit) break;
          }
        }

        const results = [...selected.values()].slice(0, limit);
        return {
          count: results.length,
          query,
          requestedIds: normalizedIds,
          concepts: results.map((concept) => serializeConceptForAgent(concept, includeContent))
        };
      }
    });
  }

  private createSuggestConceptTool(
    project: StoredFlowProject,
    concepts: KnowledgeBaseRecord[],
    actionsFromTools: ConstructFlowAction[],
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "suggest-existing-concept",
      description: "Point the learner to an existing concept instead of re-explaining it. Use before explaining when an existing concept already covers the topic.",
      inputSchema: z.object({
        conceptId: z.string().min(1),
        reason: z.string().min(1).max(700),
        label: z.string().min(1).max(80).default("Open concept")
      }).strict(),
      execute: async (toolInput) => {
        const conceptId = normalizeConceptId(toolInput.conceptId, project);
        const concept = concepts.find((candidate) => candidate.id === conceptId);
        if (!concept) {
          throw new Error(`Concept ${conceptId} does not exist in the learner's global concepts.`);
        }
        const action: ConstructFlowAction = {
          type: "open-concept",
          conceptId: concept.id,
          label: toolInput.label ?? `Open ${concept.title}`,
          reason: toolInput.reason
        };
        actionsFromTools.push(action);
        publish("updated");
        return {
          action,
          concept: {
            id: concept.id,
            title: concept.title,
            summary: concept.summary
          }
        };
      }
    });
  }

  private createCompleteSubtaskTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "complete-subtask",
      description: "Mark a task subtask complete only after reviewing learner evidence or a submitted diff.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        subtaskId: z.string().min(1),
        evidence: z.string().min(1).max(1_000)
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        const subtask = task.subtasks?.find((candidate) => candidate.id === toolInput.subtaskId);
        if (!subtask) {
          throw new Error(`Unknown Flow subtask: ${toolInput.subtaskId}`);
        }
        subtask.status = "completed";
        subtask.completedAt = new Date().toISOString();
        subtask.evidence = toolInput.evidence;

        const nextReady = task.subtasks?.find((candidate) => candidate.status === "ready");
        if (nextReady) {
          nextReady.status = "active";
          task.status = "waiting";
        }
        publish("updated");
        return {
          completed: true,
          taskId: task.id,
          subtaskId: subtask.id,
          evidence: toolInput.evidence,
          nextSubtaskId: nextReady?.id ?? null
        };
      }
    });
  }

  private createCompleteTaskTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "complete-task",
      description: "Mark a full Flow task done only when every required concept and subtask has enough evidence.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        summary: z.string().min(1).max(1_200),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8)
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        task.status = "completed";
        if (task.subtasks) {
          task.subtasks = task.subtasks.map((subtask) => ({
            ...subtask,
            status: subtask.status === "completed" ? subtask.status : "completed",
            completedAt: subtask.completedAt ?? new Date().toISOString(),
            evidence: subtask.evidence ?? toolInput.evidence.join("\n")
          }));
        }
        if (task.pathNodeId) {
          markPathNodeProgress(project, task.pathNodeId);
        }
        project.flow.updatedAt = new Date().toISOString();
        project.progress = this.options.workspace.calculateProgress(project);
        publish("updated");
        return {
          completed: true,
          taskId: task.id,
          title: task.title,
          summary: toolInput.summary,
          evidence: toolInput.evidence
        };
      }
    });
  }
}

function findPracticeTask(project: StoredFlowProject, taskId: string): ConstructFlowPracticeTask {
  const task = project.flow.sessions
    .flatMap((session) => session.practiceTasks)
    .find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Unknown Flow practice task: ${taskId}`);
  }
  return task;
}

function uniqueKnowledgeConcepts(records: KnowledgeBaseRecord[]): KnowledgeBaseRecord[] {
  const byId = new Map<string, KnowledgeBaseRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || Date.parse(record.lastModifiedAt ?? record.savedAt) > Date.parse(existing.lastModifiedAt ?? existing.savedAt)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function findKnowledgeConceptById(records: KnowledgeBaseRecord[], conceptId: string): KnowledgeBaseRecord | undefined {
  return uniqueKnowledgeConcepts(records).find((record) => record.id === conceptId);
}

function scoreConceptMatch(concept: KnowledgeBaseRecord, normalizedQuery: string, terms: string[]): number {
  const id = concept.id.toLowerCase();
  const title = concept.title.toLowerCase();
  const haystack = conceptSearchHaystack(concept).toLowerCase();
  let score = 0;

  if (id === normalizedQuery) score += 100;
  if (title === normalizedQuery) score += 80;
  if (id.includes(normalizedQuery)) score += 35;
  if (title.includes(normalizedQuery)) score += 30;
  if (concept.summary?.toLowerCase().includes(normalizedQuery)) score += 18;
  if (concept.content?.toLowerCase().includes(normalizedQuery)) score += 10;

  for (const term of terms) {
    if (id.includes(term)) score += 8;
    if (title.includes(term)) score += 7;
    if (haystack.includes(term)) score += 3;
  }

  return score;
}

function conceptSearchHaystack(concept: KnowledgeBaseRecord): string {
  return [
    concept.id,
    concept.title,
    concept.summary,
    concept.content,
    concept.language,
    concept.technology,
    concept.confidence,
    concept.confidenceReason,
    concept.lastChangeReason,
    ...(concept.tags ?? []),
    ...(concept.relatedConcepts ?? []),
    ...(concept.examples ?? []),
    ...(concept.learnerEvidence ?? [])
  ].filter(Boolean).join("\n");
}

function serializeConceptForAgent(concept: KnowledgeBaseRecord, includeContent: boolean) {
  const compact = {
    id: concept.id,
    parentId: concept.parentId,
    title: concept.title,
    language: concept.language,
    technology: concept.technology,
    summary: concept.summary,
    confidence: concept.confidence,
    confidenceReason: concept.confidenceReason,
    learnerEvidence: concept.learnerEvidence,
    lastChangeReason: concept.lastChangeReason,
    authoredBy: concept.authoredBy,
    agentContributionPercent: concept.agentContributionPercent,
    relatedConcepts: concept.relatedConcepts,
    savedAt: concept.savedAt,
    lastModifiedAt: concept.lastModifiedAt
  };

  if (!includeContent) return compact;

  return {
    ...compact,
    why: concept.why,
    content: concept.content,
    examples: concept.examples,
    docs: concept.docs
  };
}

function normalizeConceptIds(conceptIds: string[], project: StoredFlowProject): string[] {
  return [...new Set(conceptIds.map((id) => normalizeConceptId(id, project)).filter(Boolean))];
}

function normalizeConceptId(conceptId: string, project: StoredFlowProject): string {
  const parts = conceptId
    .trim()
    .toLowerCase()
    .replace(/[/:]+/g, ".")
    .split(".")
    .map((part) => part.trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  const projectTokens = projectSpecificConceptSegments(project);
  const cleaned = parts.filter((part, index) => index === 0 || !projectTokens.has(part));
  return (cleaned.length ? cleaned : parts).join(".");
}

function projectSpecificConceptSegments(project: StoredFlowProject): Set<string> {
  const values = [
    project.id,
    project.title,
    project.description,
    project.flow.goal
  ];
  const tokens = new Set<string>();
  for (const value of values) {
    const wordTokens = String(value ?? "").toLowerCase().split(/[^a-z0-9]+/g).filter((token) => token.length >= 2);
    const compact = String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (compact.length >= 4) {
      tokens.add(compact);
      tokens.add(compact.replace(/project$/, ""));
    }
    for (const token of wordTokens) {
      if (token.length >= 4) tokens.add(token);
    }
    for (let index = 0; index < wordTokens.length - 1; index += 1) {
      const joined = `${wordTokens[index]}${wordTokens[index + 1]}`;
      if (joined.length >= 4) tokens.add(joined);
    }
  }
  for (const token of [...tokens]) {
    if (token.endsWith("app") && token.length > 4) {
      tokens.add(token.slice(0, -3));
    }
  }
  return tokens;
}

function collectTaskIdsByNode(project: StoredFlowProject): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const task of project.flow.sessions.flatMap((session) => session.practiceTasks)) {
    if (!task.pathNodeId) continue;
    ids.set(task.pathNodeId, [...(ids.get(task.pathNodeId) ?? []), task.id]);
  }
  return ids;
}

function firstActivePathNode(project: StoredFlowProject): ConstructFlowPathNode | undefined {
  return [...(project.flow.pathNodes ?? [])]
    .sort((a, b) => a.order - b.order)
    .find((node) => node.status === "active" || node.status === "revising" || node.status === "blocked")
    ?? [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order).find((node) => node.status !== "completed");
}

function attachTaskToPathNode(project: StoredFlowProject, pathNodeId: string, taskId: string): void {
  const node = project.flow.pathNodes?.find((candidate) => candidate.id === pathNodeId);
  if (!node) return;
  node.taskIds = [...new Set([...(node.taskIds ?? []), taskId])];
  node.updatedAt = new Date().toISOString();
}

function markPathNodeProgress(project: StoredFlowProject, pathNodeId: string): void {
  const nodes = [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order);
  const node = nodes.find((candidate) => candidate.id === pathNodeId);
  if (!node) return;
  const nodeTasks = project.flow.sessions
    .flatMap((session) => session.practiceTasks)
    .filter((task) => task.pathNodeId === pathNodeId);
  if (!nodeTasks.length || nodeTasks.some((task) => task.status !== "completed")) return;

  const now = new Date().toISOString();
  node.status = "completed";
  node.completedAt = now;
  node.updatedAt = now;
  const nextNode = nodes.find((candidate) => candidate.order > node.order && candidate.status !== "completed");
  if (nextNode) {
    nextNode.status = "active";
    nextNode.updatedAt = now;
    project.flow.currentPathNodeId = nextNode.id;
  } else {
    project.flow.currentPathNodeId = node.id;
  }
  project.flow.pathUpdatedAt = now;
}

function formatPathMemory(project: StoredFlowProject, reason: string): string {
  const nodes = [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order);
  return [
    "# Path",
    "",
    `Current node: ${project.flow.currentPathNodeId ?? "not selected"}`,
    "",
    `Reason: ${reason}`,
    "",
    "## Nodes",
    "",
    ...nodes.flatMap((node) => [
      `### ${node.order + 1}. ${node.title}`,
      "",
      `Status: ${node.status}`,
      "",
      node.summary,
      "",
      node.concepts?.length ? `Concepts: ${node.concepts.join(", ")}` : "Concepts: none recorded yet.",
      "",
      node.entryCriteria?.length ? `Entry criteria: ${node.entryCriteria.join("; ")}` : "Entry criteria: none.",
      "",
      node.exitCriteria?.length ? `Exit criteria: ${node.exitCriteria.join("; ")}` : "Exit criteria: none.",
      ""
    ]),
    "## Handoff",
    "",
    "Use the structured Flow path on the project record as the source of truth. Revise this path when learner evidence changes."
  ].join("\n");
}

async function applyTaskPreparations(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  preparations: Array<{ path: string; content: string; mode: "create" | "overwrite" | "replace"; find?: string }>
) {
  for (const prep of preparations) {
    const target = workspace.safeProjectPath(project, prep.path);
    await mkdir(path.dirname(target), { recursive: true });

    if (prep.mode === "create" || prep.mode === "overwrite") {
      await writeFile(target, prep.content, "utf8");
    } else if (prep.mode === "replace") {
      let currentContent = existsSync(target) ? await readFile(target, "utf8") : "";
      if (prep.find !== undefined) {
        const index = currentContent.indexOf(prep.find);
        if (index < 0) {
          throw new Error(`Could not find target string "${prep.find}" in file ${prep.path}`);
        }
        currentContent = `${currentContent.slice(0, index)}${prep.content}${currentContent.slice(index + prep.find.length)}`;
      } else {
        currentContent = prep.content;
      }
      await writeFile(target, currentContent, "utf8");
    }
  }
}

async function captureBaseline(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  taskFiles?: string[]
): Promise<ConstructFlowTaskBaseline> {
  const files = taskFiles && taskFiles.length > 0
    ? taskFiles
    : await listTextFiles(project, workspace);
  const entries = await Promise.all(
    files.map(async (file) => {
      const filePath = workspace.safeProjectPath(project, file);
      const content = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
      return [file, content] as const;
    })
  );
  return {
    capturedAt: new Date().toISOString(),
    files: Object.fromEntries(entries)
  };
}

function diffBaseline(
  baseline: ConstructFlowTaskBaseline,
  current: ConstructFlowTaskBaseline,
  taskId: string,
  note?: string
): ConstructFlowTaskSubmission {
  const paths = [...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])].sort();
  const chunks: string[] = [];
  const touchedFiles: string[] = [];
  for (const file of paths) {
    const before = baseline.files[file] ?? "";
    const after = current.files[file] ?? "";
    if (before === after) continue;
    touchedFiles.push(file);
    chunks.push(simpleUnifiedDiff(file, before, after));
  }
  const compactDiff = chunks.join("\n").slice(0, maxDiffChars);
  return {
    taskId,
    note,
    touchedFiles,
    compactDiff: compactDiff || "(no file changes)",
    nothingChanged: touchedFiles.length === 0,
    submittedAt: new Date().toISOString()
  };
}

function applyQuestionResponse(
  project: StoredFlowProject,
  response: ConstructFlowQuestionResponse | undefined
): ConstructFlowSession | undefined {
  if (!response) return undefined;
  const session = project.flow.sessions.find((candidate) => candidate.id === response.sessionId);
  if (!session) return undefined;
  const toolCall = session.toolCalls.find((candidate) => candidate.id === response.toolCallId);
  if (!toolCall || !isQuestionTool(toolCall.name)) return undefined;

  const answeredAt = response.answeredAt || new Date().toISOString();
  const question = response.question || readQuestionText(toolCall.input) || "Flow question";
  toolCall.response = {
    ...response,
    question,
    answeredAt
  };
  session.status = session.status === "waiting" ? "completed" : session.status;
  session.updatedAt = answeredAt;
  project.flow.updatedAt = answeredAt;
  return session;
}

function isQuestionTool(name: string | undefined): boolean {
  return normalizeToolName(name) === "askquestion" || normalizeToolName(name) === "askuser";
}

function normalizeToolName(name: string | undefined): string {
  return (name ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function readQuestionText(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const question = (input as { question?: unknown }).question;
  return typeof question === "string" && question.trim() ? question : undefined;
}

function simpleUnifiedDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const beforeContextEnd = Math.min(beforeLines.length - 1, beforeEnd + 3);
  const afterContextEnd = Math.min(afterLines.length - 1, afterEnd + 3);
  const removed = beforeLines.slice(contextStart, beforeContextEnd + 1);
  const added = afterLines.slice(contextStart, afterContextEnd + 1);
  return [
    `--- ${file}`,
    `+++ ${file}`,
    `@@ ${contextStart + 1} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`)
  ].join("\n");
}

async function listTextFiles(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  root = ""
): Promise<string[]> {
  const absoluteRoot = workspace.safeProjectPath(project, root || ".");
  const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(project, workspace, path.join(root, entry.name)));
      continue;
    }
    const fileStat = await stat(workspace.safeProjectPath(project, relativePath)).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > maxBaselineFileBytes) continue;
    files.push(relativePath);
  }
  return files;
}

function buildMainPrompt(
  project: StoredFlowProject,
  input: ConstructFlowAgentInput,
  memory: Array<{ file: string; content: string; updatedAt: string | null }>,
  concepts: KnowledgeBaseRecord[]
): string {
  const recent = project.flow.sessions.slice(-6).map((session) => ({
    id: session.id,
    status: session.status,
    origin: session.origin,
    messages: session.messages.slice(-2),
    toolCalls: session.toolCalls.map((tool) => ({
      name: tool.name,
      title: tool.title,
      status: tool.status,
      response: tool.response
        ? {
            question: tool.response.question,
            answer: tool.response.answer,
            skipped: tool.response.skipped === true
          }
        : undefined
    })).slice(-8)
  }));
  const latestInputLabel = input.taskSubmission
    ? "Latest task submission:"
    : input.taskMessage
      ? "Latest learner message inside an active task:"
    : input.questionResponse
      ? "Latest learner answer to tracked question:"
      : input.startReason === "new-project"
        ? "New project kickoff:"
        : "Latest learner message:";
  const latestInput = input.taskSubmission
    ? JSON.stringify(input.taskSubmission, null, 2)
    : input.taskMessage
      ? JSON.stringify({
          taskMessage: input.taskMessage,
          message: input.message
        }, null, 2)
    : input.questionResponse
      ? JSON.stringify({
          question: input.questionResponse.question,
          answer: input.questionResponse.answer,
          skipped: input.questionResponse.skipped === true
        }, null, 2)
      : input.message;
  return [
    `Project: ${project.title}`,
    `Goal: ${project.flow.goal}`,
    project.flow.stackPreference ? `Stack preference: ${project.flow.stackPreference}` : null,
    `Research enabled: ${project.flow.researchEnabled ? "yes" : "no"}`,
    `Research completed: ${project.flow.researchCompletedAt ? project.flow.researchCompletedAt : "no"}`,
    "",
    "Structured Flow Path:",
    JSON.stringify({
      currentPathNodeId: project.flow.currentPathNodeId,
      nodes: (project.flow.pathNodes ?? []).map((node) => ({
        id: node.id,
        title: node.title,
        status: node.status,
        order: node.order,
        kind: node.kind,
        learnerLevel: node.learnerLevel,
        concepts: node.concepts,
        taskIds: node.taskIds,
        entryCriteria: node.entryCriteria,
        exitCriteria: node.exitCriteria
      }))
    }, null, 2),
    "",
    "Active tasks:",
    JSON.stringify(project.flow.sessions
      .flatMap((session) => session.practiceTasks)
      .filter((task) => task.status === "waiting" || task.status === "submitted")
      .map((task) => ({
        id: task.id,
        pathNodeId: task.pathNodeId,
        title: task.title,
        status: task.status,
        conceptIds: task.conceptIds,
        introducedConceptIds: task.introducedConceptIds,
        successCriteria: task.successCriteria,
        subtasks: task.subtasks?.map((subtask) => ({
          id: subtask.id,
          title: subtask.title,
          status: subtask.status,
          successCriteria: subtask.successCriteria
        })),
        recentMessages: task.messages?.slice(-4)
      })), null, 2),
    "",
    "Flow Memory:",
    "project.md, path.md, and learner.md are preloaded here. Use flow-memory-patch for concise durable updates when meaningful work happens.",
    JSON.stringify(memory.map((item) => ({
      file: item.file,
      updatedAt: item.updatedAt,
      content: item.content.slice(0, 3_000)
    })), null, 2),
    "",
    "Concepts / Knowledge Base:",
    JSON.stringify(concepts.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      title: c.title,
      language: c.language,
      technology: c.technology,
      sourceProjectTitle: c.sourceProjectTitle,
      content: c.content,
      examples: c.examples,
      confidence: c.confidence,
      confidenceReason: c.confidenceReason,
      learnerEvidence: c.learnerEvidence,
      lastChangeReason: c.lastChangeReason,
      authoredBy: c.authoredBy,
      relatedConcepts: c.relatedConcepts
    })), null, 2),
    "",
    "Recent Flow context:",
    JSON.stringify(recent, null, 2),
    "",
    latestInputLabel,
    latestInput,
    "",
    "Use tools when workspace reality matters. For UI actions, call the relevant action tool instead of returning JSON. Before explaining a topic, check whether Concepts already cover it; if exact concept details or evidence matter, use fetch-concepts before suggesting, explaining, or updating. Reply naturally after tool work."
  ].filter(Boolean).join("\n");
}

function buildResearchPrompt(project: StoredFlowProject): string {
  return [
    `Project title: ${project.title}`,
    `Goal/description: ${project.flow.goal}`,
    project.flow.stackPreference ? `Stack preference: ${project.flow.stackPreference}` : null,
    "",
    "Research the domain/technology only as much as useful, then return concise researchMarkdown for research.md."
  ].filter(Boolean).join("\n");
}

function applyTrace(session: ConstructFlowSession, entry: ConstructAgentTraceEntry): void {
  if (entry.event) {
    upsertEvent(session.agentEvents, entry.event);
    const part = timelinePartFromRunEvent(entry.event);
    if (part) {
      upsertTimelinePart(session.timeline, part);
    }
  }
}

function upsertEvent(events: ConstructAgentRunEvent[], event: ConstructAgentRunEvent): void {
  const index = events.findIndex((candidate) => candidate.id === event.id);
  if (index >= 0) {
    events[index] = event;
  } else {
    events.push(event);
  }
}

function timelinePartFromRunEvent(event: ConstructAgentRunEvent): ConstructFlowTimelinePart | null {
  const updatedAt = new Date().toISOString();
  if (event.type === "iteration") return null;
  if (event.type === "tool" && isProtocolRecordedTool(event.toolName ?? event.title)) return null;
  if (event.type === "message") {
    return {
      id: event.id,
      kind: "message",
      status: event.status,
      text: event.text ?? "",
      createdAt: event.createdAt,
      updatedAt
    };
  }
  if (event.type === "reasoning") {
    return {
      id: event.id,
      kind: "reasoning",
      status: event.status,
      title: event.title,
      detail: event.detail,
      text: event.text,
      createdAt: event.createdAt,
      updatedAt
    };
  }
  return {
    id: event.id,
    kind: "tool",
    toolCallId: event.id,
    name: event.toolName ?? event.title,
    title: event.title,
    reason: event.detail,
    status: event.status,
    input: event.input,
    outputPreview: event.outputPreview,
    createdAt: event.createdAt,
    completedAt: event.status === "running" ? undefined : updatedAt,
    updatedAt
  };
}

function timelinePartFromToolRecord(
  record: ConstructProtocolToolRecord,
  status: ConstructFlowToolCallRecord["status"]
): ConstructFlowTimelinePart {
  return {
    id: record.id,
    kind: "tool",
    toolCallId: record.id,
    name: record.name,
    title: record.title,
    reason: record.reason,
    status,
    input: record.input,
    outputPreview: record.outputPreview,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.completedAt ?? new Date().toISOString()
  };
}

function upsertTimelinePart(parts: ConstructFlowTimelinePart[], part: ConstructFlowTimelinePart): void {
  const index = parts.findIndex((candidate) => candidate.id === part.id);
  if (index >= 0) {
    parts[index] = {
      ...parts[index],
      ...part,
      createdAt: parts[index].createdAt
    } as ConstructFlowTimelinePart;
  } else {
    parts.push(part);
  }
}

function toFlowToolRecord(
  record: ConstructProtocolToolRecord,
  status: ConstructFlowToolCallRecord["status"]
): ConstructFlowToolCallRecord {
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    reason: record.reason,
    input: record.input,
    outputPreview: record.outputPreview,
    status,
    createdAt: record.createdAt,
    completedAt: record.completedAt
  };
}

function replaceToolRecord(session: ConstructFlowSession, record: ConstructFlowToolCallRecord): void {
  const index = session.toolCalls.findIndex((candidate) => candidate.id === record.id);
  if (index >= 0) {
    session.toolCalls[index] = record;
  } else {
    session.toolCalls.push(record);
  }
}

function pickFlowMainProtocolTools(protocolTools: ToolsInput): ToolsInput {
  const allowed = [
    "read",
    "grep",
    "run-terminal-command",
    "ask-question",
    "askQuestion",
    "internet-fetch",
    "internetFetch",
    "flow-memory-patch"
  ];
  return Object.fromEntries(
    allowed
      .map((name) => [name, protocolTools[name]] as const)
      .filter((entry): entry is [string, ToolsInput[string]] => entry[1] !== undefined)
  );
}

const protocolRecordedToolNames = new Set([
  "read",
  "grep",
  "runterminalcommand",
  "askquestion",
  "internetfetch",
  "flowmemorypatch",
  "flowmemoryfetch",
  "internetsearch",
  "glob"
]);

function isProtocolRecordedTool(name: string | undefined): boolean {
  return protocolRecordedToolNames.has(normalizeToolName(name));
}

function extractAction(record: ConstructProtocolToolRecord): ConstructFlowAction[] {
  if (!record.outputPreview) return [];
  try {
    const parsed = JSON.parse(record.outputPreview) as { action?: ConstructFlowAction };
    return parsed.action ? [parsed.action] : [];
  } catch {
    return [];
  }
}

function findPendingLearnerQuestion(toolCalls: ConstructFlowToolCallRecord[]): ConstructFlowToolCallRecord | undefined {
  return [...toolCalls].reverse().find((toolCall) => (
    isQuestionTool(toolCall.name) && toolCall.status !== "error" && !toolCall.response
  ));
}

function cleanReplyForPendingQuestion(reply: string, pendingQuestion: ConstructFlowToolCallRecord | undefined): string {
  if (!pendingQuestion) return reply;
  const payload = readQuestionPayload(pendingQuestion);
  const choiceSet = new Set((payload.choices ?? []).map((choice) => choice.trim().toLowerCase()));
  let cleaned = reply
    .replace(/\n+\s*(?:choose|pick|select)\s+(?:one|an option)\s*:?\s*[\s\S]*$/i, "")
    .trim();

  if (!choiceSet.size) return cleaned;

  const lines = cleaned.split(/\r?\n/);
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (!last) {
      lines.pop();
      continue;
    }
    const normalized = last
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[\).]\s+/, "")
      .replace(/\*\*/g, "")
      .trim()
      .toLowerCase();
    if (!choiceSet.has(normalized)) break;
    lines.pop();
  }
  return lines.join("\n").trim();
}

function readQuestionPayload(toolCall: ConstructFlowToolCallRecord): { choices?: string[] } {
  const source = typeof toolCall.input === "object" && toolCall.input !== null
    ? toolCall.input as { choices?: unknown }
    : {};
  return {
    choices: Array.isArray(source.choices)
      ? source.choices.filter((choice): choice is string => typeof choice === "string")
      : undefined
  };
}

function mergeActions(primary: ConstructFlowAction[], secondary: ConstructFlowAction[]): ConstructFlowAction[] {
  const seen = new Set<string>();
  return [...secondary, ...primary].filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function trimSessions(project: StoredFlowProject): void {
  if (project.flow.sessions.length > 50) {
    project.flow.sessions = project.flow.sessions.slice(-50);
  }
}

function cloneSession(session: ConstructFlowSession): ConstructFlowSession {
  return {
    ...session,
    questionResponse: session.questionResponse ? { ...session.questionResponse } : undefined,
    messages: session.messages.map((message) => ({ ...message })),
    toolCalls: session.toolCalls.map((toolCall) => ({
      ...toolCall,
      response: toolCall.response ? { ...toolCall.response } : undefined
    })),
    agentEvents: session.agentEvents.map((event) => ({ ...event })),
    timeline: (session.timeline ?? []).map((part) => ({ ...part })),
    actions: session.actions.map((action) => ({ ...action })),
    practiceTasks: session.practiceTasks.map((task) => ({
      ...task,
      baseline: { ...task.baseline, files: { ...task.baseline.files } },
      conceptIds: task.conceptIds ? [...task.conceptIds] : undefined,
      introducedConceptIds: task.introducedConceptIds ? [...task.introducedConceptIds] : undefined,
      successCriteria: task.successCriteria ? [...task.successCriteria] : undefined,
      subtasks: task.subtasks?.map((subtask) => ({ ...subtask, successCriteria: subtask.successCriteria ? [...subtask.successCriteria] : undefined })),
      messages: task.messages?.map((message) => ({ ...message })),
      preparedFiles: task.preparedFiles?.map((file) => ({ ...file, authoredBy: { ...file.authoredBy } })),
      authoredBy: task.authoredBy ? { ...task.authoredBy } : undefined,
      submission: task.submission ? { ...task.submission, touchedFiles: [...task.submission.touchedFiles], authoredBy: task.submission.authoredBy ? { ...task.submission.authoredBy } : undefined } : undefined
    }))
  };
}

export const FLOW_MAIN_AGENT_PROMPT = `You are Construct Flow, an understanding-based coding mentor working inside a real project workspace.

You are not a code vending machine. Your job is to help the learner become capable of writing and understanding the project themselves.
You are not a coding agent. You are a teaching system that uses real tasks to let the learner practice only after the needed ideas are introduced.

The main Flow agent tools are read, grep, run-terminal-command, ask-question, internet-fetch, flow-memory-patch, plan-learning-path, practice-task, fetch-concepts, suggest-existing-concept, add-concept, modify-concept, remove-concept, complete-subtask, and complete-task. Keep the tool surface calm. Do not ask for or invent extra tools.

Project kickoff and path:
- When a new Flow project starts, first learn the learner and the project. Ask a good amount of tracked questions when needed. You may ask about prior experience, comfort level, goals, constraints, taste, and what they already understand, but choose questions naturally from the situation.
- Read the global Concepts / Knowledge Base in the prompt. Use it to avoid asking questions that are already answered, and to notice what the learner may already know.
- After profiling, update learner.md with flow-memory-patch.
- After updating learner.md, call plan-learning-path. The path must be based on the learner's abilities, the project goal, global concepts, and useful research. If the learner is new to a technology, begin with the beginner concepts before project-specific app work.
- The path is allowed to change. Revise it with plan-learning-path when learner evidence changes.
- Each practice-task belongs to the current path node unless there is a clear reason to place it elsewhere.

Concept-first tutoring:
- Concepts are global learner knowledge across projects. They are not per-project folders.
- Before explaining a topic, check the global Concepts / Knowledge Base in the prompt.
- Use fetch-concepts when you need exact concept content, examples, evidence, confidence, or related concepts. Use exact conceptIds when you know them and query search when you do not. Do not guess concept details from memory.
- Before modifying or removing a concept, fetch it first unless the full current record is already visible in the prompt or current tool output.
- If an existing concept covers the need, link it in chat with the inline markdown tag [[concept:concept.id|Concept title]] and briefly say why it is relevant instead of re-explaining.
- If the learner asks again, is confused, or needs help applying the concept, then explain in chat.
- After explaining, ask one focused Socratic question with ask-question when you need evidence of understanding.
- Normal chat is for ideas, mental models, questions, and review. Do not put implementation code blocks or broad code snippets in normal chat.
- Only create a practice-task after the relevant concepts have been introduced and recorded with add-concept, modify-concept, or suggest-existing-concept.
- Every practice-task must include introducedConceptIds. Those are the exact concepts the learner has already seen before the task begins.
- If no concept is introduced yet, teach first. Explain the idea, record the concept, check understanding when needed, then create the task.

When you teach or the learner demonstrates understanding, update the concepts database with evidence:
- After explaining something new, use add-concept or modify-concept to record it with reason and evidence.
- After a practice task is submitted and reviewed, use modify-concept to update the learner's confidence level only when the diff or chat proves it.
- Always set concept language using the enum swift, python, typescript, javascript, cpp, or unknown. Set technology when there is a clear framework, platform, or API such as SwiftUI, OpenGL, GLFW, React, or Node.
- Every confidence value other than unknown requires confidenceReason. Do not upgrade to weak/emerging/strong without exact evidence.
- Use dot-notated hierarchical IDs for reusable concepts (e.g. 'typescript.types.interfaces', 'react.hooks.state', 'swiftui.core-structure'). Max 3 levels deep (domain.area.topic).
- Do not include product/project/app names in concept IDs. For a notes app, use 'swiftui.core-structure', not 'swiftui.notesapp.core-structure'.
- Do not create smaller and smaller concepts. Group related sub-concepts inside parent concepts logically.
- Keep concept content detailed, natural, and free-form markdown so it can be easily read and modified. Write detailed text explanations.
- When a learner struggles, modify the concept to note the specific confusion point.
- Concepts are persistent memory of what the learner knows and what the agent wrote. Preserve authoredBy and evidence so future agents do not mistake agent-created content for learner mastery.

Stay natural. Do not reveal internal modes. Do not force responses into rigid templates. Respond like a strong human mentor reviewing and building with the learner.

Use Flow Memory as durable context. The current project, path, and learner memory are already in the prompt. Use flow-memory-patch for memory updates; do not rewrite full memory files from the agent unless recovering a broken file. Keep memory concise.

Prefer learner attempts. Tasks are the main unit of Flow progress. When the next step is a learner coding attempt, use the practice-task tool to create a real task card with the current path node, task files, prepared files when needed, success criteria, subtasks when useful, and introducedConceptIds. Prepared/scaffolded code is agent-authored; submitted diffs are learner-authored. Do not infer learner understanding from code you wrote.

Code belongs inside tasks, not ordinary mentor replies. If code must be prepared by the agent, it must be small, scoped to introducedConceptIds, and clearly marked through preparations/authorship. If the learner has not been introduced to the concept behind a code change, do not write that code yet.

Clickable file protocol:
- Whenever you mention a project file in chat, concept content, task prompts, subtask prompts, or review notes, use inline file refs: [[file:path/from/project.ext|label]].
- Include a line or range when useful: [[file:src/main.ts:24|src/main.ts:24]] or [[file:src/main.ts:24-41|the render loop]].
- If the UI should immediately open or focus a file, also call open-file or focus-code. Inline refs are for clickable text; action tools are for immediate navigation.
- For taskFiles, prepared files, and focus paths, use project-relative paths that the UI can open directly.

Do not build whole apps for the learner by hand. For project setup, use run-terminal-command with the normal scaffold command when one exists, then inspect and make small targeted changes only as task preparation. If a native scaffold command is unavailable, explain why, ask a tracked question if direction matters, or create the smallest learner task that can move understanding forward. Never hand-write a whole package.json, Xcode project, or broad app tree as a substitute for a real scaffold command.

When the latest input is a learner message inside an active task, treat it as task-scoped chat. Answer in the context of the active task and do not create a new task unless the path genuinely changes. When the latest input includes a task submission, act as a task-review mentor: inspect the compact diff and authoredBy metadata, compare it against the active subtask success criteria, update concepts only with evidence, call complete-subtask when a subtask is genuinely done, and call complete-task only when the whole task has enough evidence. If the diff is insufficient or ambiguous, ask-question with one focused follow-up.

If you need learner input, first give at most one short sentence of context in chat, then call ask-question. The ask-question.question field must be the direct question only, ideally one sentence. Do not duplicate the context in both prose and the tool question. Keep ask-question.reason short and internal; the learner UI does not show it. Do not put required learner questions only in prose. Never write "Choose one", a numbered option list, or the full question again in normal chat after calling ask-question; the UI renders choices. After ask-question, stop with a short acknowledgement if you need any prose at all.

On a new project kickoff, inspect the workspace or Flow Memory if useful. If research is not complete, decide naturally whether to ask the learner to research first, start without research, or clarify project direction with ask-question. Do not wait for a greeting before beginning, and do not create practice tasks before learner profiling and plan-learning-path unless the learner explicitly asks to skip planning.

Do not end with a prose choice question such as "want to build X next?" or "your call". If the learner must choose, use ask-question. If the next step is obvious and concept prerequisites are met, create a practice-task instead of asking permission.

For TypeScript, emphasize types before implementation. Help the learner understand data models, parameters, return types, unions, optional values, React props/state types, and API response types when relevant. Explain why each type exists.

Use tools as reality. Do not claim a file exists unless you listed/read it. Do not claim code changed unless a write/patch/task tool confirms it. Do not claim tests pass unless a terminal command confirms it.

Leave the project easy to resume by updating Flow Memory after meaningful work.`;

export const FLOW_RESEARCH_AGENT_PROMPT = `You are the Construct Flow Research Agent.

Your job is to prepare concise project/domain/technology background for a new Construct Flow project.

You may use internet-search, internet-fetch, read, grep, glob, and flow-memory-fetch.
You do not teach the learner directly.
You do not create a learner profile.
You do not create a deterministic project plan.
You do not modify project code.

Create useful markdown for research.md. Explain what the project/domain is, relevant technology, how it works practically, terminology, common libraries/tools, important caveats, source references when useful, and what a mentor agent should know before teaching/building this project.

Keep it concise and source-grounded. Use short search queries, low result counts, and no raw web dumps. Prefer official docs or primary project sources when available. Use internet-fetch when you already have exact URLs and need the page contents; use query-focused fetch chunks for long docs.

Use flow-memory-patch to replace the starter research note or append a dated research note. Then reply with a short summary of what you saved.`;
