import type { AiProvider, AiSettings } from "../../types";

/**
 * Construct's AI settings, read as the provider inventory a settings screen
 * actually wants to draw.
 *
 * `AiSettings` is a flat bag — one API key field, one model field and one base
 * URL per vendor, plus a `source`/`provider` pair naming the active one. That
 * shape is right for the runtime, which only ever asks "which model do I call",
 * and wrong for a list of providers, which needs to ask each one whether it is
 * connected and what it can run. This module is the one place that translation
 * happens, so the page below never reaches into the settings bag directly.
 */

/** Which vendors appear in the list, in the order the list shows them. */
export const CONSTRUCT_PROVIDER_ORDER = [
  "construct-cloud",
  "openai",
  "openrouter",
  "opencode-zen",
  "github-copilot",
  "litellm",
] as const;

export type ConstructProviderId = (typeof CONSTRUCT_PROVIDER_ORDER)[number];

/**
 * How a provider authenticates, which is also how the connect menu groups them.
 *
 * `subscription` is an account you sign into, `api-key` is a secret you paste,
 * `custom` is an endpoint you point at. The distinction is not cosmetic: it
 * decides what the connect dialog asks for.
 */
export type ConstructProviderKind = "subscription" | "api-key" | "custom";

export type ConstructProvider = {
  id: ConstructProviderId;
  name: string;
  kind: ConstructProviderKind;
  /** Whether Construct currently holds what it needs to call this provider. */
  connected: boolean;
  /** The model this provider runs when it is the active one. */
  selectedModel: string;
  /** Which settings key holds that model, so a change writes to the right field. */
  modelKey: keyof AiSettings;
  /** Which settings key holds the secret, when the provider takes one. */
  apiKeyKey?: keyof AiSettings;
  /** Which settings key holds the endpoint, when the provider allows one. */
  baseUrlKey?: keyof AiSettings;
  /** Where to go to mint a key, for the providers that have such a page. */
  keyUrl?: string;
  /** One line naming what this provider is, shown under its name. */
  detail: string;
};

const CATALOGUE: Array<Omit<ConstructProvider, "connected" | "selectedModel">> = [
  {
    id: "construct-cloud",
    name: "Construct Cloud",
    kind: "subscription",
    modelKey: "constructCloudModel",
    baseUrlKey: "constructCloudBaseUrl",
    detail: "Hosted compute on your Construct account",
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "api-key",
    modelKey: "openAiModel",
    apiKeyKey: "openAiApiKey",
    baseUrlKey: "openAiBaseUrl",
    keyUrl: "https://platform.openai.com/api-keys",
    detail: "Direct API access",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "api-key",
    modelKey: "openRouterModel",
    apiKeyKey: "openRouterApiKey",
    baseUrlKey: "openRouterBaseUrl",
    keyUrl: "https://openrouter.ai/keys",
    detail: "One key across many vendors",
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    kind: "api-key",
    modelKey: "opencodeZenModel",
    apiKeyKey: "opencodeZenApiKey",
    baseUrlKey: "opencodeZenBaseUrl",
    detail: "Direct API access",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    kind: "subscription",
    modelKey: "githubCopilotModel",
    detail: "Imported from your OpenCode sign-in",
  },
  {
    id: "litellm",
    name: "LiteLLM",
    kind: "custom",
    modelKey: "liteLlmModel",
    apiKeyKey: "liteLlmApiKey",
    baseUrlKey: "liteLlmBaseUrl",
    detail: "Your own proxy endpoint",
  },
];

const stringAt = (settings: AiSettings, key: keyof AiSettings | undefined): string =>
  key ? String(settings[key] ?? "") : "";

/**
 * Whether a provider is usable right now.
 *
 * A key-based provider is connected once it holds a secret. Construct Cloud needs
 * its access token. Copilot has no secret of its own — its credentials arrive
 * through the OpenCode import — so a chosen model is the only evidence available
 * that the import happened, and the alternative (showing it as permanently
 * disconnected) would be a worse lie than treating the model as the signal.
 */
function isConnected(provider: Omit<ConstructProvider, "connected" | "selectedModel">, settings: AiSettings): boolean {
  if (provider.id === "construct-cloud") return stringAt(settings, "constructCloudAccessToken").trim().length > 0;
  if (provider.id === "github-copilot") return stringAt(settings, provider.modelKey).trim().length > 0;
  if (provider.apiKeyKey) return stringAt(settings, provider.apiKeyKey).trim().length > 0;
  return false;
}

export function constructProviders(settings: AiSettings): ConstructProvider[] {
  return CATALOGUE.map((entry) => ({
    ...entry,
    connected: isConnected(entry, settings),
    selectedModel: stringAt(settings, entry.modelKey),
  }));
}

/** Which provider the agent calls today. */
export function activeConstructProviderId(settings: AiSettings): ConstructProviderId {
  return settings.source === "construct-cloud" ? "construct-cloud" : (settings.provider as ConstructProviderId);
}

/**
 * The settings patch that makes a provider the active one.
 *
 * `featureModels` is cleared deliberately: those are per-feature overrides
 * pinned to whatever provider was active when they were set, and carrying them
 * across a provider switch is how you end up with a model id that the new
 * provider has never heard of.
 */
export function selectProviderPatch(provider: ConstructProvider, model: string): Partial<AiSettings> {
  if (provider.id === "construct-cloud") {
    return { source: "construct-cloud", featureModels: {}, constructCloudModel: model };
  }
  return {
    source: "byok",
    provider: provider.id as AiProvider,
    featureModels: {},
    [provider.modelKey]: model,
  } as Partial<AiSettings>;
}

/** The patch that forgets a provider's credentials. */
export function disconnectProviderPatch(provider: ConstructProvider): Partial<AiSettings> {
  if (provider.id === "construct-cloud") return { constructCloudAccessToken: "" };
  if (provider.apiKeyKey) return { [provider.apiKeyKey]: "" } as Partial<AiSettings>;
  // Copilot carries no secret of its own, so forgetting it means forgetting the
  // model that was the only evidence it had been imported.
  return { [provider.modelKey]: "" } as Partial<AiSettings>;
}

/** The provider argument `listModels` expects for this row. */
export function modelLookupProvider(provider: ConstructProvider): string {
  return provider.id;
}

/** The secret `listModels` needs to enumerate this provider's catalogue. */
export function apiKeyFor(provider: ConstructProvider, settings: AiSettings): string {
  if (provider.id === "construct-cloud") return stringAt(settings, "constructCloudAccessToken");
  return stringAt(settings, provider.apiKeyKey);
}
