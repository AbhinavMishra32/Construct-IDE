import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { z } from "zod";

import { resolveConstructAgentModel, type ConstructAgentModel } from "./constructAgentModels";
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
    const model = resolveConstructAgentModel(request.purpose, request.featureId);
    request.onTrace?.({
      title: "Agent request",
      level: "debug",
      detail: [
        `id: ${request.id}`,
        `name: ${request.name}`,
        `purpose: ${request.purpose}`,
        request.featureId ? `featureId: ${request.featureId}` : null,
        `maxRetries: ${request.maxRetries ?? 1}`,
        `provider: ${model.providerId}`,
        `model: ${model.modelId}`
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

    if (model.providerId === "openrouter") {
      return this.generateStructuredViaOpenRouterStream(request, model);
    }

    const agent = new Agent({
      id: request.id,
      name: request.name,
      instructions: request.instructions,
      model,
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

  private async generateStructuredViaOpenRouterStream<T>(
    request: ConstructAgentRuntimeRequest<T>,
    model: ConstructAgentModel
  ): Promise<T> {
    request.onTrace?.({
      title: "OpenRouter streaming",
      level: "info",
      detail: `Streaming enabled for ${model.modelId}`
    });

    const response = await fetch(`${(model.url || "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${model.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model.modelId,
        stream: true,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              request.instructions,
              "",
              "Return only valid JSON.",
              "Do not wrap the JSON in markdown fences.",
              "Follow this schema shape exactly:",
              JSON.stringify(describeSchema(request.schema), null, 2)
            ].join("\n")
          },
          {
            role: "user",
            content: request.prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 1200);
      throw new Error(`OpenRouter streaming request failed (${response.status}): ${detail}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenRouter stream did not provide a readable body.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let streamedChars = 0;
    let lastPreviewAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: Record<string, unknown>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            text += content;
            streamedChars += content.length;
            if (streamedChars - lastPreviewAt >= 160) {
              lastPreviewAt = streamedChars;
              request.onTrace?.({
                title: "Streaming progress",
                level: "debug",
                detail: text.slice(-600)
              });
            }
          }

          if (parsed.usage) {
            request.onTrace?.({
              title: "Streaming usage",
              level: "debug",
              detail: stringifyForTrace(parsed.usage)
            });
          }
        } catch {
          // Ignore malformed chunks and continue reading the stream.
        }
      }
    }

    request.onTrace?.({
      title: "Raw streamed output",
      level: "debug",
      detail: text
    });

    const jsonText = extractJsonObject(text);
    const parsedObject = JSON.parse(jsonText) as unknown;
    request.onTrace?.({
      title: "Parsed streamed JSON",
      level: "debug",
      detail: stringifyForTrace(parsedObject)
    });

    const validated = request.schema.parse(parsedObject);
    request.onTrace?.({
      title: "Validated structured result",
      level: "debug",
      detail: stringifyForTrace(validated)
    });
    return validated;
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

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  throw new Error("Streaming response did not contain a JSON object.");
}
