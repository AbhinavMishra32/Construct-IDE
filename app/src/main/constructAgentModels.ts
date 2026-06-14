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
      modelId: featureId ? modelForAiFeature(settings, featureId) : (settings.openRouterModel || "deepseek/deepseek-v4-flash"),
      url: settings.openRouterBaseUrl,
      apiKey
    };
  }

  return {
    providerId: "openai",
    modelId: featureId ? modelForAiFeature(settings, featureId) : (settings.openAiModel || "gpt-5-mini"),
    url: settings.openAiBaseUrl,
    apiKey
  };
}

export function resolveConstructOpenAiResponsesConfig(featureId?: ConstructAiFeatureId): { apiKey: string; baseUrl: string; model: string } | null {
  const settings = resolveConstructAiSettings();
  const apiKey = settings.openAiApiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: settings.openAiBaseUrl,
    model: featureId ? modelForAiFeature(settings, featureId) : (settings.openAiModel || "gpt-5-mini")
  };
}
