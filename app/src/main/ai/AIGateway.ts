import { randomUUID } from "node:crypto";

import type { ConstructAiFeatureId } from "../constructAiFeatures";
import {
  resolveConstructLlmModel,
  resolveConstructOpenAiResponsesConfig,
  type ConstructAgentModel
} from "../constructAgentModels";
import { resolveConstructAiSettings } from "../constructAiSettings";

export type AIGatewayTraceSink = (entry: {
  title: string;
  detail: string;
  level?: "info" | "warn" | "error" | "debug";
  payload?: unknown;
}) => void;

export type AIGatewayFetchResult = {
  model: ConstructAgentModel;
  requestId: string;
  response: Response;
};

class ConstructAIGateway {
  async resolveModel(purpose: string, featureId?: ConstructAiFeatureId): Promise<ConstructAgentModel> {
    return resolveConstructLlmModel(purpose, featureId);
  }

  async chatCompletions(input: {
    body: Record<string, unknown>;
    featureId?: ConstructAiFeatureId;
    idempotencyKey?: string;
    purpose: string;
    signal?: AbortSignal;
    trace?: AIGatewayTraceSink;
  }): Promise<AIGatewayFetchResult> {
    const model = await this.resolveModel(input.purpose, input.featureId);
    await this.preflightModelEndpoint({ model, purpose: input.purpose, trace: input.trace });
    const requestId = randomUUID();
    const baseUrl = model.url?.replace(/\/$/, "");
    if (!baseUrl) {
      throw new Error(`No base URL is configured for ${model.providerId}.`);
    }

    input.trace?.({
      title: "AI gateway request",
      level: "debug",
      detail: `${model.providerId} | ${model.modelId} | ${input.featureId ?? "default"}`,
      payload: {
        featureId: input.featureId,
        model: model.modelId,
        provider: model.providerId,
        requestId,
        source: resolveConstructAiSettings().source
      }
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
        "Content-Type": "application/json",
        "x-construct-request-id": requestId,
        ...(input.idempotencyKey ? { "x-construct-idempotency-key": input.idempotencyKey } : {}),
        ...(input.featureId ? { "x-construct-feature-id": input.featureId } : {})
      },
      body: JSON.stringify({
        ...input.body,
        model: model.modelId
      }),
      signal: input.signal
    });

    return { model, requestId, response };
  }

  resolveOpenAiResponses(featureId?: ConstructAiFeatureId) {
    return resolveConstructOpenAiResponsesConfig(featureId);
  }

  async openAiResponses(input: {
    body: Record<string, unknown>;
    featureId?: ConstructAiFeatureId;
    purpose: string;
    signal?: AbortSignal;
    trace?: AIGatewayTraceSink;
  }): Promise<{ config: NonNullable<ReturnType<typeof resolveConstructOpenAiResponsesConfig>>; requestId: string; response: Response }> {
    const config = this.resolveOpenAiResponses(input.featureId);
    if (!config) {
      throw new Error("OpenAI Responses is not configured for BYOK web research.");
    }
    const requestId = randomUUID();
    input.trace?.({
      title: "AI gateway responses request",
      level: "debug",
      detail: `openai | ${config.model} | ${input.featureId ?? "default"}`,
      payload: {
        featureId: input.featureId,
        model: config.model,
        provider: "openai",
        requestId,
        source: "byok"
      }
    });

    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "x-construct-request-id": requestId,
        ...(input.featureId ? { "x-construct-feature-id": input.featureId } : {})
      },
      body: JSON.stringify({
        ...input.body,
        model: config.model
      }),
      signal: input.signal
    });

    return { config, requestId, response };
  }

  async preflightModelEndpoint(input: {
    model: ConstructAgentModel;
    purpose: string;
    trace?: AIGatewayTraceSink;
  }): Promise<void> {
    if (input.model.providerId === "construct-cloud") {
      await preflightConstructCloudModel(input.model, input.purpose, input.trace);
      return;
    }

    if (!isLiteLlmBackedProvider(input.model.providerId)) {
      return;
    }

    const baseUrl = input.model.url?.trim();
    if (!baseUrl) {
      throw new Error(`LiteLLM base URL is required for ${input.purpose}.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
    try {
      const response = await fetch(modelsUrl, {
        method: "GET",
        headers: input.model.apiKey ? { Authorization: `Bearer ${input.model.apiKey}` } : undefined,
        signal: controller.signal
      });
      input.trace?.({
        title: "AI gateway provider preflight",
        level: response.ok || response.status === 401 || response.status === 403 ? "debug" : "warn",
        detail: `GET ${modelsUrl} returned ${response.status}.`,
        payload: {
          model: input.model.modelId,
          provider: input.model.providerId,
          status: response.status,
          url: modelsUrl
        }
      });
    } catch (error) {
      const cause = error instanceof Error && error.name === "AbortError"
        ? "request timed out"
        : error instanceof Error && error.message
          ? error.message
          : String(error);
      throw new Error(
        `LiteLLM proxy is unreachable at ${baseUrl}. Start LiteLLM or update Settings > AI > LiteLLM Proxy. Model "${input.model.modelId}" cannot run until the proxy is reachable. (${cause})`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  traceProviderCall(input: {
    featureId?: ConstructAiFeatureId;
    model: ConstructAgentModel;
    phase: "start" | "complete" | "error";
    purpose: string;
    trace?: AIGatewayTraceSink;
  }): void {
    input.trace?.({
      title: input.phase === "start" ? "AI gateway provider call" : input.phase === "complete" ? "AI gateway provider completed" : "AI gateway provider failed",
      level: input.phase === "error" ? "error" : "debug",
      detail: `${input.model.providerId} | ${input.model.modelId} | ${input.purpose}`,
      payload: {
        featureId: input.featureId,
        model: input.model.modelId,
        phase: input.phase,
        provider: input.model.providerId
      }
    });
  }
}

export const aiGateway = new ConstructAIGateway();

function isLiteLlmBackedProvider(providerId: string): boolean {
  return providerId === "github-copilot" || providerId === "litellm";
}

async function preflightConstructCloudModel(
  model: ConstructAgentModel,
  purpose: string,
  trace?: AIGatewayTraceSink
): Promise<void> {
  const baseUrl = model.url?.trim();
  if (!baseUrl) {
    throw new Error(`Construct Cloud base URL is required for ${purpose}.`);
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
    if (!response.ok) {
      throw new Error(`model catalog returned ${response.status}`);
    }

    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const available = new Set((payload.data ?? [])
      .map((entry) => typeof entry.id === "string" ? entry.id : "")
      .filter(Boolean));

    trace?.({
      title: "Construct Cloud model preflight",
      level: available.has(model.modelId) ? "debug" : "error",
      detail: `GET ${modelsUrl} returned ${available.size} available models.`,
      payload: {
        model: model.modelId,
        provider: model.providerId,
        url: modelsUrl
      }
    });

    if (!available.has(model.modelId)) {
      throw new Error(`Construct Cloud model "${model.modelId}" is not available. Open Settings > AI, search Construct Cloud models, and choose one from the list.`);
    }
  } catch (error) {
    const cause = error instanceof Error && error.name === "AbortError"
      ? "request timed out"
      : error instanceof Error && error.message
        ? error.message
        : String(error);
    if (cause.startsWith("Construct Cloud model")) {
      throw new Error(cause);
    }
    throw new Error(`Construct Cloud model catalog is unreachable at ${baseUrl}. ${purpose} cannot run until available models are loaded. (${cause})`);
  } finally {
    clearTimeout(timeout);
  }
}
