import { resolveConstructAiSettings } from "./constructAiSettings";
import { modelForAiFeature, type ConstructAiFeatureId } from "./constructAiFeatures";

export type ConstructAgentModel = {
  providerId: "openai" | "openrouter";
  modelId: string;
  url?: string;
  apiKey: string;
};

export function resolveConstructAgentModel(purpose: string, featureId?: ConstructAiFeatureId): ConstructAgentModel {
  const settings = resolveConstructAiSettings();
  const openRouter = settings.provider === "openrouter";
  const apiKey = openRouter ? settings.openRouterApiKey : settings.openAiApiKey;

  if (!apiKey) {
    throw new Error(openRouter
      ? `OpenRouter API key is required for ${purpose}.`
      : `OpenAI API key is required for ${purpose}.`);
  }

  if (openRouter) {
    return {
      providerId: "openrouter",
      modelId: featureId ? modelForAiFeature(settings, featureId) : (settings.openRouterModel || "openai/gpt-5-mini"),
      url: process.env.CONSTRUCT_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      apiKey
    };
  }

  return {
    providerId: "openai",
    modelId: featureId ? modelForAiFeature(settings, featureId) : (settings.openAiModel || "gpt-5-mini"),
    url: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(),
    apiKey
  };
}

export function resolveConstructOpenAiResponsesConfig(featureId?: ConstructAiFeatureId): { apiKey: string; baseUrl: string; model: string } | null {
  const settings = resolveConstructAiSettings();
  const apiKey = settings.openAiApiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.CONSTRUCT_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: featureId ? modelForAiFeature(settings, featureId) : (settings.openAiModel || "gpt-5-mini")
  };
}
