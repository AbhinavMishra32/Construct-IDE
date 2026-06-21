import { resolveConstructAiSettings, type StoredAiSettings } from "./constructAiSettings";
import { modelForAiFeature, type ConstructAiFeatureId } from "./constructAiFeatures";

export type ConstructAgentModel = {
  providerId: string;
  modelId: string;
  id?: string;
  url?: string;
  apiKey?: string;
};

export function resolveConstructAgentModel(purpose: string, featureId?: ConstructAiFeatureId): ConstructAgentModel {
  return resolveConstructAgentModelFromSettings(resolveConstructAiSettings(), purpose, featureId);
}

export function resolveConstructAgentModelFromSettings(
  settings: StoredAiSettings,
  purpose: string,
  featureId?: ConstructAiFeatureId
): ConstructAgentModel {
  if (settings.source === "construct-cloud") {
    return resolveConstructCloudModelFromSettings(settings, purpose, featureId);
  }

  if (isLiteLlmBackedProvider(settings.provider)) {
    return resolveLiteLlmModelFromSettings(settings, purpose, featureId);
  }

  const directProvider = settings.provider; // "openai" | "openrouter" | "opencode-zen"

  const apiKey = directProvider === "openrouter" ? settings.openRouterApiKey
    : directProvider === "opencode-zen" ? settings.opencodeZenApiKey
    : settings.openAiApiKey;

  const baseUrl = directProvider === "openrouter" ? settings.openRouterBaseUrl
    : directProvider === "opencode-zen" ? settings.opencodeZenBaseUrl
    : settings.openAiBaseUrl;

  const defaultModel = directProvider === "openrouter" ? "deepseek/deepseek-v4-flash"
    : directProvider === "opencode-zen" ? "gpt-5.1-codex"
    : "gpt-5-mini";

  const modelKey = directProvider === "openrouter" ? settings.openRouterModel
    : directProvider === "opencode-zen" ? settings.opencodeZenModel
    : settings.openAiModel;

  if (directProvider !== "opencode-zen" && !apiKey) {
    throw new Error(directProvider === "openrouter"
      ? `OpenRouter API key is required for ${purpose}.`
      : `OpenAI API key is required for ${purpose}.`);
  }

  return {
    providerId: directProvider,
    modelId: featureId ? modelForAiFeature(settings, featureId) : (modelKey || defaultModel),
    url: baseUrl,
    apiKey: apiKey || undefined
  };
}

export async function resolveConstructLlmModel(purpose: string, featureId?: ConstructAiFeatureId): Promise<ConstructAgentModel> {
  return resolveConstructLlmModelFromSettings(resolveConstructAiSettings(), purpose, featureId);
}

export async function resolveConstructLlmModelFromSettings(
  settings: StoredAiSettings,
  purpose: string,
  featureId?: ConstructAiFeatureId
): Promise<ConstructAgentModel> {
  return resolveConstructAgentModelFromSettings(settings, purpose, featureId);
}

export function resolveConstructOpenAiResponsesConfig(featureId?: ConstructAiFeatureId): { apiKey: string; baseUrl: string; model: string } | null {
  return resolveConstructOpenAiResponsesConfigFromSettings(resolveConstructAiSettings(), featureId);
}

export function resolveConstructOpenAiResponsesConfigFromSettings(
  settings: StoredAiSettings,
  featureId?: ConstructAiFeatureId
): { apiKey: string; baseUrl: string; model: string } | null {
  if (settings.source !== "byok" || settings.provider !== "openai") return null;
  const apiKey = settings.openAiApiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: settings.openAiBaseUrl,
    model: featureId ? modelForAiFeature(settings, featureId) : (settings.openAiModel || "gpt-5-mini")
  };
}

function resolveConstructCloudModelFromSettings(
  settings: StoredAiSettings,
  purpose: string,
  featureId?: ConstructAiFeatureId
): ConstructAgentModel {
  const token = settings.constructCloudAccessToken.trim();
  if (!token) {
    throw new Error(`Construct Cloud access token is required for ${purpose}. Sign in or paste a desktop token in Settings.`);
  }

  const modelId = featureId ? modelForAiFeature(settings, featureId) : (settings.constructCloudModel || "deepseek/deepseek-v4-flash");

  return {
    providerId: "construct-cloud",
    modelId,
    id: modelId,
    url: constructCloudApiBaseUrl(settings.constructCloudBaseUrl),
    apiKey: token
  };
}

function isLiteLlmBackedProvider(provider: StoredAiSettings["provider"]): boolean {
  return provider === "github-copilot" || provider === "litellm";
}

function resolveLiteLlmModelFromSettings(
  settings: StoredAiSettings,
  purpose: string,
  featureId?: ConstructAiFeatureId
): ConstructAgentModel {
  const modelId = featureId ? modelForAiFeature(settings, featureId) : liteLlmModelForProvider(settings);
  if (!modelId) {
    throw new Error(`Select a LiteLLM model for ${purpose}.`);
  }

  return {
    providerId: settings.provider,
    modelId,
    id: modelId,
    url: settings.liteLlmBaseUrl,
    apiKey: settings.liteLlmApiKey || undefined
  };
}

function liteLlmModelForProvider(settings: StoredAiSettings): string {
  if (settings.provider === "github-copilot") return settings.githubCopilotModel?.trim() || "github_copilot/gpt-4";
  return settings.liteLlmModel?.trim() || "openai/gpt-5-mini";
}

function constructCloudApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}
