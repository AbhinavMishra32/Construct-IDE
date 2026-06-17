import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { resolveConstructLlmModel } from "./constructAgentModels";
import type { ConstructAiFeatureId } from "./constructAiFeatures";
import { resolveConstructAiSettings } from "./constructAiSettings";
import type { ConstructAgentRunEvent } from "../shared/constructLearning";

export type ConstructAgentTools = ToolsInput;

export type ConstructAgentRuntimeRequest<T> = {
  id: string;
  featureId?: ConstructAiFeatureId;
  name: string;
  purpose: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  tools?: ConstructAgentTools;
  maxRetries?: number;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  onTrace?: (entry: ConstructAgentTraceEntry<T>) => void;
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
}

class MastraConstructAgentRuntime implements ConstructAgentRuntime {
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

    const model = await resolveConstructLlmModel(request.purpose, request.featureId);
    request.onTrace?.({
      title: "Resolved agent model",
      level: "debug",
      detail: [
        `provider: ${model.providerId}`,
        `model: ${model.modelId}`,
        model.id ? `id: ${model.id}` : null,
        model.url ? `baseUrl: ${model.url}` : null
      ].filter(Boolean).join("\n"),
      payload: {
        provider: model.providerId,
        model: model.modelId,
        id: model.id,
        baseUrl: model.url
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
    try {
      const hasTools = request.tools && Object.keys(request.tools).length > 0;
      const runStartedAt = Date.now();
      const runEventId = outputEventId(request.id);
      const output = await agent.stream(request.prompt, {
        structuredOutput: {
          schema: request.schema,
          jsonPromptInjection: model.providerId === "opencode-zen"
        },
        abortSignal: request.abortSignal,
        maxSteps: request.maxSteps ?? (hasTools ? 12 : 1),
        toolChoice: hasTools ? "auto" : undefined,
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

      const parsed = request.schema.parse(object);
      request.onTrace?.({
        title: "Validated structured result",
        level: "debug",
        detail: stringifyForTrace(parsed),
        payload: parsed
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
      throw error;
    }
  }

  private async observeStream<T>(
    stream: { getReader: () => { read: () => Promise<{ done?: boolean; value?: unknown }>; releaseLock?: () => void } },
    request: ConstructAgentRuntimeRequest<T>,
    runStartedAt: number,
    runEventId: string
  ): Promise<void> {
    const reasoning = new Map<string, {
      event: ConstructAgentRunEvent;
      characterCount: number;
      lastPublishedAt: number;
    }>();
    const messages = new Map<string, {
      text: string;
      lastPublishedAt: number;
    }>();
    const pendingToolInputs = new Map<string, string>();
    const toolEvents = new Map<string, ConstructAgentRunEvent>();

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value: rawChunk } = await reader.read();
        if (done) {
          break;
        }
      const chunk = rawChunk as {
        type?: string;
        payload?: Record<string, unknown>;
        object?: Partial<T>;
      };

      if (chunk.type === "reasoning-start") {
        const id = stringField(chunk.payload, "id") ?? `${runEventId}:reasoning`;
        const event: ConstructAgentRunEvent = {
          id,
          type: "reasoning",
          status: "running",
          title: "Model reasoning stream",
          detail: "Receiving reasoning activity from the model",
          createdAt: new Date().toISOString()
        };
        reasoning.set(id, {
          event,
          characterCount: 0,
          lastPublishedAt: Date.now()
        });
        request.onTrace?.({
          title: "Agent analysis started",
          level: "debug",
          detail: event.detail ?? "",
          event,
          payload: { type: chunk.type, id }
        });
        continue;
      }

      if (chunk.type === "reasoning-delta") {
        const id = stringField(chunk.payload, "id") ?? `${runEventId}:reasoning`;
        const text = stringField(chunk.payload, "text") ?? "";
        const state = reasoning.get(id) ?? {
          event: {
            id,
            type: "reasoning" as const,
            status: "running" as const,
            title: "Model reasoning stream",
            detail: "Receiving reasoning activity from the model",
            createdAt: new Date().toISOString()
          },
          characterCount: 0,
          lastPublishedAt: 0
        };
        state.characterCount += text.length;
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
        const id = stringField(chunk.payload, "id");
        const state = id ? reasoning.get(id) : undefined;
        if (state) {
          state.event.status = "completed";
          state.event.detail = "Analysis complete";
          request.onTrace?.({
            title: "Agent analysis completed",
            level: "debug",
            detail: state.event.detail,
            event: state.event,
            payload: {
              type: chunk.type,
              id,
              characterCount: state.characterCount
            }
          });
        }
        continue;
      }

      if (chunk.type === "text-start") {
        const id = stringField(chunk.payload, "id") ?? `${runEventId}:message`;
        messages.set(id, { text: "", lastPublishedAt: 0 });
        request.onTrace?.({
          title: "Agent response started",
          level: "debug",
          detail: "",
          responseText: "",
          payload: { type: chunk.type, id }
        });
        continue;
      }

      if (chunk.type === "text-delta") {
        const id = stringField(chunk.payload, "id") ?? `${runEventId}:message`;
        const text = stringField(chunk.payload, "text") ?? "";
        const state = messages.get(id) ?? { text: "", lastPublishedAt: 0 };
        state.text += text;
        const now = Date.now();
        if (now - state.lastPublishedAt >= 50) {
          state.lastPublishedAt = now;
          request.onTrace?.({
            title: "Agent response streaming",
            level: "debug",
            detail: `${state.text.length} response characters received`,
            responseText: state.text
          });
        }
        messages.set(id, state);
        continue;
      }

      if (chunk.type === "text-end") {
        const id = stringField(chunk.payload, "id");
        const state = id ? messages.get(id) : undefined;
        if (state) {
          request.onTrace?.({
            title: "Agent response completed",
            level: "debug",
            detail: `${state.text.length} response characters received`,
            responseText: state.text,
            payload: {
              type: chunk.type,
              id,
              text: state.text
            }
          });
        }
        continue;
      }

      if (chunk.type === "tool-call-input-streaming-start") {
        const toolCallId = stringField(chunk.payload, "toolCallId");
        if (toolCallId) {
          pendingToolInputs.set(toolCallId, "");
          const toolName = stringField(chunk.payload, "toolName") ?? "tool";
          const event: ConstructAgentRunEvent = {
            id: toolCallId,
            type: "tool",
            status: "running",
            title: toolName,
            detail: "Preparing input",
            toolName,
            input: {},
            createdAt: new Date().toISOString()
          };
          toolEvents.set(toolCallId, event);
          request.onTrace?.({ title: "Agent tool input started", level: "debug", detail: toolName, event, payload: chunk });
        }
        continue;
      }

      if (chunk.type === "tool-call-delta") {
        const toolCallId = stringField(chunk.payload, "toolCallId");
        if (toolCallId) {
          pendingToolInputs.set(toolCallId, `${pendingToolInputs.get(toolCallId) ?? ""}${stringField(chunk.payload, "argsTextDelta") ?? ""}`);
          request.onTrace?.({
            title: "Agent tool input streaming",
            level: "debug",
            detail: stringField(chunk.payload, "toolName") ?? toolEvents.get(toolCallId)?.toolName ?? "tool",
            payload: {
              type: chunk.type,
              toolCallId,
              toolName: stringField(chunk.payload, "toolName"),
              inputLength: pendingToolInputs.get(toolCallId)?.length ?? 0
            }
          });
        }
        continue;
      }

      if (chunk.type === "tool-call") {
        const toolCallId = stringField(chunk.payload, "toolCallId") ?? `${runEventId}:tool`;
        const toolName = stringField(chunk.payload, "toolName") ?? "tool";
        const event: ConstructAgentRunEvent = {
          id: toolCallId,
          type: "tool",
          status: "running",
          title: toolName,
          detail: "Running",
          toolName,
          input: chunk.payload?.args ?? parseMaybeJson(pendingToolInputs.get(toolCallId)),
          createdAt: new Date().toISOString()
        };
        toolEvents.set(toolCallId, event);
        request.onTrace?.({ title: "Agent tool call streamed", level: "debug", detail: toolName, event, payload: chunk });
        continue;
      }

      if (chunk.type === "tool-result" || chunk.type === "tool-error") {
        const toolCallId = stringField(chunk.payload, "toolCallId") ?? `${runEventId}:tool`;
        const toolName = stringField(chunk.payload, "toolName") ?? "tool";
        const existing = toolEvents.get(toolCallId);
        const event: ConstructAgentRunEvent = {
          id: toolCallId,
          type: "tool",
          status: chunk.type === "tool-error" ? "error" : "completed",
          title: toolName,
          detail: chunk.type === "tool-error" ? "Failed" : "Completed",
          toolName,
          input: existing?.input ?? chunk.payload?.args,
          outputPreview: previewUnknown(chunk.type === "tool-error" ? chunk.payload?.error : chunk.payload?.result),
          createdAt: existing?.createdAt ?? new Date().toISOString()
        };
        toolEvents.set(toolCallId, event);
        request.onTrace?.({ title: "Agent tool result streamed", level: chunk.type === "tool-error" ? "error" : "debug", detail: toolName, event, payload: chunk });
        continue;
      }

      const partialObject = chunk.type === "network-object"
        ? (chunk.payload?.object as Partial<T> | undefined)
        : chunk.object;
      if ((chunk.type === "object" || chunk.type === "network-object") && partialObject) {
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
  }
}

let runEventSequence = 0;

function outputEventId(agentId: string): string {
  runEventSequence += 1;
  return `${agentId}-${Date.now()}-${runEventSequence}`;
}

function iterationDetail(iteration: ConstructAgentIteration): string {
  const toolCallCount = iteration.toolCalls.length;
  const toolResultCount = iteration.toolResults.length;
  if (toolCallCount > 0 || toolResultCount > 0) {
    return [
      toolCallCount > 0 ? `${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}` : null,
      toolResultCount > 0 ? `${toolResultCount} result${toolResultCount === 1 ? "" : "s"}` : null,
      iteration.isFinal ? "final step" : null
    ].filter(Boolean).join(" · ");
  }
  return iteration.isFinal ? `Final step · ${iteration.finishReason}` : `Step ${iteration.iteration} · ${iteration.finishReason}`;
}

function stringField(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
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
    return JSON.stringify(value, null, 2).slice(0, 1600);
  } catch {
    return String(value).slice(0, 1600);
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

async function ensureModelEndpointReachable<T>(
  model: { providerId: string; modelId: string; url?: string; apiKey?: string },
  request: ConstructAgentRuntimeRequest<T>
): Promise<void> {
  if (!isLiteLlmBackedProvider(model.providerId)) {
    return;
  }

  const baseUrl = model.url?.trim();
  if (!baseUrl) {
    throw new Error(`LiteLLM base URL is required for ${request.purpose}.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : undefined,
      signal: controller.signal
    });
    request.onTrace?.({
      title: "LiteLLM proxy preflight",
      level: response.ok || response.status === 401 || response.status === 403 ? "debug" : "warn",
      detail: `GET ${modelsUrl} returned ${response.status}.`,
      payload: {
        url: modelsUrl,
        status: response.status,
        model: model.modelId,
        provider: model.providerId
      }
    });
  } catch (error) {
    const cause = error instanceof Error && error.name === "AbortError"
      ? "request timed out"
      : error instanceof Error && error.message
        ? error.message
        : String(error);
    throw new Error(
      `LiteLLM proxy is unreachable at ${baseUrl}. Start LiteLLM or update Settings > AI > LiteLLM Proxy. Model "${model.modelId}" cannot run until the proxy is reachable. (${cause})`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isLiteLlmBackedProvider(providerId: string): boolean {
  return providerId === "litellm" || providerId === "github-copilot";
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
