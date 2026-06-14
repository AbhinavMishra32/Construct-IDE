import {
  context,
  register,
  setMetadata,
  setSession,
  traceAgent,
  type NodeTracerProvider
} from "@arizeai/phoenix-otel";

import type { StoredSettings } from "../config/constructConfig";

export type ConstructAgentTraceMetadata = Record<string, string | number | boolean | null | undefined>;

export class ConstructObservabilityService {
  private provider: NodeTracerProvider | null = null;
  private enabled = false;

  configure(settings: StoredSettings): void {
    this.enabled = settings.observability.enabled;

    if (!this.enabled) {
      return;
    }

    try {
      this.provider = register({
        projectName: settings.observability.phoenixProjectName,
        url: settings.observability.phoenixEndpoint,
        apiKey: settings.observability.phoenixApiKey || undefined,
        batch: settings.observability.batch,
        headers: {
          "x-client-name": "construct",
          "x-client-version": settings.releaseVersion
        }
      });
      console.log("[construct observability] Phoenix tracing enabled", {
        projectName: settings.observability.phoenixProjectName,
        endpoint: settings.observability.phoenixEndpoint,
        batch: settings.observability.batch
      });
    } catch (error) {
      this.enabled = false;
      this.provider = null;
      console.warn("[construct observability] Phoenix tracing disabled after setup failure", error);
    }
  }

  async shutdown(): Promise<void> {
    const provider = this.provider;
    this.provider = null;
    this.enabled = false;

    if (!provider) {
      return;
    }

    try {
      await provider.shutdown();
    } catch (error) {
      console.warn("[construct observability] Failed to shut down Phoenix tracer provider", error);
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

    const traced = traceAgent(operation, { name });
    const active = context.active();
    const sessionId = typeof metadata.projectId === "string"
      ? `project:${metadata.projectId}`
      : "construct";

    return context.with(
      setMetadata(
        setSession(active, { sessionId }),
        compactMetadata(metadata)
      ),
      traced
    );
  }
}

function compactMetadata(metadata: ConstructAgentTraceMetadata): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string | number | boolean] => {
      return typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean";
    })
  );
}
