import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import {
  createConstructAgentRuntime,
  type ConstructAgentRuntimeMessage,
  type ConstructAgentToolChoice,
  type ConstructAgentTraceEntry
} from "../constructAgentRuntime";
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
  ConstructFlowConceptExercise,
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
import { CONSTRUCT_CONCEPT_LANGUAGES, CONSTRUCT_CONCEPT_MASTERY_RUBRIC, conceptMasteryRubricForLevel, type ConstructAgentContextWindow, type ConstructAgentRunEvent, type ConstructCitationSource, type ConstructConceptConfidence, type ConstructConceptLanguage, type ConstructConceptMasteryLevel, type KnowledgeBaseRecord } from "../../shared/constructLearning";
import { ConstructLearningStore } from "../constructLearningStore";
import {
  ConstructConceptPolicyService,
  assertConceptPolicyAllowed
} from "../learning/ConstructConceptPolicyService";

const ignoredNames = new Set([".git", ".construct", "node_modules", "dist", "build", ".next", "coverage"]);
const maxBaselineFileBytes = 120_000;
const maxDiffChars = 18_000;
const flowCompactionThreshold = 0.72;
const flowCompactionRecentMessageCount = 10;
const flowTranscriptMaxSessionChars = 8_000;
const flowTranscriptMaxFieldChars = 1_200;
const flowTranscriptMaxToolContentChars = 700;
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
const flowConceptMasterySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5)
]);
const citationSourceSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(180),
  url: z.string().url(),
  provider: z.string().min(1).max(80).optional(),
  publisher: z.string().min(1).max(120).optional(),
  snippet: z.string().min(1).max(700).optional(),
  quote: z.string().min(1).max(500).optional(),
  accessedAt: z.string().min(1).max(80).optional()
}).strict();
type CitationSourceInput = z.infer<typeof citationSourceSchema>;
const taskReadyMasteryLevel = 3 satisfies ConstructConceptMasteryLevel;
const flowMasteryRubricDescription = CONSTRUCT_CONCEPT_MASTERY_RUBRIC
  .map((entry) => `Level ${entry.level} (${entry.title}): ${entry.text}`)
  .join(" ");

type ConceptFirewallReviewRecord =
  | {
      kind: "file-write" | "file-edit";
      createdAt: string;
    }
  | {
      kind: "practice-task";
      createdAt: string;
    }
  | {
      kind: "concept-exercise";
      createdAt: string;
    };

type ConceptFirewallReviewKind = ConceptFirewallReviewRecord["kind"];

type FlowModelMessage = ConstructAgentRuntimeMessage & {
  id: string;
  sessionId?: string;
  source: "chat" | "summary";
  visibleTranscriptTokens?: number;
  visibleTranscriptEventCount?: number;
  compactedRawMessageIds?: string[];
};

type FlowRunMode = "mentor" | "task-review";

type FlowRunToolPolicy = {
  mode: FlowRunMode;
  sourceGroundingEnabled: boolean;
  allowWorkspaceMutation: boolean;
  allowTerminalCommands: boolean;
  terminalCommandMode: "workspace" | "validation-only";
  protocolToolNames: string[];
  flowToolNames: string[];
  maxSteps: number;
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
  const visibleTranscriptTokens = input.messages.reduce((sum, message) => sum + (message.visibleTranscriptTokens ?? 0), 0);
  const visibleTranscriptEventCount = input.messages.reduce((sum, message) => sum + (message.visibleTranscriptEventCount ?? 0), 0);
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
    visibleTranscriptTokens,
    visibleTranscriptEventCount,
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

function buildConceptPolicyBlockedReply(decision: {
  reason: string;
  blockedCapabilities: string[];
}): string {
  return [
    "I can’t present that next step yet because it depends on material that has not been taught in this project.",
    decision.reason,
    decision.blockedCapabilities.length
      ? `Missing project concept coverage: ${decision.blockedCapabilities.join("; ")}`
      : null,
    "I need to teach and record that capability here before creating the task, assessment, explanation, or file change."
  ].filter(Boolean).join("\n\n");
}

export type ConstructFlowSessionEventSink = (event: ConstructFlowSessionEvent) => void;

export class ConstructFlowService {
  constructor(private readonly options: {
    workspace: ConstructProjectWorkspaceService;
    flowMemory: ConstructFlowMemoryService;
    latestTerminalOutput: (projectId: string) => string;
    logs: AgentLogService;
    learningStore: () => ConstructLearningStore;
    conceptPolicy?: () => ConstructConceptPolicyService;
    readSettings?: () => Promise<StoredSettings>;
    agentRuntime?: () => ReturnType<typeof createConstructAgentRuntime>;
  }) {}

  private conceptPolicy(): ConstructConceptPolicyService {
    return this.options.conceptPolicy?.() ?? new ConstructConceptPolicyService({
      learningStore: this.options.learningStore,
      readSettings: this.options.readSettings,
      readProjectMemory: (project) => this.options.flowMemory.read(project, ["learner.md"])
    });
  }

  async runMainAgent(
    project: StoredFlowProject,
    input: ConstructFlowAgentInput,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const memory = await this.options.flowMemory.read(project, ["project.md", "path.md", "learner.md", "research.md"]);
    const settings = await this.options.readSettings?.();
    const sourceGroundingEnabled = settings?.ai.flowSourceGroundingEnabled !== false;
    const toolPolicy = flowToolPolicyForInput(input, { sourceGroundingEnabled });
    const answeredSession = applyFlowQuestionResponse(project, input.questionResponse);
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
    const conceptFirewallReviews = collectPendingConceptFirewallReviews(project);
    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      tavilyApiKey: settings?.ai.tavilyApiKey,
      webResearchEnabled: sourceGroundingEnabled,
      allowWorkspaceMutation: toolPolicy.allowWorkspaceMutation,
      allowTerminalCommands: toolPolicy.allowTerminalCommands,
      terminalCommandMode: toolPolicy.terminalCommandMode,
      authorizeWorkspaceMutation: async (mutation) => {
        const reviewId = findLatestConceptFirewallReviewId(conceptFirewallReviews, mutation.kind);
        if (reviewId) {
          consumeConceptFirewallToolReview(conceptFirewallReviews, reviewId, mutation.kind);
          clearPendingConceptFirewallReview(project, reviewId);
          return;
        }
        const decision = await this.conceptPolicy().authorize({
          project,
          artifactKind: mutation.kind,
          artifactRef: mutation.path,
          content: mutation.content,
          declaredConceptIds: mutation.conceptIds
        });
        if (!decision.allowed) {
          conceptFirewallReviews.set(decision.auditId, {
            kind: mutation.kind,
            createdAt: new Date().toISOString()
          });
          persistPendingConceptFirewallReview(session, decision.auditId, conceptFirewallReviews.get(decision.auditId));
          throw new Error(buildConceptFirewallMutationBlockedMessage(decision));
        }
        assertConceptPolicyAllowed(decision);
      },
      onToolCallStart: (record) => {
        session.toolCalls.push(toFlowToolRecord(record, "running"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, "running"));
        publish("updated");
      },
      onToolCall: (record) => {
        replaceToolRecord(session, toFlowToolRecord(record, record.status ?? "completed"));
        upsertTimelinePart(session.timeline, timelinePartFromToolRecord(record, record.status ?? "completed"));
        appendCitationSourcesFromToolRecord(session, record);
        extractAction(record).forEach((action) => actionsFromTools.push(action));
        publish("updated");
      }
    });

    const store = this.options.learningStore();
    await store.migrateLegacyProjectConcepts(project.id, project.title);
    const concepts = await store.getProjectConceptRecords(project.id);
    const flowStatePrompt = buildMainPrompt(project, input, memory, concepts, toolPolicy, session.id);
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

    const practiceTask = this.createPracticeTaskTool(project, session, publish, conceptFirewallReviews);
    const planLearningPath = this.createPlanLearningPathTool(project, publish);
    const addConcept = this.createAddConceptTool(project, publish);
    const modifyConcept = this.createModifyConceptTool(project, publish);
    const removeConcept = this.createRemoveConceptTool(project, publish);
    const fetchConcepts = this.createFetchConceptsTool(project);
    const suggestConcept = this.createSuggestConceptTool(project, concepts, actionsFromTools, publish);
    const conceptExercise = this.createConceptExerciseTool(project, session, publish, conceptFirewallReviews);
    const reviewConceptExercise = this.createReviewConceptExerciseTool(project, publish);
    const reviewSubtask = this.createReviewSubtaskTool(project, publish);
    const completeTask = this.createCompleteTaskTool(project, publish);
    const flowTools: ToolsInput = {
      "plan-learning-path": planLearningPath,
      "practice-task": practiceTask,
      "concept-exercise": conceptExercise,
      "review-concept-exercise": reviewConceptExercise,
      "suggest-existing-concept": suggestConcept,
      "fetch-concepts": fetchConcepts,
      "add-concept": addConcept,
      "modify-concept": modifyConcept,
      "remove-concept": removeConcept,
      "review-subtask": reviewSubtask,
      "complete-task": completeTask
    };
    const tools: ToolsInput = {
      ...pickFlowMainProtocolTools(protocol.tools, toolPolicy),
      ...pickFlowMainFlowTools(flowTools, toolPolicy)
    };
    const toolChoice = explicitFlowToolChoice(input.message, tools);

    let reply: string;
    let runError: unknown;
    let runFinishReason: string | undefined;
    let runStepCount: number | undefined;
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
        toolChoice,
        maxSteps: toolPolicy.maxSteps,
        maxRetries: 2,
        onTrace: (entry) => {
          applyTrace(session, entry);
          if (entry.event?.type === "tool") {
            const toolEvent = entry.event;
            const level = toolEvent.status === "error" ? "error" : "info";
            this.options.logs.toolCall(
              toolEvent.toolName ?? "tool",
              toolEvent.status,
              toolEvent.input,
              toolEvent.outputPreview,
              level
            );
          }
          if (entry.payload !== undefined) {
            this.options.logs.structured("flow", entry.title, entry.payload, entry.level ?? "debug");
          } else {
            this.options.logs.text("flow", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
          }
          publish("updated");
        }
      });
      runFinishReason = generated.finishReason;
      runStepCount = generated.stepCount;
      const pendingQuestion = findPendingLearnerQuestion(session.toolCalls);
      if (pendingQuestion) {
        truncateSessionAfterPendingQuestion(session, pendingQuestion);
      }
      reply = pendingQuestion
        ? "I’ll wait for your answer below."
        : cleanReplyForPendingQuestion(
            generated.text.trim(),
            pendingQuestion
          ) || buildFlowEmptyReplyFallback(session, toolPolicy);
    } catch (error) {
      runError = error;
      runFinishReason = "error";
      reply = buildFlowRuntimeErrorReply(error);
    }

    if (!runError) {
      const replyDecision = await this.conceptPolicy().authorize({
        project,
        artifactKind: "next-step",
        artifactRef: `Flow reply ${session.id}`,
        content: reply,
        semanticAudit: false
      });
      if (!replyDecision.allowed) {
        reply = buildConceptPolicyBlockedReply(replyDecision);
        runFinishReason = "concept-policy";
      }
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
    finalizeAssistantReplyTrace(session, reply, runError ? "error" : "completed");
    session.status = runError ? "error" : waiting ? "waiting" : "completed";
    session.finishReason = runFinishReason;
    session.stepCount = runStepCount;
    session.errorMessage = runError instanceof Error ? runError.message : undefined;
    settleRunningSessionTrace(session, session.status);
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

    const settings = await this.options.readSettings?.();
    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      tavilyApiKey: settings?.ai.tavilyApiKey,
      webResearchEnabled: settings?.ai.flowSourceGroundingEnabled !== false,
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
        appendCitationSourcesFromToolRecord(session, record);
        publish("updated");
      }
    });
    const researchTools = pickProtocolTools(
      protocol.tools,
      settings?.ai.flowSourceGroundingEnabled === false
        ? researchProtocolToolNames.filter((name) => !isInternetToolName(name))
        : researchProtocolToolNames
    );

    let reply: string;
    try {
      const generated = await (this.options.agentRuntime?.() ?? createConstructAgentRuntime()).runAgentic({
        id: "construct-flow-research-agent",
        featureId: "construct-flow",
        name: "Construct Flow Research",
        purpose: "Construct Flow research agent",
        instructions: FLOW_RESEARCH_AGENT_PROMPT,
        prompt: buildResearchPrompt(project),
        tools: researchTools,
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
    settleRunningSessionTrace(session, session.status);
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
            content: formatQuestionResponseMessage(input.questionResponse, input.message),
            createdAt: now
          }]
        : [{
            id: randomUUID(),
            role: "user" as const,
            content: input.taskSubmission
              ? formatTaskSubmissionUserMessage(input.message, input.taskSubmission)
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
      citations: [],
      actions: [],
      practiceTasks: [],
      conceptExercises: [],
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
          conceptAuditId: undefined,
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
    publish: (type: ConstructFlowSessionEvent["type"]) => void,
    conceptFirewallReviews?: Map<string, ConceptFirewallReviewRecord>
  ): ToolsInput[string] {
    return createTool({
      id: "practice-task",
      description: `Create one real learner coding task only after every required concept is Mastery Level ${taskReadyMasteryLevel} or higher. Mastery scale: ${flowMasteryRubricDescription} If any required concept is below Level ${taskReadyMasteryLevel}, do not create a task; teach more, ask a Socratic question, or create a concept-exercise instead. This is Flow's normal write path for task setup: preparations are applied before the baseline is captured. This is a handoff point: after creating the task, summarize briefly and let the learner work. Do not use practice-task as a progress update, duplicate milestone marker, or setup narration. Do not keep trying to verify or rewrite the same scaffold after this tool succeeds. Use guidance for structured work highlights instead of writing large TODO comment blocks into source files.`,
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
        introducedConceptIds: z.array(z.string().min(1)).min(1).describe(`Concept IDs already taught and recorded at Mastery Level ${taskReadyMasteryLevel} or higher before this task. Required; if none exist yet, explain, record the concept, and use Socratic checks/exercises before creating the task.`),
        conceptIds: z.array(z.string().min(1)).optional().describe("Optional extra related concept IDs; introducedConceptIds is the required prerequisite set"),
        requiredMasteryLevel: flowConceptMasterySchema.default(taskReadyMasteryLevel).describe(`Minimum Mastery level required for every introducedConceptId. Use ${taskReadyMasteryLevel} for normal tasks.`),
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
        const requiredMasteryLevel = toolInput.requiredMasteryLevel ?? taskReadyMasteryLevel;
        const learnerReadiness = normalizeLearnerReadiness(toolInput.learnerReadiness, project);
        const store = this.options.learningStore();
        const knownConcepts = await store.getProjectConceptRecords(project.id);
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
        assertTaskConceptReadiness(introducedConceptIds, conceptRecords, learnerReadiness, requiredMasteryLevel);
        assertTaskLanguageMatchesConcepts(taskLanguage, conceptRecords);
        assertTaskLanguageMatchesPath(project, pathNodeId, taskLanguage, knownConcepts);
        const cancelledStaleTaskIds = cancelStaleLanguageTasks(project, taskLanguage, knownConcepts, now);
        if (cancelledStaleTaskIds.length > 0) {
          project.flow.updatedAt = now;
        }
        const blockingTask = findBlockingActivePracticeTask(project, {
          pathNodeId,
          introducedConceptIds,
          taskFiles: toolInput.taskFiles
        });
        if (blockingTask) {
          throw new Error(`A waiting Flow task already exists for this path node: "${blockingTask.title}" (${blockingTask.id}). Do not create another task; resume the existing task or ask the learner to submit or cancel it first.`);
        }
        const conceptAuditContent = JSON.stringify({
          title: toolInput.title,
          prompt: toolInput.prompt,
          successCriteria: toolInput.successCriteria,
          subtasks: toolInput.subtasks,
          preparations: toolInput.preparations,
          guidance: toolInput.guidance
        }, null, 2);
        const reviewId = findLatestConceptFirewallReviewId(conceptFirewallReviews, "practice-task");
        const conceptDecision = reviewId && conceptFirewallReviews
          ? (() => {
              consumeConceptFirewallToolReview(conceptFirewallReviews, reviewId, "practice-task");
              clearPendingConceptFirewallReview(project, reviewId);
              return {
                allowed: true,
                declaredConceptIds: introducedConceptIds,
                matchedConceptIds: introducedConceptIds,
                blockedCapabilities: [],
                reason: "Practice task approved by one-shot concept firewall tool review.",
                auditId: reviewId
              };
            })()
          : await this.conceptPolicy().authorize({
              project,
              artifactKind: "task",
              artifactRef: toolInput.title,
              declaredConceptIds: introducedConceptIds,
              requireTaskReady: true,
              content: conceptAuditContent
            });
        if (!conceptDecision.allowed && conceptFirewallReviews) {
          conceptFirewallReviews.set(conceptDecision.auditId, {
            kind: "practice-task",
            createdAt: new Date().toISOString()
          });
          persistPendingConceptFirewallReview(session, conceptDecision.auditId, conceptFirewallReviews.get(conceptDecision.auditId));
          throw new Error(buildConceptFirewallTaskBlockedMessage(conceptDecision));
        }
        assertConceptPolicyAllowed(conceptDecision);
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
          requiredMasteryLevel,
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
          requiredMasteryLevel: task.requiredMasteryLevel,
          learnerReadiness: task.learnerReadiness,
          safety: task.safety,
          cancelledStaleTaskIds,
          successCriteria: task.successCriteria,
          subtasks: task.subtasks,
          preparedFiles: task.preparedFiles,
          conceptAuditId: conceptDecision.auditId
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
      description: `Introduce a new concept with a dot-notated hierarchical ID, title, content, explicit parent placement, and evidence-backed Mastery level. Before creating, inspect the project concept tree with fetch-concepts includeTree when placement is not already visible. Prefer an existing narrow parent; only create a new parent branch when the placementRationale explains why the existing tree does not fit. Mastery scale: ${flowMasteryRubricDescription} New concepts normally start at Level 0 unless the learner's own answer or exercise evidence proves a higher level.`,
      inputSchema: z.object({
        id: z.string().min(1).describe("The dot-notated hierarchical ID, e.g., 'typescript.syntax.interface'"),
        title: z.string().min(1).describe("Short user-friendly title of the concept"),
        parentId: z.string().min(1).nullable().optional().describe("Existing project-local parent concept ID, or null for a root concept. Must match the dot-notated ID prefix."),
        placementRationale: z.string().min(1).max(700).optional().describe("Why this concept belongs under the chosen parent and why a new parent branch is necessary if one will be auto-created."),
        language: conceptLanguageSchema.default("unknown").describe("Primary programming language family for the concept. Use unknown only when it genuinely is not language-specific."),
        technology: z.string().min(1).max(80).optional().describe("Primary framework, library, API, or platform, e.g. SwiftUI, GLFW, OpenGL, React."),
        content: z.string().min(1).describe("Rich, detailed free-form markdown explanation of the concept"),
        sources: z.array(citationSourceSchema).max(10).optional().describe("Docs/articles actually used for source-grounded sentences in content. Use source IDs in content as [[source:id|Label]]."),
        examples: z.array(z.string()).optional().describe("Code examples illustrating the concept"),
        relatedConcepts: z.array(z.string()).optional().describe("IDs of related concepts"),
        confidence: flowConceptConfidenceSchema.optional().default("unknown").describe("Learner's current evidence-backed learning state for this concept"),
        masteryLevel: flowConceptMasterySchema.default(0).describe(`Evidence-backed Mastery level for the learner. ${flowMasteryRubricDescription}`),
        masteryText: z.string().max(900).optional().describe("Attached text for this exact Mastery level. Defaults to the rubric text for the selected level."),
        masteryReason: z.string().max(700).optional().describe("Exact reason this Mastery level is correct. Required when masteryLevel is above 0."),
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
        if ((input.masteryLevel ?? 0) > 0 && !input.masteryReason?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["masteryReason"],
            message: "Concept mastery above Level 0 requires an exact mastery reason from learner evidence."
          });
        }
      }),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const store = this.options.learningStore();
        const state = await store.getState();
        const conceptId = normalizeConceptId(toolInput.id, project);
        const projectConcepts = await store.getProjectConceptRecords(project.id);
        const existingConcepts = uniqueKnowledgeConcepts(Object.values(state.knowledgeBase.concepts));
        const existingRecord = findKnowledgeConceptById(existingConcepts, conceptId);
        const masteryLevel = normalizeMasteryLevel(toolInput.masteryLevel ?? masteryLevelFromConfidence(toolInput.confidence));
        const masteryText = normalizeMasteryText(masteryLevel, toolInput.masteryText);
        const masteryReason = normalizeMasteryReason(toolInput.masteryReason, masteryLevel);
        const explicitParentId = normalizeOptionalParentId(toolInput.parentId, project);
        assertAddConceptPlacement({
          project,
          conceptId,
          title: toolInput.title,
          content: toolInput.content,
          explicitParentId,
          placementRationale: toolInput.placementRationale,
          projectConcepts,
          existingRecord
        });

        const parts = conceptId.split(".");
        const projectConceptIds = new Set(projectConcepts.map((concept) => concept.id));
        for (let i = 1; i < parts.length; i++) {
          const parentId = parts.slice(0, i).join(".");
          const parentIsInProject = projectConceptIds.has(parentId);
          if (!parentIsInProject) {
            const existingParentRecord = findKnowledgeConceptById(existingConcepts, parentId);
            const parentParts = parentId.split(".");
            if (!existingParentRecord) {
              const parentStub: KnowledgeBaseRecord = {
                id: parentId,
                sourceProjectId: project.id,
                sourceProjectTitle: project.title,
                title: conceptTitleFromId(parentId, toolInput.language, toolInput.technology),
                kind: "concept",
                language: toolInput.language,
                technology: toolInput.technology,
                tags: parentParts.slice(0, -1),
                summary: `Parent concept stub for ${parentId}`,
                why: "",
                examples: [],
                docs: [],
                sources: [],
                content: "",
                confidence: "unknown",
                masteryLevel: 0,
                masteryText: conceptMasteryRubricForLevel(0).text,
                masteryUpdatedAt: now,
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
                masteryLevel: 0,
                masteryText: conceptMasteryRubricForLevel(0).text,
                masteryDirection: "unchanged",
                authoredBy: "system",
                agentContributionPercent: 100,
                createdAt: now
              })];
              await store.saveKnowledgeConcept(parentStub);
            }
            await store.recordConceptProjectEvent({
              id: randomUUID(),
              projectId: project.id,
              projectTitle: project.title,
              conceptId: parentId,
              kind: "introduced",
              masteryLevel: normalizeMasteryLevel(existingParentRecord?.masteryLevel),
              reason: existingParentRecord
                ? `Linked existing parent concept ${parentId} into this project while adding ${conceptId}.`
                : `Auto-created parent concept while adding ${conceptId}.`,
              evidence: existingParentRecord?.learnerEvidence?.length
                ? existingParentRecord.learnerEvidence.slice(0, 3)
                : [`Parent concept required for hierarchy ${conceptId}.`],
              artifactKind: "teaching",
              pathNodeId: toolInput.pathNodeId,
              taskId: toolInput.taskId,
              createdAt: now
            });
            projectConceptIds.add(parentId);
          }
        }

        const parentId = explicitParentId !== undefined ? explicitParentId : parts.length > 1 ? parts.slice(0, -1).join(".") : null;
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
          docs: sourcesToDocs(toolInput.sources ?? []),
          sources: normalizeCitationSources(toolInput.sources ?? []),
          content: toolInput.content,
          confidence: toolInput.confidence,
          masteryLevel,
          masteryText,
          masteryReason,
          masteryEvidence: toolInput.evidence,
          masteryUpdatedAt: now,
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
          masteryLevel,
          masteryText,
          masteryReason,
          masteryDirection: masteryDirection(existingRecord?.masteryLevel, masteryLevel),
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent,
          createdAt: now
        });
        newRecord.history = appendConceptHistory(existingRecord?.history, historyEntry);

        await store.saveKnowledgeConcept(newRecord);
        const currentRelation = state.projects[project.id]?.conceptRelations?.[conceptId];
        await store.recordConceptProjectEvent({
          id: randomUUID(),
          projectId: project.id,
          projectTitle: project.title,
          conceptId,
          kind: "introduced",
          previousMasteryLevel: currentRelation?.masteryLevel,
          masteryLevel,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          artifactKind: "teaching",
          pathNodeId: toolInput.pathNodeId,
          taskId: toolInput.taskId,
          createdAt: now
        });
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
          masteryLevel,
          masteryText,
          masteryReason,
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
      description: `Modify an existing concept. Only the fields provided in the patch will be updated. Use masteryLevel for evidence-backed Mastery changes, including decreases. Mastery scale: ${flowMasteryRubricDescription} Do not upgrade because the learner merely saw an explanation or because Flow wrote code; require learner answers, exercises, or learner-authored task diffs.`,
      inputSchema: z.object({
        id: z.string().min(1).describe("The ID of the concept to modify"),
        title: z.string().optional().describe("New title"),
        language: conceptLanguageSchema.optional().describe("Updated primary programming language family for the concept"),
        technology: z.string().min(1).max(80).optional().describe("Updated primary framework, library, API, or platform"),
        content: z.string().optional().describe("New markdown explanation"),
        sources: z.array(citationSourceSchema).max(10).optional().describe("Docs/articles used for newly source-grounded sentences. Use source IDs in content as [[source:id|Label]]."),
        examples: z.array(z.string()).optional().describe("New code examples"),
        relatedConcepts: z.array(z.string()).optional().describe("New related concepts"),
        confidence: flowConceptConfidenceSchema.optional().describe("Updated evidence-backed learner state for this concept"),
        masteryLevel: flowConceptMasterySchema.optional().describe(`Updated evidence-backed Mastery level. ${flowMasteryRubricDescription}`),
        masteryText: z.string().max(900).optional().describe("Attached text for this exact Mastery level. Defaults to the rubric text for the selected level."),
        masteryReason: z.string().max(700).optional().describe("Exact reason this Mastery level is correct. Required when masteryLevel is provided."),
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
        if (input.masteryLevel !== undefined && !input.masteryReason?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["masteryReason"],
            message: "Concept mastery changes require an exact mastery reason from learner evidence."
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
        const projectRelation = state.projects[project.id]?.conceptRelations?.[conceptId];
        if (!projectRelation?.introducedAt) {
          throw new Error(`Concept ${conceptId} exists globally but has not been taught in project ${project.title}. Use add-concept to introduce it in this project before modifying or using it.`);
        }
        const existingMasteryLevel = masteryLevelForConcept(existing);
        const nextMasteryLevel = toolInput.masteryLevel !== undefined
          ? normalizeMasteryLevel(toolInput.masteryLevel)
          : existingMasteryLevel;
        const nextMasteryText = toolInput.masteryLevel !== undefined || toolInput.masteryText !== undefined
          ? normalizeMasteryText(nextMasteryLevel, toolInput.masteryText)
          : existing.masteryText ?? conceptMasteryRubricForLevel(nextMasteryLevel).text;
        const nextMasteryReason = toolInput.masteryReason ?? existing.masteryReason;
        const masteryChanged = toolInput.masteryLevel !== undefined
          || toolInput.masteryText !== undefined
          || toolInput.masteryReason !== undefined;

        const updatedRecord: KnowledgeBaseRecord = {
          ...existing,
          id: conceptId,
          title: toolInput.title ?? existing.title,
          language: toolInput.language ?? existing.language,
          technology: toolInput.technology ?? existing.technology,
          content: toolInput.content ?? existing.content,
          docs: toolInput.sources ? mergeDocs(existing.docs, sourcesToDocs(toolInput.sources)) : existing.docs,
          sources: toolInput.sources ? mergeCitationSources(existing.sources ?? [], normalizeCitationSources(toolInput.sources)) : existing.sources,
          example: toolInput.examples ? (toolInput.examples[0] || "") : existing.example,
          examples: toolInput.examples ?? existing.examples,
          relatedConcepts: toolInput.relatedConcepts ?? existing.relatedConcepts,
          confidence: toolInput.confidence ?? existing.confidence,
          masteryLevel: nextMasteryLevel,
          masteryText: nextMasteryText,
          masteryReason: nextMasteryReason,
          masteryEvidence: masteryChanged ? toolInput.evidence : existing.masteryEvidence,
          masteryUpdatedAt: masteryChanged ? now : existing.masteryUpdatedAt,
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
          masteryLevel: nextMasteryLevel,
          masteryText: nextMasteryText,
          masteryReason: nextMasteryReason,
          masteryDirection: masteryChanged ? masteryDirection(existingMasteryLevel, nextMasteryLevel) : "unchanged",
          authoredBy: toolInput.authoredBy,
          agentContributionPercent: toolInput.agentContributionPercent ?? existing.agentContributionPercent,
          createdAt: now
        });
        updatedRecord.history = appendConceptHistory(existing.history, historyEntry);

        await store.saveKnowledgeConcept(updatedRecord);
        const direction = masteryChanged ? masteryDirection(existingMasteryLevel, nextMasteryLevel) : "unchanged";
        await store.recordConceptProjectEvent({
          id: randomUUID(),
          projectId: project.id,
          projectTitle: project.title,
          conceptId,
          kind: direction === "increased" ? "leveled-up" : direction === "decreased" ? "leveled-down" : "referenced",
          previousMasteryLevel: existingMasteryLevel,
          masteryLevel: nextMasteryLevel,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          artifactKind: "teaching",
          pathNodeId: toolInput.pathNodeId,
          taskId: toolInput.taskId,
          createdAt: now
        });
        publish("updated");

        return {
          modified: true,
          canonicalId: conceptId,
          normalizedFrom: conceptId === toolInput.id ? undefined : toolInput.id,
          previousConfidence: existing.confidence,
          nextConfidence: updatedRecord.confidence,
          previousMasteryLevel: existingMasteryLevel,
          nextMasteryLevel: updatedRecord.masteryLevel,
          reason: toolInput.reason,
          evidence: toolInput.evidence,
          changedFields: historyEntry.changedFields,
          fieldChanges: historyEntry.fieldChanges,
          provenance: historyEntry.provenance,
          confidenceReason: toolInput.confidenceReason,
          masteryText: updatedRecord.masteryText,
          masteryReason: updatedRecord.masteryReason,
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
        if (!state.projects[project.id]?.conceptRelations?.[conceptId]) {
          throw new Error(`Concept ${conceptId} is not related to project ${project.title}.`);
        }
        await store.removeProjectConcept(project.id, conceptId);
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
      description: "Read project-local concept records by exact ID, search query, or compact tree overview before citing, updating, teaching from, or placing new concepts. Use includeTree before add-concept when parent placement is not already obvious.",
      inputSchema: z.object({
        conceptIds: z.array(z.string().min(1)).max(8).optional().describe("Exact concept IDs to fetch when known"),
        query: z.string().min(1).max(160).optional().describe("Search query for concept ID, title, summary, content, evidence, tags, language, or technology"),
        includeTree: z.boolean().default(false).describe("Include a compact project-wide concept tree, available parent IDs, and placement candidates."),
        includeContent: z.boolean().default(false).describe("Include full content/examples/evidence details when the summary is not enough"),
        limit: z.number().int().min(1).max(12).default(8).describe("Maximum number of concepts to return")
      }).strict().superRefine((input, ctx) => {
        if (!input.conceptIds?.length && !input.query?.trim() && input.includeTree !== true) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query"],
            message: "Provide conceptIds, query, or includeTree."
          });
        }
      }),
      execute: async (toolInput) => {
        const store = this.options.learningStore();
        const concepts = await store.getProjectConceptRecords(project.id);
        const selected = new Map<string, KnowledgeBaseRecord>();
        const limit = toolInput.limit ?? 8;
        const includeContent = toolInput.includeContent ?? false;
        const includeTree = toolInput.includeTree ?? false;
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
          concepts: results.map((concept) => serializeConceptForAgent(concept, includeContent)),
          conceptTree: includeTree ? buildConceptTreeForAgent(concepts, {
            query,
            maxConcepts: 200
          }) : undefined
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

  private createConceptExerciseTool(
    project: StoredFlowProject,
    session: ConstructFlowSession,
    publish: (type: ConstructFlowSessionEvent["type"]) => void,
    conceptFirewallReviews?: Map<string, ConceptFirewallReviewRecord>
  ): ToolsInput[string] {
    return createTool({
      id: "concept-exercise",
      description: `Create a non-roadmap concept exercise when the learner needs practice before a project task. Exercises must be answerable directly from the concept content/sourceText and are appropriate for Mastery Levels 0-2. Mastery scale: ${flowMasteryRubricDescription} After creating an exercise, ask the learner for an answer with ask_user_question and stop.`,
      inputSchema: z.object({
        conceptIds: z.array(z.string().min(1)).min(1).max(6).describe("Concept IDs this exercise practices."),
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(1_200).describe("The learner-facing exercise prompt. It must be answerable from the concept text/sourceText, not from hidden project context."),
        masteryGoalLevel: flowConceptMasterySchema.default(2).describe("Target Mastery level this exercise can provide evidence for. Use 1-2 for early checks, 3 only when it proves task readiness."),
        successCriteria: z.array(z.string().min(1).max(240)).min(1).max(6),
        expectedSignals: z.array(z.string().min(1).max(240)).min(1).max(8).describe("What a good learner answer should notice."),
        sourceText: z.string().max(2_000).optional().describe("Short excerpt or synthesis from concept content that makes the exercise self-contained."),
        reason: z.string().min(1).max(700)
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const conceptIds = normalizeConceptIds(toolInput.conceptIds, project);
        const store = this.options.learningStore();
        const concepts = await store.getProjectConceptRecords(project.id);
        const conceptRecords = conceptIds
          .map((conceptId) => findKnowledgeConceptById(concepts, conceptId))
          .filter((concept): concept is KnowledgeBaseRecord => Boolean(concept));
        const missingConceptIds = conceptIds.filter((conceptId) => !conceptRecords.some((concept) => concept.id === conceptId));
        if (missingConceptIds.length > 0) {
          throw new Error(`Concept exercises require recorded concepts. Missing concept records: ${missingConceptIds.join(", ")}.`);
        }
        const sourceText = normalizeExerciseSourceText(toolInput.sourceText, conceptRecords);
        if (!sourceText) {
          throw new Error("Concept exercises must be answerable from the concept text. Add concept content first or provide sourceText.");
        }
        const conceptAuditContent = JSON.stringify({
          title: toolInput.title,
          prompt: toolInput.prompt,
          successCriteria: toolInput.successCriteria,
          expectedSignals: toolInput.expectedSignals,
          sourceText
        }, null, 2);
        const reviewId = findLatestConceptFirewallReviewId(conceptFirewallReviews, "concept-exercise");
        const conceptDecision = reviewId && conceptFirewallReviews
          ? (() => {
              consumeConceptFirewallToolReview(conceptFirewallReviews, reviewId, "concept-exercise");
              clearPendingConceptFirewallReview(project, reviewId);
              return {
                allowed: true,
                declaredConceptIds: conceptIds,
                matchedConceptIds: conceptIds,
                blockedCapabilities: [],
                reason: "Concept exercise approved by one-shot concept firewall tool review.",
                auditId: reviewId
              };
            })()
          : await this.conceptPolicy().authorize({
              project,
              artifactKind: "assessment",
              artifactRef: toolInput.title,
              declaredConceptIds: conceptIds,
              content: conceptAuditContent
            });
        if (!conceptDecision.allowed && conceptFirewallReviews) {
          conceptFirewallReviews.set(conceptDecision.auditId, {
            kind: "concept-exercise",
            createdAt: new Date().toISOString()
          });
          persistPendingConceptFirewallReview(session, conceptDecision.auditId, conceptFirewallReviews.get(conceptDecision.auditId));
          throw new Error(buildConceptFirewallExerciseBlockedMessage(conceptDecision));
        }
        assertConceptPolicyAllowed(conceptDecision);
        const exercise: ConstructFlowConceptExercise = {
          id: randomUUID(),
          projectId: project.id,
          sessionId: session.id,
          conceptIds,
          title: toolInput.title,
          prompt: toolInput.prompt,
          status: "waiting",
          masteryGoalLevel: toolInput.masteryGoalLevel,
          successCriteria: toolInput.successCriteria,
          expectedSignals: toolInput.expectedSignals,
          sourceText,
          createdAt: now
        };
        session.conceptExercises = [...(session.conceptExercises ?? []), exercise];
        project.flow.updatedAt = now;
        publish("updated");
        return {
          created: true,
          exerciseId: exercise.id,
          conceptIds: exercise.conceptIds,
          title: exercise.title,
          prompt: exercise.prompt,
          masteryGoalLevel: exercise.masteryGoalLevel,
          successCriteria: exercise.successCriteria,
          expectedSignals: exercise.expectedSignals,
          sourceText: exercise.sourceText,
          reason: toolInput.reason,
          conceptAuditId: conceptDecision.auditId
        };
      }
    });
  }

  private createReviewConceptExerciseTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "review-concept-exercise",
      description: `Review a learner answer to a concept-exercise and record whether it proves any Mastery movement. Use this before project tasks when a concept is below Level ${taskReadyMasteryLevel}. Mastery can increase, stay unchanged, or decrease; only update levels from the learner's answer evidence.`,
      inputSchema: z.object({
        exerciseId: z.string().min(1),
        learnerAnswer: z.string().min(1).max(2_000),
        outcome: z.enum(["passed", "partial", "missed"]),
        reviewNote: z.string().min(1).max(1_000),
        masteryUpdates: z.array(z.object({
          conceptId: z.string().min(1),
          masteryLevel: flowConceptMasterySchema,
          masteryText: z.string().max(900).optional(),
          masteryReason: z.string().min(1).max(700),
          evidence: z.string().min(1).max(500)
        })).max(6).optional().describe("Evidence-backed Mastery updates. Include only concepts whose level is genuinely proven by the learner answer.")
      }).strict(),
      execute: async (toolInput) => {
        const exercise = findConceptExercise(project, toolInput.exerciseId);
        if (exercise.status === "cancelled") {
          throw new Error(`Cannot review cancelled concept exercise: ${exercise.id}`);
        }
        const now = new Date().toISOString();
        exercise.status = "reviewed";
        exercise.learnerAnswer = toolInput.learnerAnswer;
        exercise.answeredAt ??= now;
        exercise.reviewedAt = now;
        exercise.reviewNote = toolInput.reviewNote;
        exercise.masteryEvidence = (toolInput.masteryUpdates ?? []).map((update) => ({
          conceptId: normalizeConceptId(update.conceptId, project),
          evidence: update.evidence,
          recommendedLevel: update.masteryLevel
        }));

        if (toolInput.masteryUpdates?.length) {
          const store = this.options.learningStore();
          for (const update of toolInput.masteryUpdates) {
            await applyConceptMasteryUpdate(project, store, {
              conceptId: update.conceptId,
              masteryLevel: update.masteryLevel,
              masteryText: update.masteryText,
              masteryReason: update.masteryReason,
              evidence: [update.evidence],
              authoredBy: "learner",
              agentContributionPercent: 0,
              pathNodeId: project.flow.currentPathNodeId ?? undefined
            }, now);
          }
        }

        project.flow.updatedAt = now;
        publish("updated");
        return {
          reviewed: true,
          exerciseId: exercise.id,
          outcome: toolInput.outcome,
          reviewNote: exercise.reviewNote,
          masteryEvidence: exercise.masteryEvidence
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
      description: `Review the current subtask and mark it either done or needing more work with explicit evidence. A formal learner submission is useful but not required; concrete workspace evidence, task-scoped learner messages, or validation results can complete a subtask. Agent-authored edits alone are not learner evidence. Optionally update concept Mastery only for concepts whose level is proven by learner-authored work or explanation. Mastery scale: ${flowMasteryRubricDescription}`,
      inputSchema: z.object({
        taskId: z.string().min(1),
        subtaskId: z.string().min(1),
        outcome: z.enum(["done", "needs-work"]),
        evidence: z.string().min(1).max(1_000),
        nextInstructions: z.string().max(1_000).optional(),
        masteryUpdates: z.array(z.object({
          conceptId: z.string().min(1),
          masteryLevel: flowConceptMasterySchema,
          masteryText: z.string().max(900).optional(),
          masteryReason: z.string().min(1).max(700),
          evidence: z.string().min(1).max(500)
        })).max(8).optional().describe("Evidence-backed Mastery updates from this learner-authored subtask. Include only concepts genuinely proven by the submitted diff.")
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        const subtask = findPracticeSubtask(task, toolInput.subtaskId);
        const submission = task.submission?.authoredBy?.actor === "learner" ? task.submission : undefined;
        const reviewingLatestSubmission = Boolean(submission && (task.status === "submitted" || subtask.status === "submitted"));
        if (task.status === "completed" || task.status === "cancelled") {
          throw new Error(`Cannot review a subtask for a ${task.status} task.`);
        }
        if (reviewingLatestSubmission && submission?.subtaskId && submission.subtaskId !== subtask.id) {
          throw new Error("Cannot review a different subtask from the latest learner submission.");
        }
        const agentEditedPaths = reviewingLatestSubmission ? findAgentEditedTaskFilesAfterSubmission(project, task) : [];
        if (reviewingLatestSubmission && toolInput.outcome === "done" && agentEditedPaths.length > 0) {
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

        if (toolInput.masteryUpdates?.length) {
          const store = this.options.learningStore();
          for (const update of toolInput.masteryUpdates) {
            const conceptId = normalizeConceptId(update.conceptId, project);
            const taskConceptIds = new Set([...(task.conceptIds ?? []), ...(task.introducedConceptIds ?? [])]);
            if (!taskConceptIds.has(conceptId)) {
              throw new Error(`Subtask review can only update Mastery for concepts attached to the task. ${conceptId} is not attached to task ${task.id}.`);
            }
            await applyConceptMasteryUpdate(project, store, {
              conceptId,
              masteryLevel: update.masteryLevel,
              masteryText: update.masteryText,
              masteryReason: update.masteryReason,
              evidence: [update.evidence],
              authoredBy: "learner",
              agentContributionPercent: 0,
              pathNodeId: task.pathNodeId,
              taskId: task.id
            }, now);
          }
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
      description: "Mark a full Flow task done after every subtask has been reviewed as completed. A learner-authored submission can be used as evidence when present, but concrete reviewed subtask evidence can also complete the task.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        summary: z.string().min(1).max(1_200),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(8)
      }).strict(),
      execute: async (toolInput) => {
        const task = findPracticeTask(project, toolInput.taskId);
        const submission = task.submission?.authoredBy?.actor === "learner" ? task.submission : undefined;
        if (task.status === "completed" || task.status === "cancelled") {
          throw new Error(`Cannot complete a task that is already ${task.status}.`);
        }
        const agentEditedPaths = submission ? findAgentEditedTaskFilesAfterSubmission(project, task) : [];
        if (submission && agentEditedPaths.length > 0) {
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

function findConceptExercise(project: StoredFlowProject, exerciseId: string): ConstructFlowConceptExercise {
  const exercise = project.flow.sessions
    .flatMap((session) => session.conceptExercises ?? [])
    .find((candidate) => candidate.id === exerciseId);
  if (!exercise) {
    throw new Error(`Unknown Flow concept exercise: ${exerciseId}`);
  }
  return exercise;
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

type ConceptMasteryUpdate = {
  conceptId: string;
  masteryLevel: ConstructConceptMasteryLevel;
  masteryText?: string;
  masteryReason: string;
  evidence: string[];
  authoredBy: ConceptHistoryEntry["authoredBy"];
  agentContributionPercent?: number;
  pathNodeId?: string;
  taskId?: string;
};

async function applyConceptMasteryUpdate(
  project: StoredFlowProject,
  store: ConstructLearningStore,
  update: ConceptMasteryUpdate,
  updatedAt: string
): Promise<KnowledgeBaseRecord> {
  const state = await store.getState();
  const conceptId = normalizeConceptId(update.conceptId, project);
  const existing = findKnowledgeConceptById(Object.values(state.knowledgeBase.concepts), conceptId);
  if (!existing) {
    throw new Error(`Concept with ID ${conceptId} not found in the learner's global concepts.`);
  }
  const projectRelation = state.projects[project.id]?.conceptRelations?.[conceptId];
  if (!projectRelation?.introducedAt) {
    throw new Error(`Concept ${conceptId} cannot gain project Mastery because it has not been taught in project ${project.title}.`);
  }
  const previousMasteryLevel = masteryLevelForConcept(existing);
  const masteryLevel = normalizeMasteryLevel(update.masteryLevel);
  const masteryText = normalizeMasteryText(masteryLevel, update.masteryText);
  const updatedRecord: KnowledgeBaseRecord = {
    ...existing,
    masteryLevel,
    masteryText,
    masteryReason: update.masteryReason,
    masteryEvidence: update.evidence,
    masteryUpdatedAt: updatedAt,
    lastChangeReason: update.masteryReason,
    learnerEvidence: update.evidence,
    authoredBy: update.authoredBy,
    agentContributionPercent: update.agentContributionPercent ?? existing.agentContributionPercent,
    lastPracticedAt: updatedAt,
    lastModifiedAt: updatedAt
  };
  const fieldChanges = conceptFieldChanges(existing, updatedRecord, ["masteryLevel", "masteryText", "masteryReason", "masteryEvidence", "learnerEvidence", "lastPracticedAt"]);
  const historyEntry = createConceptHistoryEntry({
    kind: "practiced",
    reason: update.masteryReason,
    evidence: update.evidence,
    changedFields: fieldChanges.map((change) => change.field),
    fieldChanges,
    provenance: createConceptHistoryProvenance(project, conceptId, update.pathNodeId, update.taskId),
    masteryLevel,
    masteryText,
    masteryReason: update.masteryReason,
    masteryDirection: masteryDirection(previousMasteryLevel, masteryLevel),
    authoredBy: update.authoredBy,
    agentContributionPercent: update.agentContributionPercent,
    createdAt: updatedAt
  });
  updatedRecord.history = appendConceptHistory(existing.history, historyEntry);
  await store.saveKnowledgeConcept(updatedRecord);
  const direction = masteryDirection(previousMasteryLevel, masteryLevel);
  await store.recordConceptProjectEvent({
    id: randomUUID(),
    projectId: project.id,
    projectTitle: project.title,
    conceptId,
    kind: direction === "increased" ? "leveled-up" : direction === "decreased" ? "leveled-down" : "practiced",
    previousMasteryLevel,
    masteryLevel,
    reason: update.masteryReason,
    evidence: update.evidence,
    artifactKind: "assessment",
    pathNodeId: update.pathNodeId,
    taskId: update.taskId,
    createdAt: updatedAt
  });
  return updatedRecord;
}

function createConceptHistoryEntry(input: {
  kind: ConceptHistoryEntry["kind"];
  reason: string;
  evidence: string[];
  changedFields?: string[];
  fieldChanges?: ConceptFieldChange[];
  provenance?: ConceptHistoryProvenance;
  confidence?: ConstructConceptConfidence;
  confidenceReason?: string;
  masteryLevel?: ConstructConceptMasteryLevel;
  masteryText?: string;
  masteryReason?: string;
  masteryDirection?: ConceptHistoryEntry["masteryDirection"];
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
    masteryLevel: input.masteryLevel,
    masteryText: input.masteryText,
    masteryReason: input.masteryReason,
    masteryDirection: input.masteryDirection,
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
    "docs",
    "sources",
    "examples",
    "relatedConcepts",
    "confidence",
    "confidenceReason",
    "masteryLevel",
    "masteryText",
    "masteryReason",
    "masteryEvidence",
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
    "docs",
    "sources",
    "examples",
    "relatedConcepts",
    "confidence",
    "confidenceReason",
    "masteryLevel",
    "masteryText",
    "masteryReason",
    "masteryEvidence",
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
  if (field === "masteryLevel") return record.masteryLevel;
  if (field === "masteryText") return record.masteryText;
  if (field === "masteryReason") return record.masteryReason;
  if (field === "masteryEvidence") return record.masteryEvidence;
  if (field === "lastPracticedAt") return record.lastPracticedAt;
  if (field === "learnerEvidence") return record.learnerEvidence;
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

function normalizeMasteryLevel(value: unknown): ConstructConceptMasteryLevel {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (numeric === 0 || numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5) {
      return numeric;
    }
  }
  return 0;
}

function normalizeMasteryText(level: ConstructConceptMasteryLevel, text: string | undefined): string {
  const trimmed = text?.trim();
  return trimmed || conceptMasteryRubricForLevel(level).text;
}

function normalizeMasteryReason(reason: string | undefined, level: ConstructConceptMasteryLevel): string | undefined {
  const trimmed = reason?.trim();
  if (trimmed) return trimmed;
  return level === 0 ? "Concept introduced or refreshed; no learner-owned application evidence yet." : undefined;
}

function masteryLevelForConcept(concept: KnowledgeBaseRecord): ConstructConceptMasteryLevel {
  if (concept.masteryLevel !== undefined) return normalizeMasteryLevel(concept.masteryLevel);
  return masteryLevelFromConfidence(concept.confidence);
}

function masteryLevelFromConfidence(confidence: ConstructConceptConfidence | undefined): ConstructConceptMasteryLevel {
  if (confidence === "applying") return 3;
  if (confidence === "solid" || confidence === "strong") return 4;
  if (confidence === "fluent" || confidence === "teaching") return 5;
  if (confidence === "practicing" || confidence === "emerging") return 2;
  if (confidence === "confused" || confidence === "fragile" || confidence === "weak") return 1;
  return 0;
}

function masteryDirection(
  previous: ConstructConceptMasteryLevel | number | undefined,
  next: ConstructConceptMasteryLevel | number | undefined
): ConceptHistoryEntry["masteryDirection"] {
  const previousLevel = previous === undefined ? undefined : normalizeMasteryLevel(previous);
  const nextLevel = next === undefined ? undefined : normalizeMasteryLevel(next);
  if (nextLevel === undefined || previousLevel === nextLevel) return "unchanged";
  if (previousLevel === undefined) return nextLevel > 0 ? "increased" : "unchanged";
  return nextLevel > previousLevel ? "increased" : "decreased";
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
    concept.masteryLevel,
    concept.masteryText,
    concept.masteryReason,
    concept.lastChangeReason,
    ...(concept.tags ?? []),
    ...(concept.relatedConcepts ?? []),
    ...(concept.examples ?? []),
    ...(concept.learnerEvidence ?? []),
    ...(concept.masteryEvidence ?? [])
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
    masteryLevel: masteryLevelForConcept(concept),
    masteryText: concept.masteryText ?? conceptMasteryRubricForLevel(masteryLevelForConcept(concept)).text,
    masteryReason: concept.masteryReason,
    masteryEvidence: concept.masteryEvidence,
    masteryUpdatedAt: concept.masteryUpdatedAt,
    learnerEvidence: concept.learnerEvidence,
    lastChangeReason: concept.lastChangeReason,
    authoredBy: concept.authoredBy,
    agentContributionPercent: concept.agentContributionPercent,
    relatedConcepts: concept.relatedConcepts,
    sources: concept.sources,
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

function buildConceptTreeForAgent(
  concepts: KnowledgeBaseRecord[],
  options: {
    query?: string;
    maxConcepts: number;
  }
) {
  const records = uniqueKnowledgeConcepts(concepts);
  const limited = records.slice(0, options.maxConcepts);
  const byId = new Map(records.map((concept) => [concept.id, concept] as const));
  const childrenByParent = new Map<string | null, string[]>();

  for (const concept of records) {
    const parentId = concept.parentId && byId.has(concept.parentId) ? concept.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), concept.id]);
  }

  for (const [parentId, childIds] of childrenByParent.entries()) {
    childrenByParent.set(parentId, childIds.sort((left, right) => left.localeCompare(right)));
  }

  const nodes = limited.map((concept) => {
    const childIds = childrenByParent.get(concept.id) ?? [];
    const depth = conceptDepth(concept);
    return {
      id: concept.id,
      parentId: concept.parentId ?? null,
      title: concept.title,
      titlePath: conceptTitlePath(concept, byId),
      depth,
      childIds,
      childCount: childIds.length,
      canHaveChildren: depth < 2,
      language: concept.language,
      technology: concept.technology,
      summary: compactAgentText(concept.summary || concept.content || "", 220),
      masteryLevel: masteryLevelForConcept(concept),
      isParentStub: isParentConceptStub(concept),
      relatedConcepts: concept.relatedConcepts?.slice(0, 8) ?? []
    };
  });

  const availableParents = nodes
    .filter((node) => node.canHaveChildren)
    .map((node) => ({
      id: node.id,
      title: node.title,
      depth: node.depth,
      childCount: node.childCount,
      titlePath: node.titlePath,
      summary: node.summary,
      isParentStub: node.isParentStub
    }))
    .slice(0, 120);

  return {
    totalConcepts: records.length,
    returnedConcepts: limited.length,
    truncated: records.length > limited.length,
    maxDepth: 3,
    namingRules: [
      "Use reusable dot-notated IDs shaped as domain.area.topic, never project/app-specific names.",
      "Prefer an existing narrow parent from availableParents; create a new parent branch only with a concrete placement rationale.",
      "Concept titles should read naturally inside the titlePath and name the capability, not the project."
    ],
    outline: buildConceptTreeOutline(records).slice(0, options.maxConcepts),
    nodes,
    availableParents,
    suggestedParents: suggestedConceptParents(records, options.query).slice(0, 12)
  };
}

function buildConceptTreeOutline(concepts: KnowledgeBaseRecord[]): string[] {
  const records = uniqueKnowledgeConcepts(concepts);
  const byId = new Map(records.map((concept) => [concept.id, concept] as const));
  const childrenByParent = new Map<string | null, KnowledgeBaseRecord[]>();

  for (const concept of records) {
    const parentId = concept.parentId && byId.has(concept.parentId) ? concept.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), concept]);
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    childrenByParent.set(parentId, children.sort((left, right) => left.id.localeCompare(right.id)));
  }

  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (concept: KnowledgeBaseRecord, depth: number) => {
    if (visited.has(concept.id)) return;
    visited.add(concept.id);
    const marker = isParentConceptStub(concept) ? " [parent stub]" : "";
    lines.push(`${"  ".repeat(depth)}- ${concept.id} — ${concept.title}${marker}`);
    for (const child of childrenByParent.get(concept.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }
  for (const concept of records) {
    if (!visited.has(concept.id)) visit(concept, conceptDepth(concept));
  }
  return lines;
}

function suggestedConceptParents(concepts: KnowledgeBaseRecord[], query: string | undefined): Array<{
  id: string;
  title: string;
  score: number;
  childCount: number;
  titlePath: string[];
  reason: string;
}> {
  const normalizedQuery = query?.trim().toLowerCase();
  const records = uniqueKnowledgeConcepts(concepts);
  const byId = new Map(records.map((concept) => [concept.id, concept] as const));
  const childCountById = new Map<string, number>();
  for (const concept of records) {
    if (!concept.parentId) continue;
    childCountById.set(concept.parentId, (childCountById.get(concept.parentId) ?? 0) + 1);
  }
  const terms = normalizedQuery
    ? normalizedQuery.split(/[^a-z0-9#.+-]+/i).filter((term) => term.length > 2)
    : [];

  return records
    .filter((concept) => conceptDepth(concept) < 2)
    .map((concept) => {
      const score = normalizedQuery ? scoreParentCandidate(concept, normalizedQuery, terms) : childCountById.get(concept.id) ?? 0;
      return {
        id: concept.id,
        title: concept.title,
        score,
        childCount: childCountById.get(concept.id) ?? 0,
        titlePath: conceptTitlePath(concept, byId),
        reason: normalizedQuery
          ? "Matched query terms against parent id, title, summary, content, or existing child names."
          : "Existing parent-capable concept in the project tree."
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function scoreParentCandidate(concept: KnowledgeBaseRecord, normalizedQuery: string, terms: string[]): number {
  let score = scoreConceptMatch(concept, normalizedQuery, terms);
  if (concept.id === normalizedQuery) score += 30;
  if (normalizedQuery.startsWith(`${concept.id}.`)) score += 60;
  if (concept.id.split(".")[0] === normalizedQuery.split(".")[0]) score += 16;
  return score;
}

function conceptTitlePath(concept: KnowledgeBaseRecord, byId: Map<string, KnowledgeBaseRecord>): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let current: KnowledgeBaseRecord | undefined = concept;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function compactAgentText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1).trimEnd()}…` : compact;
}

function conceptDepth(concept: Pick<KnowledgeBaseRecord, "id" | "parentId">): number {
  return Math.max(0, concept.id.split(".").length - 1);
}

function isParentConceptStub(concept: KnowledgeBaseRecord): boolean {
  return concept.authoredBy === "system" && concept.summary.trim().toLowerCase().startsWith("parent concept stub for ");
}

function normalizeOptionalParentId(parentId: string | null | undefined, project: StoredFlowProject): string | null | undefined {
  if (parentId === undefined) return undefined;
  if (parentId === null) return null;
  const normalized = normalizeConceptId(parentId, project);
  if (!normalized) {
    throw new Error("parentId normalized to an empty concept ID.");
  }
  return normalized;
}

function assertAddConceptPlacement(input: {
  project: StoredFlowProject;
  conceptId: string;
  title: string;
  content: string;
  explicitParentId: string | null | undefined;
  placementRationale: string | undefined;
  projectConcepts: KnowledgeBaseRecord[];
  existingRecord: KnowledgeBaseRecord | undefined;
}): void {
  const parts = input.conceptId.split(".");
  if (parts.length > 3) {
    throw new Error(`Concept IDs may be at most 3 levels deep (domain.area.topic). Received ${input.conceptId}. Group smaller ideas inside the nearest existing parent concept instead.`);
  }

  const expectedParentId = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  if (input.explicitParentId !== undefined && input.explicitParentId !== expectedParentId) {
    throw new Error(
      expectedParentId
        ? `parentId must match the concept ID prefix. For ${input.conceptId}, parentId must be ${expectedParentId}.`
        : `Root concept ${input.conceptId} must use parentId null or omit parentId.`
    );
  }

  const projectConceptIds = new Set(input.projectConcepts.map((concept) => concept.id));
  const titleKey = normalizeConceptTitleForComparison(input.title);
  const titleConflict = input.projectConcepts.find((concept) => (
    concept.id !== input.conceptId && normalizeConceptTitleForComparison(concept.title) === titleKey
  ));
  if (titleConflict) {
    throw new Error(`Concept title "${input.title}" already exists as ${titleConflict.id}. Use modify-concept for that record or choose a more precise tree name.`);
  }

  const missingParentIds = conceptAncestorIds(input.conceptId).filter((parentId) => !projectConceptIds.has(parentId));
  if (!missingParentIds.length || !input.projectConcepts.length || input.existingRecord) return;

  const candidates = candidateExistingParentsForNewConcept(input.conceptId, input.title, input.content, input.projectConcepts);
  if (!candidates.length) return;
  if (isSpecificPlacementRationale(input.placementRationale)) return;

  throw new Error([
    `Adding ${input.conceptId} would create new parent concept(s): ${missingParentIds.join(", ")}.`,
    `Existing parent candidates in this project: ${candidates.map((candidate) => `${candidate.id} (${candidate.title})`).join(", ")}.`,
    "Fetch the concept tree with fetch-concepts includeTree, place the concept under the best existing parent by changing the ID, or retry with placementRationale explaining why the new parent branch is correct."
  ].join(" "));
}

function conceptAncestorIds(conceptId: string): string[] {
  const parts = conceptId.split(".");
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("."));
  }
  return ancestors;
}

function candidateExistingParentsForNewConcept(
  conceptId: string,
  title: string,
  content: string,
  concepts: KnowledgeBaseRecord[]
): Array<{ id: string; title: string; score: number }> {
  const normalizedQuery = `${conceptId} ${title} ${content.slice(0, 800)}`.toLowerCase();
  const terms = normalizedQuery.split(/[^a-z0-9#.+-]+/i).filter((term) => term.length > 2);
  const root = conceptId.split(".")[0];
  return uniqueKnowledgeConcepts(concepts)
    .filter((concept) => concept.id !== conceptId && conceptDepth(concept) < 2)
    .map((concept) => {
      let score = scoreParentCandidate(concept, normalizedQuery, terms);
      if (concept.id === root || concept.id.startsWith(`${root}.`)) score += 60;
      return { id: concept.id, title: concept.title, score };
    })
    .filter((candidate) => candidate.score >= 20)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 6);
}

function isSpecificPlacementRationale(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) >= 32;
}

function normalizeConceptTitleForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeExerciseSourceText(sourceText: string | undefined, concepts: KnowledgeBaseRecord[]): string {
  const explicit = sourceText?.trim();
  if (explicit) return explicit;
  return concepts
    .map((concept) => [
      `${concept.title} (${concept.id})`,
      concept.content || concept.summary,
      concept.examples?.length ? `Examples:\n${concept.examples.slice(0, 2).join("\n\n")}` : null
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n")
    .trim()
    .slice(0, 2_000);
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
  learnerReadiness: NonNullable<ConstructFlowPracticeTask["learnerReadiness"]>,
  requiredMasteryLevel: ConstructConceptMasteryLevel
): void {
  const unreadyConcepts = conceptRecords
    .map((concept) => ({
      id: concept.id,
      level: masteryLevelForConcept(concept),
      title: concept.title
    }))
    .filter((concept) => concept.level < requiredMasteryLevel);
  if (unreadyConcepts.length > 0) {
    throw new Error([
      `Practice tasks require every introduced concept to be Mastery Level ${requiredMasteryLevel} or higher.`,
      `Not ready: ${unreadyConcepts.map((concept) => `${concept.id} is Level ${concept.level}`).join(", ")}.`,
      "Keep teaching with Socratic explanation, ask a tracked question, or create a concept-exercise until the learner demonstrates Level 3 readiness."
    ].join(" "));
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

function findBlockingActivePracticeTask(
  project: StoredFlowProject,
  input: {
    pathNodeId?: string | null;
    introducedConceptIds: string[];
    taskFiles: string[];
  }
): ConstructFlowPracticeTask | undefined {
  const conceptIds = new Set(input.introducedConceptIds);
  const taskFiles = new Set(input.taskFiles);
  return project.flow.sessions
    .flatMap((session) => session.practiceTasks)
    .find((task) => {
      if (task.status !== "waiting" && task.status !== "submitted") return false;
      if (input.pathNodeId && task.pathNodeId === input.pathNodeId) return true;
      if ((task.taskFiles ?? []).some((file) => taskFiles.has(file))) return true;
      return activeTaskConceptIds(task).some((conceptId) => conceptIds.has(conceptId));
    });
}

function activeTaskConceptIds(task: ConstructFlowPracticeTask): string[] {
  return [...new Set([...(task.introducedConceptIds ?? []), ...(task.conceptIds ?? [])])];
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

function conceptTitleFromId(
  conceptId: string,
  language: ConstructConceptLanguage | undefined,
  technology: string | undefined
): string {
  const segments = conceptId.split(".");
  const segment = segments[segments.length - 1] ?? conceptId;
  if (segments.length === 1) {
    const technologyTitle = technology?.trim();
    if (technologyTitle && normalizeConceptTitleSegment(technologyTitle) === segment) {
      return technologyTitle;
    }
    const languageTitle = conceptLanguageTitle(language);
    if (languageTitle && normalizeConceptTitleSegment(languageTitle) === segment) {
      return languageTitle;
    }
  }
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeConceptTitleSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function conceptLanguageTitle(language: ConstructConceptLanguage | undefined): string | undefined {
  switch (language) {
    case "cpp":
      return "C++";
    case "javascript":
      return "JavaScript";
    case "typescript":
      return "TypeScript";
    case "swift":
      return "Swift";
    case "python":
      return "Python";
    default:
      return undefined;
  }
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

export function applyFlowQuestionResponse(
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

function formatQuestionResponseMessage(
  response: ConstructFlowQuestionResponse | undefined,
  fallbackMessage: string
): string {
  if (!response) return fallbackMessage;
  return [
    "Tracked Flow question answered.",
    `Question: ${response.question || "Flow question"}`,
    response.skipped ? "Answer: Skipped" : `Answer: ${response.answer || ""}`,
    `Answered at: ${response.answeredAt}`
  ].join("\n");
}

function isQuestionTool(name: string | undefined): boolean {
  const normalized = normalizeToolName(name);
  return normalized === "askquestion" || normalized === "askuser" || normalized === "askuserquestion";
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
      source: "summary",
      compactedRawMessageIds: [...compaction.summarizedMessageIds]
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
    const visibleActivity = visibleFlowTranscriptForModel(session);
    const visibleTranscriptTokens = visibleActivity ? estimateTextTokens(visibleActivity) : 0;
    const visibleTranscriptEventCount = visibleActivity ? visibleFlowTranscriptEventCount(session) : 0;
    const assistantMessages = session.messages.filter((message) => message.role === "assistant");
    for (const message of assistantMessages) {
      const content = [visibleActivity, message.content].filter((part) => part.trim()).join("\n\n");
      messages.push({
        id: `${session.id}:${message.id}`,
        sessionId: session.id,
        role: "assistant",
        content,
        source: "chat",
        visibleTranscriptTokens,
        visibleTranscriptEventCount
      });
    }
    if (!assistantMessages.length && visibleActivity) {
      messages.push({
        id: `${session.id}:visible-activity`,
        sessionId: session.id,
        role: "assistant",
        content: visibleActivity,
        source: "chat",
        visibleTranscriptTokens,
        visibleTranscriptEventCount
      });
    }
  }
  return messages;
}

function visibleFlowTranscriptEventCount(session: ConstructFlowSession): number {
  const timelineToolIds = new Set(
    session.timeline
      .filter((part): part is Extract<ConstructFlowTimelinePart, { kind: "tool" }> => part.kind === "tool")
      .map((part) => part.toolCallId)
  );
  const extraToolCount = session.toolCalls.filter((toolCall) => !timelineToolIds.has(toolCall.id)).length;
  return session.timeline.length + extraToolCount;
}

function visibleFlowTranscriptForModel(session: ConstructFlowSession): string {
  const lines: string[] = [];
  const toolResponses = new Map(session.toolCalls.map((toolCall) => [toolCall.id, toolCall.response] as const));
  const timeline = session.timeline.length
    ? session.timeline
    : session.toolCalls.map((toolCall) => timelinePartFromFlowToolRecord(toolCall));
  for (const part of timeline) {
    const response = part.kind === "tool" ? toolResponses.get(part.toolCallId) : undefined;
    const rendered = timelinePartForModel(part, response);
    if (rendered) {
      lines.push(rendered);
    }
  }
  const visibleToolIds = new Set(
    timeline
      .filter((part): part is Extract<ConstructFlowTimelinePart, { kind: "tool" }> => part.kind === "tool")
      .map((part) => part.toolCallId)
  );
  for (const toolCall of session.toolCalls) {
    if (visibleToolIds.has(toolCall.id)) continue;
    const rendered = timelinePartForModel(timelinePartFromFlowToolRecord(toolCall), toolCall.response);
    if (rendered) {
      lines.push(rendered);
    }
  }
  if (!lines.length) return "";
  return truncateModelTextTail([
    `Visible Flow turn transcript (${session.origin ?? "user"} session, ${session.status}):`,
    ...lines.map((line) => `- ${line}`)
  ].join("\n"), flowTranscriptMaxSessionChars);
}

function timelinePartFromFlowToolRecord(record: ConstructFlowToolCallRecord): Extract<ConstructFlowTimelinePart, { kind: "tool" }> {
  return {
    id: record.id,
    kind: "tool",
    toolCallId: record.id,
    name: record.name,
    title: record.title,
    reason: record.reason,
    status: record.status,
    input: record.input,
    outputPreview: record.outputPreview,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.completedAt ?? record.createdAt
  };
}

function timelinePartForModel(part: ConstructFlowTimelinePart, response?: ConstructFlowQuestionResponse): string | undefined {
  if (part.kind === "message") {
    const text = truncateModelText(part.text.trim(), flowTranscriptMaxFieldChars);
    return text ? `Said (${part.status}): ${text}` : undefined;
  }
  if (part.kind === "reasoning") {
    const text = truncateModelText((part.text || part.detail || part.title).trim(), flowTranscriptMaxFieldChars);
    return text ? `Thought (${part.status}): ${text}` : undefined;
  }
  if (part.kind === "compaction") {
    return [
      `Context compaction ${part.status}: ${part.title}`,
      part.detail ? `reason=${truncateModelText(part.detail, 400)}` : null,
      typeof part.summarizedMessageCount === "number" ? `summarized=${part.summarizedMessageCount}` : null,
      typeof part.preservedMessageCount === "number" ? `preserved=${part.preservedMessageCount}` : null,
      part.summary ? `summary=${truncateModelText(part.summary, flowTranscriptMaxFieldChars)}` : null
    ].filter(Boolean).join("; ");
  }
  return toolPartForModel(part, response);
}

function toolPartForModel(part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>, response?: ConstructFlowQuestionResponse): string {
  const input = summarizeToolInput(part.name, part.input);
  const output = part.outputPreview ? truncateModelText(part.outputPreview, flowTranscriptMaxFieldChars) : undefined;
  const answer = response
    ? `answer=${truncateModelText(response.skipped ? "Skipped" : response.answer, 500)}`
    : undefined;
  return [
    `Tool ${part.name} ${part.status}: ${part.title}`,
    part.reason ? `reason=${truncateModelText(part.reason, 400)}` : null,
    answer,
    input ? `input=${input}` : null,
    output ? `output=${output}` : null
  ].filter(Boolean).join("; ");
}

function summarizeToolInput(name: string, input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) {
    return input === undefined ? undefined : truncateModelText(String(input), flowTranscriptMaxFieldChars);
  }
  const normalized = normalizeToolName(name);
  const source = input as Record<string, unknown>;
  if (normalized === "write" || normalized === "editwritefile") {
    return stringifyModelObject({
      path: source.path,
      reason: source.reason,
      contentPreview: summarizeTextField(source.content, flowTranscriptMaxToolContentChars)
    });
  }
  if (normalized === "edit" || normalized === "editreplace") {
    return stringifyModelObject({
      path: source.path,
      reason: source.reason,
      findPreview: summarizeTextField(source.find, flowTranscriptMaxToolContentChars),
      replacePreview: summarizeTextField(source.replace, flowTranscriptMaxToolContentChars)
    });
  }
  if (normalized === "runterminalcommand") {
    return stringifyModelObject({
      command: source.command,
      cwd: source.cwd,
      label: source.label,
      reason: source.reason
    });
  }
  if (normalized === "askquestion" || normalized === "askuser") {
    return stringifyModelObject({
      question: source.question,
      choices: source.choices,
      blocksProgress: source.blocksProgress
    });
  }
  if (normalized === "flowmemorypatch") {
    const patches = Array.isArray(source.patches)
      ? source.patches.map((patch) => summarizeFlowMemoryPatch(patch))
      : undefined;
    return stringifyModelObject({ patches });
  }
  if (normalized === "practicetask") {
    return stringifyModelObject({
      title: source.title,
      pathNodeId: source.pathNodeId,
      introducedConceptIds: source.introducedConceptIds,
      requiredMasteryLevel: source.requiredMasteryLevel,
      learnerReadiness: source.learnerReadiness,
      taskFiles: source.taskFiles,
      promptPreview: summarizeTextField(source.prompt, flowTranscriptMaxToolContentChars)
    });
  }
  if (normalized === "conceptexercise") {
    return stringifyModelObject({
      title: source.title,
      conceptIds: source.conceptIds,
      masteryGoalLevel: source.masteryGoalLevel,
      successCriteria: source.successCriteria,
      promptPreview: summarizeTextField(source.prompt, flowTranscriptMaxToolContentChars)
    });
  }
  if (normalized === "reviewconceptexercise") {
    return stringifyModelObject({
      exerciseId: source.exerciseId,
      outcome: source.outcome,
      masteryUpdates: source.masteryUpdates,
      answerPreview: summarizeTextField(source.learnerAnswer, flowTranscriptMaxToolContentChars)
    });
  }
  return stringifyModelObject(pruneModelObject(source));
}

function summarizeFlowMemoryPatch(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const patch = value as Record<string, unknown>;
  return {
    file: patch.file,
    mode: patch.mode,
    reason: patch.reason,
    contentPreview: summarizeTextField(patch.content, 500),
    findPreview: summarizeTextField(patch.find, 500)
  };
}

function pruneModelObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => pruneModelObject(item));
  if (typeof value === "string") return summarizeTextField(value, flowTranscriptMaxFieldChars);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 16)
      .map(([key, item]) => [key, pruneModelObject(item)])
  );
}

function summarizeTextField(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return truncateModelText(value, maxChars);
}

function stringifyModelObject(value: unknown): string | undefined {
  const text = JSON.stringify(value, null, 2);
  return text ? truncateModelText(text, flowTranscriptMaxFieldChars) : undefined;
}

function truncateModelText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated ${trimmed.length - maxChars} chars]`;
}

function truncateModelTextTail(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const omitted = trimmed.length - maxChars;
  return `[truncated ${omitted} earlier chars]\n${trimmed.slice(-maxChars).trimStart()}`;
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
  const summarizedMessageIds = summarizedMessageIdsForSelection(selected.head);
  return {
    id: randomUUID(),
    status: "running",
    trigger: "auto",
    reason: `Context reached ${contextWindow.maxTokens ? Math.round(((contextWindow.usedTokens ?? 0) / contextWindow.maxTokens) * 100) : "unknown"}% of the model window.`,
    startedAt,
    beforeTokens: contextWindow.usedTokens ?? selected.beforeTokens,
    summarizedMessageIds,
    preservedMessageIds: selected.tail.map((message) => message.id),
    summarizedMessageCount: summarizedMessageIds.length,
    preservedMessageCount: selected.tail.length
  };
}

function summarizedMessageIdsForSelection(messages: FlowModelMessage[]): string[] {
  return [...new Set(messages.flatMap((message) => (
    message.source === "summary"
      ? message.compactedRawMessageIds ?? [message.id]
      : [message.id]
  )))];
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
      source: "summary",
      compactedRawMessageIds: summarizedMessageIdsForSelection(selected.head)
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

function activeFlowPracticeTasks(project: StoredFlowProject): ConstructFlowPracticeTask[] {
  return project.flow.sessions
    .flatMap((session) => session.practiceTasks)
    .filter((task) => task.status === "waiting" || task.status === "submitted");
}

function activeFlowConceptExercises(project: StoredFlowProject): ConstructFlowConceptExercise[] {
  return project.flow.sessions
    .flatMap((session) => session.conceptExercises ?? [])
    .filter((exercise) => exercise.status === "waiting" || exercise.status === "answered");
}

function buildStoppedRunContinuationState(project: StoredFlowProject, currentSessionId: string): string | null {
  const previous = latestContinuationSourceSession(project, currentSessionId);
  if (!previous) return null;
  return [
    "Flow continuation state:",
    "This is a continuation of an existing Flow run, not a fresh project kickoff. Continue from the stopped/interrupted state below before planning new work.",
    "If the previous run stopped during a tool call, reconcile the latest tool state first: resume any created task/exercise/question; if the tool result is missing and no durable state exists, retry only that missing action with the same intent instead of redoing research, path planning, or concept introduction.",
    JSON.stringify({
      previousSession: {
        id: previous.id,
        origin: previous.origin,
        status: previous.status,
        finishReason: previous.finishReason ?? latestFinishReasonFromEvents(previous),
        stepCount: previous.stepCount,
        errorMessage: previous.errorMessage,
        updatedAt: previous.updatedAt
      },
      activeTasks: previous.practiceTasks
        .filter((task) => task.status === "waiting" || task.status === "submitted")
        .map((task) => ({
          id: task.id,
          pathNodeId: task.pathNodeId,
          title: task.title,
          status: task.status,
          introducedConceptIds: task.introducedConceptIds,
          taskFiles: task.taskFiles,
          activeSubtask: task.subtasks?.find((subtask) => subtask.status === "active" || subtask.status === "needs-work" || subtask.status === "submitted")
        })),
      activeExercises: (previous.conceptExercises ?? [])
        .filter((exercise) => exercise.status === "waiting" || exercise.status === "answered")
        .map((exercise) => ({
          id: exercise.id,
          title: exercise.title,
          status: exercise.status,
          conceptIds: exercise.conceptIds,
          masteryGoalLevel: exercise.masteryGoalLevel
        })),
      recentTools: previous.toolCalls.slice(-8).map((tool) => ({
        id: tool.id,
        name: tool.name,
        title: tool.title,
        status: tool.status,
        reason: tool.reason,
        input: pruneModelObject(tool.input),
        outputPreview: tool.outputPreview ? truncateModelText(tool.outputPreview, flowTranscriptMaxFieldChars) : undefined
      })),
      recentTimeline: previous.timeline.slice(-12).map((part) => continuationTimelinePart(part)),
      lastMessages: previous.messages.slice(-2).map((message) => ({
        role: message.role,
        content: truncateModelText(message.content, flowTranscriptMaxFieldChars)
      }))
    }, null, 2)
  ].join("\n");
}

function latestContinuationSourceSession(project: StoredFlowProject, currentSessionId: string): ConstructFlowSession | undefined {
  return [...project.flow.sessions]
    .filter((session) => session.id !== currentSessionId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .find((session) => isContinuationSourceSession(session));
}

function isContinuationSourceSession(session: ConstructFlowSession): boolean {
  return session.status === "waiting"
    || session.status === "error"
    || hasActiveSessionWork(session)
    || isInterruptedFinishReason(session.finishReason ?? latestFinishReasonFromEvents(session))
    || hasInterruptedToolState(session);
}

function hasActiveSessionWork(session: ConstructFlowSession): boolean {
  return session.practiceTasks.some((task) => task.status === "waiting" || task.status === "submitted")
    || (session.conceptExercises ?? []).some((exercise) => exercise.status === "waiting" || exercise.status === "answered")
    || Boolean(findPendingLearnerQuestion(session.toolCalls));
}

function isInterruptedFinishReason(finishReason: string | undefined): boolean {
  if (!finishReason) return false;
  return !["stop", "suspended"].includes(finishReason.toLowerCase());
}

function latestFinishReasonFromEvents(session: ConstructFlowSession): string | undefined {
  return [...session.agentEvents]
    .reverse()
    .map((event) => finishReasonFromEvent(event))
    .find((finishReason): finishReason is string => Boolean(finishReason));
}

function finishReasonFromEvent(event: ConstructAgentRunEvent): string | undefined {
  const parsed = parseToolOutputPreview(event.outputPreview);
  const fromOutput = parsed ? readStringValue(parsed.finishReason) : undefined;
  if (fromOutput) return fromOutput;
  const detailMatch = event.detail?.match(/\bfinish:\s*([a-z0-9_-]+)/i);
  return detailMatch?.[1];
}

function hasInterruptedToolState(session: ConstructFlowSession): boolean {
  return session.toolCalls.some((tool) => tool.status === "running")
    || session.timeline.some((part) => part.kind === "tool" && part.status === "running");
}

function continuationTimelinePart(part: ConstructFlowTimelinePart): Record<string, unknown> {
  if (part.kind === "tool") {
    return {
      kind: part.kind,
      name: part.name,
      title: part.title,
      status: part.status,
      reason: part.reason,
      input: pruneModelObject(part.input),
      outputPreview: part.outputPreview ? truncateModelText(part.outputPreview, flowTranscriptMaxFieldChars) : undefined
    };
  }
  if (part.kind === "compaction") {
    return {
      kind: part.kind,
      title: part.title,
      status: part.status,
      detail: part.detail,
      summary: part.summary ? truncateModelText(part.summary, flowTranscriptMaxFieldChars) : undefined
    };
  }
  return {
    kind: part.kind,
    title: "title" in part ? part.title : undefined,
    status: part.status,
    text: "text" in part && part.text ? truncateModelText(part.text, flowTranscriptMaxFieldChars) : undefined,
    detail: "detail" in part && part.detail ? truncateModelText(part.detail, 400) : undefined
  };
}

function buildContinuationGuard(project: StoredFlowProject): string | null {
  const activeTasks = activeFlowPracticeTasks(project);
  const activeExercises = activeFlowConceptExercises(project);
  if (!activeTasks.length && !activeExercises.length) return null;
  return [
    "Continuation guard:",
    "Existing active tasks/exercises are binding Flow state. Treat the learner's latest message as operating inside this active state unless they explicitly ask to cancel, replace, or replan it. Do not restart research, rewrite Flow Memory, re-plan the path, re-introduce existing concepts, or create duplicate practice tasks while active work is waiting.",
    activeTasks.length ? `Waiting/submitted tasks:\n${JSON.stringify(activeTasks.map((task) => ({
      id: task.id,
      pathNodeId: task.pathNodeId,
      title: task.title,
      status: task.status,
      conceptIds: task.conceptIds,
      introducedConceptIds: task.introducedConceptIds,
      requiredMasteryLevel: task.requiredMasteryLevel,
      taskFiles: task.taskFiles,
      activeSubtask: task.subtasks?.find((subtask) => subtask.status === "active" || subtask.status === "needs-work" || subtask.status === "submitted")
    })), null, 2)}` : null,
    activeExercises.length ? `Waiting/answered concept exercises:\n${JSON.stringify(activeExercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      status: exercise.status,
      conceptIds: exercise.conceptIds,
      masteryGoalLevel: exercise.masteryGoalLevel,
      learnerAnswer: exercise.learnerAnswer
    })), null, 2)}` : null,
    "Resume the listed waiting item and give the learner the next concrete action from that item; do not call plan-learning-path, add-concept, or practice-task unless the active item is first resolved, cancelled, or explicitly replaced by the learner."
  ].filter(Boolean).join("\n");
}

function buildMainPrompt(
  project: StoredFlowProject,
  input: ConstructFlowAgentInput,
  memory: Array<{ file: string; content: string; updatedAt: string | null }>,
  concepts: KnowledgeBaseRecord[],
  toolPolicy: FlowRunToolPolicy,
  currentSessionId: string
): string {
  const recent = project.flow.sessions.slice(-6).map((session) => ({
    id: session.id,
    status: session.status,
    origin: session.origin,
    messages: session.messages.slice(-2),
    citations: session.citations?.slice(-8),
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
    ? JSON.stringify(summarizeTaskSubmissionForPrompt(input.taskSubmission), null, 2)
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
    "Current Flow run mode:",
    JSON.stringify({
      mode: toolPolicy.mode,
      sourceGrounding: toolPolicy.sourceGroundingEnabled ? "enabled" : "disabled",
      workspaceMutation: toolPolicy.allowWorkspaceMutation ? "available-with-mentor-guardrails" : "unavailable",
      terminalCommands: toolPolicy.allowTerminalCommands ? toolPolicy.terminalCommandMode : "unavailable",
      availableTools: availableFlowToolNames(toolPolicy)
    }, null, 2),
    "",
    "Source grounding:",
    toolPolicy.sourceGroundingEnabled
      ? "Enabled. Use internet_search and internet_fetch when teaching or updating concepts would benefit from official docs, primary sources, current APIs, or article context. Cite source-backed claims with markdown links or [[source:source-id|Label]] refs that match tool results or concept sources."
      : "Disabled in settings. Do not call internet_search or internet_fetch and do not claim that fresh web research was performed.",
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
        requiredMasteryLevel: task.requiredMasteryLevel,
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
    "Active concept exercises:",
    JSON.stringify(project.flow.sessions
      .flatMap((session) => session.conceptExercises ?? [])
      .filter((exercise) => exercise.status === "waiting" || exercise.status === "answered")
      .map((exercise) => ({
        id: exercise.id,
        title: exercise.title,
        status: exercise.status,
        conceptIds: exercise.conceptIds,
        masteryGoalLevel: exercise.masteryGoalLevel,
        successCriteria: exercise.successCriteria,
        expectedSignals: exercise.expectedSignals,
        learnerAnswer: exercise.learnerAnswer,
        reviewNote: exercise.reviewNote
      })), null, 2),
    "",
    buildContinuationGuard(project),
    "",
    buildStoppedRunContinuationState(project, currentSessionId),
    "",
    "Flow Memory:",
    "project.md, path.md, learner.md, and research.md are preloaded here. Treat research.md as the new-project research handoff when it has content; continue from its assumptions instead of redoing research or asking redundant project-direction clarification. Use flow-memory-patch for concise durable updates when meaningful work happens.",
    JSON.stringify(memory.map((item) => ({
      file: item.file,
      updatedAt: item.updatedAt,
      content: item.content.slice(0, 3_000)
    })), null, 2),
    "",
    "Project concept tree for placement:",
    JSON.stringify(buildConceptTreeForAgent(concepts, {
      maxConcepts: 200
    }), null, 2),
    "",
    "Concepts taught in this project:",
    JSON.stringify(concepts.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      title: c.title,
      language: c.language,
      technology: c.technology,
      sourceProjectTitle: c.sourceProjectTitle,
      content: c.content,
      examples: c.examples,
      sources: c.sources,
      docs: c.docs,
      confidence: c.confidence,
      confidenceReason: c.confidenceReason,
      masteryLevel: masteryLevelForConcept(c),
      masteryText: c.masteryText ?? conceptMasteryRubricForLevel(masteryLevelForConcept(c)).text,
      masteryReason: c.masteryReason,
      masteryEvidence: c.masteryEvidence,
      masteryUpdatedAt: c.masteryUpdatedAt,
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
      "A tracked question answer is learner-model or concept-exercise context only. It is not task completion evidence, does not mean a demo compiled or ran, and must not upgrade Mastery unless the answer itself demonstrates the rubric level."
    ].join("\n") : null,
    input.taskSubmission ? [
      "",
      "Task-submission review mode:",
      "The learner submitted work. Review it; do not repair it for them.",
      "Workspace write/edit/practice-task/plan-learning-path tools are intentionally unavailable in this run.",
      "Use task success criteria, submission metadata, read/grep, workspace inspection, and validation-only terminal output as review evidence. A clean terminal-created project or command-only milestone can be completed even when the submitted diff is empty.",
      "If validation fails, explain the failure as the next learner-facing correction and use review-subtask with needs-work when appropriate.",
      "Do not delete, move, rewrite, or replace learner files while reviewing a submission."
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

function finalizeAssistantReplyTrace(
  session: ConstructFlowSession,
  reply: string,
  status: "completed" | "error"
): void {
  const updatedAt = new Date().toISOString();
  const normalizedReply = reply.trim();
  const messageEvents = session.agentEvents.filter((event) => event.type === "message");
  const eventText = messageEvents.map((event) => event.text ?? "").join("").trim();
  if (messageEvents.length === 0 || eventText !== normalizedReply) {
    session.agentEvents = [
      ...session.agentEvents.filter((event) => event.type !== "message"),
      {
        id: `${session.id}:reply`,
        type: "message",
        status,
        title: "Assistant response",
        text: reply,
        createdAt: updatedAt
      }
    ];
  } else {
    session.agentEvents = session.agentEvents.map((event) => (
      event.type === "message"
        ? { ...event, status: event.status === "error" ? "error" : status }
        : event
    ));
  }

  const messagePartIndex = session.timeline.findIndex((part) => part.kind === "message");
  const messageParts = session.timeline.filter((part): part is Extract<ConstructFlowTimelinePart, { kind: "message" }> => part.kind === "message");
  const timelineText = messageParts.map((part) => part.text).join("").trim();
  if (messageParts.length === 0 || timelineText !== normalizedReply) {
    const replyPart: ConstructFlowTimelinePart = {
      id: `${session.id}:reply`,
      kind: "message",
      status,
      text: reply,
      createdAt: messageParts[0]?.createdAt ?? updatedAt,
      updatedAt
    };
    if (messagePartIndex < 0) {
      session.timeline.push(replyPart);
    } else {
      const before = session.timeline.slice(0, messagePartIndex).filter((part) => part.kind !== "message");
      const after = session.timeline.slice(messagePartIndex).filter((part) => part.kind !== "message");
      session.timeline = [...before, replyPart, ...after];
    }
    return;
  }

  session.timeline = session.timeline.map((part) => (
    part.kind === "message"
      ? { ...part, status: part.status === "error" ? "error" : status, updatedAt }
      : part
  ));
}

function settleRunningSessionTrace(session: ConstructFlowSession, status: ConstructFlowSession["status"]): void {
  if (status === "running" || status === "queued") return;
  const settledStatus = status === "error" ? "error" : "completed";
  const settledAt = new Date().toISOString();
  session.agentEvents = session.agentEvents.map((event) => (
    event.status === "running"
      ? { ...event, status: settledStatus }
      : event
  ));
  session.timeline = session.timeline.map((part) => settleTimelinePart(part, settledStatus, settledAt));
  session.toolCalls = session.toolCalls.map((toolCall) => (
    toolCall.status === "running"
      ? { ...toolCall, status: settledStatus, completedAt: toolCall.completedAt ?? settledAt }
      : toolCall
  ));
}

function settleTimelinePart(
  part: ConstructFlowTimelinePart,
  status: "completed" | "error",
  settledAt: string
): ConstructFlowTimelinePart {
  if (part.status !== "running") return part;
  if (part.kind === "tool" || part.kind === "compaction") {
    return {
      ...part,
      status,
      completedAt: part.completedAt ?? settledAt,
      updatedAt: part.updatedAt ?? settledAt
    };
  }
  return {
    ...part,
    status,
    updatedAt: part.updatedAt ?? settledAt
  };
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

function appendCitationSourcesFromToolRecord(session: ConstructFlowSession, record: ConstructProtocolToolRecord): void {
  const sources = citationSourcesFromToolRecord(record);
  if (!sources.length) return;
  session.citations = mergeCitationSources(session.citations ?? [], sources);
}

function citationSourcesFromToolRecord(record: ConstructProtocolToolRecord): ConstructCitationSource[] {
  if (record.status === "running" || !record.outputPreview || !isInternetToolName(record.name)) {
    return [];
  }

  const parsed = parseToolOutput(record.outputPreview);
  const rawResults = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.results)
      ? parsed.results
      : [];

  const accessedAt = record.completedAt ?? new Date().toISOString();
  return rawResults
    .filter(isRecord)
    .map((result) => citationSourceFromResult(result, accessedAt))
    .filter((source): source is ConstructCitationSource => Boolean(source));
}

function citationSourceFromResult(result: Record<string, unknown>, accessedAt: string): ConstructCitationSource | null {
  const url = typeof result.url === "string" ? result.url : "";
  const title = typeof result.title === "string" ? result.title : url || "Untitled source";
  if (!url && !title) return null;
  const content = typeof result.content === "string"
    ? result.content
    : typeof result.snippet === "string"
      ? result.snippet
      : "";
  const id = typeof result.sourceId === "string" && result.sourceId.trim()
    ? result.sourceId.trim()
    : citationSourceId(url || title);
  return {
    id,
    title,
    url,
    provider: typeof result.provider === "string" ? result.provider : undefined,
    publisher: publisherFromUrl(url),
    snippet: content ? compactCitationText(content, 420) : undefined,
    quote: content ? compactCitationText(content, 220) : undefined,
    accessedAt
  };
}

function mergeCitationSources(current: ConstructCitationSource[], incoming: ConstructCitationSource[]): ConstructCitationSource[] {
  const merged = new Map<string, ConstructCitationSource>();
  for (const source of current) {
    merged.set(citationSourceKey(source), source);
  }
  for (const source of incoming) {
    const key = citationSourceKey(source);
    const existing = merged.get(key);
    merged.set(key, {
      ...existing,
      ...source,
      snippet: source.snippet ?? existing?.snippet,
      quote: source.quote ?? existing?.quote,
      accessedAt: source.accessedAt ?? existing?.accessedAt
    });
  }
  return [...merged.values()].slice(-40);
}

function normalizeCitationSources(sources: CitationSourceInput[]): ConstructCitationSource[] {
  return mergeCitationSources([], sources.map((source) => ({
    id: source.id?.trim() || citationSourceId(source.url || source.title),
    title: source.title,
    url: source.url,
    provider: source.provider,
    publisher: source.publisher ?? publisherFromUrl(source.url),
    snippet: source.snippet,
    quote: source.quote,
    accessedAt: source.accessedAt ?? new Date().toISOString()
  })));
}

function sourcesToDocs(sources: CitationSourceInput[]): KnowledgeBaseRecord["docs"] {
  return normalizeCitationSources(sources).map((source) => ({
    title: source.title,
    url: source.url,
    why: source.quote ?? source.snippet
  }));
}

function mergeDocs(current: KnowledgeBaseRecord["docs"], incoming: KnowledgeBaseRecord["docs"]): KnowledgeBaseRecord["docs"] {
  const urls = new Set<string>();
  const merged: KnowledgeBaseRecord["docs"] = [];
  for (const doc of [...(current ?? []), ...incoming]) {
    if (!doc.url || urls.has(doc.url)) continue;
    urls.add(doc.url);
    merged.push(doc);
  }
  return merged.slice(-20);
}

function citationSourceKey(source: ConstructCitationSource): string {
  return source.url || source.id;
}

function citationSourceId(seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "source";
}

function publisherFromUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function compactCitationText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1).trimEnd()}…` : compact;
}

function parseToolOutput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const mentorProtocolToolNames = [
  "read",
  "grep",
  "runTerminalCommand",
  "write",
  "edit",
  "ask_user_question",
  "internet_search",
  "internet_fetch",
  "flowMemoryPatch"
];

const taskReviewProtocolToolNames = [
  "read",
  "grep",
  "runTerminalCommand",
  "ask_user_question",
  "flowMemoryPatch"
];

const researchProtocolToolNames = [
  "read",
  "grep",
  "glob",
  "internet_search",
  "internet_fetch",
  "flowMemoryFetch",
  "flowMemoryPatch"
];

const mentorFlowToolNames = [
  "plan-learning-path",
  "practice-task",
  "concept-exercise",
  "review-concept-exercise",
  "suggest-existing-concept",
  "fetch-concepts",
  "add-concept",
  "modify-concept",
  "remove-concept",
  "review-subtask",
  "complete-task"
];

const taskReviewFlowToolNames = [
  "suggest-existing-concept",
  "fetch-concepts",
  "modify-concept",
  "review-subtask",
  "complete-task"
];

function flowToolPolicyForInput(input: ConstructFlowAgentInput, options: { sourceGroundingEnabled: boolean }): FlowRunToolPolicy {
  if (input.taskSubmission) {
    return {
      mode: "task-review",
      sourceGroundingEnabled: false,
      allowWorkspaceMutation: false,
      allowTerminalCommands: true,
      terminalCommandMode: "validation-only",
      protocolToolNames: taskReviewProtocolToolNames,
      flowToolNames: taskReviewFlowToolNames,
      maxSteps: 10
    };
  }
  return {
    mode: "mentor",
    sourceGroundingEnabled: options.sourceGroundingEnabled,
    allowWorkspaceMutation: true,
    allowTerminalCommands: true,
    terminalCommandMode: "validation-only",
    protocolToolNames: options.sourceGroundingEnabled
      ? mentorProtocolToolNames
      : mentorProtocolToolNames.filter((name) => !isInternetToolName(name)),
    flowToolNames: mentorFlowToolNames,
    maxSteps: 16
  };
}

function isInternetToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  return normalized === "internetsearch" || normalized === "internetfetch";
}

function availableFlowToolNames(policy: FlowRunToolPolicy): string[] {
  return [...new Set([...policy.protocolToolNames, ...policy.flowToolNames])];
}

export function explicitFlowToolChoice(message: string, tools: ToolsInput): ConstructAgentToolChoice | undefined {
  const normalized = message
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[\s-]+/g, "_");
  const explicitlyDeclinesTool = /\b(?:do_not|dont|never)_(?:use|call|invoke|trigger)_/.test(normalized);
  const explicitlyRequestsTool = /\b(?:use|call|invoke|trigger)_(?:the_)?ask_(?:user_)?question(?:_tool)?(?=_|$)/.test(normalized);
  if (!explicitlyDeclinesTool && explicitlyRequestsTool && tools.ask_user_question) {
    return { type: "tool", toolName: "ask_user_question" };
  }
  return undefined;
}

function consumeConceptFirewallToolReview(
  reviews: Map<string, ConceptFirewallReviewRecord>,
  reviewId: string,
  kind: ConceptFirewallReviewKind
): void {
  const review = reviews.get(reviewId);
  if (!review) {
    throw new Error("The internal concept firewall token is not available in this Flow run. It may already have been consumed.");
  }
  if (review.kind !== kind) {
    throw new Error(`The internal concept firewall token belongs to ${review.kind}, not ${kind}.`);
  }
  reviews.delete(reviewId);
}

function findLatestConceptFirewallReviewId(
  reviews: Map<string, ConceptFirewallReviewRecord> | undefined,
  kind: ConceptFirewallReviewKind
): string | undefined {
  if (!reviews) return undefined;
  return [...reviews.entries()]
    .filter(([, review]) => review.kind === kind)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .at(0)?.[0];
}

function collectPendingConceptFirewallReviews(project: StoredFlowProject): Map<string, ConceptFirewallReviewRecord> {
  const reviews = new Map<string, ConceptFirewallReviewRecord>();
  for (const session of project.flow.sessions) {
    for (const review of session.pendingConceptFirewallReviews ?? []) {
      reviews.set(review.id, {
        kind: review.kind,
        createdAt: review.createdAt
      });
    }
  }
  return reviews;
}

function persistPendingConceptFirewallReview(
  session: ConstructFlowSession,
  id: string,
  review: ConceptFirewallReviewRecord | undefined
): void {
  if (!review) return;
  const pending = session.pendingConceptFirewallReviews?.filter((entry) => entry.id !== id) ?? [];
  pending.push({
    id,
    kind: review.kind,
    createdAt: review.createdAt
  });
  session.pendingConceptFirewallReviews = pending;
}

function clearPendingConceptFirewallReview(project: StoredFlowProject, id: string): void {
  for (const session of project.flow.sessions) {
    if (!session.pendingConceptFirewallReviews?.length) continue;
    const pending = session.pendingConceptFirewallReviews.filter((entry) => entry.id !== id);
    if (pending.length > 0) {
      session.pendingConceptFirewallReviews = pending;
    } else {
      delete session.pendingConceptFirewallReviews;
    }
  }
}

function buildConceptFirewallMutationBlockedMessage(decision: {
  auditId: string;
  reason: string;
  blockedCapabilities: string[];
}): string {
  return [
    "Project concept firewall blocked this workspace mutation.",
    decision.reason,
    decision.blockedCapabilities.length
      ? `Uncovered capabilities: ${decision.blockedCapabilities.join("; ")}`
      : null,
    "Flow queued a one-shot internal firewall token for the next matching write/edit tool call in this run. Teach and record the missing capability or adjust the tool input, then call the tool again; the token is applied automatically and cannot be reused."
  ].filter(Boolean).join(" ");
}

function buildConceptFirewallTaskBlockedMessage(decision: {
  auditId: string;
  reason: string;
  blockedCapabilities: string[];
}): string {
  return [
    "Project concept firewall blocked this practice task.",
    decision.reason,
    decision.blockedCapabilities.length
      ? `Uncovered capabilities: ${decision.blockedCapabilities.join("; ")}`
      : null,
    "Flow queued a one-shot internal firewall token for the next practice-task call in this run. Teach and record the missing capability or adjust the task input, then call practice-task again; the token is applied automatically and cannot be reused."
  ].filter(Boolean).join(" ");
}

function buildConceptFirewallExerciseBlockedMessage(decision: {
  auditId: string;
  reason: string;
  blockedCapabilities: string[];
}): string {
  return [
    "Project concept firewall blocked this concept exercise.",
    decision.reason,
    decision.blockedCapabilities.length
      ? `Uncovered capabilities: ${decision.blockedCapabilities.join("; ")}`
      : null,
    "Flow queued a one-shot internal firewall token for the next concept-exercise call in this run or the next Flow turn. Teach and record the missing capability or adjust the exercise input, then call concept-exercise again; the token is applied automatically and cannot be reused."
  ].filter(Boolean).join(" ");
}

function pickFlowMainProtocolTools(protocolTools: ToolsInput, policy: FlowRunToolPolicy): ToolsInput {
  return pickProtocolTools(protocolTools, policy.protocolToolNames);
}

function pickProtocolTools(protocolTools: ToolsInput, names: string[]): ToolsInput {
  return Object.fromEntries(
    names
      .map((name) => [name, protocolTools[name]] as const)
      .filter((entry): entry is [string, ToolsInput[string]] => entry[1] !== undefined)
  );
}

function pickFlowMainFlowTools(flowTools: ToolsInput, policy: FlowRunToolPolicy): ToolsInput {
  return Object.fromEntries(
    policy.flowToolNames
      .map((name) => [name, flowTools[name]] as const)
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
  "askuser",
  "askuserquestion",
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

function buildFlowEmptyReplyFallback(session: ConstructFlowSession, policy: FlowRunToolPolicy): string {
  const failedTool = [...session.toolCalls].reverse().find((toolCall) => toolCall.status === "error");
  if (!failedTool) {
    return "I could not produce a response from the model, but the activity above shows the work completed.";
  }

  const summary = summarizeFailedFlowTool(failedTool);
  if (normalizeToolName(failedTool.name) === "runterminalcommand") {
    return [
      policy.mode === "task-review"
        ? "The validation command did not succeed, so I cannot mark the submitted work done from this evidence."
        : "The command did not succeed, so I am stopping here instead of editing around it.",
      summary ? "" : null,
      summary || null,
      "",
      policy.mode === "task-review"
        ? "Use that output as the next correction, update the learner-authored code, then resubmit the task."
        : "Use the output above as the next debugging clue before continuing."
    ].filter((line): line is string => line !== null).join("\n");
  }

  return [
    "A Flow tool failed, so I am stopping at the failure boundary instead of continuing with assumptions.",
    summary ? "" : null,
    summary || null
  ].filter((line): line is string => line !== null).join("\n");
}

function summarizeFailedFlowTool(toolCall: ConstructFlowToolCallRecord): string {
  const parsed = parseToolOutputPreview(toolCall.outputPreview);
  const status = parsed ? readStringValue(parsed.status) : undefined;
  const reason = parsed ? readStringValue(parsed.reason) : undefined;
  const command = parsed ? readStringValue(parsed.command) : undefined;
  const stderr = parsed ? readStringValue(parsed.stderr) : undefined;
  const stdout = parsed ? readStringValue(parsed.stdout) : undefined;
  const fallback = toolCall.outputPreview?.trim();
  return [
    command ? `Command: ${command}` : `${toolCall.title}`,
    status ? `Status: ${status}` : null,
    reason ? `Reason: ${reason}` : null,
    stderr ? `stderr: ${truncateModelText(stderr, 700)}` : null,
    stdout && !stderr ? `stdout: ${truncateModelText(stdout, 700)}` : null,
    !reason && !stderr && !stdout && fallback ? truncateModelText(fallback, 700) : null
  ].filter(Boolean).join("\n");
}

function parseToolOutputPreview(outputPreview: string | undefined): Record<string, unknown> | null {
  if (!outputPreview) return null;
  try {
    const parsed = JSON.parse(outputPreview);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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

function readQuestionPayload(toolCall: ConstructFlowToolCallRecord): { choices?: string[]; answerMode?: string; language?: string; initialAnswer?: string; hideLearningMaterials?: boolean; allowSkip?: boolean } {
  const source = typeof toolCall.input === "object" && toolCall.input !== null
    ? toolCall.input as { choices?: unknown; answerMode?: unknown; language?: unknown; initialAnswer?: unknown; hideLearningMaterials?: unknown; allowSkip?: unknown }
    : {};
  return {
    choices: Array.isArray(source.choices)
      ? source.choices.filter((choice): choice is string => typeof choice === "string")
      : undefined,
    answerMode: typeof source.answerMode === "string" ? source.answerMode : undefined,
    language: typeof source.language === "string" ? source.language : undefined,
    initialAnswer: typeof source.initialAnswer === "string" ? source.initialAnswer : undefined,
    hideLearningMaterials: typeof source.hideLearningMaterials === "boolean" ? source.hideLearningMaterials : undefined,
    allowSkip: typeof source.allowSkip === "boolean" ? source.allowSkip : undefined
  };
}

function formatTaskSubmissionUserMessage(message: string, submission: ConstructFlowTaskSubmission): string {
  return [
    message.trim() || "Please review my task submission.",
    submission.subtaskId ? `Subtask: ${submission.subtaskId}` : null,
    submission.note?.trim() ? `Learner note: ${submission.note.trim()}` : null
  ].filter(Boolean).join("\n\n");
}

function summarizeTaskSubmissionForPrompt(submission: ConstructFlowTaskSubmission): Record<string, unknown> {
  return {
    taskId: submission.taskId,
    subtaskId: submission.subtaskId,
    note: submission.note,
    touchedFiles: submission.touchedFiles,
    submittedAt: submission.submittedAt,
    authoredBy: submission.authoredBy,
    diff: submission.touchedFiles.length > 0 ? submission.compactDiff : undefined
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
    citations: session.citations?.map((source) => ({ ...source })),
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
    })),
    conceptExercises: session.conceptExercises?.map((exercise) => ({
      ...exercise,
      conceptIds: [...exercise.conceptIds],
      successCriteria: exercise.successCriteria ? [...exercise.successCriteria] : undefined,
      expectedSignals: exercise.expectedSignals ? [...exercise.expectedSignals] : undefined,
      masteryEvidence: exercise.masteryEvidence?.map((item) => ({ ...item }))
    }))
  };
}

export const FLOW_MAIN_AGENT_PROMPT = `You are Construct Flow, an understanding-based coding mentor working inside a real project workspace.

You are not a code vending machine. Your job is to help the learner become capable of writing and understanding the project themselves.
You are not a coding agent. You are a teaching system that uses real tasks to let the learner practice only after the needed ideas are introduced.
CRITICAL PEDAGOGY RULE: You must NEVER use write/edit to write the actual implementation or solve the tasks for the learner. Even if the concept has been introduced and recorded, the learner must be the one who writes the code. You are strictly forbidden from writing or implementing the solution code yourself.

The available Flow tools are run-mode dependent. The prompt includes a Current Flow run mode section with the exact tool list for this turn. Keep the tool surface calm. Do not ask for or invent extra tools.
File mutation follows the Claude Code shape: write creates or overwrites a file; edit replaces one exact string in an existing file. Every write/edit call must include conceptIds from this project's taught concept ledger. The runtime independently audits the proposed content against those exact concept bodies and blocks uncovered syntax, APIs, patterns, tooling, or hidden prerequisites. A global concept or a concept taught in another project does not count. Use write/edit only to help the learner move through a project-taught concept, repair tiny scaffold/setup blockers, update simple docs, or make clearly requested support edits. Do not use write/edit to implement code whose concept has not been introduced in this project yet. Even after a concept is introduced, do not implement it; instead, create a practice task for the learner.
If write/edit is blocked by the concept firewall, Flow queues a one-shot internal token for the next matching write/edit tool call in this run. You do not see or pass the token. Teach and record the missing capability or adjust the tool input, then call the tool again; the token is applied automatically and cannot be reused.
If practice-task is blocked by the concept firewall, Flow queues a one-shot internal token for the next practice-task call in this run. You do not see or pass the token. Teach and record the missing capability or adjust the task input, then call practice-task again. The task wording can change naturally after teaching; the runtime treats the reviewed tool boundary as the permission boundary.
If concept-exercise is blocked by the concept firewall, Flow queues a one-shot internal token for the next concept-exercise call in this run or the next Flow turn. You do not see or pass the token. Teach and record the missing capability or adjust the exercise input, then call concept-exercise again; the token is applied automatically and cannot be reused.
Before using write/edit for a learning-acceleration support edit, ask the learner first with ask_user_question and wait for the answer. This includes edits because the learner is stuck, because a scaffold bug is blocking progress, or because the edit would make learning faster. The question must name the file, describe the exact change, explain why it would speed progress, and say what learning remains for the learner. Example shape: "Should I edit [[file:src/core/index.ts|src/core/index.ts]] to remove the broken export so you can focus on module barrels instead of setup friction? You will still implement the public API yourself." If the learner says no or skips, do not edit; teach or create a learner task instead. If the learner explicitly asks in the current message for a concrete file edit, that counts as consent for that requested edit only.

Project kickoff and path:
- When a new Flow project starts, first learn the learner and the project. Ask a good amount of tracked questions when needed. You may ask about prior experience, comfort level, goals, constraints, taste, and what they already understand, but choose questions naturally from the situation.
- Read only the project Concepts in the prompt when deciding what may be used. Global knowledge can help choose what to teach next, but it never authorizes a task, assessment, explanation, or write in this project.
- Use ask_user_question for learner modeling when it would improve the path: background, preferences, constraints, confidence, what they want to do manually, and what they want handled by normal tooling.
- After learner profiling or any meaningful learner answer, update learner.md with flow-memory-patch before creating or revising tasks.
- After updating learner.md for kickoff, call plan-learning-path. The path must be based on the learner's abilities, the project goal, concepts already taught in this project, and useful research. Future nodes must not name or depend on untaught implementation concepts; introduce them first, then revise the path.
- The path is allowed to change. Revise it with plan-learning-path when learner evidence changes.
- Each practice-task belongs to the current path node unless there is a clear reason to place it elsewhere.

Guided discovery:
- Make building feel like discovery, not answer delivery. Start from first principles: what inputs exist, what output or behavior is wanted, what invariants must hold, what smaller step can be tested, and what the learner already knows.
- When the learner is solving, debugging, or designing, help them generate the next move before revealing yours. Ask for their mental model, an English plan, a small example, a sketch of control flow, or pseudocode when that would naturally help. Do not force a fixed format; choose the lightest prompt that helps them think.
- Prefer a ladder of hints: observation, constraint, smaller example, missing concept, then partial structure. Give the full solution only after the learner has attempted, asked directly for it, or the task would otherwise stall after meaningful guided attempts.
- Do not end a teaching turn by dumping the completed algorithm, architecture, or code when the learner has not had a chance to form it. End with one focused next thinking move when discovery is still active.
- Celebrate curiosity through the work itself: make the next question feel like opening a door, not taking a quiz. Avoid schooly recap checks. Ask questions that help the learner notice the shape of the solution.
- Never design tasks, exercises, or questions that can be solved by directly copying code, wording, or actual logic from the agent's recent chat responses or recorded concept definitions. Instead, require the learner to actively apply the learned concepts in a new context, rather than echoing back the given answers. However, adapt this progression based on the learner: start with easier, more scaffolded checks initially, and transition to application-focused challenges only when the user shows promise and understanding.
- When asking questions, Socratic checks, or creating exercises about knowledge the learner gained from a concept or the chat history, anchor and nudge the learner by referencing that context (e.g., "Recall from the concept card we just discussed..." or "Building on our chat about X..."). Do not ask dry, completely out-of-context questions about arbitrary files or setups unless they are anchored in the current project or what was just explained. However, keep this progression natural and dynamic—do not force a rigid or mechanical reference to concepts every time.
- If the learner proposes an approach, treat it as the primary material. Improve it, test it against edge cases, and only then fill in missing details.

Mentor handoffs, not executor checklists:
- Do not turn ordinary chat into a coding-agent handoff where the learner is only told to run a command, create a directory tree, paste full files, add env vars, then run a build. That is executor work, not learning. If the next move is real project work, use practice-task, small consented support edits, or a focused ask_user_question instead of a long prose checklist.
- When setup or boilerplate is needed, first separate mechanical support from learner-owned understanding. Mechanical support can be prepared through concept-audited tools after consent; learner-owned pieces belong in a practice-task with a concrete gap, success criteria, and guidance highlights.
- Before giving a step, ask what prior pattern, Concept, task, or file shape this resembles. Prompt the learner to retrieve the structure they already saw ("Which two files did we need last time: the specific agent module or the registry/wiring module?") and build from that answer.
- For framework or package work, guide the learner to identify roles and boundaries before paths and commands: what object is being defined, where it gets registered, what secret/config it needs, and what small validation proves the wiring.
- Command snippets in chat should be rare, tiny, and observational or validation-focused. Do not provide multi-command setup scripts, full file contents, or copy-paste implementation blocks unless the learner explicitly asks after an attempt or the content is a consented support scaffold.
- If Flow has already verified something with tools, state the observation briefly and ask the next reasoning move. Do not follow verification with a literal "now run this, then create this file" sequence unless it is inside a structured practice-task.

Conversational teaching pace:
- Treat Concepts as the durable reference shelf, not the chat script. Concept bodies can be detailed for future auditing and recall; normal chat should surface only the next small slice the learner needs right now.
- A teaching turn should advance one idea or one relationship, then hand the learner a small thinking move. If the concept contains several subideas, record the whole concept but teach the first useful slice now and continue later from learner evidence.
- Do not make the learner read a multi-section reference page before answering. Avoid broad overview dumps, glossary cascades, long enumerations, diagrams plus caveats plus future applications, or all phases of a system in one ordinary chat turn.
- Prefer short, conversational paragraphs. Use lightweight structure only when it genuinely reduces cognitive load. The learner should feel guided through a project, not assigned reading from documentation.
- Socratic checks should target the last small slice taught. Ask for a prediction, comparison, tiny example, or mental model that can be answered from that slice, not from a whole reference article.
- If the learner asks for a reference overview, provide it in a collapsible/linked concept card style and still make the next action small.

Source-grounded teaching and citations:
- When the Current Flow run mode says source grounding is enabled, use internet_search and internet_fetch before teaching or recording factual concepts about languages, frameworks, APIs, libraries, standards, tools, or current project-domain facts unless the exact source is already in the current prompt.
- Prefer official documentation, standards, primary project docs, and highly relevant articles. Avoid uncited claims for docs/API behavior when the web tools are available.
- In chat replies, put citation refs at the end of the sentence or paragraph they support. Use normal markdown links or [[source:source-id|Label]] refs that match web tool results. Do not invent source IDs, titles, quotes, or URLs.
- In add-concept and modify-concept, include a sources array for docs/articles actually used. The concept content should contain source-backed paragraphs with sentence-level citations and short quote/highlight snippets when useful. Keep direct quotes short; use paraphrase for most explanation.
- If source grounding is disabled, do not call internet_search or internet_fetch and do not imply fresh web research. You may still link previously saved concept sources if they are already present.

Concept-first tutoring:
- Concept definitions may be reusable, but permission to use them is project-local. Every project has its own introduced, referenced, practiced, assessed, and leveled-up ledger.
- Before explaining a topic, check the Concepts taught in this project. A matching global concept from another project is only a candidate to introduce here, never permission to use it.
- Use fetch-concepts when you need exact concept content, examples, evidence, confidence, or related concepts. Use exact conceptIds when you know them and query search when you do not. Do not guess concept details from memory.
- Before add-concept, inspect the current project concept tree. If the full tree and candidate parents are not already visible in the prompt or current tool output, call fetch-concepts with includeTree true and a query for the proposed concept. Treat concept placement as architecture: choose the narrowest existing parent that already owns the mental model, then make the new concept a child of that parent.
- Before modifying or removing a concept, fetch it first unless the full current record is already visible in the prompt or current tool output.
- If a reusable concept exists but is not in this project, introduce it here with add-concept before teaching from or using it. Then link it in chat with the inline markdown tag [[concept:concept.id|Concept title]].
- Introducing a concept is only the start of the teaching journey. After add-concept/suggest-existing-concept, teach a small slice of the concept with a mental model, a tiny example, or a contrast chosen for the learner's current level. Do not dump the entire concept body into chat and do not jump straight from "introduced" to a project task.
- Use ask_user_question for Socratic checks when the learner's answer is needed as Mastery evidence. Ask focused questions that reveal their model, not schooly recap prompts. When requesting code snippets, implementations, code syntax guesses, or answers containing code, set the answerMode parameter to "code" (and optionally specify the language hint). For general explanations or conceptual answers, use the default "text" mode. After ask_user_question, stop and wait.
- Normal chat is for ideas, mental models, questions, and review. Do not put implementation code blocks or broad code snippets in normal chat unless the learner has already attempted the shape or explicitly asks for the code.
- Only create a practice-task after every relevant concept is recorded at Mastery Level 3 or higher. If any required concept is Level 0, 1, or 2, the correct next move is more explanation, ask_user_question, or concept-exercise, not a task.
- Every practice-task must include introducedConceptIds and requiredMasteryLevel. Those are project-local prerequisites. The runtime audits every word of the task, criteria, guidance, subtasks, and preparations against the bodies of those concepts.
- Every practice-task must include learnerReadiness evidence for every introducedConceptId. This evidence must come from the learner's own chat answer, plan, explanation, or submitted diff. Agent-written demos, prepared files, terminal output, and "the demo ran" are not learner readiness.
- concept-exercise is for practicing a concept before roadmap/project tasks. Exercises must be answerable from the concept text/sourceText directly and should usually target Mastery 1-3. After creating an exercise, use ask_user_question for the learner's answer and stop. When they answer, use review-concept-exercise and update only the concepts proven by that answer.
- If no concept is introduced in this project yet, teach first. Record the concept in this project at Mastery Level 0 unless there is learner-owned evidence for more, get observable learner understanding with questions/exercises, then create the task only after Level 3 readiness.
- If the learner switches languages or says they do not know the current language, stop using stale tasks/path nodes from the old language. Patch learner.md, revise the path, teach the new language prerequisites, and only then create tasks in the new language.

When you teach or the learner demonstrates understanding, update Concepts with evidence:
- After explaining something new, use add-concept or modify-concept to record it at Mastery Level 0 unless the learner's own answer already proves a higher level. Explanation by itself does not raise Mastery.
- Learner answers to Socratic questions and reviewed concept-exercises can raise, keep, or lower Mastery. Use review-concept-exercise or modify-concept only from the learner's answer evidence.
- After a practice subtask is reviewed, update concept Mastery only when learner-authored work or explanation proves it. A formal submit click is useful but not required for subtask review when concrete workspace evidence or task-scoped learner messages prove the outcome. You may use review-subtask.masteryUpdates for concepts attached to that task, or modify-concept when a separate concept update is clearer.
- Always set concept language using the enum swift, python, typescript, javascript, cpp, or unknown. Set technology when there is a clear framework, platform, or API such as SwiftUI, OpenGL, GLFW, React, or Node.
- Use the Mastery scale precisely:
  Level 0 = the learner has only been introduced to the name or has no reliable understanding yet;
  Level 1 = the learner can identify some parts or vocabulary, but is still extremely new;
  Level 2 = the learner can explain the basic idea with support and answer small guided checks;
  Level 3 = the learner can reason about the concept in their own words and is ready for scoped tasks that test it;
  Level 4 = the learner can use the concept in their own work with only light review;
  Level 5 = the learner can transfer, debug, or teach the concept across nearby problems.
- Every masteryLevel above 0 requires masteryReason. Do not upgrade or downgrade without exact learner-owned evidence, and put the why in reason plus masteryReason. It is valid to decrease Mastery when a learner answer or task diff reveals confusion. Be conservative when grading learner answers and upgrading Mastery levels: only upgrade Mastery when the learner has clearly demonstrated sufficient understanding, and do not upgrade prematurely on incomplete code, guesses, or when you have to complete the solution for them. Proactively downgrade Mastery levels if the learner exhibits confusion, incorrect assumptions, or struggles to apply a concept.
- Keep confidence only as compatibility metadata. Mastery is the source of truth for task readiness.
- Use dot-notated hierarchical IDs for reusable concepts (e.g. 'typescript.types.interfaces', 'react.hooks.state', 'swiftui.core-structure'). Max 3 levels deep (domain.area.topic).
- Do not include product/project/app names in concept IDs. For a notes app, use 'swiftui.core-structure', not 'swiftui.notesapp.core-structure'.
- Do not create smaller and smaller concepts. Group related sub-concepts inside parent concepts logically.
- For add-concept, set parentId explicitly when the concept has a parent. The parentId must match the dot-notated ID prefix. Prefer an existing project-local parent; do not create a new parent branch just because a new phrase appeared. If a new parent branch is truly needed, placementRationale must explain why existing parents from the fetched tree do not fit.
- Concept titles must make sense when read as a tree path. Name the capability, not the app or lesson moment: use "Interfaces" or "State updates", not "Notes app interface thing" or "Today’s new concept". If the title would duplicate an existing concept title, modify that existing concept instead of creating another.
- Keep concept content detailed, natural, and free-form markdown so it can be easily read and modified. Write detailed text explanations inside the concept record, but do not mirror that full reference text into the learner-facing chat.
- When a learner struggles, modify the concept to note the specific confusion point.
- Concepts are persistent memory of what the learner knows, where they are confused, and what the agent wrote. Preserve authoredBy, history, and evidence so future agents do not mistake agent-created content for learner mastery.

Stay natural. Do not reveal internal modes. Do not force responses into rigid templates. Respond like a strong human mentor reviewing and building with the learner.

Use Flow Memory as durable context. The current project, path, and learner memory are already in the prompt. Use flow-memory-patch for memory updates; do not rewrite full memory files from the agent unless recovering a broken file. Keep memory concise.
Learner.md is the durable learner model for this project. Patch it whenever the learner reveals preferences, constraints, experience level, desired autonomy, frustration, confidence, or a repeated misunderstanding. Examples: "prefers CLI commands for boilerplate instead of manual package metadata", "wants concept-first explanations before task code", "comfortable with npm but new to TypeScript library packaging". Do not let these stay only in chat.

Prefer learner attempts. Tasks are the main unit of Flow progress. When the next step is a learner coding attempt, use the practice-task tool once to create a real structured task with the current path node, task files, prepared files when needed, success criteria, subtasks when useful, guidance highlights, and introducedConceptIds. Prepared/scaffolded code is agent-authored; submitted diffs are learner-authored. Do not infer learner understanding from code you wrote.
If a missing README, placeholder module, or tiny scaffold file must exist before the learner can attempt the task, ask first unless the learner explicitly requested that exact support edit. After consent, use write/edit or practice-task.preparations for the exact small support change. If the learner should write it, put the work in the task prompt, subtasks, successCriteria, and guidance instead.
After creating a practice-task, stop cleanly and let the learner work. Do not keep reading files, create another task for the same milestone, try to verify the same prepared files again, or call ask_user_question to quiz the learner about scaffold files, concepts, or code you just prepared. Put distinctions like public entrypoint vs internal barrel in the task prompt, guidance, or normal mentor message instead of pausing progress with a tracked question.
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

Do not build whole apps for the learner by hand. Flow terminal commands are validation-only because generators can write unaudited code containing untaught concepts. Prepare only small concept-audited files through write/edit or practice-task preparations. Never hand-write a whole package.json, Xcode project, or broad app tree as a substitute for a learner-owned, concept-scoped task.

When the latest input is a learner message inside an active task, treat it as task-scoped chat. Answer in the context of the active task and do not create a new task unless the path genuinely changes. If the active subtask can be judged from concrete task evidence, workspace reads/grep, validation output, or the learner's task-scoped message, call review-subtask with outcome "done" or "needs-work" even when the learner has not pressed Submit. When the latest input includes a task submission, act as a task-review mentor: inspect workspace reality, submission metadata, task success criteria, and authoredBy metadata; use compact diffs only when files actually changed. A terminal-created project, command-only milestone, or explanation-only subtask can still be completed from concrete workspace/tool/learner evidence. Use task.submission.authoredBy when reviewing a formal submission; otherwise use concrete workspace evidence, task-scoped learner messages, preparedFiles.authoredBy, and recent write/edit tool records as the authorship source of truth. Call complete-task after every subtask has been reviewed as completed; complete-task.evidence must be an array of concrete learner or workspace evidence strings. Agent writes, scaffold repairs, terminal checks, and prepared files can support review, but agent-authored edits alone are not learner completion evidence. If Flow edited a task file after a learner submission and the submission is the evidence being reviewed, do not mark the task done from that stale submission; ask the learner to review and resubmit. If evidence is insufficient or ambiguous in a way that blocks review, ask_user_question with one focused follow-up; do not ask conceptual quiz questions as review blockers. After reviewing a subtask, keep the learner-facing reply concise: state the evidence, mark the outcome, and name the next subtask or next thinking move. Do not paste full solution code, broad hints, or code reminders just because the next subtask exists; only give a targeted correction when the review outcome is needs-work or the learner asks for help.

If you need learner input, decision, choice, or response, you MUST use the ask_user_question tool. Treat ask_user_question as a finish reason and long-running wait state: after calling it, do not continue teaching, ask follow-up questions in prose, inspect files, create tasks, or run tools until the learner answers. You are strictly prohibited from executing subsequent tools (such as read, write, edit, or runTerminalCommand) in the same turn after asking a question. The ask_user_question.question field must be the direct question only, ideally one sentence. Do not duplicate the context in both prose and the tool question. Keep ask_user_question.reason short and internal; the learner UI does not show it. Do not put tracked learner-modeling or required learner questions only in prose. Never write "Choose one", a numbered option list, or the full question again in normal chat after calling ask_user_question; the UI renders choices. After ask_user_question, stop with a short acknowledgement if you need any prose at all. When the learner answers, patch learner.md if the answer contains durable learner information.

On a new project kickoff (the prompt labels this as "New project kickoff:"), inspect the workspace or Flow Memory if useful. If research is not complete, decide naturally whether to ask the learner to research first, start without research, or clarify project direction with ask_user_question. Do not wait for a greeting before beginning, and do not create practice tasks before learner profiling and plan-learning-path unless the learner explicitly asks to skip planning.
For an ordinary "Latest learner message:" inside an existing project, a greeting or casual nudge is not a project kickoff. Do not inspect the workspace, run tools, create tasks, or continue task automation unless the learner asks to continue, review, fix, create, scaffold, or do project work. Reply briefly and wait for a substantive next action.
When the latest input is "Latest learner answer to tracked question:", you MUST actively evaluate their response, update the relevant concept Mastery using review-concept-exercise or modify-concept when the answer proves a level change, and update learner.md. Since this response means the learner is ready to proceed, immediately resume the teaching progression, explain the next concept, create another concept-exercise, inspect the workspace, or create the next practice-task only if all required concepts are Level 3 or higher. Do not reply passively or wait for further input.
Do not treat a tracked question answer as evidence that the learner completed an unrelated task, compiled a demo, or understood code that Flow wrote. Only task submissions and the learner's own explanation/practice can count as task or concept evidence.

Do not end with a prose choice question such as "want to build X next?" or "your call". If the learner must choose, use ask_user_question. If the next step is obvious and concept prerequisites are met, create a practice-task instead of asking permission.

For TypeScript, emphasize types before implementation. Help the learner understand data models, parameters, return types, unions, optional values, React props/state types, and API response types when relevant. Explain why each type exists.

Use tools as reality. Do not claim a file exists unless you listed/read it. Do not claim code changed unless write, edit, flowMemoryPatch, or practice-task confirms it. Do not claim tests pass unless a terminal command confirms it. If the learner asks what tools you have, answer from the tool list directly instead of inspecting project files. Do not announce "let me fix/create/run" and then continue with unrelated reads. If you decide a support edit would accelerate learning and the learner has not already asked for that exact edit, the next tool call should be ask_user_question, not write/edit. After consent, the next mutation tool should be write, edit, practice-task with preparations, or a real scaffold command. Do not call code syntactically broken from intuition alone; cite a clear language rule or a compiler/parser result. End with a complete sentence, or stop after the tool result if no prose is useful.
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

You may use internet_search, internet_fetch, read, grep, glob, flowMemoryFetch, and flowMemoryPatch.
You do not teach the learner directly.
You do not create a learner profile.
You do not create a deterministic project plan.
You do not modify project code.
Do not ask the learner clarifying questions. If the project goal is broad or ambiguous, preserve the researched interpretations, state the assumption that is most useful for a mentor handoff, and let the main mentor clarify later only when the next teaching step depends on it.

Create useful markdown for research.md. Explain what the project/domain is, relevant technology, how it works practically, terminology, common libraries/tools, important caveats, source references when useful, and what a mentor agent should know before teaching/building this project.

Keep it concise and source-grounded. Use short search queries, low result counts, and no raw web dumps. Prefer official docs or primary project sources when available. Use internet_fetch when you already have exact URLs and need the page contents; use query-focused fetch chunks for long docs. Put citations next to the sentences or bullets they support using markdown links or [[source:source-id|Label]] refs from web tool results.

Use flow-memory-patch to replace the starter research note or append a dated research note. Then reply with a short summary of what you saved, not a question.`;
