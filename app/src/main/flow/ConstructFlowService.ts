import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentRuntimeMessage, type ConstructAgentTraceEntry } from "../constructAgentRuntime";
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
  ConstructFlowContextCompaction,
  ConstructFlowMemoryPatchResult,
  ConstructFlowPathNode,
  ConstructFlowPracticeTask,
  ConstructFlowPracticeSubtask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowTaskGuidance,
  ConstructFlowTimelinePart,
  ConstructFlowTaskBaseline,
  ConstructFlowTaskSubmission,
  ConstructFlowToolCallRecord
} from "../../shared/constructFlow";
import { CONSTRUCT_CONCEPT_LANGUAGES, type ConstructAgentContextWindow, type ConstructAgentRunEvent, type ConstructConceptConfidence, type ConstructConceptLanguage, type KnowledgeBaseRecord } from "../../shared/constructLearning";
import { ConstructLearningStore } from "../constructLearningStore";

const ignoredNames = new Set([".git", ".construct", "node_modules", "dist", "build", ".next", "coverage"]);
const maxBaselineFileBytes = 120_000;
const maxDiffChars = 18_000;
const flowCompactionThreshold = 0.72;
const flowCompactionRecentMessageCount = 10;
const conceptLanguageSchema = z.enum(CONSTRUCT_CONCEPT_LANGUAGES);
const flowConceptConfidenceLevels = [
  "unknown",
  "introduced",
  "confused",
  "fragile",
  "practicing",
  "applying",
  "solid",
  "fluent",
  "teaching"
] as const satisfies readonly ConstructConceptConfidence[];
const flowConceptConfidenceSchema = z.enum(flowConceptConfidenceLevels);

type FlowModelMessage = ConstructAgentRuntimeMessage & {
  id: string;
  sessionId?: string;
  source: "chat" | "summary";
};

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateContextWindow(
  settings: StoredSettings["ai"] | undefined,
  input: {
    systemPrompt: string;
    flowStatePrompt: string;
    messages: FlowModelMessage[];
    compactedMessageCount?: number;
    compaction?: ConstructAgentContextWindow["compaction"];
  }
): ConstructAgentContextWindow {
  const modelId = settings ? modelForAiFeature(settings, "construct-flow") : undefined;
  const fullSystemPromptTokens = estimateTextTokens(input.systemPrompt);
  const flowStateTokens = estimateTextTokens(input.flowStatePrompt);
  const systemPromptTokens = Math.max(1, fullSystemPromptTokens - flowStateTokens);
  const chatTokens = input.messages
    .filter((message) => message.source === "chat")
    .reduce((sum, message) => sum + estimateTextTokens(`${message.role}\n${message.content}`), 0);
  const compactedSummaryTokens = input.messages
    .filter((message) => message.source === "summary")
    .reduce((sum, message) => sum + estimateTextTokens(`${message.role}\n${message.content}`), 0);
  const usedTokens = fullSystemPromptTokens + chatTokens + compactedSummaryTokens;
  return {
    providerId: settings?.provider,
    modelId,
    usedTokens,
    inputTokens: usedTokens,
    outputTokens: 0,
    systemPromptTokens,
    chatTokens,
    flowStateTokens,
    compactedSummaryTokens,
    messageCount: input.messages.length,
    compactedMessageCount: input.compactedMessageCount ?? 0,
    maxTokens: estimateModelContextTokens(modelId),
    source: "estimated",
    updatedAt: new Date().toISOString(),
    compaction: input.compaction
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
    agentRuntime?: () => ReturnType<typeof createConstructAgentRuntime>;
  }) {}

  async runMainAgent(
    project: StoredFlowProject,
    input: ConstructFlowAgentInput,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const memory = await this.options.flowMemory.read(project, ["project.md", "path.md", "learner.md", "research.md"]);
    const settings = await this.options.readSettings?.();
    const answeredSession = applyQuestionResponse(project, input.questionResponse);
    if (answeredSession) {
      onSessionEvent?.({
        type: "completed",
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
    const flowStatePrompt = buildMainPrompt(project, input, memory, concepts);
    let systemPrompt = buildFlowSystemPrompt(flowStatePrompt);
    let modelMessages = buildFlowModelMessages(project);
    let compactedMessageCount = latestCompletedCompaction(project)?.summarizedMessageCount ?? 0;
    session.contextWindow = estimateContextWindow(settings?.ai, {
      systemPrompt,
      flowStatePrompt,
      messages: modelMessages,
      compactedMessageCount
    });
    publish("updated");
    if (shouldCompactFlowContext(session.contextWindow, modelMessages)) {
      const selected = selectMessagesForCompaction(modelMessages);
      if (selected) {
        const compaction = createRunningContextCompaction(session.contextWindow, selected);
        session.contextCompaction = compaction;
        upsertTimelinePart(session.timeline, timelinePartFromCompaction(compaction));
        session.contextWindow = estimateContextWindow(settings?.ai, {
          systemPrompt,
          flowStatePrompt,
          messages: modelMessages,
          compactedMessageCount,
          compaction: {
            status: "running",
            reason: compaction.reason,
            beforeTokens: compaction.beforeTokens,
            summarizedMessageCount: compaction.summarizedMessageCount,
            preservedMessageCount: compaction.preservedMessageCount,
            updatedAt: compaction.startedAt
          }
        });
        publish("updated");
        try {
          const summary = await this.compactFlowContext(project, selected, flowStatePrompt);
          const completedAt = new Date().toISOString();
          compaction.status = "completed";
          compaction.completedAt = completedAt;
          compaction.summary = summary;
          modelMessages = buildCompactedModelMessages(summary, selected);
          compactedMessageCount = selected.head.length;
          systemPrompt = buildFlowSystemPrompt(flowStatePrompt);
          const compactedWindow = estimateContextWindow(settings?.ai, {
            systemPrompt,
            flowStatePrompt,
            messages: modelMessages,
            compactedMessageCount,
            compaction: {
              status: "completed",
              reason: compaction.reason,
              beforeTokens: compaction.beforeTokens,
              afterTokens: estimateMessagesTokens(modelMessages) + estimateTextTokens(systemPrompt),
              summarizedMessageCount: compaction.summarizedMessageCount,
              preservedMessageCount: compaction.preservedMessageCount,
              updatedAt: completedAt
            }
          });
          compaction.afterTokens = compactedWindow.usedTokens;
          session.contextWindow = compactedWindow;
          upsertTimelinePart(session.timeline, timelinePartFromCompaction(compaction));
          publish("updated");
        } catch (error) {
          const completedAt = new Date().toISOString();
          compaction.status = "error";
          compaction.completedAt = completedAt;
          compaction.errorMessage = error instanceof Error ? error.message : String(error);
          session.contextWindow = estimateContextWindow(settings?.ai, {
            systemPrompt,
            flowStatePrompt,
            messages: modelMessages,
            compactedMessageCount,
            compaction: {
              status: "error",
              reason: compaction.errorMessage,
              beforeTokens: compaction.beforeTokens,
              summarizedMessageCount: compaction.summarizedMessageCount,
              preservedMessageCount: compaction.preservedMessageCount,
              updatedAt: completedAt
            }
          });
          upsertTimelinePart(session.timeline, timelinePartFromCompaction(compaction));
          publish("updated");
        }
      }
    }

    const practiceTask = this.createPracticeTaskTool(project, session, publish);
    const planLearningPath = this.createPlanLearningPathTool(project, publish);
    const addConcept = this.createAddConceptTool(project, publish);
    const modifyConcept = this.createModifyConceptTool(project, publish);
    const removeConcept = this.createRemoveConceptTool(project, publish);
    const fetchConcepts = this.createFetchConceptsTool(project);
    const suggestConcept = this.createSuggestConceptTool(project, concepts, actionsFromTools, publish);
    const reviewSubtask = this.createReviewSubtaskTool(project, publish);
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
      "review-subtask": reviewSubtask,
      "complete-task": completeTask
    };

    let reply: string;
    let runError: unknown;
    try {
      const generated = await (this.options.agentRuntime?.() ?? createConstructAgentRuntime()).runAgentic({
        id: "construct-flow-agent",
        featureId: "construct-flow",
        name: "Construct Flow",
        purpose: "Construct Flow mentor agent",
        instructions: systemPrompt,
        prompt: input.message,
        messages: modelMessages.map(({ role, content }) => ({ role, content })),
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
      if (pendingQuestion) {
        truncateSessionAfterPendingQuestion(session, pendingQuestion);
      }
      reply = pendingQuestion
        ? "I’ll wait for your answer below."
        : cleanReplyForPendingQuestion(
            generated.text.trim(),
            pendingQuestion
          ) || "I could not produce a response from the model, but the activity above shows the work completed.";
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
      message: `Research this Flow project and update research.md. Project goal: ${project.flow.goal}${project.flow.stackPreference ? ` Project context: ${project.flow.stackPreference}` : ""}`,
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
      const generated = await (this.options.agentRuntime?.() ?? createConstructAgentRuntime()).runAgentic({
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
      reply = sanitizeResearchReply(generated.text.trim() || "Research completed.");
      if (!hasCompletedResearchMemoryWrite(session)) {
        const researchContent = buildResearchDocument(session, reply);
        const writeResults = await this.options.flowMemory.updateWithDiff(project, [{
          file: "research.md",
          content: researchContent,
          reason: "Save researched project context for the mentor handoff."
        }]);
        recordHostResearchMemoryWrite(session, writeResults);
        publish("updated");
      }
    } catch (error) {
      reply = "Research failed before completion.";
      await this.options.flowMemory.update(project, [{
        file: "research.md",
        content: `# Research\n\nResearch failed before completion.\n\nError: ${error instanceof Error ? error.message : String(error)}\n`
      }]);
      session.status = "error";
      session.errorMessage = error instanceof Error ? error.message : String(error);
    }

    const finishedAt = new Date().toISOString();
    if (session.status !== "error") {
      project.flow.researchEnabled = true;
      project.flow.researchCompletedAt = finishedAt;
    }
    project.flow.updatedAt = finishedAt;
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

  private async compactFlowContext(
    project: StoredFlowProject,
    selected: FlowCompactionSelection,
    flowStatePrompt: string
  ): Promise<string> {
    const generated = await (this.options.agentRuntime?.() ?? createConstructAgentRuntime()).runAgentic({
      id: "construct-flow-context-compactor",
      featureId: "construct-flow",
      name: "Construct Flow Compactor",
      purpose: "Construct Flow context compaction",
      instructions: FLOW_CONTEXT_COMPACTION_PROMPT,
      prompt: buildFlowCompactionPrompt(project, selected, flowStatePrompt),
      maxSteps: 1,
      maxRetries: 1
    });
    return normalizeCompactionSummary(generated.text);
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
    const messages = origin === "system"
      ? []
      : origin === "question-response"
        ? [{
            id: randomUUID(),
            role: "user" as const,
            content: input.questionResponse?.skipped
              ? `(skipped question) ${input.questionResponse?.question ?? ""}`
              : input.questionResponse?.question
                ? `${input.questionResponse.question}\n\n${input.questionResponse.answer ?? ""}`
                : input.message,
            createdAt: now
          }]
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
      description: "Create one real learner coding task only after the required concepts have been introduced. This is Flow's normal write path for task setup: preparations are applied before the baseline is captured. This is a handoff point: after creating the task, summarize briefly and let the learner work. Do not use practice-task as a progress update, duplicate milestone marker, or setup narration. Do not keep trying to verify or rewrite the same scaffold after this tool succeeds. Use guidance for structured work highlights instead of writing large TODO comment blocks into source files.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(2_000),
        focus: z.object({
          path: z.string().min(1),
          line: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional()
        }).optional(),
        language: conceptLanguageSchema.optional().describe("Primary language for this task. Use this to prevent stale tasks/concepts after language switches."),
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
        guidance: z.array(z.object({
          title: z.string().min(1).max(120),
          instruction: z.string().min(1).max(700),
          path: z.string().min(1),
          line: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional(),
          placeholder: z.string().max(240).optional(),
          subtaskTitle: z.string().max(120).optional()
        })).max(12).optional().describe("UI-only task work highlights. Prefer this over TODO comment blocks in prepared files."),
        introducedConceptIds: z.array(z.string().min(1)).min(1).describe("Concept IDs already introduced before this task. Required; if none exist yet, explain and record the concept before creating the task."),
        conceptIds: z.array(z.string().min(1)).optional().describe("Optional extra related concept IDs; introducedConceptIds is the required prerequisite set"),
        learnerReadiness: z.array(z.object({
          conceptId: z.string().min(1).describe("Introduced concept this learner evidence supports"),
          evidence: z.string().min(1).max(500).describe("Concrete learner-authored evidence, e.g. their explanation, plan, answer, or submitted diff"),
          source: z.enum(["learner-chat", "learner-task-submission", "existing-concept-evidence"]).describe("Where the learner-authored evidence came from")
        })).min(1).max(12).describe("Observable learner understanding or practice evidence collected before this task is created."),
        safety: z.object({
          level: z.enum(["beginner-safe", "host-safe", "advanced-system-access"]).default("beginner-safe"),
          rationale: z.string().min(1).max(500)
        }).optional().describe("Why this task is safe for the learner's machine and current level.")
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const pathNodeId = toolInput.pathNodeId ?? project.flow.currentPathNodeId ?? firstActivePathNode(project)?.id;
        const introducedConceptIds = normalizeConceptIds(toolInput.introducedConceptIds, project);
        const relatedConceptIds = normalizeConceptIds(toolInput.conceptIds ?? toolInput.introducedConceptIds, project);
        const learnerReadiness = normalizeLearnerReadiness(toolInput.learnerReadiness, project);
        const store = this.options.learningStore();
        const state = await store.getState();
        const knownConcepts = uniqueKnowledgeConcepts(Object.values(state.knowledgeBase.concepts));
        const knownConceptIds = new Set(knownConcepts.map((concept) => concept.id));
        const conceptRecords = introducedConceptIds
          .map((conceptId) => findKnowledgeConceptById(knownConcepts, conceptId))
          .filter((concept): concept is KnowledgeBaseRecord => Boolean(concept));
        const missingConceptIds = introducedConceptIds.filter((conceptId) => !knownConceptIds.has(conceptId));
        if (missingConceptIds.length > 0) {
          throw new Error(`Practice tasks require introduced concepts. Missing concept records: ${missingConceptIds.join(", ")}.`);
        }
        const taskLanguage = inferPracticeTaskLanguage(toolInput.language, toolInput, conceptRecords);
        assertPracticeTaskIsLearnerSafe(toolInput);
        assertPreparedFilesLeaveLearnerWork(toolInput);
        assertTaskConceptReadiness(introducedConceptIds, conceptRecords, learnerReadiness);
        assertTaskLanguageMatchesConcepts(taskLanguage, conceptRecords);
        assertTaskLanguageMatchesPath(project, pathNodeId, taskLanguage, knownConcepts);
        const cancelledStaleTaskIds = cancelStaleLanguageTasks(project, taskLanguage, knownConcepts, now);
        if (cancelledStaleTaskIds.length > 0) {
          project.flow.updatedAt = now;
        }
        if (toolInput.preparations && toolInput.preparations.length > 0) {
          await applyTaskPreparations(project, this.options.workspace, toolInput.preparations);
        }
        const baseline = await captureBaseline(project, this.options.workspace, toolInput.taskFiles);
        const subtasks = (toolInput.subtasks?.length ? toolInput.subtasks : [{
          title: toolInput.title,
          prompt: toolInput.prompt,
          successCriteria: toolInput.successCriteria
        }]).map((subtask, index): ConstructFlowPracticeSubtask => ({
          id: randomUUID(),
          title: subtask.title,
          prompt: subtask.prompt,
          successCriteria: subtask.successCriteria,
          status: index === 0 ? "active" : "ready"
        }));
        const task: ConstructFlowPracticeTask = {
          id: randomUUID(),
          projectId: project.id,
          sessionId: session.id,
          pathNodeId,
          language: taskLanguage,
          title: toolInput.title,
          prompt: toolInput.prompt,
          focus: toolInput.focus,
          status: "waiting",
          baseline,
          createdAt: now,
          taskFiles: toolInput.taskFiles,
          conceptIds: relatedConceptIds,
          introducedConceptIds,
          learnerReadiness,
          safety: {
            level: toolInput.safety?.level ?? "beginner-safe",
            rationale: toolInput.safety?.rationale ?? "Task avoids privileged host access and leaves the learner with observable work."
          },
          successCriteria: toolInput.successCriteria,
          subtasks,
          guidance: normalizeTaskGuidance(toolInput.guidance ?? [], subtasks),
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
          learnerReadiness: task.learnerReadiness,
          safety: task.safety,
          cancelledStaleTaskIds,
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
        confidence: flowConceptConfidenceSchema.optional().default("unknown").describe("Learner's current evidence-backed learning state for this concept"),
        reason: z.string().min(1).max(700).describe("Exact reason this concept is being created now"),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8).describe("Concrete evidence from the learner, task diff, project, or conversation"),
        confidenceReason: z.string().max(700).optional().describe("Required when confidence is not unknown"),
        authoredBy: z.enum(["learner", "agent", "mixed", "system"]).default("agent"),
        agentContributionPercent: z.number().min(0).max(100).optional(),
        pathNodeId: z.string().min(1).max(120).optional().describe("Path node whose teaching context introduced or changed this concept"),
        taskId: z.string().min(1).max(120).optional().describe("Practice task whose evidence introduced or changed this concept")
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
            const parentFieldChanges = conceptFieldChanges(undefined, parentStub, introducedConceptFields(parentStub));
            parentStub.history = [createConceptHistoryEntry({
              kind: "system",
              reason: `Auto-created parent while adding ${conceptId}.`,
              evidence: [`Parent concept required for hierarchy ${conceptId}.`],
              changedFields: parentFieldChanges.map((change) => change.field),
              fieldChanges: parentFieldChanges,
              provenance: createConceptHistoryProvenance(project, parentId, toolInput.pathNodeId, toolInput.taskId),
              authoredBy: "system",
              agentContributionPercent: 100,
              createdAt: now
            })];
            await store.saveKnowledgeConcept(parentStub);
          }
        }

        const parentId = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
        const provenance = createConceptHistoryProvenance(project, conceptId, toolInput.pathNodeId, toolInput.taskId);

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
        const fieldChanges = conceptFieldChanges(existingRecord, newRecord, existingRecord ? conceptPatchFields(toolInput) : introducedConceptFields(newRecord));
        const historyEntry = createConceptHistoryEntry({
          kind: existingRecord ? "modified" : "introduced",
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          changedFields: fieldChanges.map((change) => change.field),
          fieldChanges,
          provenance,
          confidence: toolInput.confidence,
          confidenceReason: toolInput.confidenceReason,
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent,
          createdAt: now
        });
        newRecord.history = appendConceptHistory(existingRecord?.history, historyEntry);

        await store.saveKnowledgeConcept(newRecord);
        publish("updated");

        return {
          introduced: !existingRecord,
          created: !existingRecord,
          canonicalId: conceptId,
          normalizedFrom: conceptId === toolInput.id ? undefined : toolInput.id,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          changedFields: historyEntry.changedFields,
          fieldChanges: historyEntry.fieldChanges,
          provenance: historyEntry.provenance,
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
        confidence: flowConceptConfidenceSchema.optional().describe("Updated evidence-backed learner state for this concept"),
        reason: z.string().min(1).max(700).describe("Exact reason this concept is changing"),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8).describe("Concrete evidence that justifies this change"),
        confidenceReason: z.string().max(700).optional().describe("Required when confidence is provided"),
        authoredBy: z.enum(["learner", "agent", "mixed", "system"]).default("agent"),
        agentContributionPercent: z.number().min(0).max(100).optional(),
        pathNodeId: z.string().min(1).max(120).optional().describe("Path node whose teaching context changed this concept"),
        taskId: z.string().min(1).max(120).optional().describe("Practice task whose evidence changed this concept")
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
        const fieldChanges = conceptFieldChanges(existing, updatedRecord, conceptPatchFields(toolInput));
        const historyEntry = createConceptHistoryEntry({
          kind: "modified",
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          changedFields: fieldChanges.map((change) => change.field),
          fieldChanges,
          provenance: createConceptHistoryProvenance(project, conceptId, toolInput.pathNodeId, toolInput.taskId),
          confidence: toolInput.confidence ?? existing.confidence,
          confidenceReason: toolInput.confidenceReason ?? existing.confidenceReason,
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent ?? existing.agentContributionPercent,
          createdAt: now
        });
        updatedRecord.history = appendConceptHistory(existing.history, historyEntry);

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
          changedFields: historyEntry.changedFields,
          fieldChanges: historyEntry.fieldChanges,
          provenance: historyEntry.provenance,
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

  private createReviewSubtaskTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "review-subtask",
      description: "Review a learner-authored subtask submission and mark it either done or needing more work with explicit evidence. Requires a current learner submission; agent-authored edits or verification commands are not learner evidence.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        subtaskId: z.string().min(1),
        outcome: z.enum(["done", "needs-work"]),
        evidence: z.string().min(1).max(1_000),
        nextInstructions: z.string().max(1_000).optional()
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        const subtask = findPracticeSubtask(task, toolInput.subtaskId);
        const submission = requireLearnerSubmission(task, "review a subtask");
        if (task.status !== "submitted" || subtask.status !== "submitted") {
          throw new Error("Cannot review a subtask until the learner submits that subtask.");
        }
        if (submission.subtaskId && submission.subtaskId !== subtask.id) {
          throw new Error("Cannot review a different subtask from the latest learner submission.");
        }
        if (toolInput.outcome === "done" && submission.nothingChanged) {
          throw new Error("Cannot mark a subtask done from a learner submission with no file changes.");
        }
        const agentEditedPaths = findAgentEditedTaskFilesAfterSubmission(project, task);
        if (toolInput.outcome === "done" && agentEditedPaths.length > 0) {
          throw new Error(`Cannot mark learner work done because Flow edited task files after the learner submission: ${agentEditedPaths.join(", ")}. Ask the learner to review and resubmit.`);
        }
        const now = new Date().toISOString();

        subtask.reviewedAt = now;
        subtask.evidence = toolInput.evidence;
        subtask.reviewNote = toolInput.evidence;
        subtask.nextInstructions = toolInput.nextInstructions;

        if (toolInput.outcome === "done") {
          subtask.status = "completed";
          subtask.completedAt = now;
          const nextReady = task.subtasks?.find((candidate) => candidate.status === "ready" || candidate.status === "needs-work");
          if (nextReady) {
            nextReady.status = "active";
            task.status = "waiting";
          } else {
            task.status = task.subtasks?.every((candidate) => candidate.status === "completed") ? "submitted" : "waiting";
          }
        } else {
          subtask.status = "needs-work";
          subtask.completedAt = undefined;
          task.status = "waiting";
        }

        project.flow.updatedAt = now;
        publish("updated");
        return {
          reviewed: true,
          taskId: task.id,
          subtaskId: subtask.id,
          outcome: toolInput.outcome,
          status: subtask.status,
          nextInstructions: subtask.nextInstructions ?? null
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
      description: "Mark a full Flow task done only after a learner-authored submission and after every subtask has been reviewed as completed. Evidence must come from learner-authored submission metadata, not agent edits or terminal checks.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        summary: z.string().min(1).max(1_200),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8)
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        const submission = requireLearnerSubmission(task, "complete a task");
        if (task.status !== "submitted") {
          throw new Error("Cannot complete a task until the learner has submitted work and all subtasks have been reviewed.");
        }
        if (submission.nothingChanged) {
          throw new Error("Cannot complete a task from a learner submission with no file changes.");
        }
        const agentEditedPaths = findAgentEditedTaskFilesAfterSubmission(project, task);
        if (agentEditedPaths.length > 0) {
          throw new Error(`Cannot complete learner task because Flow edited task files after the learner submission: ${agentEditedPaths.join(", ")}. Ask the learner to review and resubmit.`);
        }
        const incompleteSubtasks = task.subtasks?.filter((subtask) => subtask.status !== "completed") ?? [];
        if (incompleteSubtasks.length > 0) {
          throw new Error(`Cannot complete task before all subtasks are reviewed as done: ${incompleteSubtasks.map((subtask) => subtask.title).join(", ")}.`);
        }
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

function findPracticeSubtask(task: ConstructFlowPracticeTask, subtaskId: string): ConstructFlowPracticeSubtask {
  const subtask = task.subtasks?.find((candidate) => candidate.id === subtaskId);
  if (!subtask) {
    throw new Error(`Unknown Flow subtask: ${subtaskId}`);
  }
  return subtask;
}

function requireLearnerSubmission(task: ConstructFlowPracticeTask, action: string): ConstructFlowTaskSubmission {
  const submission = task.submission;
  if (!submission || submission.authoredBy?.actor !== "learner") {
    throw new Error(`Cannot ${action} without a learner-authored task submission. Agent-authored edits, scaffold repairs, and verification commands are support work, not learner completion evidence.`);
  }
  return submission;
}

function findAgentEditedTaskFilesAfterSubmission(project: StoredFlowProject, task: ConstructFlowPracticeTask): string[] {
  const submittedAt = Date.parse(task.submission?.submittedAt ?? "");
  if (!Number.isFinite(submittedAt)) return [];
  const taskFiles = new Set(task.taskFiles ?? []);
  const edited = new Set<string>();

  for (const session of project.flow.sessions) {
    for (const toolCall of session.toolCalls) {
      const toolName = normalizeToolName(toolCall.name);
      if (toolName !== "write" && toolName !== "edit") continue;
      const completedAt = Date.parse(toolCall.completedAt ?? toolCall.createdAt);
      if (!Number.isFinite(completedAt) || completedAt <= submittedAt) continue;
      const path = readToolInputPath(toolCall.input);
      if (!path) continue;
      if (taskFiles.size > 0 && !taskFiles.has(path)) continue;
      edited.add(path);
    }
  }

  return [...edited].sort();
}

function readToolInputPath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path : undefined;
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

type ConceptHistoryEntry = NonNullable<KnowledgeBaseRecord["history"]>[number];
type ConceptFieldChange = NonNullable<ConceptHistoryEntry["fieldChanges"]>[number];
type ConceptHistoryProvenance = NonNullable<ConceptHistoryEntry["provenance"]>;

function createConceptHistoryEntry(input: {
  kind: ConceptHistoryEntry["kind"];
  reason: string;
  evidence: string[];
  changedFields?: string[];
  fieldChanges?: ConceptFieldChange[];
  provenance?: ConceptHistoryProvenance;
  confidence?: ConstructConceptConfidence;
  confidenceReason?: string;
  authoredBy?: ConceptHistoryEntry["authoredBy"];
  agentContributionPercent?: number;
  createdAt: string;
}): ConceptHistoryEntry {
  return {
    id: randomUUID(),
    kind: input.kind,
    reason: input.reason,
    evidence: input.evidence,
    changedFields: input.changedFields,
    fieldChanges: input.fieldChanges,
    provenance: input.provenance,
    confidence: input.confidence,
    confidenceReason: input.confidenceReason,
    authoredBy: input.authoredBy,
    agentContributionPercent: input.agentContributionPercent,
    createdAt: input.createdAt
  };
}

function appendConceptHistory(
  current: KnowledgeBaseRecord["history"],
  entry: ConceptHistoryEntry
): NonNullable<KnowledgeBaseRecord["history"]> {
  return [...(current ?? []), entry].slice(-30);
}

function introducedConceptFields(record: KnowledgeBaseRecord): string[] {
  return [
    "title",
    "language",
    "technology",
    "content",
    "examples",
    "relatedConcepts",
    "confidence",
    "confidenceReason",
    "authoredBy",
    "agentContributionPercent"
  ].filter((field) => conceptAuditValue(record, field) !== undefined);
}

function conceptPatchFields(input: Record<string, unknown>): string[] {
  const fields = [
    "title",
    "language",
    "technology",
    "content",
    "examples",
    "relatedConcepts",
    "confidence",
    "confidenceReason",
    "authoredBy",
    "agentContributionPercent"
  ].filter((field) => input[field] !== undefined);
  if (input.content !== undefined) fields.push("summary");
  return [...new Set(fields)];
}

function conceptFieldChanges(
  before: KnowledgeBaseRecord | undefined,
  after: KnowledgeBaseRecord,
  fields: string[]
): ConceptFieldChange[] {
  return fields.flatMap((field): ConceptFieldChange[] => {
    const previousValue = before ? conceptAuditValue(before, field) : undefined;
    const nextValue = conceptAuditValue(after, field);
    if (auditValuesEqual(previousValue, nextValue)) return [];
    return [{
      field,
      before: formatConceptAuditValue(previousValue),
      after: formatConceptAuditValue(nextValue)
    }];
  });
}

function conceptAuditValue(record: KnowledgeBaseRecord, field: string): unknown {
  if (field === "summary") return record.summary;
  if (field === "title") return record.title;
  if (field === "language") return record.language;
  if (field === "technology") return record.technology;
  if (field === "content") return record.content;
  if (field === "examples") return record.examples;
  if (field === "relatedConcepts") return record.relatedConcepts;
  if (field === "confidence") return record.confidence;
  if (field === "confidenceReason") return record.confidenceReason;
  if (field === "authoredBy") return record.authoredBy;
  if (field === "agentContributionPercent") return record.agentContributionPercent;
  return undefined;
}

function auditValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function formatConceptAuditValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = Array.isArray(value)
    ? value.join("\n")
    : typeof value === "string"
      ? value
      : String(value);
  const normalized = text.trim();
  if (!normalized) return undefined;
  return normalized.length > 900 ? `${normalized.slice(0, 900)}...` : normalized;
}

function createConceptHistoryProvenance(
  project: StoredFlowProject,
  conceptId: string,
  explicitPathNodeId?: string,
  explicitTaskId?: string
): ConceptHistoryProvenance {
  const task = findConceptHistoryTask(project, conceptId, explicitTaskId);
  const pathNodeId = explicitPathNodeId ?? task?.pathNodeId ?? project.flow.currentPathNodeId ?? firstActivePathNode(project)?.id;
  const pathNode = pathNodeId ? project.flow.pathNodes?.find((candidate) => candidate.id === pathNodeId) : undefined;
  return {
    projectId: project.id,
    projectTitle: project.title,
    projectGoal: project.flow.goal,
    pathNodeId,
    pathNodeTitle: pathNode?.title,
    taskId: task?.id ?? explicitTaskId,
    taskTitle: task?.title,
    taskFiles: task?.taskFiles?.slice(0, 12),
    focusPath: task?.focus?.path
  };
}

function findConceptHistoryTask(
  project: StoredFlowProject,
  conceptId: string,
  explicitTaskId?: string
): ConstructFlowPracticeTask | undefined {
  const tasks = project.flow.sessions.flatMap((session) => session.practiceTasks);
  if (explicitTaskId) {
    return tasks.find((task) => task.id === explicitTaskId);
  }
  return tasks
    .filter((task) => [...(task.conceptIds ?? []), ...(task.introducedConceptIds ?? [])].includes(conceptId))
    .sort((a, b) => Date.parse(b.submittedAt ?? b.createdAt) - Date.parse(a.submittedAt ?? a.createdAt))[0];
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
    history: concept.history,
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

function normalizeLearnerReadiness(
  readiness: Array<{ conceptId: string; evidence: string; source: "learner-chat" | "learner-task-submission" | "existing-concept-evidence" }>,
  project: StoredFlowProject
): NonNullable<ConstructFlowPracticeTask["learnerReadiness"]> {
  return readiness.map((item) => ({
    conceptId: normalizeConceptId(item.conceptId, project),
    evidence: item.evidence.trim(),
    source: item.source
  }));
}

function normalizeConceptIds(conceptIds: string[], project: StoredFlowProject): string[] {
  return [...new Set(conceptIds.map((id) => normalizeConceptId(id, project)).filter(Boolean))];
}

function inferPracticeTaskLanguage(
  explicitLanguage: ConstructConceptLanguage | undefined,
  toolInput: {
    title: string;
    prompt: string;
    taskFiles: string[];
  },
  conceptRecords: KnowledgeBaseRecord[]
): ConstructConceptLanguage | undefined {
  if (explicitLanguage && explicitLanguage !== "unknown") return explicitLanguage;
  const fileLanguage = inferLanguageFromFiles(toolInput.taskFiles);
  if (fileLanguage) return fileLanguage;
  const textLanguage = inferLanguageFromText(`${toolInput.title}\n${toolInput.prompt}`);
  if (textLanguage) return textLanguage;
  const conceptLanguages = [...new Set(conceptRecords.map((concept) => concept.language).filter(isConcreteConceptLanguage))];
  return conceptLanguages.length === 1 ? conceptLanguages[0] : explicitLanguage;
}

function inferLanguageFromFiles(files: string[]): ConstructConceptLanguage | undefined {
  for (const file of files) {
    const lower = file.toLowerCase();
    if (/\.(cpp|cc|cxx|hpp|hh|hxx|h)$/.test(lower)) return "cpp";
    if (lower.endsWith(".swift")) return "swift";
    if (/\.(ts|tsx)$/.test(lower)) return "typescript";
    if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return "javascript";
    if (lower.endsWith(".py")) return "python";
  }
  return undefined;
}

function inferLanguageFromText(text: string): ConstructConceptLanguage | undefined {
  const lower = text.toLowerCase();
  if (/\bc\+\+\b|\bcpp\b/.test(lower)) return "cpp";
  if (/\bswift(ui)?\b/.test(lower)) return "swift";
  if (/\btypescript\b|\btsx\b/.test(lower)) return "typescript";
  if (/\bjavascript\b|\bjsx\b/.test(lower)) return "javascript";
  if (/\bpython\b/.test(lower)) return "python";
  return undefined;
}

function isConcreteConceptLanguage(language: ConstructConceptLanguage | undefined): language is Exclude<ConstructConceptLanguage, "unknown"> {
  return Boolean(language && language !== "unknown");
}

function assertPracticeTaskIsLearnerSafe(toolInput: {
  title: string;
  prompt: string;
  successCriteria?: string[];
  subtasks?: Array<{ title: string; prompt: string; successCriteria?: string[] }>;
  guidance?: Array<{ title: string; instruction: string; path: string; placeholder?: string }>;
  preparations?: Array<{ path: string; content: string }>;
}): void {
  const surface = [
    toolInput.title,
    toolInput.prompt,
    ...(toolInput.successCriteria ?? []),
    ...(toolInput.subtasks ?? []).flatMap((subtask) => [subtask.title, subtask.prompt, ...(subtask.successCriteria ?? [])]),
    ...(toolInput.guidance ?? []).flatMap((item) => [item.title, item.instruction, item.placeholder ?? "", item.path]),
    ...(toolInput.preparations ?? []).flatMap((prep) => [prep.path, prep.content])
  ].join("\n");

  const blockedPatterns = [
    /\/dev\/mem/i,
    /\bsudo\b/i,
    /\bphysical memory\b/i,
    /\bhardware registers?\b/i,
    /\bkernel extension\b/i,
    /\bneural engine interfaces?\b/i,
    /\bm2\b[\s\S]{0,80}\b(register|gpu|neural engine)\b/i
  ];
  const match = blockedPatterns.find((pattern) => pattern.test(surface));
  if (match) {
    throw new Error("Practice tasks cannot require privileged host access, /dev/mem, hardware registers, or M2 device interfaces. Teach with safe simulations and learner-owned exercises first.");
  }
}

function assertPreparedFilesLeaveLearnerWork(toolInput: {
  taskFiles: string[];
  preparations?: Array<{ path: string; content: string; mode: "create" | "overwrite" | "replace" }>;
}): void {
  const taskFiles = new Set(toolInput.taskFiles);
  const completeDemo = toolInput.preparations?.find((prep) => (
    taskFiles.has(prep.path)
    && /\.(cpp|cc|cxx)$/.test(prep.path.toLowerCase())
    && /int\s+main\s*\(/.test(prep.content)
    && /\bstd::cout\b/.test(prep.content)
    && !/\b(todo|your turn|fill|implement|placeholder|exercise)\b/i.test(prep.content)
  ));
  if (completeDemo) {
    throw new Error(`Prepared file ${completeDemo.path} looks like a complete read-and-run demo. Practice tasks must leave concrete learner-authored work, not just files to compile and observe.`);
  }
}

function assertTaskConceptReadiness(
  introducedConceptIds: string[],
  conceptRecords: KnowledgeBaseRecord[],
  learnerReadiness: NonNullable<ConstructFlowPracticeTask["learnerReadiness"]>
): void {
  const unknownConcepts = conceptRecords
    .filter((concept) => !concept.confidence || concept.confidence === "unknown")
    .map((concept) => concept.id);
  if (unknownConcepts.length > 0) {
    throw new Error(`Practice tasks require introduced concepts with explicit confidence, not unknown records: ${unknownConcepts.join(", ")}.`);
  }

  const missingReadiness = introducedConceptIds.filter((conceptId) => (
    !learnerReadiness.some((item) => conceptReadinessCovers(item.conceptId, conceptId))
  ));
  if (missingReadiness.length > 0) {
    throw new Error(`Practice tasks require observable learner understanding before task creation. Missing learnerReadiness evidence for: ${missingReadiness.join(", ")}.`);
  }
}

function conceptReadinessCovers(readinessConceptId: string, requiredConceptId: string): boolean {
  return readinessConceptId === requiredConceptId
    || readinessConceptId === "all"
    || requiredConceptId.startsWith(`${readinessConceptId}.`);
}

function assertTaskLanguageMatchesConcepts(
  taskLanguage: ConstructConceptLanguage | undefined,
  conceptRecords: KnowledgeBaseRecord[]
): void {
  if (!isConcreteConceptLanguage(taskLanguage)) return;
  const mismatches = conceptRecords
    .filter((concept) => isConcreteConceptLanguage(concept.language) && concept.language !== taskLanguage)
    .map((concept) => `${concept.id} (${concept.language})`);
  if (mismatches.length > 0) {
    throw new Error(`Practice task language ${taskLanguage} does not match prerequisite concepts: ${mismatches.join(", ")}. Revise the path and teach the new language prerequisites first.`);
  }
}

function assertTaskLanguageMatchesPath(
  project: StoredFlowProject,
  pathNodeId: string | undefined | null,
  taskLanguage: ConstructConceptLanguage | undefined,
  knownConcepts: KnowledgeBaseRecord[]
): void {
  if (!pathNodeId || !isConcreteConceptLanguage(taskLanguage)) return;
  const node = project.flow.pathNodes?.find((candidate) => candidate.id === pathNodeId);
  if (!node?.concepts?.length) return;
  const nodeLanguages = [...new Set(node.concepts
    .map((conceptId) => findKnowledgeConceptById(knownConcepts, normalizeConceptId(conceptId, project))?.language)
    .filter(isConcreteConceptLanguage))];
  const staleLanguages = nodeLanguages.filter((language) => language !== taskLanguage);
  if (staleLanguages.length > 0) {
    throw new Error(`Current path node ${pathNodeId} is still scoped to ${staleLanguages.join(", ")} concepts. Revise the learning path before creating a ${taskLanguage} task.`);
  }
}

function cancelStaleLanguageTasks(
  project: StoredFlowProject,
  taskLanguage: ConstructConceptLanguage | undefined,
  knownConcepts: KnowledgeBaseRecord[],
  cancelledAt: string
): string[] {
  if (!isConcreteConceptLanguage(taskLanguage)) return [];
  const cancelled: string[] = [];
  for (const task of project.flow.sessions.flatMap((session) => session.practiceTasks)) {
    if (task.status !== "waiting") continue;
    const existingLanguage = task.language
      ?? inferLanguageFromFiles(task.taskFiles ?? [])
      ?? inferLanguageFromTaskConcepts(task, knownConcepts);
    if (!isConcreteConceptLanguage(existingLanguage) || existingLanguage === taskLanguage) continue;
    task.status = "cancelled";
    task.messages = [
      ...(task.messages ?? []),
      {
        id: randomUUID(),
        role: "assistant",
        content: `Cancelled because the learner switched from ${existingLanguage} to ${taskLanguage}; stale tasks should not remain active across language changes.`,
        createdAt: cancelledAt
      }
    ];
    cancelled.push(task.id);
  }
  return cancelled;
}

function inferLanguageFromTaskConcepts(
  task: ConstructFlowPracticeTask,
  knownConcepts: KnowledgeBaseRecord[]
): ConstructConceptLanguage | undefined {
  const languages = [...new Set((task.introducedConceptIds ?? task.conceptIds ?? [])
    .map((conceptId) => findKnowledgeConceptById(knownConcepts, conceptId)?.language)
    .filter(isConcreteConceptLanguage))];
  return languages.length === 1 ? languages[0] : undefined;
}

function normalizeTaskGuidance(
  guidance: Array<{
    title: string;
    instruction: string;
    path: string;
    line?: number;
    endLine?: number;
    placeholder?: string;
    subtaskTitle?: string;
  }>,
  subtasks: ConstructFlowPracticeSubtask[]
): ConstructFlowTaskGuidance[] {
  return guidance.map((item) => {
    const subtask = item.subtaskTitle
      ? subtasks.find((candidate) => candidate.title.toLowerCase() === item.subtaskTitle?.toLowerCase())
      : undefined;
    const line = item.line && item.line > 0 ? Math.floor(item.line) : undefined;
    const rawEndLine = item.endLine && item.endLine > 0 ? Math.floor(item.endLine) : undefined;
    return {
      id: randomUUID(),
      title: item.title,
      instruction: item.instruction,
      path: item.path,
      line,
      endLine: line && rawEndLine ? Math.max(line, rawEndLine) : undefined,
      placeholder: item.placeholder,
      subtaskId: subtask?.id
    };
  });
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

type FlowCompactionSelection = {
  head: FlowModelMessage[];
  tail: FlowModelMessage[];
  beforeTokens: number;
};

function buildFlowSystemPrompt(flowStatePrompt: string): string {
  return `${FLOW_MAIN_AGENT_PROMPT}\n\n${flowStatePrompt}`;
}

function buildFlowModelMessages(project: StoredFlowProject): FlowModelMessage[] {
  const messages = buildRawFlowModelMessages(project);
  const compaction = latestCompletedCompaction(project);
  if (!compaction?.summary) return messages;
  const summarized = new Set(compaction.summarizedMessageIds);
  const preserved = new Set(compaction.preservedMessageIds);
  return [
    {
      id: `compaction:${compaction.id}`,
      role: "assistant",
      content: `Compacted Flow context summary:\n\n${compaction.summary}`,
      source: "summary"
    },
    ...messages.filter((message) => preserved.has(message.id) || !summarized.has(message.id))
  ];
}

function buildRawFlowModelMessages(project: StoredFlowProject): FlowModelMessage[] {
  const messages: FlowModelMessage[] = [];
  for (const session of project.flow.sessions) {
    for (const message of session.messages) {
      if (message.role === "user") {
        messages.push({
          id: `${session.id}:${message.id}`,
          sessionId: session.id,
          role: "user",
          content: message.content,
          source: "chat"
        });
      }
    }
    const visibleActivity = visibleFlowActivityForModel(session);
    const assistantMessages = session.messages.filter((message) => message.role === "assistant");
    for (const message of assistantMessages) {
      const content = [visibleActivity, message.content].filter((part) => part.trim()).join("\n\n");
      messages.push({
        id: `${session.id}:${message.id}`,
        sessionId: session.id,
        role: "assistant",
        content,
        source: "chat"
      });
    }
    if (!assistantMessages.length && visibleActivity) {
      messages.push({
        id: `${session.id}:visible-activity`,
        sessionId: session.id,
        role: "assistant",
        content: visibleActivity,
        source: "chat"
      });
    }
  }
  return messages;
}

function visibleFlowActivityForModel(session: ConstructFlowSession): string {
  const lines: string[] = [];
  if (session.contextCompaction?.status === "completed" && session.contextCompaction.summary) {
    lines.push(`Visible compaction: summarized ${session.contextCompaction.summarizedMessageCount} older chat messages and preserved ${session.contextCompaction.preservedMessageCount} recent messages.`);
  }
  for (const toolCall of session.toolCalls) {
    if (toolCall.name === "ask-question" || toolCall.name === "askQuestion") {
      const question = readAskQuestionPayload(toolCall.input, toolCall.outputPreview).question || toolCall.title;
      lines.push(toolCall.response
        ? `Visible question answered: ${question}\nLearner answer: ${toolCall.response.answer}`
        : `Visible question waiting: ${question}`);
      continue;
    }
    if (toolCall.name === "practice-task") {
      const input = typeof toolCall.input === "object" && toolCall.input !== null ? toolCall.input as Record<string, unknown> : {};
      lines.push(`Visible practice task ${toolCall.status}: ${readStringValue(input.title) ?? toolCall.title}`);
      continue;
    }
    if (toolCall.name === "add-concept" || toolCall.name === "modify-concept" || toolCall.name === "remove-concept" || toolCall.name === "suggest-existing-concept") {
      const input = typeof toolCall.input === "object" && toolCall.input !== null ? toolCall.input as Record<string, unknown> : {};
      lines.push(`Visible concept ${toolCall.status}: ${toolCall.name} ${readStringValue(input.id) ?? readStringValue(input.title) ?? toolCall.title}`);
      continue;
    }
    if (toolCall.name === "flow-memory-patch" || toolCall.name === "flow-memory-update") {
      lines.push(`Visible memory update ${toolCall.status}: ${toolCall.title}`);
    }
  }
  return lines.length ? `Visible Flow transcript events:\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}

function readAskQuestionPayload(input: unknown, outputPreview?: string): { question?: string; choices?: string[] } {
  let parsedOutput: Record<string, unknown> | undefined;
  if (outputPreview) {
    try {
      const parsed = JSON.parse(outputPreview) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        parsedOutput = parsed as Record<string, unknown>;
      }
    } catch {
      parsedOutput = undefined;
    }
  }
  const source = parsedOutput ?? (typeof input === "object" && input !== null ? input as Record<string, unknown> : {});
  return {
    question: readStringValue(source.question),
    choices: Array.isArray(source.choices) ? source.choices.filter((choice): choice is string => typeof choice === "string") : undefined
  };
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function latestCompletedCompaction(project: StoredFlowProject): ConstructFlowContextCompaction | undefined {
  return [...project.flow.sessions]
    .reverse()
    .map((session) => session.contextCompaction)
    .find((compaction) => compaction?.status === "completed" && Boolean(compaction.summary));
}

function shouldCompactFlowContext(contextWindow: ConstructAgentContextWindow, messages: FlowModelMessage[]): boolean {
  if (!contextWindow.maxTokens || !contextWindow.usedTokens) return false;
  if (messages.length <= flowCompactionRecentMessageCount + 4) return false;
  return contextWindow.usedTokens / contextWindow.maxTokens >= flowCompactionThreshold;
}

function selectMessagesForCompaction(messages: FlowModelMessage[]): FlowCompactionSelection | null {
  if (messages.length <= flowCompactionRecentMessageCount + 4) return null;
  const head = messages.slice(0, -flowCompactionRecentMessageCount);
  const tail = messages.slice(-flowCompactionRecentMessageCount);
  if (head.length < 4) return null;
  return {
    head,
    tail,
    beforeTokens: estimateMessagesTokens(messages)
  };
}

function createRunningContextCompaction(
  contextWindow: ConstructAgentContextWindow,
  selected: FlowCompactionSelection
): ConstructFlowContextCompaction {
  const startedAt = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "running",
    trigger: "auto",
    reason: `Context reached ${contextWindow.maxTokens ? Math.round(((contextWindow.usedTokens ?? 0) / contextWindow.maxTokens) * 100) : "unknown"}% of the model window.`,
    startedAt,
    beforeTokens: contextWindow.usedTokens ?? selected.beforeTokens,
    summarizedMessageIds: selected.head.map((message) => message.id),
    preservedMessageIds: selected.tail.map((message) => message.id),
    summarizedMessageCount: selected.head.length,
    preservedMessageCount: selected.tail.length
  };
}

function timelinePartFromCompaction(compaction: ConstructFlowContextCompaction): ConstructFlowTimelinePart {
  return {
    id: `compaction:${compaction.id}`,
    kind: "compaction",
    status: compaction.status,
    title: compaction.status === "running" ? "Compacting chat history" : compaction.status === "error" ? "Chat compaction failed" : "Chat compacted",
    detail: compaction.errorMessage ?? compaction.reason,
    summary: compaction.summary,
    beforeTokens: compaction.beforeTokens,
    afterTokens: compaction.afterTokens,
    summarizedMessageCount: compaction.summarizedMessageCount,
    preservedMessageCount: compaction.preservedMessageCount,
    createdAt: compaction.startedAt,
    completedAt: compaction.completedAt,
    updatedAt: compaction.completedAt ?? compaction.startedAt
  };
}

function buildCompactedModelMessages(summary: string, selected: FlowCompactionSelection): FlowModelMessage[] {
  return [
    {
      id: `summary:${randomUUID()}`,
      role: "assistant",
      content: `Compacted Flow context summary:\n\n${summary}`,
      source: "summary"
    },
    ...selected.tail
  ];
}

function estimateMessagesTokens(messages: FlowModelMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTextTokens(`${message.role}\n${message.content}`), 0);
}

function buildFlowCompactionPrompt(
  project: StoredFlowProject,
  selected: FlowCompactionSelection,
  flowStatePrompt: string
): string {
  return [
    `Project: ${project.title}`,
    `Goal: ${project.flow.goal}`,
    "",
    "Current Flow state that will be reloaded after compaction:",
    flowStatePrompt,
    "",
    "Summarize the older visible chat transcript below. Preserve the learner model, unresolved questions, completed and waiting tasks, concepts introduced or modified, mistakes/confusions, decisions, files mentioned, and exact next teaching state. Do not invent task completion or learner understanding.",
    "",
    JSON.stringify(selected.head.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content
    })), null, 2)
  ].join("\n");
}

function normalizeCompactionSummary(text: string): string {
  const summary = text.trim();
  return summary || "The earlier Flow conversation was compacted, but the compactor returned an empty summary. Continue from the preserved recent messages and durable Flow memory.";
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
    project.flow.stackPreference ? `Project context: ${project.flow.stackPreference}` : null,
    project.flow.projectSettings ? `Project settings:\n${JSON.stringify(project.flow.projectSettings, null, 2)}` : null,
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
          successCriteria: subtask.successCriteria,
          evidence: subtask.evidence,
          reviewNote: subtask.reviewNote,
          nextInstructions: subtask.nextInstructions
        })),
        guidance: task.guidance,
        recentMessages: task.messages?.slice(-4)
      })), null, 2),
    "",
    "Flow Memory:",
    "project.md, path.md, learner.md, and research.md are preloaded here. Treat research.md as the new-project research handoff when it has content; continue from its assumptions instead of redoing research or asking redundant project-direction clarification. Use flow-memory-patch for concise durable updates when meaningful work happens.",
    JSON.stringify(memory.map((item) => ({
      file: item.file,
      updatedAt: item.updatedAt,
      content: item.content.slice(0, 3_000)
    })), null, 2),
    "",
    "Concepts:",
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
      relatedConcepts: c.relatedConcepts,
      history: c.history
    })), null, 2),
    "",
    "Recent Flow context:",
    JSON.stringify(recent, null, 2),
    "",
    latestInputLabel,
    latestInput,
    input.questionResponse ? [
      "",
      "Question-response guard:",
      "A tracked question answer is learner-model context only. It is not task completion evidence, does not mean a demo compiled or ran, and must not upgrade concept confidence unless the answer itself demonstrates understanding."
    ].join("\n") : null,
    "",
    "Use tools when workspace reality matters. For UI actions, call the relevant action tool instead of returning JSON. Before explaining a topic, check whether Concepts already cover it; if exact concept details or evidence matter, use fetch-concepts before suggesting, explaining, or updating. Reply naturally after tool work."
  ].filter(Boolean).join("\n");
}

function buildResearchDocument(session: ConstructFlowSession, reply: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const toolResults = session.timeline
    .filter((p): p is Extract<ConstructFlowTimelinePart, { kind: "tool" }> =>
      p.kind === "tool" && p.status === "completed" && Boolean(p.outputPreview)
    )
    .map((p) => `## Tool: ${p.name}${p.reason ? ` — ${p.reason}` : ""}\n${p.outputPreview}`)
    .join("\n\n");
  return `# Research — ${date}\n\n## Mentor Handoff\n\nUse these notes as project context before teaching, planning, or asking project-direction questions. If the goal has multiple valid interpretations, continue from the researched assumptions below and clarify later only when the learner's next step depends on it.\n\n## Research Summary\n\n${reply}\n\n${toolResults ? `## Sources & Tool Results\n\n${toolResults}` : ""}`.trim();
}

function sanitizeResearchReply(reply: string): string {
  if (!isClarificationPivot(reply)) return reply;
  return "Research saved to research.md. I captured the researched background and assumptions so the mentor can continue without redoing discovery.";
}

function isClarificationPivot(reply: string): boolean {
  const normalized = reply.toLowerCase();
  return (
    normalized.includes("let me clarify") ||
    normalized.includes("key question before we proceed") ||
    (normalized.includes("what does") && normalized.includes("mean to you")) ||
    normalized.includes("are you looking to")
  );
}

function hasCompletedResearchMemoryWrite(session: ConstructFlowSession): boolean {
  return session.toolCalls.some((toolCall) => {
    if (toolCall.status !== "completed") return false;
    const name = normalizeToolName(toolCall.name);
    if (name !== "flowmemorypatch" && name !== "flowmemoryupdate") return false;
    return toolCallReferencesResearchMemory(toolCall.input) || toolCallReferencesResearchMemory(toolCall.outputPreview);
  });
}

function toolCallReferencesResearchMemory(value: unknown): boolean {
  if (typeof value === "string") return value.includes("research.md");
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => toolCallReferencesResearchMemory(item));
  return Object.values(value).some((item) => toolCallReferencesResearchMemory(item));
}

function recordHostResearchMemoryWrite(
  session: ConstructFlowSession,
  results: ConstructFlowMemoryPatchResult[]
): void {
  const timestamp = new Date().toISOString();
  const record: ConstructFlowToolCallRecord = {
    id: `flow-memory-update-${session.id}`,
    name: "flow-memory-update",
    title: "Updated Flow Memory",
    reason: "Saved research.md for mentor handoff",
    input: {
      updates: [{ file: "research.md" }]
    },
    outputPreview: JSON.stringify(results, null, 2),
    status: "completed",
    createdAt: timestamp,
    completedAt: timestamp
  };
  session.toolCalls.push(record);
  upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, "completed"));
}

function buildResearchPrompt(project: StoredFlowProject): string {
  return [
    `Project title: ${project.title}`,
    `Goal/description: ${project.flow.goal}`,
    project.flow.stackPreference ? `Project context: ${project.flow.stackPreference}` : null,
    project.flow.projectSettings ? `Project settings:\n${JSON.stringify(project.flow.projectSettings, null, 2)}` : null,
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
    toolCallId: event.toolCallId ?? event.id,
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
    "runTerminalCommand",
    "run-terminal-command",
    "write",
    "edit",
    "ask-question",
    "askQuestion",
    "internet-fetch",
    "internetFetch",
    "flowMemoryPatch",
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
  "write",
  "edit",
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

function truncateSessionAfterPendingQuestion(
  session: ConstructFlowSession,
  pendingQuestion: ConstructFlowToolCallRecord
): void {
  const toolIndex = session.toolCalls.findIndex((toolCall) => toolCall.id === pendingQuestion.id);
  if (toolIndex >= 0) {
    session.toolCalls = session.toolCalls.slice(0, toolIndex + 1);
  }

  const timelineIndex = session.timeline.findIndex((part) => (
    part.kind === "tool" && (part.toolCallId === pendingQuestion.id || part.id === pendingQuestion.id)
  ));
  if (timelineIndex >= 0) {
    session.timeline = session.timeline.slice(0, timelineIndex + 1);
  }

  const cutoff = Date.parse(pendingQuestion.completedAt ?? pendingQuestion.createdAt);
  if (Number.isFinite(cutoff)) {
    session.agentEvents = session.agentEvents.filter((event) => {
      if (event.type === "tool" && event.toolCallId === pendingQuestion.id) return true;
      const createdAt = Date.parse(event.createdAt);
      return Number.isFinite(createdAt) && createdAt <= cutoff;
    });
  }
}

function cleanReplyForPendingQuestion(reply: string, pendingQuestion: ConstructFlowToolCallRecord | undefined): string {
  if (!pendingQuestion) return reply;
  const payload = readQuestionPayload(pendingQuestion);
  const question = readQuestionText(pendingQuestion.input);
  const choiceSet = new Set((payload.choices ?? []).map((choice) => choice.trim().toLowerCase()));
  let cleaned = reply
    .replace(/\n+\s*(?:choose|pick|select)\s+(?:one|an option)\s*:?\s*[\s\S]*$/i, "")
    .trim();

  if (question) {
    cleaned = removeDuplicatedQuestionText(cleaned, question);
  }
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

function removeDuplicatedQuestionText(reply: string, question: string): string {
  const normalizedQuestion = normalizeQuestionForComparison(question);
  const lines = reply.split(/\r?\n/);
  return lines
    .filter((line) => {
      const normalizedLine = normalizeQuestionForComparison(line);
      if (!normalizedLine) return true;
      return normalizedLine !== normalizedQuestion && !normalizedLine.includes(normalizedQuestion);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeQuestionForComparison(value: string): string {
  return value
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/\*\*/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
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
  void project;
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
    contextCompaction: session.contextCompaction
      ? {
          ...session.contextCompaction,
          summarizedMessageIds: [...session.contextCompaction.summarizedMessageIds],
          preservedMessageIds: [...session.contextCompaction.preservedMessageIds]
        }
      : undefined,
    contextWindow: session.contextWindow
      ? {
          ...session.contextWindow,
          compaction: session.contextWindow.compaction ? { ...session.contextWindow.compaction } : undefined
        }
      : undefined,
    actions: session.actions.map((action) => ({ ...action })),
    practiceTasks: session.practiceTasks.map((task) => ({
      ...task,
      baseline: { ...task.baseline, files: { ...task.baseline.files } },
      conceptIds: task.conceptIds ? [...task.conceptIds] : undefined,
      introducedConceptIds: task.introducedConceptIds ? [...task.introducedConceptIds] : undefined,
      learnerReadiness: task.learnerReadiness?.map((item) => ({ ...item })),
      safety: task.safety ? { ...task.safety } : undefined,
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
CRITICAL PEDAGOGY RULE: You must NEVER use write/edit to write the actual implementation or solve the tasks for the learner. Even if the concept has been introduced and recorded, the learner must be the one who writes the code. You are strictly forbidden from writing or implementing the solution code yourself.

The main Flow agent tools are read, grep, runTerminalCommand, write, edit, ask-question, internetFetch, flowMemoryPatch, plan-learning-path, practice-task, fetch-concepts, suggest-existing-concept, add-concept, modify-concept, remove-concept, review-subtask, and complete-task. Keep the tool surface calm. Do not ask for or invent extra tools.
File mutation follows the Claude Code shape: write creates or overwrites a file; edit replaces one exact string in an existing file. These are the only normal file modification tools. Use them only to help the learner move through an introduced concept, repair tiny scaffold/setup blockers, update simple docs, or make clearly requested support edits. Do not use write/edit to implement code whose concept has not been introduced yet. Even after a concept is introduced, do not implement it; instead, create a practice task for the learner. If a code change needs an unintroduced concept, teach it first, record the concept, then create a learner task or make the smallest necessary support edit (such as an empty scaffold file/boilerplate) with clear authorship.
Before using write/edit for a learning-acceleration support edit, ask the learner first with ask-question and wait for the answer. This includes edits because the learner is stuck, because a scaffold bug is blocking progress, or because the edit would make learning faster. The question must name the file, describe the exact change, explain why it would speed progress, and say what learning remains for the learner. Example shape: "Should I edit [[file:src/core/index.ts|src/core/index.ts]] to remove the broken export so you can focus on module barrels instead of setup friction? You will still implement the public API yourself." If the learner says no or skips, do not edit; teach or create a learner task instead. If the learner explicitly asks in the current message for a concrete file edit, that counts as consent for that requested edit only.

Project kickoff and path:
- When a new Flow project starts, first learn the learner and the project. Ask a good amount of tracked questions when needed. You may ask about prior experience, comfort level, goals, constraints, taste, and what they already understand, but choose questions naturally from the situation.
- Read the global Concepts in the prompt. Use it to avoid asking questions that are already answered, and to notice what the learner may already know.
- Use ask-question for learner modeling when it would improve the path: background, preferences, constraints, confidence, what they want to do manually, and what they want handled by normal tooling.
- After learner profiling or any meaningful learner answer, update learner.md with flow-memory-patch before creating or revising tasks.
- After updating learner.md for kickoff, call plan-learning-path. The path must be based on the learner's abilities, the project goal, global concepts, and useful research. If the learner is new to a technology, begin with the beginner concepts before project-specific app work.
- The path is allowed to change. Revise it with plan-learning-path when learner evidence changes.
- Each practice-task belongs to the current path node unless there is a clear reason to place it elsewhere.

Guided discovery:
- Make building feel like discovery, not answer delivery. Start from first principles: what inputs exist, what output or behavior is wanted, what invariants must hold, what smaller step can be tested, and what the learner already knows.
- When the learner is solving, debugging, or designing, help them generate the next move before revealing yours. Ask for their mental model, an English plan, a small example, a sketch of control flow, or pseudocode when that would naturally help. Do not force a fixed format; choose the lightest prompt that helps them think.
- Prefer a ladder of hints: observation, constraint, smaller example, missing concept, then partial structure. Give the full solution only after the learner has attempted, asked directly for it, or the task would otherwise stall after meaningful guided attempts.
- Do not end a teaching turn by dumping the completed algorithm, architecture, or code when the learner has not had a chance to form it. End with one focused next thinking move when discovery is still active.
- Celebrate curiosity through the work itself: make the next question feel like opening a door, not taking a quiz. Avoid schooly recap checks. Ask questions that help the learner notice the shape of the solution.
- If the learner proposes an approach, treat it as the primary material. Improve it, test it against edge cases, and only then fill in missing details.

Concept-first tutoring:
- Concepts are global learner knowledge across projects. They are not per-project folders.
- Before explaining a topic, check the global Concepts in the prompt.
- Use fetch-concepts when you need exact concept content, examples, evidence, confidence, or related concepts. Use exact conceptIds when you know them and query search when you do not. Do not guess concept details from memory.
- Before modifying or removing a concept, fetch it first unless the full current record is already visible in the prompt or current tool output.
- If an existing concept covers the need, link it in chat with the inline markdown tag [[concept:concept.id|Concept title]] and briefly say why it is relevant instead of re-explaining.
- If the learner asks again, is confused, or needs help applying the concept, then explain in chat.
- Use ask-question when the learner's answer improves the learner model or is required to choose the next step. Do not use ask-question for comprehension quizzes, recap prompts, or questions whose answer you can explain directly.
- Normal chat is for ideas, mental models, questions, and review. Do not put implementation code blocks or broad code snippets in normal chat unless the learner has already attempted the shape or explicitly asks for the code.
- Only create a practice-task after the relevant concepts have been introduced and recorded with add-concept, modify-concept, or suggest-existing-concept.
- Every practice-task must include introducedConceptIds. Those are the exact concepts the learner has already seen before the task begins.
- Every practice-task must include learnerReadiness evidence for every introducedConceptId. This evidence must come from the learner's own chat answer, plan, explanation, or submitted diff. Agent-written demos, prepared files, terminal output, and "the demo ran" are not learner readiness.
- If no concept is introduced yet, teach first. Explain the idea, record the concept, get observable learner understanding when needed, then create the task.
- If the learner switches languages or says they do not know the current language, stop using stale tasks/path nodes from the old language. Patch learner.md, revise the path, teach the new language prerequisites, and only then create tasks in the new language.

When you teach or the learner demonstrates understanding, update Concepts with evidence:
- After explaining something new, use add-concept or modify-concept to record it with reason and evidence.
- After a practice task is submitted and reviewed, use modify-concept to update the learner's learning state only when the diff or chat proves it.
- Always set concept language using the enum swift, python, typescript, javascript, cpp, or unknown. Set technology when there is a clear framework, platform, or API such as SwiftUI, OpenGL, GLFW, React, or Node.
- Use the concept confidence scale precisely:
  unknown = no reliable evidence yet;
  introduced = the learner has seen the idea but has not applied it;
  confused = the learner is actively misunderstanding or mixing it up;
  fragile = the learner can follow with support but not independently;
  practicing = the learner is attempting it with guidance;
  applying = the learner used it in their own work with some review needed;
  solid = the learner can explain and use it reliably;
  fluent = the learner can transfer it across nearby problems;
  teaching = the learner can explain or debug it for someone else.
- Every confidence value other than unknown requires confidenceReason. Do not upgrade or downgrade without exact evidence, and put the why in reason plus confidenceReason.
- Use dot-notated hierarchical IDs for reusable concepts (e.g. 'typescript.types.interfaces', 'react.hooks.state', 'swiftui.core-structure'). Max 3 levels deep (domain.area.topic).
- Do not include product/project/app names in concept IDs. For a notes app, use 'swiftui.core-structure', not 'swiftui.notesapp.core-structure'.
- Do not create smaller and smaller concepts. Group related sub-concepts inside parent concepts logically.
- Keep concept content detailed, natural, and free-form markdown so it can be easily read and modified. Write detailed text explanations.
- When a learner struggles, modify the concept to note the specific confusion point.
- Concepts are persistent memory of what the learner knows, where they are confused, and what the agent wrote. Preserve authoredBy, history, and evidence so future agents do not mistake agent-created content for learner mastery.

Stay natural. Do not reveal internal modes. Do not force responses into rigid templates. Respond like a strong human mentor reviewing and building with the learner.

Use Flow Memory as durable context. The current project, path, and learner memory are already in the prompt. Use flow-memory-patch for memory updates; do not rewrite full memory files from the agent unless recovering a broken file. Keep memory concise.
Learner.md is the durable learner model for this project. Patch it whenever the learner reveals preferences, constraints, experience level, desired autonomy, frustration, confidence, or a repeated misunderstanding. Examples: "prefers CLI commands for boilerplate instead of manual package metadata", "wants concept-first explanations before task code", "comfortable with npm but new to TypeScript library packaging". Do not let these stay only in chat.

Prefer learner attempts. Tasks are the main unit of Flow progress. When the next step is a learner coding attempt, use the practice-task tool once to create a real structured task with the current path node, task files, prepared files when needed, success criteria, subtasks when useful, guidance highlights, and introducedConceptIds. Prepared/scaffolded code is agent-authored; submitted diffs are learner-authored. Do not infer learner understanding from code you wrote.
If a missing README, placeholder module, or tiny scaffold file must exist before the learner can attempt the task, ask first unless the learner explicitly requested that exact support edit. After consent, use write/edit or practice-task.preparations for the exact small support change. If the learner should write it, put the work in the task prompt, subtasks, successCriteria, and guidance instead.
After creating a practice-task, stop cleanly and let the learner work. Do not keep reading files, create another task for the same milestone, try to verify the same prepared files again, or call ask-question to quiz the learner about scaffold files, concepts, or code you just prepared. Put distinctions like public entrypoint vs internal barrel in the task prompt, guidance, or normal mentor message instead of pausing progress with a tracked question.
Never create beginner practice tasks that require sudo, /dev/mem, real hardware registers, kernel extensions, M2 GPU/Neural Engine interfaces, or other privileged host/device access. For low-level topics, use safe simulations, diagrams, tiny memory models, toy buffers, or pseudocode first. Do not create "pointer demo" tasks that are just complete agent-written files for the learner to compile and read; leave a concrete learner-authored gap and ask for their explanation or modification.

Task workspace guidance:
- Do not put large TODO banners, assignment prose, or multi-line task comments into source files.
- Use practice-task.guidance for file/line work areas, hover instructions, and placeholders. The UI renders those as task highlights and opens the right file/line.
- Prepared files should contain only necessary scaffold code or tiny placeholder comments. Task explanation belongs in the task prompt, subtasks, successCriteria, and guidance fields.

Code belongs inside tasks or explicit support edits, not ordinary mentor replies. Before full implementation code appears, the learner should usually have produced or discussed the plan, examples, constraints, pseudocode, or a partial attempt. If code must be prepared by the agent, it must be small, scoped to introducedConceptIds, and clearly marked through preparations/authorship. If the learner has not been introduced to the concept behind a code change, introduce and record that concept before writing the code. Do not infer learner understanding from agent-written code.

Clickable file protocol:
- Whenever you mention a project file in chat, concept content, task prompts, subtask prompts, or review notes, use inline file refs: [[file:path/from/project.ext|label]].
- Include a line or range when useful: [[file:src/main.ts:24|src/main.ts:24]] or [[file:src/main.ts:24-41|the render loop]].
- If the UI should immediately open or focus a file, also call open-file or focus-code. Inline refs are for clickable text; action tools are for immediate navigation.
- For taskFiles, prepared files, and focus paths, use project-relative paths that the UI can open directly.

Do not build whole apps for the learner by hand. For project setup, use run-terminal-command with the normal scaffold command when one exists, then inspect and make small targeted changes only as task preparation. If a native scaffold command is unavailable, explain why, ask a tracked question if direction matters, or create the smallest learner task that can move understanding forward. Never hand-write a whole package.json, Xcode project, or broad app tree as a substitute for a real scaffold command.

When the latest input is a learner message inside an active task, treat it as task-scoped chat. Answer in the context of the active task and do not create a new task unless the path genuinely changes. When the latest input includes a task submission, act as a task-review mentor: inspect the compact diff and authoredBy metadata, compare it against the active subtask success criteria, update concepts only with evidence, call review-subtask with outcome "done" when the submitted subtask passes, or outcome "needs-work" when it does not. Use task.submission.authoredBy, preparedFiles.authoredBy, and recent write/edit tool records as the authorship source of truth. Call complete-task only after a learner-authored submission exists and every subtask has been reviewed as completed; complete-task.evidence must be an array of concrete learner evidence strings. Agent writes, scaffold repairs, terminal checks, and prepared files are support work, not learner completion evidence. If Flow edited a task file after the learner submission, do not mark the task done from that stale submission; ask the learner to review and resubmit. If there is no learner submission, keep the task waiting and explain the next learner action. If the diff is insufficient or ambiguous in a way that blocks review, ask-question with one focused follow-up; do not ask conceptual quiz questions as review blockers.

If you need learner input, decision, choice, or response, you MUST use the ask-question tool. Treat ask-question as a finish reason and long-running wait state: after calling it, do not continue teaching, ask follow-up questions in prose, inspect files, create tasks, or run tools until the learner answers. You are strictly prohibited from executing subsequent tools (such as read, write, edit, or runTerminalCommand) in the same turn after asking a question. The ask-question.question field must be the direct question only, ideally one sentence. Do not duplicate the context in both prose and the tool question. Keep ask-question.reason short and internal; the learner UI does not show it. Do not put tracked learner-modeling or required learner questions only in prose. Never write "Choose one", a numbered option list, or the full question again in normal chat after calling ask-question; the UI renders choices. After ask-question, stop with a short acknowledgement if you need any prose at all. When the learner answers, patch learner.md if the answer contains durable learner information.

On a new project kickoff (the prompt labels this as "New project kickoff:"), inspect the workspace or Flow Memory if useful. If research is not complete, decide naturally whether to ask the learner to research first, start without research, or clarify project direction with ask-question. Do not wait for a greeting before beginning, and do not create practice tasks before learner profiling and plan-learning-path unless the learner explicitly asks to skip planning.
For an ordinary "Latest learner message:" inside an existing project, a greeting or casual nudge is not a project kickoff. Do not inspect the workspace, run tools, create tasks, or continue task automation unless the learner asks to continue, review, fix, create, scaffold, or do project work. Reply briefly and wait for a substantive next action.
When the latest input is "Latest learner answer to tracked question:", you MUST actively evaluate their response, update the relevant concept confidence using modify-concept/add-concept, and update learner.md. Since this response means the learner is ready to proceed, immediately resume the teaching progression, explain the next concept, inspect the workspace, or create the next practice-task. Do not reply passively or wait for further input.
Do not treat a tracked question answer as evidence that the learner completed an unrelated task, compiled a demo, or understood code that Flow wrote. Only task submissions and the learner's own explanation/practice can count as task or concept evidence.

Do not end with a prose choice question such as "want to build X next?" or "your call". If the learner must choose, use ask-question. If the next step is obvious and concept prerequisites are met, create a practice-task instead of asking permission.

For TypeScript, emphasize types before implementation. Help the learner understand data models, parameters, return types, unions, optional values, React props/state types, and API response types when relevant. Explain why each type exists.

Use tools as reality. Do not claim a file exists unless you listed/read it. Do not claim code changed unless write, edit, flowMemoryPatch, or practice-task confirms it. Do not claim tests pass unless a terminal command confirms it. If the learner asks what tools you have, answer from the tool list directly instead of inspecting project files. Do not announce "let me fix/create/run" and then continue with unrelated reads. If you decide a support edit would accelerate learning and the learner has not already asked for that exact edit, the next tool call should be ask-question, not write/edit. After consent, the next mutation tool should be write, edit, practice-task with preparations, or a real scaffold command. Do not call code syntactically broken from intuition alone; cite a clear language rule or a compiler/parser result. End with a complete sentence, or stop after the tool result if no prose is useful.
YIELDING CONTROL AND TURN TAKING: You must yield control back to the learner immediately whenever you present a task, ask a question, or require input. Under no circumstances should you generate multiple tool-use steps in a single turn that write or modify files after prompting the user for input or after creating a practice-task.

Leave the project easy to resume by updating Flow Memory after meaningful work.`;

export const FLOW_CONTEXT_COMPACTION_PROMPT = `You are the Construct Flow context compactor.

Summarize older visible Flow chat history so the mentor can continue without losing teaching state.
The summary must be detailed enough to replace the older message prefix.
Preserve:
- learner background, preferences, confidence, and explicit frustrations;
- concepts introduced, modified, confused, or still unproven;
- tracked questions and the learner's answers;
- active path node, waiting tasks, submissions, task messages, and review outcomes;
- files, commands, research handoff assumptions, and next safe teaching step;
- anything the mentor must not falsely assume, especially task completion or learner mastery.

Do not write a generic recap. Do not mark a task complete unless the transcript proves learner-authored completion.
Return markdown only.`;

export const FLOW_RESEARCH_AGENT_PROMPT = `You are the Construct Flow Research Agent.

Your job is to prepare concise project/domain/technology background for a new Construct Flow project.

You may use internet-search, internet-fetch, read, grep, glob, flow-memory-fetch, and flow-memory-patch.
You do not teach the learner directly.
You do not create a learner profile.
You do not create a deterministic project plan.
You do not modify project code.
Do not ask the learner clarifying questions. If the project goal is broad or ambiguous, preserve the researched interpretations, state the assumption that is most useful for a mentor handoff, and let the main mentor clarify later only when the next teaching step depends on it.

Create useful markdown for research.md. Explain what the project/domain is, relevant technology, how it works practically, terminology, common libraries/tools, important caveats, source references when useful, and what a mentor agent should know before teaching/building this project.

Keep it concise and source-grounded. Use short search queries, low result counts, and no raw web dumps. Prefer official docs or primary project sources when available. Use internet-fetch when you already have exact URLs and need the page contents; use query-focused fetch chunks for long docs.

Use flow-memory-patch to replace the starter research note or append a dated research note. Then reply with a short summary of what you saved, not a question.`;
