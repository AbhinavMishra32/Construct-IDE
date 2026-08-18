import { randomUUID } from "node:crypto";

import { ConstructLearningStore } from "../constructLearningStore";
import { runConstructInteract } from "../constructInteractAgent";
import { createConstructInteractTools } from "../constructInteractTools";
import { validateGeneratedLiveStepDrafts } from "../generatedLiveSteps";
import {
  isLearnerFacingReply,
  selectLearnerFacingReply
} from "../constructInteractReply";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import { isTapeProject, type StoredProject, type StoredTapeProject } from "../projects/ConstructProjectTypes";
import type { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import { supportsGeneratedLiveSteps } from "../../shared/tapeFeatures";
import type {
  ConstructAgentRunEvent,
  ConstructInteractAssessment,
  ConstructInteractAction,
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  ConstructInteractSessionEvent,
  ConstructInteractSession,
  ConstructInteractToolCallRecord,
  GeneratedLiveStepValidationRecord,
  LearningStatePatch
} from "../../shared/constructLearning";
import { AgentLogService } from "./AgentLogService";

type ConstructInteractEvaluation = ConstructInteractResult & {
  actions: ConstructInteractAction[];
  generatedLiveSteps: NonNullable<ConstructInteractResult["generatedLiveSteps"]>;
  liveStepValidation: GeneratedLiveStepValidationRecord[];
  session: ConstructInteractSession;
  learningState: Awaited<ReturnType<ConstructLearningStore["getState"]>>;
};

export type ConstructInteractSessionEventSink = (event: ConstructInteractSessionEvent) => void;

export class ConstructInteractService {
  constructor(private readonly options: {
    learningStore: () => ConstructLearningStore;
    latestTerminalOutput: (projectId: string) => string;
    workspace: ConstructProjectWorkspaceService;
    logs: AgentLogService;
    observability?: ConstructObservabilityService;
  }) {}

  async evaluate(
    project: StoredProject,
    input: Omit<ConstructInteractRuntimeInput, "learningState">,
    onSessionEvent?: ConstructInteractSessionEventSink
  ): Promise<ConstructInteractEvaluation> {
    if (!isTapeProject(project)) {
      throw new Error("Construct Interact is available for tape projects. Use Construct Flow for Flow projects.");
    }

    return this.options.observability?.traceAgentOperation(
      "construct.interact.evaluate",
      {
        projectId: project.id,
        blockId: input.blockId,
        tapeSpec: project.program.spec ?? input.tapeSpec ?? "tape-0.1",
        runtime: "construct"
      },
      () => this.runEvaluate(project, input, onSessionEvent)
    ) ?? this.runEvaluate(project, input, onSessionEvent);
  }

  private async runEvaluate(
    project: StoredTapeProject,
    input: Omit<ConstructInteractRuntimeInput, "learningState">,
    onSessionEvent?: ConstructInteractSessionEventSink
  ): Promise<ConstructInteractEvaluation> {
    const store = this.options.learningStore();
    const learningState = await store.getState();
    const sourceStepIndex = project.program.steps.findIndex((step) => step.blocks.some((block) => block.id === input.blockId));
    const sourceStep = sourceStepIndex >= 0 ? project.program.steps[sourceStepIndex] : undefined;
    const sourceStepId = sourceStep?.id;
    const sourceRunId = randomUUID();
    const runStartedAt = Date.now();
    const agentEvents: ConstructAgentRunEvent[] = [];
    const tapeSpec = project.program.spec ?? input.tapeSpec ?? "tape-0.1";
    const canGenerateLiveSteps = supportsGeneratedLiveSteps(tapeSpec);
    const mode = input.mode ?? "lesson-check";
    const threadId = input.threadId ?? (mode === "general" ? `general:${project.id}` : `${input.blockId}:lesson`);
    const now = new Date().toISOString();
    const session: ConstructInteractSession = {
      id: randomUUID(),
      threadId,
      mode,
      projectId: input.projectId,
      blockId: input.blockId,
      prompt: input.prompt,
      answer: input.answer,
      status: "continue",
      confidence: "low",
      reply: "",
      coveredConceptIds: [],
      missingConceptIds: [],
      assistanceLevel: "none",
      createdAt: now,
      updatedAt: now,
      runStatus: "running",
      actions: [],
      dynamicSteps: [],
      dynamicStepValidation: [],
      generatedLiveSteps: [],
      liveStepValidation: [],
      toolCalls: [],
      agentEvents: [],
      durationMs: 0
    };
    let publishQueue: Promise<void> = Promise.resolve();
    let liveUpdateTimer: NodeJS.Timeout | undefined;
    const queueSessionEvent = (
      type: ConstructInteractSessionEvent["type"],
      result?: ConstructInteractResult,
      stateOverride?: Awaited<ReturnType<ConstructLearningStore["getState"]>>
    ) => {
      const snapshot = cloneSession(session);
      publishQueue = publishQueue
        .then(async () => {
          const state = stateOverride ?? await store.upsertConstructInteractSession(snapshot);
          onSessionEvent?.({
            type,
            runId: sourceRunId,
            projectId: input.projectId,
            blockId: input.blockId,
            threadId,
            session: snapshot,
            result,
            learningState: state
          });
        })
        .catch((error) => {
          this.logStructured("Interact session event failed", error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) }, "warn");
        });
      return publishQueue;
    };
    const updateLiveSessionSnapshot = () => {
      session.updatedAt = new Date().toISOString();
      session.durationMs = Date.now() - runStartedAt;
      session.toolCalls = [...(session.toolCalls ?? [])];
      session.agentEvents = [...agentEvents];
    };
    const flushLiveSessionUpdate = () => {
      if (liveUpdateTimer) {
        clearTimeout(liveUpdateTimer);
        liveUpdateTimer = undefined;
      }
      updateLiveSessionSnapshot();
      void queueSessionEvent("updated");
    };
    const publishUpdatedSession = () => {
      updateLiveSessionSnapshot();
      if (liveUpdateTimer) {
        return;
      }
      liveUpdateTimer = setTimeout(() => {
        liveUpdateTimer = undefined;
        updateLiveSessionSnapshot();
        void queueSessionEvent("updated");
      }, 50);
    };
    session.agentEvents = [...agentEvents];
    const { tools, toolCalls, dynamicSteps, getAssessment } = createConstructInteractTools({
      project,
      request: input,
      learningState,
      sourceBlockId: input.blockId,
      sourceStepId,
      sourceRunId,
      latestTerminalOutput: this.options.latestTerminalOutput(input.projectId),
      workspace: this.options.workspace,
      onToolCallStart: (toolCall) => {
        this.logStructured("Agent tool call started", toolCall, "debug");
      },
      onToolCall: (toolCall) => {
        session.toolCalls = [...toolCalls];
        publishUpdatedSession();
        this.logStructured("Agent tool call", toolCall, "debug");
      }
    });

    this.logText(`Evaluating interaction for block ${input.blockId} (${tapeSpec})`);
    this.logStructured("Interaction request", {
      ...input,
      tapeSpec,
      canGenerateLiveSteps,
      availableTools: Object.keys(tools),
      learningState
    });
    console.log("[Construct Interact] evaluating", input.projectId, input.blockId);
    this.logText("Waiting for model response", "debug");
    await queueSessionEvent("started");

    let result: ConstructInteractResult;
    let runError: unknown;
    let streamedReply = "";
    const abortController = new AbortController();
    try {
      result = await runConstructInteract({
        ...input,
        tapeSpec,
        learningState
      }, (entry) => {
        if (abortController.signal.aborted) {
          return;
        }
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
        if (entry.responseText !== undefined) {
          streamedReply = entry.responseText;
          if (isLearnerFacingReply(streamedReply)) {
            session.reply = streamedReply;
          }
          publishUpdatedSession();
        }
        if (entry.event) {
          const existingEventIndex = findMatchingAgentEventIndex(agentEvents, entry.event);
          if (existingEventIndex >= 0) {
            agentEvents.splice(existingEventIndex, 1, entry.event);
          } else {
            agentEvents.push(entry.event);
          }
          session.agentEvents = [...agentEvents];
          publishUpdatedSession();
        }
        if (entry.partialObject) {
          applyPartialResultToSession(session, entry.partialObject);
          if (isLearnerFacingReply(streamedReply)) {
            session.reply = streamedReply;
          }
          publishUpdatedSession();
          return;
        }
        if (entry.responseText !== undefined && entry.payload === undefined && !entry.event && !entry.partialObject) {
          return;
        }
        if (entry.payload !== undefined) {
          this.logStructured(entry.title, entry.event ? {
            event: entry.event,
            payload: entry.payload
          } : entry.payload, entry.level ?? "debug");
          return;
        }
        this.logText(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      }, tools, { abortSignal: abortController.signal });
    } catch (error) {
      runError = error;
      abortController.abort();
      this.logStructured("Interaction recovery fallback", {
        error: error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : { message: String(error) },
        blockId: input.blockId
      }, "warn");
      result = this.buildRecoveryResult(input, error);
    }
    flushLiveSessionUpdate();
    await publishQueue;
    result.dynamicSteps = dynamicSteps;
    result.reply = runError
      ? result.reply
      : selectLearnerFacingReply(result, streamedReply);
    const assessment = runError ? undefined : getAssessment();
    if (assessment) {
      result.assessment = assessment;
      result.status = assessment.status;
      result.confidence = assessment.confidence;
      result.coveredConceptIds = assessment.coveredConceptIds;
      result.missingConceptIds = assessment.missingConceptIds;
      result.assistanceLevel = assessment.assistanceLevel;
      result.shouldAdvance = assessment.shouldAdvance;
    }
    if (runError || mode === "general") {
      result.shouldAdvance = false;
    }
    const actionsFromTools = extractActionsFromToolCalls(toolCalls);

    const validationContext = {
      projectId: input.projectId,
      sourceBlockId: input.blockId,
      sourceStepId,
      sourceRunId,
      validStepIds: new Set(project.program.steps.map((step, index) => step.id ?? `step-${index + 1}`)),
      validConceptIds: new Set((project.program.concepts ?? [])
        .map((concept) => typeof concept === "object" && concept !== null ? String((concept as { id?: unknown }).id ?? "") : "")
        .filter(Boolean))
    };
    const requestedLiveSteps = dynamicSteps;
    if (!canGenerateLiveSteps && requestedLiveSteps.length > 0) {
      this.logText(`Ignoring ${requestedLiveSteps.length} Dynamic Step draft(s): ${tapeSpec} does not support Dynamic Steps.`, "warn");
    }
    const liveStepValidation = validateGeneratedLiveStepDrafts(
      canGenerateLiveSteps ? requestedLiveSteps : [],
      validationContext
    );
    const acceptedLiveSteps = liveStepValidation.steps;
    let actions = this.normalizeActions([...actionsFromTools, ...(result.actions ?? [])], acceptedLiveSteps.map((step) => step.id), liveStepValidation.validation);
    if (runError) {
      actions = [];
    } else if (result.requestedOutcome === "create-dynamic-steps" && acceptedLiveSteps.length === 0) {
      result.shouldAdvance = false;
      actions = actions.filter((action) => action.type !== "go-to-step");
    }
    this.logText(`Interaction result: ${assessment ? `${result.status} assessment, ` : ""}reply=${result.reply?.slice(0, 80) ?? "none"}...`);
    this.logStructured("Interaction result payload", {
      ...result,
      actions,
      toolCalls,
      dynamicSteps: acceptedLiveSteps,
      dynamicStepValidation: liveStepValidation.validation
    });

    session.status = result.status;
    session.confidence = result.confidence;
    session.reply = result.reply;
    session.coveredConceptIds = result.coveredConceptIds;
    session.missingConceptIds = result.missingConceptIds;
    session.assistanceLevel = result.assistanceLevel;
    session.assessment = assessment;
    session.updatedAt = new Date().toISOString();
    session.runStatus = runError ? "error" : "completed";
    session.errorMessage = runError instanceof Error ? errorMessageForSession(runError) : undefined;
    session.actions = actions;
    session.generatedLiveSteps = acceptedLiveSteps;
    session.liveStepValidation = liveStepValidation.validation;
    session.dynamicSteps = acceptedLiveSteps;
    session.dynamicStepValidation = liveStepValidation.validation;
    session.toolCalls = [...toolCalls];
    session.agentEvents = [...agentEvents];
    session.durationMs = Date.now() - runStartedAt;

    if (result.statePatch) {
      await store.applyPatch(result.statePatch);
    }
    if (assessment) {
      await store.applyPatch(assessmentToLearningStatePatch(assessment, input.projectId));
    }
    let state = await store.recordConstructInteractAttempt(session);
    if (acceptedLiveSteps.length > 0 || actions.length > 0 || toolCalls.length > 0 || liveStepValidation.validation.length > 0) {
      state = await store.applyPatch({
        generatedLiveSteps: {
          projectId: input.projectId,
          steps: acceptedLiveSteps,
          run: {
            id: sourceRunId,
            source: "construct-interact",
            sourceBlockId: input.blockId,
            sourceStepId,
            generatedStepIds: acceptedLiveSteps.map((step) => step.id),
            actions,
            toolCalls,
            validation: liveStepValidation.validation,
            createdAt: new Date().toISOString()
          }
        }
      });
    }
    console.log("[Construct Interact] result", assessment ? result.status : "unassessed", result.shouldAdvance ? "advance" : "stay");
    await queueSessionEvent(runError ? "error" : "completed", {
      ...result,
      actions,
      toolCalls,
      agentEvents,
      durationMs: session.durationMs,
      generatedLiveSteps: acceptedLiveSteps,
      liveStepValidation: liveStepValidation.validation,
      dynamicSteps: acceptedLiveSteps,
      dynamicStepValidation: liveStepValidation.validation
    }, state);
    return {
      ...result,
      actions,
      toolCalls,
      agentEvents,
      durationMs: session.durationMs,
      generatedLiveSteps: acceptedLiveSteps,
      liveStepValidation: liveStepValidation.validation,
      dynamicSteps: acceptedLiveSteps,
      dynamicStepValidation: liveStepValidation.validation,
      session,
      learningState: state
    };
  }

  private buildRecoveryResult(
    input: Omit<ConstructInteractRuntimeInput, "learningState">,
    error: unknown
  ): ConstructInteractResult {
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "";
    const combined = `${errorName} ${message}`;
    const isProviderProblem =
      /json|timeout|timed out|response|api|invalid|parse|structure|user not found|unauthorized|forbidden|api.key|401|403|quota|rate.limit|billing/i.test(combined);
    const providerProblem = isProviderProblem
        ? "Construct Interact could not finish the agent run cleanly"
        : "Construct Interact hit a runtime error";

    return {
      status: "almost",
      confidence: "low",
      reply: [
        `${providerProblem}.`,
        "",
        "The work completed before the provider error is shown above. Retry the same request after checking the model connection."
      ].filter(Boolean).join("\n"),
      coveredConceptIds: [],
      missingConceptIds: input.resources?.concepts ?? [],
      assistanceLevel: "hint",
      shouldAdvance: false,
      actions: [],
      generatedLiveSteps: []
    };
  }

  private normalizeActions(
    actions: ConstructInteractAction[],
    acceptedLiveStepIds: string[],
    validation: GeneratedLiveStepValidationRecord[]
  ): ConstructInteractAction[] {
    const normalized = actions.filter((action) => {
      if (action.type !== "create-live-steps" && action.type !== "open-dynamic-steps") {
        return true;
      }
      return action.stepIds.some((stepId) => acceptedLiveStepIds.includes(stepId));
    });

    if (
      acceptedLiveStepIds.length > 0 &&
      !normalized.some((action) => action.type === "create-live-steps" || action.type === "open-dynamic-steps")
    ) {
      normalized.push({
        type: "open-dynamic-steps",
        stepIds: acceptedLiveStepIds,
        label: acceptedLiveStepIds.length === 1 ? "Review Dynamic Step" : "Review Dynamic Steps",
        reason: validation.find((record) => record.status === "accepted")?.reason ?? "A compiler-validated Dynamic Step is ready."
      });
    }

    return normalized.slice(0, 6);
  }

  private logText(message: string, level: "debug" | "info" | "warn" | "error" = "info"): void {
    this.options.logs.text("interact", message, level);
  }

  private logStructured(
    title: string,
    payload: unknown,
    level: "debug" | "info" | "warn" | "error" = "debug"
  ): void {
    this.options.logs.structured("interact", title, payload, level);
  }
}

function cloneSession(session: ConstructInteractSession): ConstructInteractSession {
  return {
    ...session,
    coveredConceptIds: [...session.coveredConceptIds],
    missingConceptIds: [...session.missingConceptIds],
    actions: session.actions ? [...session.actions] : undefined,
    dynamicSteps: session.dynamicSteps ? [...session.dynamicSteps] : undefined,
    dynamicStepValidation: session.dynamicStepValidation ? [...session.dynamicStepValidation] : undefined,
    generatedLiveSteps: session.generatedLiveSteps ? [...session.generatedLiveSteps] : undefined,
    liveStepValidation: session.liveStepValidation ? [...session.liveStepValidation] : undefined,
    toolCalls: session.toolCalls ? [...session.toolCalls] : undefined,
    agentEvents: session.agentEvents ? [...session.agentEvents] : undefined
  };
}

function errorMessageForSession(error: Error): string {
  return error.message;
}

function applyPartialResultToSession(
  session: ConstructInteractSession,
  partial: Partial<ConstructInteractResult>
): void {
  if (typeof partial.reply === "string" && isLearnerFacingReply(partial.reply)) {
    session.reply = partial.reply;
  }
  if (Array.isArray(partial.actions)) {
    session.actions = partial.actions;
  }
}

function extractActionsFromToolCalls(toolCalls: ConstructInteractToolCallRecord[]): ConstructInteractAction[] {
  const actions: ConstructInteractAction[] = [];
  for (const toolCall of toolCalls) {
    if (!toolCall.outputPreview) continue;
    try {
      const parsed = JSON.parse(toolCall.outputPreview) as { action?: ConstructInteractAction };
      if (parsed.action) {
        actions.push(parsed.action);
      }
    } catch {
      // Tool output previews are best-effort debug strings; non-JSON previews simply do not carry UI actions.
    }
  }
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findMatchingAgentEventIndex(
  events: ConstructAgentRunEvent[],
  nextEvent: ConstructAgentRunEvent
): number {
  const sameIdIndex = events.findIndex((event) => event.id === nextEvent.id);
  if (sameIdIndex >= 0) {
    return sameIdIndex;
  }
  if (nextEvent.type !== "tool" || !nextEvent.toolName) {
    return -1;
  }
  return events.findIndex((event) => (
    event.type === "tool" &&
    event.toolName === nextEvent.toolName &&
    event.status === "running" &&
    !event.outputPreview
  ));
}

function assessmentToLearningStatePatch(
  assessment: ConstructInteractAssessment,
  projectId: string
): LearningStatePatch {
  const at = new Date().toISOString();
  const coveredConfidence = assessment.status === "pass"
    ? "strong"
    : assessment.confidence === "high"
      ? "emerging"
      : "weak";
  const globalConceptUnderstanding = Object.fromEntries([
    ...assessment.coveredConceptIds.map((conceptId) => [conceptId, {
      conceptId,
      confidence: coveredConfidence,
      lastEvidenceAt: at,
      notes: assessment.reason,
      projectIds: [projectId]
    }]),
    ...assessment.missingConceptIds.map((conceptId) => [conceptId, {
      conceptId,
      confidence: "weak" as const,
      lastEvidenceAt: at,
      notes: assessment.reason,
      projectIds: [projectId]
    }])
  ]);
  return {
    globalConceptUnderstanding,
    projectConceptUnderstanding: {
      [projectId]: globalConceptUnderstanding
    },
    assistanceEvent: assessment.assistanceLevel === "none" ? undefined : {
      id: randomUUID(),
      projectId,
      kind: "interact",
      conceptIds: [...new Set([...assessment.coveredConceptIds, ...assessment.missingConceptIds])],
      detail: assessment.reason,
      createdAt: at
    }
  };
}
