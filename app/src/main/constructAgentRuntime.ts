import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { z } from "zod";

import { resolveConstructAgentModel } from "./constructAgentModels";
import type { ConstructAiFeatureId } from "./constructAiFeatures";

export type ConstructAgentRuntimeRequest<T> = {
  id: string;
  featureId?: ConstructAiFeatureId;
  name: string;
  purpose: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxRetries?: number;
  onTrace?: (entry: ConstructAgentTraceEntry) => void;
};

export type ConstructAgentRuntime = {
  generateStructured<T>(request: ConstructAgentRuntimeRequest<T>): Promise<T>;
};

export type ConstructAgentTraceEntry = {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
};

export function createConstructAgentRuntime(): ConstructAgentRuntime {
  const runtime = (process.env.CONSTRUCT_AGENT_RUNTIME ?? "mastra").trim().toLowerCase();

  switch (runtime) {
    case "mastra":
      return new MastraConstructAgentRuntime();
    default:
      throw new Error(`Unsupported CONSTRUCT_AGENT_RUNTIME "${runtime}". Available runtime: mastra.`);
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
      ].filter(Boolean).join("\n")
    });
    request.onTrace?.({
      title: "Agent instructions",
      level: "debug",
      detail: request.instructions
    });
    request.onTrace?.({
      title: "Agent prompt",
      level: "debug",
      detail: request.prompt
    });
    request.onTrace?.({
      title: "Structured schema",
      level: "debug",
      detail: stringifyForTrace(describeSchema(request.schema))
    });

    const agent = new Agent({
      id: request.id,
      name: request.name,
      instructions: request.instructions,
      model: resolveConstructAgentModel(request.purpose, request.featureId),
      maxRetries: request.maxRetries ?? 1
    });

    new Mastra({ agents: { [request.id]: agent }, logger: false });
    try {
      const output = await agent.generate(request.prompt, {
        structuredOutput: { schema: request.schema }
      });

      request.onTrace?.({
        title: "Raw structured output",
        level: "debug",
        detail: stringifyForTrace(output.object)
      });

      const parsed = request.schema.parse(output.object);
      request.onTrace?.({
        title: "Validated structured result",
        level: "debug",
        detail: stringifyForTrace(parsed)
      });
      return parsed;
    } catch (error) {
      request.onTrace?.({
        title: "Agent runtime error",
        level: "error",
        detail: error instanceof Error ? error.stack || error.message : String(error)
      });
      throw error;
    }
  }
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
