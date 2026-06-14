import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { resolveConstructAgentModel } from "./constructAgentModels";
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
  completionGuard?: (iteration: ConstructAgentIteration) => { continue?: boolean; feedback?: string } | void;
  onTrace?: (entry: ConstructAgentTraceEntry) => void;
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

export type ConstructAgentTraceEntry = {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
  payload?: unknown;
  event?: ConstructAgentRunEvent;
};

export function createConstructAgentRuntime(): ConstructAgentRuntime {
  const runtime = resolveConstructAiSettings().runtime;

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

    const model = resolveConstructAgentModel(request.purpose, request.featureId);
    request.onTrace?.({
      title: "Resolved agent model",
      level: "debug",
      detail: [
        `provider: ${model.providerId}`,
        `model: ${model.modelId}`,
        model.url ? `baseUrl: ${model.url}` : null
      ].filter(Boolean).join("\n"),
      payload: {
        provider: model.providerId,
        model: model.modelId,
        baseUrl: model.url
      }
    });

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
      const availableToolNames = new Set(Object.keys(request.tools ?? {}));
      const runStartedAt = Date.now();
      const output = await agent.generate(request.prompt, {
        structuredOutput: {
          schema: request.schema,
          model
        },
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
            id: `${outputEventId(request.id)}:iteration:${iteration.iteration}`,
            type: "iteration",
            status: "completed",
            title: iterationTitle(normalized, availableToolNames),
            detail: iterationDetail(normalized, availableToolNames),
            iteration: iteration.iteration,
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

          const guarded = request.completionGuard?.(normalized);
          if (guarded) return guarded;
          if (iteration.isFinal && deferredWorkPromise(iteration.text)) {
            return {
              continue: true,
              feedback: "Your response only promises future inspection or action. Complete that work in this run: call whichever tools are useful, inspect their results, and then return the final structured learner response."
            };
          }
        }
      });

      request.onTrace?.({
        title: "Raw structured output",
        level: "debug",
        detail: stringifyForTrace(output.object),
        payload: output.object
      });

      const finishEvent: ConstructAgentRunEvent = {
        id: `${outputEventId(request.id)}:finish`,
        type: "iteration",
        status: "completed",
        title: "Prepared the response",
        detail: `${output.steps.length} model step${output.steps.length === 1 ? "" : "s"} completed in ${formatDuration(Date.now() - runStartedAt)}.`,
        iteration: output.steps.length,
        createdAt: new Date().toISOString()
      };
      request.onTrace?.({
        title: "Agent run completed",
        level: "debug",
        detail: finishEvent.detail ?? finishEvent.title,
        event: finishEvent,
        payload: {
          stepCount: output.steps.length,
          finishReason: output.finishReason,
          totalUsage: output.totalUsage,
          durationMs: Date.now() - runStartedAt
        }
      });

      const parsed = request.schema.parse(output.object);
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
}

let runEventSequence = 0;

function outputEventId(agentId: string): string {
  runEventSequence += 1;
  return `${agentId}-${Date.now()}-${runEventSequence}`;
}

function deferredWorkPromise(text: string): boolean {
  return /\b(?:let me|i(?:'|’)ll|i will|before i .*?let me|i need to)\s+(?:check|inspect|look|read|review|find|search|add|create|open|verify)\b/i.test(text);
}

function iterationTitle(iteration: ConstructAgentIteration, availableToolNames: Set<string>): string {
  const toolCalls = iteration.toolCalls.filter((call) => availableToolNames.has(call.name));
  if (toolCalls.length > 0) {
    return `Used ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`;
  }
  if (iteration.isFinal) return "Formed the final response";
  if (iteration.toolCalls.length > 0) return "Organized the structured response";
  return "Reviewed the available context";
}

function iterationDetail(iteration: ConstructAgentIteration, availableToolNames: Set<string>): string {
  const toolCalls = iteration.toolCalls.filter((call) => availableToolNames.has(call.name));
  if (toolCalls.length > 0) {
    return toolCalls.map((call) => call.name).join(", ");
  }
  if (iteration.toolResults.length > 0) {
    return `Reviewed ${iteration.toolResults.length} tool result${iteration.toolResults.length === 1 ? "" : "s"}.`;
  }
  return `Iteration ${iteration.iteration} finished with ${iteration.finishReason}.`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
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
