import { randomUUID } from "node:crypto";

import { ConstructLearningStore } from "../constructLearningStore";
import { runConstructInteract } from "../constructInteractAgent";
import { createConstructInteractTools } from "../constructInteractTools";
import { validateGeneratedLiveStepDrafts } from "../generatedLiveSteps";
import { ConstructObservabilityService } from "../observability/ConstructObservabilityService";
import type { StoredProject } from "../projects/ConstructProjectTypes";
import { supportsGeneratedLiveSteps } from "../../shared/tapeFeatures";
import type {
  ConstructAgentRunEvent,
  ConstructInteractAction,
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  ConstructInteractSession,
  GeneratedLiveStepValidationRecord
} from "../../shared/constructLearning";
import { AgentLogService } from "./AgentLogService";

const CONSTRUCT_INTERACT_TIMEOUT_MS = 180_000;

class ConstructInteractTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Construct Interact did not return within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "ConstructInteractTimeoutError";
  }
}

type ConstructInteractEvaluation = ConstructInteractResult & {
  actions: ConstructInteractAction[];
  generatedLiveSteps: NonNullable<ConstructInteractResult["generatedLiveSteps"]>;
  liveStepValidation: GeneratedLiveStepValidationRecord[];
  session: ConstructInteractSession;
  learningState: Awaited<ReturnType<ConstructLearningStore["getState"]>>;
};

export class ConstructInteractService {
  constructor(private readonly options: {
    learningStore: () => ConstructLearningStore;
    latestTerminalOutput: (projectId: string) => string;
    logs: AgentLogService;
    observability?: ConstructObservabilityService;
  }) {}

  async evaluate(
    project: StoredProject,
    input: Omit<ConstructInteractRuntimeInput, "learningState">
  ): Promise<ConstructInteractEvaluation> {
    return this.options.observability?.traceAgentOperation(
      "construct.interact.evaluate",
      {
        projectId: project.id,
        blockId: input.blockId,
        tapeSpec: project.program.spec ?? input.tapeSpec ?? "tape-0.1",
        runtime: "construct"
      },
      () => this.runEvaluate(project, input)
    ) ?? this.runEvaluate(project, input);
  }

  private async runEvaluate(
    project: StoredProject,
    input: Omit<ConstructInteractRuntimeInput, "learningState">
  ): Promise<ConstructInteractEvaluation> {
    const store = this.options.learningStore();
    const learningState = await store.getState();
    const sourceStep = project.program.steps.find((step) => step.blocks.some((block) => block.id === input.blockId));
    const sourceStepId = sourceStep?.id;
    const sourceRunId = randomUUID();
    const runStartedAt = Date.now();
    const agentEvents: ConstructAgentRunEvent[] = [];
    const tapeSpec = project.program.spec ?? input.tapeSpec ?? "tape-0.1";
    const canGenerateLiveSteps = supportsGeneratedLiveSteps(tapeSpec);
    const { tools, toolCalls } = createConstructInteractTools({
      project,
      request: input,
      learningState,
      latestTerminalOutput: this.options.latestTerminalOutput(input.projectId),
      onToolCall: (toolCall) => {
        const event: ConstructAgentRunEvent = {
          id: toolCall.id,
          type: "tool",
          status: "completed",
          title: toolCall.name,
          detail: toolCall.reason,
          toolName: toolCall.name,
          input: toolCall.input,
          outputPreview: toolCall.outputPreview,
          createdAt: toolCall.createdAt
        };
        agentEvents.push(event);
        this.logStructured("Agent tool call", event, "debug");
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
    this.logText(`Waiting for model response (timeout ${Math.round(CONSTRUCT_INTERACT_TIMEOUT_MS / 1000)}s)`, "debug");

    let result: ConstructInteractResult;
    try {
      result = await this.withTimeout(runConstructInteract({
        ...input,
        tapeSpec,
        learningState
      }, (entry) => {
        if (entry.event) {
          agentEvents.push(entry.event);
        }
        if (entry.payload !== undefined) {
          this.logStructured(entry.title, entry.event ? {
            event: entry.event,
            payload: entry.payload
          } : entry.payload, entry.level ?? "debug");
          return;
        }
        this.logText(`${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      }, tools));
    } catch (error) {
      this.logStructured("Interaction recovery fallback", {
        error: error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : { message: String(error) },
        timeoutMs: CONSTRUCT_INTERACT_TIMEOUT_MS,
        blockId: input.blockId
      }, "warn");
      result = this.buildRecoveryResult(input, error);
    }

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
    const requestedLiveSteps = result.generatedLiveSteps ?? [];
    if (!canGenerateLiveSteps && requestedLiveSteps.length > 0) {
      this.logText(`Ignoring ${requestedLiveSteps.length} generated live step draft(s): ${tapeSpec} does not support generated live steps.`, "warn");
    }
    const liveStepValidation = validateGeneratedLiveStepDrafts(
      canGenerateLiveSteps ? requestedLiveSteps : [],
      validationContext
    );
    const acceptedLiveSteps = liveStepValidation.steps;
    const actions = this.normalizeActions(result.actions ?? [], acceptedLiveSteps.map((step) => step.id), liveStepValidation.validation);
    this.logText(`Interaction result: ${result.status} (confidence=${result.confidence}, reply=${result.reply?.slice(0, 80) ?? "none"}...)`);
    this.logStructured("Interaction result payload", {
      ...result,
      actions,
      toolCalls,
      generatedLiveSteps: acceptedLiveSteps,
      liveStepValidation: liveStepValidation.validation
    });

    const now = new Date().toISOString();
    const session: ConstructInteractSession = {
      id: randomUUID(),
      projectId: input.projectId,
      blockId: input.blockId,
      prompt: input.prompt,
      answer: input.answer,
      status: result.status,
      confidence: result.confidence,
      reply: result.reply,
      coveredConceptIds: result.coveredConceptIds,
      missingConceptIds: result.missingConceptIds,
      assistanceLevel: result.assistanceLevel,
      createdAt: now,
      toolCalls,
      agentEvents,
      durationMs: Date.now() - runStartedAt
    };

    if (result.statePatch) {
      await store.applyPatch(result.statePatch);
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
    console.log("[Construct Interact] result", result.status, result.confidence, result.shouldAdvance ? "advance" : "stay");
    return {
      ...result,
      actions,
      toolCalls,
      agentEvents,
      durationMs: Date.now() - runStartedAt,
      generatedLiveSteps: acceptedLiveSteps,
      liveStepValidation: liveStepValidation.validation,
      session,
      learningState: state
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs = CONSTRUCT_INTERACT_TIMEOUT_MS): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new ConstructInteractTimeoutError(timeoutMs)), timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
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
      ? "The AI model call did not finish cleanly"
      : "Construct Interact hit a runtime error";

    const assessmentClue = input.assessment
      ? input.assessment.split("\n").find(Boolean) ?? input.assessment
      : null;

    return {
      status: "almost",
      confidence: "low",
      reply: [
        `${providerProblem}, so I am not going to leave this block stuck.`,
        "",
        "Try rephrasing your answer and submitting again. If this keeps happening, check your API key in Settings.",
        "",
        assessmentClue ? `Hint: ${assessmentClue}` : null
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
      if (action.type !== "create-live-steps") {
        return true;
      }
      return action.stepIds.some((stepId) => acceptedLiveStepIds.includes(stepId));
    });

    if (
      acceptedLiveStepIds.length > 0 &&
      !normalized.some((action) => action.type === "create-live-steps")
    ) {
      normalized.push({
        type: "create-live-steps",
        stepIds: acceptedLiveStepIds,
        label: acceptedLiveStepIds.length === 1 ? "Review generated live step" : "Review generated live steps",
        reason: validation.find((record) => record.status === "accepted")?.reason ?? "Construct Interact generated focused live practice."
      });
    }

    return normalized.slice(0, 4);
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
