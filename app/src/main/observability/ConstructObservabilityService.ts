import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  startActiveObservation,
  type LangfuseAgent,
  type LangfuseGeneration,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { StoredSettings } from "../config/constructConfig";

export type ConstructAgentTraceMetadata = Record<string, string | number | boolean | null | undefined>;
export type ConstructGenerationTraceUsage = Record<string, number>;

export type ConstructGenerationTraceInput = {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  model: string;
  modelParameters?: Record<string, string | number>;
  provider: string;
  usageDetails?: ConstructGenerationTraceUsage;
};

export class ConstructObservabilityService {
  private sdk: NodeSDK | null = null;
  private fingerprint = "";
  private enabled = false;
  private capturePayloads = true;

  async configure(settings: StoredSettings): Promise<void> {
    const observability = settings.observability;
    const publicKey = observability.langfusePublicKey || process.env.LANGFUSE_PUBLIC_KEY?.trim() || "";
    const secretKey = observability.langfuseSecretKey || process.env.LANGFUSE_SECRET_KEY?.trim() || "";
    const baseUrl = observability.langfuseBaseUrl || process.env.LANGFUSE_BASE_URL?.trim() || "http://localhost:3000";
    const environment = observability.langfuseEnvironment || process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || "development";
    const nextFingerprint = JSON.stringify({
      enabled: observability.enabled,
      publicKey,
      secretKey,
      baseUrl,
      batch: observability.batch,
      capturePayloads: observability.capturePayloads,
      environment,
      releaseVersion: settings.releaseVersion
    });

    if (nextFingerprint === this.fingerprint) {
      return;
    }

    await this.shutdown();
    this.fingerprint = nextFingerprint;
    this.capturePayloads = observability.capturePayloads;

    if (!observability.enabled) {
      return;
    }

    if (!publicKey || !secretKey) {
      console.warn("[construct observability] Langfuse tracing disabled because public and secret keys are required.");
      return;
    }

    try {
      this.sdk = new NodeSDK({
        spanProcessors: [
          new LangfuseSpanProcessor({
            publicKey,
            secretKey,
            baseUrl,
            environment,
            release: settings.releaseVersion,
            exportMode: observability.batch ? "batched" : "immediate",
            mediaUploadEnabled: false,
            additionalHeaders: {
              "x-client-name": "construct",
              "x-client-version": settings.releaseVersion
            },
            mask: ({ data }) => redactSensitiveTraceData(data)
          })
        ]
      });
      this.sdk.start();
      this.enabled = true;
      console.log("[construct observability] Langfuse tracing enabled", {
        projectName: observability.langfuseProjectName,
        baseUrl,
        environment,
        batch: observability.batch,
        capturePayloads: observability.capturePayloads
      });
    } catch (error) {
      this.enabled = false;
      this.sdk = null;
      console.warn("[construct observability] Langfuse tracing disabled after setup failure", error);
    }
  }

  async shutdown(): Promise<void> {
    const sdk = this.sdk;
    this.sdk = null;
    this.enabled = false;

    if (!sdk) {
      return;
    }

    try {
      await sdk.shutdown();
    } catch (error) {
      console.warn("[construct observability] Failed to shut down Langfuse tracer", error);
    }
  }

  traceAgentOperation<T>(
    name: string,
    metadata: ConstructAgentTraceMetadata,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const startedAt = Date.now();
    return startActiveObservation(
      name,
      async (span: LangfuseAgent) => {
        span.update({
          input: this.capturePayloads ? compactMetadata(metadata) : summarizePayload(metadata),
          metadata: {
            ...compactMetadata(metadata),
            traceKind: "agent-operation"
          }
        });

        try {
          const result = await operation();
          span.update({
            output: this.capturePayloads ? sanitizeTracePayload(result) : summarizePayload(result),
            metadata: {
              durationMs: Date.now() - startedAt,
              status: "completed"
            }
          });
          return result;
        } catch (error) {
          span.update({
            level: "ERROR",
            statusMessage: error instanceof Error ? error.message : String(error),
            output: errorToTraceOutput(error),
            metadata: {
              durationMs: Date.now() - startedAt,
              status: "failed"
            }
          });
          throw error;
        }
      },
      { asType: "agent" }
    ) as Promise<T>;
  }

  traceGeneration<T>(
    input: ConstructGenerationTraceInput,
    operation: (generation?: LangfuseGeneration) => Promise<T>
  ): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const startedAt = Date.now();
    return startActiveObservation(
      input.name,
      async (generation: LangfuseGeneration) => {
        generation.update({
          input: this.capturePayloads ? sanitizeTracePayload(input.input) : summarizePayload(input.input),
          model: input.model,
          modelParameters: input.modelParameters,
          usageDetails: input.usageDetails,
          metadata: sanitizeTracePayload({
            ...input.metadata,
            provider: input.provider,
            traceKind: "model-generation"
          }) as Record<string, unknown>
        });

        try {
          return await operation(generation);
        } catch (error) {
          generation.update({
            level: "ERROR",
            statusMessage: error instanceof Error ? error.message : String(error),
            output: errorToTraceOutput(error),
            metadata: {
              durationMs: Date.now() - startedAt,
              provider: input.provider,
              status: "failed"
            }
          });
          throw error;
        }
      },
      { asType: "generation" }
    ) as Promise<T>;
  }
}

export const constructObservabilityService = new ConstructObservabilityService();

function compactMetadata(metadata: ConstructAgentTraceMetadata): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string | number | boolean] => {
      return typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean";
    })
  );
}

export function updateGenerationSuccess(
  generation: LangfuseGeneration | undefined,
  input: {
    output?: unknown;
    metadata?: Record<string, unknown>;
    usageDetails?: ConstructGenerationTraceUsage;
  }
): void {
  generation?.update({
    output: sanitizeTracePayload(input.output),
    metadata: sanitizeTracePayload(input.metadata ?? {}) as Record<string, unknown>,
    usageDetails: input.usageDetails
  });
}

export function usageDetailsFrom(value: unknown): ConstructGenerationTraceUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const usage: ConstructGenerationTraceUsage = {};
  for (const [key, mappedKey] of [
    ["prompt_tokens", "promptTokens"],
    ["completion_tokens", "completionTokens"],
    ["total_tokens", "totalTokens"],
    ["input_tokens", "inputTokens"],
    ["output_tokens", "outputTokens"],
    ["promptTokens", "promptTokens"],
    ["completionTokens", "completionTokens"],
    ["totalTokens", "totalTokens"],
    ["inputTokens", "inputTokens"],
    ["outputTokens", "outputTokens"]
  ] as const) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      usage[mappedKey] = raw;
    }
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function errorToTraceOutput(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { error: String(error) };
}

function sanitizeTracePayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateTraceString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (depth > 8) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeTracePayload(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 120)) {
    if (isSensitiveTraceKey(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeTracePayload(raw, depth + 1);
  }
  return output;
}

function summarizePayload(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "string") return { kind: "string", length: value.length, preview: truncateTraceString(value, 300) };
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 30) };
  return { kind: typeof value, value };
}

function redactSensitiveTraceData(value: unknown): unknown {
  return sanitizeTracePayload(value);
}

function truncateTraceString(value: string, maxLength = 12_000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function isSensitiveTraceKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|bearer|password|secret|token|cookie|set-cookie|private[-_]?key|access[-_]?key)/i.test(key);
}
