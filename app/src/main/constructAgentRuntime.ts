import { Agent } from "@mastra/core/agent";
import type { AgentStreamOptions } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { aiGateway } from "./ai/AIGateway";
import type { ConstructAiFeatureId } from "./constructAiFeatures";
import { resolveConstructAiSettings } from "./constructAiSettings";
import type { StoredAiSettings } from "./constructAiSettings";
import type { ConstructAgentRunEvent } from "../shared/constructLearning";
import { emitProviderLog } from "./ai/ProviderLogService";
import { finalizeDanglingToolRunEvents, iterationDetail, type ObservedToolEventState } from "./constructAgentRuntimeStream";
import {
  constructObservabilityService,
  updateGenerationSuccess,
  usageDetailsFrom
} from "./observability/ConstructObservabilityService";

export type ConstructAgentTools = ToolsInput;

export type ConstructAgentRuntimeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ConstructAgentStreamInput = Parameters<Agent["stream"]>[0];

export type ConstructAgentRuntimeRequest<T> = {
  id: string;
  featureId?: ConstructAiFeatureId;
  name: string;
  purpose: string;
  instructions: string;
  prompt: string;
  messages?: ConstructAgentRuntimeMessage[];
  schema: z.ZodType<T>;
  tools?: ConstructAgentTools;
  maxRetries?: number;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  onTrace?: (entry: ConstructAgentTraceEntry<T>) => void;
};

export type ConstructAgenticRuntimeRequest = Omit<ConstructAgentRuntimeRequest<unknown>, "schema"> & {
  contextSummary?: string;
};

export type ConstructAgenticRunResult = {
  text: string;
  stepCount: number;
  finishReason: string;
  totalUsage?: unknown;
  durationMs: number;
};

export type ConstructAgentIteration = {
  iteration: number;
  maxIterations?: number;
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ id: string; name: string; result: unknown; error?: Error }>;
  isFinal: boolean;
  finishReason: string;
};

export type ConstructAgentRuntime = {
  generateStructured<T>(request: ConstructAgentRuntimeRequest<T>): Promise<T>;
  runAgentic(request: ConstructAgenticRuntimeRequest): Promise<ConstructAgenticRunResult>;
};

export type ConstructAgentTraceEntry<T = unknown> = {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
  payload?: unknown;
  event?: ConstructAgentRunEvent;
  responseText?: string;
  partialObject?: Partial<T>;
};

export function createConstructAgentRuntime(): ConstructAgentRuntime {
  const settings = resolveConstructAiSettings();
  const runtime = settings.runtime;

  switch (runtime) {
    case "mastra":
      return new MastraConstructAgentRuntime();
    case "fxpnt":
      return new FxpntConstructAgentRuntime();
    default:
      throw new Error(`Unsupported Construct agent runtime "${runtime}". Available runtimes: mastra, fxpnt.`);
  }
}

class FxpntConstructAgentRuntime implements ConstructAgentRuntime {
  async generateStructured<T>(_request: ConstructAgentRuntimeRequest<T>): Promise<T> {
    throw new Error("FXPNT runtime is selectable but not installed yet. Use Mastra until the external fxpnt runtime package is wired in.");
  }

  async runAgentic(_request: ConstructAgenticRuntimeRequest): Promise<ConstructAgenticRunResult> {
    throw new Error("FXPNT runtime is selectable but not installed yet. Use Mastra until the external fxpnt runtime package is wired in.");
  }
}

class MastraConstructAgentRuntime implements ConstructAgentRuntime {
  async runAgentic(request: ConstructAgenticRuntimeRequest): Promise<ConstructAgenticRunResult> {
    request.onTrace?.({
      title: "Agent request",
      level: "debug",
      detail: [
        `id: ${request.id}`,
        `name: ${request.name}`,
        `purpose: ${request.purpose}`,
        request.featureId ? `featureId: ${request.featureId}` : null,
        `maxRetries: ${request.maxRetries ?? 1}`
      ].filter(Boolean).join("\n"),
      payload: {
        id: request.id,
        name: request.name,
        purpose: request.purpose,
        featureId: request.featureId,
        toolCount: request.tools ? Object.keys(request.tools).length : 0,
        maxRetries: request.maxRetries ?? 1
      }
    });
    request.onTrace?.({
      title: "Agent instructions",
      level: "debug",
      detail: request.instructions,
      payload: { instructions: request.instructions }
    });
    request.onTrace?.({
      title: "Agent prompt",
      level: "debug",
      detail: request.prompt,
      payload: {
        prompt: request.prompt,
        contextSummary: request.contextSummary,
        messages: request.messages
      }
    });

    const settings = resolveConstructAiSettings();
    const model = await aiGateway.resolveModel(request.purpose, request.featureId);
    const providerOptions = providerOptionsForReasoning(settings.provider, settings.reasoningEffort);
    emitProviderLog(
      model.providerId,
      `Model resolved: ${model.modelId} | Provider: ${model.providerId} | Base URL: ${model.url || "default"} | Effort: ${settings.reasoningEffort}`,
      "info"
    );
    request.onTrace?.({
      title: "Resolved agent model",
      level: "debug",
      detail: [
        `provider: ${model.providerId}`,
        `model: ${model.modelId}`,
        model.id ? `id: ${model.id}` : null,
        model.url ? `baseUrl: ${model.url}` : null,
        `reasoningEffort: ${settings.reasoningEffort}`
      ].filter(Boolean).join("\n"),
      payload: {
        provider: model.providerId,
        model: model.modelId,
        id: model.id,
        baseUrl: model.url,
        reasoningEffort: settings.reasoningEffort,
        providerOptions
      }
    });
    await ensureModelEndpointReachable(model, request);

    const agent = new Agent({
      id: request.id,
      name: request.name,
      instructions: request.instructions,
      model,
      tools: request.tools,
      maxRetries: request.maxRetries ?? 1
    });

    new Mastra({ agents: { [request.id]: agent }, logger: false });
    const hasTools = request.tools && Object.keys(request.tools).length > 0;
    const runStartedAt = Date.now();
    const runEventId = outputEventId(request.id);
    emitProviderLog(
      model.providerId,
      `Agentic API call started: ${request.purpose} | Model: ${model.modelId} | Tools: ${hasTools ? "yes" : "no"} | Prompt length: ${renderRuntimeInputForLog(request).length} chars`,
      "info"
    );

    const internalAbort = new AbortController();
    if (request.abortSignal) {
      request.abortSignal.addEventListener("abort", () => internalAbort.abort());
    }

    const observed = { text: "" };
    let completedSteps = 0;

    return constructObservabilityService.traceGeneration(
      {
        name: "construct.agentic.model",
        input: request.messages ?? request.prompt,
        model: model.modelId,
        modelParameters: {
          maxSteps: request.maxSteps ?? (hasTools ? 16 : 1),
          maxRetries: request.maxRetries ?? 1
        },
        provider: model.providerId,
        metadata: {
          featureId: request.featureId,
          purpose: request.purpose,
          requestId: request.id,
          hasTools,
          runtime: "mastra",
          reasoningEffort: settings.reasoningEffort
        }
      },
      async (generation) => {
    try {
      const streamInput = (request.messages ?? request.prompt) as ConstructAgentStreamInput;
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "start",
        purpose: request.purpose,
        trace: request.onTrace
      });
      const output = await agent.stream(streamInput, {
        abortSignal: internalAbort.signal,
        maxSteps: request.maxSteps ?? (hasTools ? 16 : 1),
        toolChoice: hasTools ? "auto" : undefined,
        providerOptions,
        onIterationComplete: (iteration) => {
          completedSteps = iteration.iteration;
          // Halting is handled in observeStream on successful tool-result chunks

          const normalized: ConstructAgentIteration = {
            iteration: iteration.iteration,
            maxIterations: iteration.maxIterations,
            text: iteration.text,
            toolCalls: iteration.toolCalls,
            toolResults: iteration.toolResults,
            isFinal: iteration.isFinal,
            finishReason: iteration.finishReason
          };
          const event: ConstructAgentRunEvent = {
            id: `${runEventId}:model-step:${iteration.iteration}`,
            type: "iteration",
            status: "completed",
            title: `Model step ${iteration.iteration}`,
            detail: iterationDetail(normalized),
            iteration: iteration.iteration,
            input: {
              iteration: iteration.iteration,
              maxIterations: iteration.maxIterations,
              toolCalls: iteration.toolCalls
            },
            outputPreview: stringifyForTrace({
              toolResults: iteration.toolResults.map((result) => ({
                id: result.id,
                name: result.name,
                status: result.error ? "error" : "completed"
              })),
              isFinal: iteration.isFinal,
              finishReason: iteration.finishReason
            }),
            createdAt: new Date().toISOString()
          };
          request.onTrace?.({
            title: "Agent iteration",
            level: "debug",
            detail: event.detail ?? event.title,
            event,
            payload: {
              iteration: iteration.iteration,
              maxIterations: iteration.maxIterations,
              toolCalls: iteration.toolCalls,
              toolResults: iteration.toolResults,
              isFinal: iteration.isFinal,
              finishReason: iteration.finishReason
            }
          });
        }
      });

      const [observedResult, steps, finishReason, totalUsage, mastraText] = await Promise.all([
        this.observeStream(output.fullStream, request, runStartedAt, runEventId, observed, internalAbort),
        output.steps,
        output.finishReason,
        output.totalUsage.catch(() => undefined),
        output.text.catch(() => "")
      ]);
      let text = (typeof mastraText === "string" ? mastraText : "").trim();
      if (!text) {
        text = observedResult.text.trim();
      }
      const result: ConstructAgenticRunResult = {
        text,
        stepCount: steps.length,
        finishReason: finishReason ?? "unknown",
        totalUsage,
        durationMs: Date.now() - runStartedAt
      };
      request.onTrace?.({
        title: "Agent run completed",
        level: "debug",
        detail: `${result.stepCount} model step${result.stepCount === 1 ? "" : "s"} completed in ${formatDuration(result.durationMs)}.`,
        payload: result
      });
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "complete",
        purpose: request.purpose,
        trace: request.onTrace
      });
      emitProviderLog(
        model.providerId,
        `Agentic API call completed: ${result.stepCount} step(s) | Finish reason: ${finishReason} | Duration: ${formatDuration(result.durationMs)} | Text length: ${text.length}`,
        "info"
      );
      updateGenerationSuccess(generation, {
        output: {
          finishReason: result.finishReason,
          stepCount: result.stepCount,
          text: result.text
        },
        usageDetails: usageDetailsFrom(totalUsage),
        metadata: {
          durationMs: result.durationMs,
          status: "completed"
        }
      });
      return result;
    } catch (error) {
      if (internalAbort.signal.aborted && (!request.abortSignal || !request.abortSignal.aborted)) {
        const text = observed.text.trim();
        const result: ConstructAgenticRunResult = {
          text,
          stepCount: completedSteps,
          finishReason: "suspended",
          durationMs: Date.now() - runStartedAt
        };
        request.onTrace?.({
          title: "Agent run suspended",
          level: "debug",
          detail: `Run suspended after ${result.stepCount} steps due to user question or task creation.`,
          payload: result
        });
        aiGateway.traceProviderCall({
          featureId: request.featureId,
          model,
          phase: "complete",
          purpose: request.purpose,
          trace: request.onTrace
        });
        emitProviderLog(
          model.providerId,
          `Agentic API call suspended: ${result.stepCount} step(s) | Duration: ${formatDuration(result.durationMs)} | Text length: ${text.length}`,
          "info"
        );
        updateGenerationSuccess(generation, {
          output: {
            finishReason: result.finishReason,
            stepCount: result.stepCount,
            text: result.text
          },
          metadata: {
            durationMs: result.durationMs,
            status: "suspended"
          }
        });
        return result;
      }

      request.onTrace?.({
        title: "Agent runtime error",
        level: "error",
        detail: error instanceof Error ? error.stack || error.message : String(error),
        payload: error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : { error: String(error) }
      });
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "error",
        purpose: request.purpose,
        trace: request.onTrace
      });
      emitProviderLog(
        model.providerId,
        `Agentic API call failed: ${error instanceof Error ? error.message : String(error)} | Model: ${model.modelId} | Provider: ${model.providerId}`,
        "error"
      );
      throw error;
    }
      }
    );
  }

  async generateStructured<T>(request: ConstructAgentRuntimeRequest<T>): Promise<T> {
    request.onTrace?.({
      title: "Agent request",
      level: "debug",
      detail: [
        `id: ${request.id}`,
        `name: ${request.name}`,
        `purpose: ${request.purpose}`,
        request.featureId ? `featureId: ${request.featureId}` : null,
        `maxRetries: ${request.maxRetries ?? 1}`
      ].filter(Boolean).join("\n"),
      payload: {
        id: request.id,
        name: request.name,
        purpose: request.purpose,
        featureId: request.featureId,
        toolCount: request.tools ? Object.keys(request.tools).length : 0,
        maxRetries: request.maxRetries ?? 1
      }
    });
    request.onTrace?.({
      title: "Agent instructions",
      level: "debug",
      detail: request.instructions,
      payload: { instructions: request.instructions }
    });
    request.onTrace?.({
      title: "Agent prompt",
      level: "debug",
      detail: request.prompt,
      payload: { prompt: request.prompt }
    });
    request.onTrace?.({
      title: "Structured schema",
      level: "debug",
      detail: stringifyForTrace(describeSchema(request.schema)),
      payload: describeSchema(request.schema)
    });

    const settings = resolveConstructAiSettings();
    const model = await aiGateway.resolveModel(request.purpose, request.featureId);
    const providerOptions = providerOptionsForReasoning(settings.provider, settings.reasoningEffort);
    
    // Log to provider channel
    emitProviderLog(
      model.providerId,
      `Model resolved: ${model.modelId} | Provider: ${model.providerId} | Base URL: ${model.url || "default"} | Effort: ${settings.reasoningEffort}`,
      "info"
    );
    
    request.onTrace?.({
      title: "Resolved agent model",
      level: "debug",
      detail: [
        `provider: ${model.providerId}`,
        `model: ${model.modelId}`,
        model.id ? `id: ${model.id}` : null,
        model.url ? `baseUrl: ${model.url}` : null,
        `reasoningEffort: ${settings.reasoningEffort}`
      ].filter(Boolean).join("\n"),
      payload: {
        provider: model.providerId,
        model: model.modelId,
        id: model.id,
        baseUrl: model.url,
        reasoningEffort: settings.reasoningEffort,
        providerOptions
      }
    });
    await ensureModelEndpointReachable(model, request);

    const agent = new Agent({
      id: request.id,
      name: request.name,
      instructions: request.instructions,
      model,
      tools: request.tools,
      maxRetries: request.maxRetries ?? 1
    });

    new Mastra({ agents: { [request.id]: agent }, logger: false });
    const hasTools = request.tools && Object.keys(request.tools).length > 0;
    const runStartedAt = Date.now();
    const runEventId = outputEventId(request.id);

    emitProviderLog(
      model.providerId,
      `API call started: ${request.purpose} | Model: ${model.modelId} | Tools: ${hasTools ? "yes" : "no"} | Prompt length: ${request.prompt.length} chars`,
      "info"
    );

    const effectivePrompt = model.providerId === "opencode-zen"
      ? enhancePromptForJsonOutput(request.prompt, request.schema)
      : request.prompt;

    return constructObservabilityService.traceGeneration(
      {
        name: "construct.structured.model",
        input: effectivePrompt,
        model: model.modelId,
        modelParameters: {
          maxSteps: request.maxSteps ?? (hasTools ? 12 : 1),
          maxRetries: request.maxRetries ?? 1
        },
        provider: model.providerId,
        metadata: {
          featureId: request.featureId,
          purpose: request.purpose,
          requestId: request.id,
          hasTools,
          runtime: "mastra",
          reasoningEffort: settings.reasoningEffort,
          structuredOutput: true
        }
      },
      async (generation) => {
    try {
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "start",
        purpose: request.purpose,
        trace: request.onTrace
      });
      const output = await agent.stream(effectivePrompt, {
        structuredOutput: {
          schema: request.schema,
          jsonPromptInjection: model.providerId === "opencode-zen"
        },
        abortSignal: request.abortSignal,
        maxSteps: request.maxSteps ?? (hasTools ? 12 : 1),
        toolChoice: hasTools ? "auto" : undefined,
        providerOptions,
        onIterationComplete: (iteration) => {
          const normalized: ConstructAgentIteration = {
            iteration: iteration.iteration,
            maxIterations: iteration.maxIterations,
            text: iteration.text,
            toolCalls: iteration.toolCalls,
            toolResults: iteration.toolResults,
            isFinal: iteration.isFinal,
            finishReason: iteration.finishReason
          };
          const event: ConstructAgentRunEvent = {
            id: `${runEventId}:model-step:${iteration.iteration}`,
            type: "iteration",
            status: "completed",
            title: `Model step ${iteration.iteration}`,
            detail: iterationDetail(normalized),
            iteration: iteration.iteration,
            input: {
              iteration: iteration.iteration,
              maxIterations: iteration.maxIterations,
              toolCalls: iteration.toolCalls
            },
            outputPreview: stringifyForTrace({
              toolResults: iteration.toolResults.map((result) => ({
                id: result.id,
                name: result.name,
                status: result.error ? "error" : "completed"
              })),
              isFinal: iteration.isFinal,
              finishReason: iteration.finishReason
            }),
            createdAt: new Date().toISOString()
          };
          request.onTrace?.({
            title: "Agent iteration",
            level: "debug",
            detail: event.detail ?? event.title,
            event,
            payload: {
              iteration: iteration.iteration,
              maxIterations: iteration.maxIterations,
              toolCalls: iteration.toolCalls,
              toolResults: iteration.toolResults,
              isFinal: iteration.isFinal,
              finishReason: iteration.finishReason
            }
          });

        }
      });
      const [object, steps, finishReason, totalUsage] = await Promise.all([
        output.object,
        output.steps,
        output.finishReason,
        output.totalUsage,
        this.observeStream(output.fullStream, request, runStartedAt, runEventId)
      ]);

      request.onTrace?.({
        title: "Raw structured output",
        level: "debug",
        detail: stringifyForTrace(object),
        payload: object
      });

      request.onTrace?.({
        title: "Agent run completed",
        level: "debug",
        detail: `${steps.length} model step${steps.length === 1 ? "" : "s"} completed in ${formatDuration(Date.now() - runStartedAt)}.`,
        payload: {
          stepCount: steps.length,
          finishReason,
          totalUsage,
          durationMs: Date.now() - runStartedAt
        }
      });

      // Log raw structured output for debugging
      request.onTrace?.({
        title: "Raw structured output from model",
        level: "info",
        detail: `Model: ${model.modelId} | Provider: ${model.providerId} | Response object type: ${typeof object}`,
        payload: {
          model: model.modelId,
          provider: model.providerId,
          object: object,
          objectString: stringifyForTrace(object),
          stepCount: steps.length,
          finishReason,
          isNull: object === null || object === undefined,
          isEmpty: object && typeof object === 'object' && Object.keys(object).length === 0
        }
      });

      // Log API call completion
      emitProviderLog(
        model.providerId,
        `API call completed: ${steps.length} step(s) | Finish reason: ${finishReason} | Duration: ${formatDuration(Date.now() - runStartedAt)} | Object type: ${typeof object}`,
        object ? "info" : "warn"
      );

      // Validate the structured output
      if (!object || (typeof object === 'object' && Object.keys(object).length === 0)) {
        const errorMsg = `Model returned empty structured output. Model: ${model.modelId}, Provider: ${model.providerId}. The model may not support structured output or returned empty JSON.`;
        request.onTrace?.({
          title: "Structured output validation error",
          level: "error",
          detail: errorMsg,
          payload: {
            model: model.modelId,
            provider: model.providerId,
            object: object
          }
        });
        // Log error to provider channel
        emitProviderLog(model.providerId, errorMsg, "error");
        throw new Error(errorMsg);
      }

      const parsed = request.schema.parse(object);
      request.onTrace?.({
        title: "Validated structured result",
        level: "debug",
        detail: stringifyForTrace(parsed),
        payload: parsed
      });
      
      // Log successful validation
      emitProviderLog(
        model.providerId,
        `Structured output validated successfully | Model: ${model.modelId} | Provider: ${model.providerId}`,
        "info"
      );
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "complete",
        purpose: request.purpose,
        trace: request.onTrace
      });
      updateGenerationSuccess(generation, {
        output: parsed,
        usageDetails: usageDetailsFrom(totalUsage),
        metadata: {
          durationMs: Date.now() - runStartedAt,
          finishReason,
          status: "completed",
          stepCount: steps.length
        }
      });
      
      return parsed;
    } catch (error) {
      request.onTrace?.({
        title: "Agent runtime error",
        level: "error",
        detail: error instanceof Error ? error.stack || error.message : String(error),
        payload: error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : { error: String(error) }
      });
      
      // Log error to provider channel
      const errorMessage = error instanceof Error ? error.message : String(error);
      emitProviderLog(
        model.providerId,
        `API call failed: ${errorMessage} | Model: ${model.modelId} | Provider: ${model.providerId}`,
        "error"
      );
      aiGateway.traceProviderCall({
        featureId: request.featureId,
        model,
        phase: "error",
        purpose: request.purpose,
        trace: request.onTrace
      });
      
      throw error;
    }
      }
    );
  }

  private async observeStream<T>(
    stream: { getReader: () => { read: () => Promise<{ done?: boolean; value?: unknown }>; releaseLock?: () => void } },
    request: Pick<ConstructAgentRuntimeRequest<T>, "id" | "onTrace">,
    runStartedAt: number,
    runEventId: string,
    observed?: { text: string },
    abortController?: AbortController
  ): Promise<{ text: string }> {
    const reasoning = new Map<string, {
      event: ConstructAgentRunEvent;
      characterCount: number;
      text: string;
      lastPublishedAt: number;
    }>();
    const messages = new Map<string, {
      text: string;
      createdAt: string;
      lastPublishedAt: number;
    }>();
    let accumulatedText = "";
    let reasoningSequence = 0;
    let activeReasoningId: string | undefined;
    let messageSequence = 0;
    let activeMessageId: string | undefined;
    let activeStreamPart: "reasoning" | "text" | "tool" | "object" | undefined;
    const pendingToolInputs = new Map<string, string>();
    let toolSequence = 0;
    const toolEvents = new Map<string, ObservedToolEventState>();

    const nextEventOrdinal = () => {
      globalEventOrdinal += 1;
      return globalEventOrdinal;
    };
    const nextReasoningId = () => {
      reasoningSequence += 1;
      return `${runEventId}:reasoning:${globalEventOrdinal + 1}:${reasoningSequence}`;
    };
    const nextMessageId = () => {
      messageSequence += 1;
      return `${runEventId}:message:${globalEventOrdinal + 1}:${messageSequence}`;
    };
    const nextToolEventId = () => {
      toolSequence += 1;
      return `${runEventId}:tool:${globalEventOrdinal + 1}:${toolSequence}`;
    };
    const startReasoningSegment = (rawId: string | undefined) => {
      void rawId;
      const id = nextReasoningId();
      activeReasoningId = id;
      activeStreamPart = "reasoning";
      const event: ConstructAgentRunEvent = {
        id,
        type: "reasoning",
        status: "running",
        title: "Thinking",
        detail: "Thinking",
        createdAt: new Date().toISOString()
      };
      reasoning.set(id, {
        event,
        characterCount: 0,
        text: "",
        lastPublishedAt: Date.now()
      });
      request.onTrace?.({
        title: "Agent analysis started",
        level: "debug",
        detail: event.detail ?? "",
        event,
        payload: { type: "reasoning-start", id }
      });
      return id;
    };
    const reasoningIdForDelta = (_rawId: string | undefined) => {
      if (activeReasoningId && reasoning.has(activeReasoningId)) {
        return activeReasoningId;
      }
      return startReasoningSegment(_rawId);
    };
    const closeReasoningSegment = (_reason: string, _rawId?: string) => {
      const id = activeReasoningId;
      const state = id ? reasoning.get(id) : undefined;
      if (!id || !state) return;
      if (state.event.status === "running") {
        state.event.status = "completed";
        state.event.detail = state.text.trim() ? summarizeReasoningText(state.text) : "Analysis complete";
        if (state.text.trim()) {
          state.event.text = state.text;
        }
          request.onTrace?.({
            title: "Agent analysis completed",
            level: "debug",
            detail: state.event.detail,
            event: state.event,
            payload: {
              type: _reason,
            id,
            characterCount: state.characterCount
          }
        });
      }
      if (id === activeReasoningId) {
        activeReasoningId = undefined;
      }
      if (activeStreamPart === "reasoning") {
        activeStreamPart = undefined;
      }
    };
    const closeActiveReasoningSegment = (reason: string) => {
      if (activeReasoningId && activeStreamPart === "reasoning") {
        closeReasoningSegment(reason);
      }
    };
    const ensureToolEvent = (providerToolCallId: string, toolName: string, detail: string) => {
      const existing = toolEvents.get(providerToolCallId);
      if (existing && !existing.completed) {
        return existing;
      }
      const event: ConstructAgentRunEvent = {
        id: nextToolEventId(),
        type: "tool",
        status: "running",
        title: toolName,
        detail,
        toolName,
        toolCallId: providerToolCallId,
        createdAt: new Date().toISOString()
      };
      const state = { providerToolCallId, event, completed: false };
      toolEvents.set(providerToolCallId, state);
      return state;
    };
    const closeDanglingToolEvents = (reason: string) => {
      finalizeDanglingToolRunEvents(toolEvents, pendingToolInputs, reason, (entry) => request.onTrace?.(entry));
      if (activeStreamPart === "tool") {
        activeStreamPart = undefined;
      }
    };
    const startTextSegment = (rawId: string | undefined) => {
      void rawId;
      const id = nextMessageId();
      const createdAt = new Date().toISOString();
      activeMessageId = id;
      activeStreamPart = "text";
      messages.set(id, { text: "", createdAt, lastPublishedAt: 0 });
      const event: ConstructAgentRunEvent = {
        id,
        type: "message",
        status: "running",
        title: "Assistant response",
        text: "",
        createdAt
      };
      request.onTrace?.({
        title: "Agent response started",
        level: "debug",
        detail: "",
        event,
        responseText: "",
        payload: { type: "text-start", id }
      });
      return id;
    };
    const closeTextSegment = (reason: string) => {
      const id = activeMessageId;
      const state = id ? messages.get(id) : undefined;
      if (id && state) {
        const event: ConstructAgentRunEvent = {
          id,
          type: "message",
          status: "completed",
          title: "Assistant response",
          text: state.text,
          createdAt: state.createdAt
        };
        request.onTrace?.({
          title: "Agent response completed",
          level: "debug",
          detail: `${state.text.length} response characters received`,
          event,
          responseText: state.text,
          payload: {
            type: reason,
            id,
            text: state.text
          }
        });
      }
      activeMessageId = undefined;
      if (activeStreamPart === "text") {
        activeStreamPart = undefined;
      }
    };
    const messageIdForTextChunk = (rawId: string | undefined) => {
      if (activeMessageId && activeStreamPart === "text") {
        return activeMessageId;
      }
      return startTextSegment(rawId);
    };

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value: rawChunk } = await reader.read();
        if (done) {
          closeTextSegment("stream-end");
          closeActiveReasoningSegment("stream-end");
          closeDanglingToolEvents("stream-end");
          break;
        }
      const chunk = rawChunk as {
        type?: string;
        payload?: Record<string, unknown>;
        object?: Partial<T>;
      };

      if (chunk.type === "reasoning-start") {
        closeTextSegment("reasoning-start");
        closeActiveReasoningSegment("reasoning-start");
        startReasoningSegment(chunkString(chunk, "id"));
        continue;
      }

      if (chunk.type === "reasoning-delta") {
        closeTextSegment("reasoning-delta");
        activeStreamPart = "reasoning";
        const rawId = chunkString(chunk, "id");
        const id = reasoningIdForDelta(rawId);
        activeReasoningId = id;
        const text = chunkString(chunk, "text") ?? "";
        const state = reasoning.get(id) ?? {
          event: {
            id,
            type: "reasoning" as const,
            status: "running" as const,
            title: "Thinking",
            detail: "Thinking",
            createdAt: new Date().toISOString()
          },
          characterCount: 0,
          text: "",
          lastPublishedAt: 0
        };
        state.characterCount += text.length;
        state.text += text;
        if (state.text.trim()) {
          state.event.text = state.text;
          state.event.detail = summarizeReasoningText(state.text);
        }
        const now = Date.now();
        if (now - state.lastPublishedAt >= 500) {
          state.lastPublishedAt = now;
          request.onTrace?.({
            title: "Agent analysis progress",
            level: "debug",
            detail: `${state.characterCount} reasoning characters received`,
            event: state.event,
            payload: {
              type: chunk.type,
              id,
              characterCount: state.characterCount
            }
          });
        }
        reasoning.set(id, state);
        continue;
      }

      if (chunk.type === "reasoning-end") {
        closeTextSegment("reasoning-end");
        const rawId = chunkString(chunk, "id");
        closeReasoningSegment("reasoning-end", rawId);
        continue;
      }

      if (chunk.type === "text-start") {
        const rawId = chunkString(chunk, "id");
        closeActiveReasoningSegment("text-start");
        closeTextSegment("text-start");
        startTextSegment(rawId);
        continue;
      }

      if (chunk.type === "text-delta") {
        const rawId = chunkString(chunk, "id");
        closeActiveReasoningSegment("text-delta");
        const id = messageIdForTextChunk(rawId);
        activeMessageId = id;
        activeStreamPart = "text";
        const text = chunkString(chunk, "text") ?? "";
        const state = messages.get(id) ?? { text: "", createdAt: new Date().toISOString(), lastPublishedAt: 0 };
        state.text += text;
        accumulatedText += text;
        if (observed) {
          observed.text = accumulatedText;
        }
        const now = Date.now();
        if (now - state.lastPublishedAt >= 50) {
          state.lastPublishedAt = now;
          const event: ConstructAgentRunEvent = {
            id,
            type: "message",
            status: "running",
            title: "Assistant response",
            text: state.text,
            createdAt: state.createdAt
          };
          request.onTrace?.({
            title: "Agent response streaming",
            level: "debug",
            detail: `${state.text.length} response characters received`,
            event,
            responseText: state.text
          });
        }
        messages.set(id, state);
        continue;
      }

      if (chunk.type === "text-end") {
        closeTextSegment("text-end");
        continue;
      }

      if (chunk.type === "tool-call-input-streaming-start" || chunk.type === "tool-call-streaming-start" || chunk.type === "tool-input-start") {
        closeTextSegment("tool-input-start");
        closeActiveReasoningSegment("tool-input-start");
        activeStreamPart = "tool";
        const providerToolCallId = chunkString(chunk, "toolCallId") ?? chunkString(chunk, "id") ?? `${runEventId}:anonymous-tool:${toolSequence + 1}`;
        if (providerToolCallId) {
          pendingToolInputs.set(providerToolCallId, "");
          const toolName = chunkString(chunk, "toolName") ?? "tool";
          const state = ensureToolEvent(providerToolCallId, toolName, "Preparing input");
          state.event = {
            ...state.event,
            status: "running",
            title: toolName,
            detail: "Preparing input",
            toolName,
            toolCallId: providerToolCallId
          };
          state.completed = false;
          request.onTrace?.({
            title: "Agent tool input started",
            level: "debug",
            detail: toolName,
            event: state.event,
            payload: { ...chunk, providerToolCallId, id: state.event.id }
          });
        }
        continue;
      }

      if (chunk.type === "tool-call-delta" || chunk.type === "tool-input-delta") {
        closeTextSegment("tool-input-delta");
        closeActiveReasoningSegment("tool-input-delta");
        activeStreamPart = "tool";
        const providerToolCallId = chunkString(chunk, "toolCallId") ?? chunkString(chunk, "id");
        if (providerToolCallId) {
          pendingToolInputs.set(providerToolCallId, `${pendingToolInputs.get(providerToolCallId) ?? ""}${chunkString(chunk, "argsTextDelta") ?? chunkString(chunk, "delta") ?? ""}`);
          const toolName = chunkString(chunk, "toolName") ?? toolEvents.get(providerToolCallId)?.event.toolName ?? "tool";
          const state = ensureToolEvent(providerToolCallId, toolName, "Streaming input");
          state.event = {
            ...state.event,
            status: "running",
            title: toolName,
            detail: "Streaming input",
            toolName,
            toolCallId: providerToolCallId
          };
          state.completed = false;
          request.onTrace?.({
            title: "Agent tool input streaming",
            level: "debug",
            detail: toolName,
            payload: {
              type: chunk.type,
              providerToolCallId,
              id: state.event.id,
              toolName,
              inputLength: pendingToolInputs.get(providerToolCallId)?.length ?? 0
            }
          });
        }
        continue;
      }

      if (chunk.type === "tool-call") {
        closeTextSegment("tool-call");
        closeActiveReasoningSegment("tool-call");
        activeStreamPart = "tool";
        const providerToolCallId = chunkString(chunk, "toolCallId") ?? chunkString(chunk, "id") ?? `${runEventId}:anonymous-tool:${toolSequence + 1}`;
        const toolName = chunkString(chunk, "toolName") ?? "tool";
        const state = ensureToolEvent(providerToolCallId, toolName, "Running");
        const event: ConstructAgentRunEvent = {
          ...state.event,
          type: "tool",
          status: "running",
          title: toolName,
          detail: "Running",
          toolName,
          toolCallId: providerToolCallId,
          input: chunkValue(chunk, "args") ?? chunkValue(chunk, "input") ?? parseMaybeJson(pendingToolInputs.get(providerToolCallId)),
          createdAt: state.event.createdAt
        };
        state.event = event;
        state.completed = false;
        request.onTrace?.({
          title: "Agent tool call streamed",
          level: "debug",
          detail: toolName,
          event,
          payload: { ...chunk, providerToolCallId, id: event.id }
        });
        continue;
      }

      if (chunk.type === "tool-result" || chunk.type === "tool-error") {
        closeTextSegment("tool-result");
        closeActiveReasoningSegment("tool-result");
        activeStreamPart = "tool";
        const providerToolCallId = chunkString(chunk, "toolCallId") ?? chunkString(chunk, "id") ?? `${runEventId}:anonymous-tool:${toolSequence + 1}`;
        const toolName = chunkString(chunk, "toolName") ?? toolEvents.get(providerToolCallId)?.event.toolName ?? "tool";
        const state = ensureToolEvent(providerToolCallId, toolName, chunk.type === "tool-error" ? "Failed" : "Completed");
        const event: ConstructAgentRunEvent = {
          ...state.event,
          type: "tool",
          status: chunk.type === "tool-error" ? "error" : "completed",
          title: toolName,
          detail: chunk.type === "tool-error" ? "Failed" : "Completed",
          toolName,
          toolCallId: providerToolCallId,
          input: state.event.input ?? chunkValue(chunk, "args") ?? chunkValue(chunk, "input"),
          outputPreview: previewUnknown(chunk.type === "tool-error" ? chunkValue(chunk, "error") : chunkValue(chunk, "result") ?? chunkValue(chunk, "output")),
          createdAt: state.event.createdAt
        };
        state.event = event;
        state.completed = true;
        request.onTrace?.({
          title: "Agent tool result streamed",
          level: chunk.type === "tool-error" ? "error" : "debug",
          detail: toolName,
          event,
          payload: { ...chunk, providerToolCallId, id: event.id }
        });
        if (chunk.type === "tool-result" && abortController) {
          const normalizedToolName = toolName.replace(/[^a-z0-9]/gi, "").toLowerCase();
          const isHalting = ["askquestion", "askuser", "askuserquestion", "practicetask"].includes(normalizedToolName);
          if (isHalting) {
            abortController.abort();
          }
        }
        continue;
      }

      const partialObject = chunk.type === "network-object"
        ? (chunk.payload?.object as Partial<T> | undefined)
        : chunk.object;
      if ((chunk.type === "object" || chunk.type === "network-object") && partialObject) {
        closeTextSegment("object");
        closeActiveReasoningSegment("object");
        activeStreamPart = "object";
        request.onTrace?.({
          title: "Structured response delta",
          level: "debug",
          detail: `${formatDuration(Date.now() - runStartedAt)} elapsed`,
          partialObject,
          payload: partialObject
        });
        continue;
      }
    }
    } finally {
      reader.releaseLock?.();
    }
    return { text: accumulatedText };
  }
}

let runEventSequence = 0;
let globalEventOrdinal = 0;

function outputEventId(agentId: string): string {
  runEventSequence += 1;
  return `${agentId}-${Date.now()}-${runEventSequence}`;
}

function stringField(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
}

function chunkValue(chunk: { payload?: Record<string, unknown> } & Record<string, unknown>, key: string): unknown {
  return chunk.payload?.[key] ?? chunk[key];
}

function chunkString(chunk: { payload?: Record<string, unknown> } & Record<string, unknown>, key: string): string | undefined {
  const value = chunkValue(chunk, key);
  return typeof value === "string" ? value : undefined;
}

function providerOptionsForReasoning(
  provider: StoredAiSettings["provider"],
  effort: StoredAiSettings["reasoningEffort"]
): AgentStreamOptions["providerOptions"] | undefined {
  if (effort === "auto") return undefined;
  if (provider === "openrouter") {
    return { openrouter: { reasoning: { effort } } } as AgentStreamOptions["providerOptions"];
  }

  const openAiEffort = effort;
  const openAiOptions: Record<string, unknown> = { reasoningEffort: openAiEffort };
  if (effort !== "none") {
    openAiOptions.reasoningSummary = "auto";
  }
  return { openai: openAiOptions } as AgentStreamOptions["providerOptions"];
}

function parseMaybeJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function previewUnknown(value: unknown): string {
  try {
    const jsonStr = JSON.stringify(value, null, 2);
    const isConceptResult = typeof value === "object" && value !== null && (
      "concept" in (value as Record<string, unknown>) ||
      "concepts" in (value as Record<string, unknown>) ||
      "conceptId" in (value as Record<string, unknown>)
    );
    const limit = isConceptResult ? 48000 : 1600;
    if (jsonStr.length <= limit) {
      return jsonStr;
    }
    return jsonStr.slice(0, limit);
  } catch {
    return String(value).slice(0, 1600);
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function summarizeReasoningText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Analysis complete";
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

async function ensureModelEndpointReachable<T>(
  model: { providerId: string; modelId: string; url?: string; apiKey?: string },
  request: Pick<ConstructAgentRuntimeRequest<T>, "purpose" | "onTrace">
): Promise<void> {
  await aiGateway.preflightModelEndpoint({ model, purpose: request.purpose, trace: request.onTrace });
}

function stringifyForTrace(value: unknown): string {
  try {
    const rendered = JSON.stringify(value, null, 2);
    if (!rendered) {
      return String(value);
    }
    return rendered.length > 80_000 ? `${rendered.slice(0, 80_000)}\n... [truncated]` : rendered;
  } catch {
    return String(value);
  }
}

function renderRuntimeInputForLog(request: ConstructAgenticRuntimeRequest): string {
  if (!request.messages?.length) return request.prompt;
  return request.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");
}

function describeSchema(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodDate) return "date";
  if (schema instanceof z.ZodEnum) return { enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { literal: schema.value };
  if (schema instanceof z.ZodArray) return [describeSchema(schema.element)];
  if (schema instanceof z.ZodOptional) return { optional: describeSchema(schema.unwrap()) };
  if (schema instanceof z.ZodNullable) return { nullable: describeSchema(schema.unwrap()) };
  if (schema instanceof z.ZodDefault) return { default: describeSchema(schema.removeDefault()) };
  if (schema instanceof z.ZodRecord) return { record: describeSchema(schema.valueSchema) };
  if (schema instanceof z.ZodUnion) return { union: schema.options.map((option: z.ZodTypeAny) => describeSchema(option)) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, describeSchema(value)])
    );
  }
  return schema.constructor?.name || "unknown";
}

function enhancePromptForJsonOutput(prompt: string, schema: z.ZodTypeAny): string {
  const schemaDescription = JSON.stringify(describeSchema(schema), null, 2);
  return `${prompt}

IMPORTANT: Your response MUST be valid JSON only. Do not include any other text, explanations, markdown formatting, or code blocks. Your entire response must be parseable JSON that matches this schema:
${schemaDescription}

Begin your response with { and end with }. No other text before or after.`;
}
