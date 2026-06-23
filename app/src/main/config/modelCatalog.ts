import type { AiProvider } from "./constructConfig";

export type ModelLookupProvider = AiProvider | "construct-cloud";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  providerId?: string | null;
  providerName?: string | null;
  subProvider?: string | null;
  description?: string | null;
  contextLength?: number | null;
  pricing?: string | null;
};

const RECOMMENDED_OPENCODE_ZEN_MODELS: ModelCatalogEntry[] = [
  { id: "gpt-5.1-codex", name: "GPT 5.1 Codex", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5.2-codex", name: "GPT 5.2 Codex", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5-nano", name: "GPT 5 Nano", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "opencode-zen", providerName: "OpenCode Zen" }
];

type LiteLlmModelInfo = {
  model_name?: string;
  litellm_params?: {
    model?: string;
  };
  model_info?: {
    id?: string;
    key?: string;
    mode?: string;
    litellm_provider?: string;
    max_tokens?: number;
    max_input_tokens?: number;
    max_output_tokens?: number;
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    description?: string;
  };
};

const LITELLM_PROXY_PROVIDERS = new Set<ModelLookupProvider>(["github-copilot", "litellm"]);

export async function fetchProviderModels(input: {
  provider: ModelLookupProvider;
  apiKey?: string;
  baseUrl: string;
}): Promise<ModelCatalogEntry[]> {
  if (input.provider === "construct-cloud") {
    return fetchConstructCloudModels(input.apiKey, input.baseUrl);
  }

  if (LITELLM_PROXY_PROVIDERS.has(input.provider)) {
    return fetchLiteLlmModels(input.provider, input.apiKey, input.baseUrl);
  }

  if (input.provider === "opencode-zen") {
    return fetchOpenCodeZenModels(input.apiKey, input.baseUrl);
  }

  if (!input.apiKey?.trim()) {
    throw new Error(`Enter a ${input.provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key first.`);
  }

  return input.provider === "openrouter"
    ? fetchOpenRouterModels(input.apiKey, input.baseUrl)
    : fetchOpenAiModels(input.apiKey, input.baseUrl);
}

async function fetchConstructCloudModels(apiKey: string | undefined, baseUrl: string): Promise<ModelCatalogEntry[]> {
  const token = apiKey?.trim();
  if (!token) {
    throw new Error("Enter your Construct Cloud desktop token first.");
  }

  const response = await fetch(`${constructCloudApiBaseUrl(baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Construct Cloud model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{
      id: string;
      name?: string;
      owned_by?: string;
      description?: string;
      context_length?: number;
      pricing?: {
        prompt?: string;
        completion?: string;
      };
    }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      providerId: "construct-cloud",
      providerName: "Construct Cloud",
      subProvider: model.owned_by ?? (model.id.includes("/") ? model.id.split("/")[0] : null),
      description: model.description ?? null,
      contextLength: model.context_length ?? null,
      pricing: model.pricing
        ? `Prompt ${model.pricing.prompt ?? "?"} - Completion ${model.pricing.completion ?? "?"}`
        : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchOpenCodeZenModels(apiKey: string | undefined, baseUrl: string): Promise<ModelCatalogEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let url = baseUrl.replace(/\/$/, "");
  if (url.includes("opencode.ai") && !url.endsWith("/zen/v1") && !url.endsWith("/v1")) {
    url = url.endsWith("/zen") ? `${url}/v1` : `${url}/zen/v1`;
  }

  const response = await fetch(`${url}/models`, { headers });

  if (response.status === 401) {
    return RECOMMENDED_OPENCODE_ZEN_MODELS;
  }

  if (!response.ok) {
    throw new Error(`OpenCode Zen model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{ id: string; owned_by?: string }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.id,
      providerId: "opencode-zen",
      providerName: "OpenCode Zen",
      subProvider: model.owned_by ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function fetchOpenAiModels(apiKey: string, baseUrl: string): Promise<ModelCatalogEntry[]> {
  let url = baseUrl.replace(/\/$/, "");
  if (url.includes("api.openai.com") && !url.endsWith("/v1")) {
    url = `${url}/v1`;
  }
  const response = await fetch(`${url}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenAI model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{ id: string; owned_by?: string }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.id,
      providerId: "openai",
      providerName: "OpenAI",
      subProvider: model.owned_by ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<ModelCatalogEntry[]> {
  let url = baseUrl.replace(/\/$/, "");
  if (url.includes("openrouter.ai") && !url.endsWith("/api/v1") && !url.endsWith("/v1")) {
    url = url.endsWith("/api") ? `${url}/v1` : `${url}/api/v1`;
  }
  const response = await fetch(`${url}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
      pricing?: {
        prompt?: string;
        completion?: string;
      };
    }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      providerId: "openrouter",
      providerName: "OpenRouter",
      subProvider: model.id.includes("/") ? model.id.split("/")[0] : null,
      description: model.description ?? null,
      contextLength: model.context_length ?? null,
      pricing: model.pricing
        ? `Prompt ${model.pricing.prompt ?? "?"} - Completion ${model.pricing.completion ?? "?"}`
        : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchLiteLlmModels(
  provider: AiProvider,
  apiKey: string | undefined,
  baseUrl: string
): Promise<ModelCatalogEntry[]> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const headers = buildAuthHeaders(apiKey);
  const [modelsResult, infoResult] = await Promise.allSettled([
    fetch(`${normalizedBaseUrl}/models`, { headers }),
    fetch(`${stripV1Suffix(normalizedBaseUrl)}/model/info`, { headers })
  ]);

  const byId = new Map<string, ModelCatalogEntry>();

  if (modelsResult.status === "fulfilled" && modelsResult.value.ok) {
    const payload = await modelsResult.value.json() as {
      data?: Array<{ id: string; owned_by?: string }>;
    };
    for (const model of payload.data ?? []) {
      addLiteLlmModel(byId, provider, {
        id: model.id,
        name: displayModelName(model.id),
        providerId: inferLiteLlmProviderId(model.id, model.owned_by),
        providerName: providerDisplayName(inferLiteLlmProviderId(model.id, model.owned_by)),
        subProvider: model.owned_by ?? null
      });
    }
  }

  if (infoResult.status === "fulfilled" && infoResult.value.ok) {
    const payload = await infoResult.value.json() as { data?: LiteLlmModelInfo[] };
    for (const info of payload.data ?? []) {
      const id = info.model_name?.trim() || info.litellm_params?.model?.trim() || info.model_info?.key?.trim();
      if (!id) continue;
      const providerId = inferLiteLlmProviderId(
        info.litellm_params?.model ?? id,
        info.model_info?.litellm_provider
      );
      addLiteLlmModel(byId, provider, {
        id,
        name: displayModelName(id),
        providerId,
        providerName: providerDisplayName(providerId),
        subProvider: info.model_info?.litellm_provider ?? null,
        description: info.model_info?.description ?? info.model_info?.mode ?? null,
        contextLength: info.model_info?.max_input_tokens ?? info.model_info?.max_tokens ?? null,
        pricing: formatLiteLlmPricing(info)
      });
    }
  }

  if (byId.size === 0) {
    const message = modelsResult.status === "fulfilled" && !modelsResult.value.ok
      ? `LiteLLM model lookup failed (${modelsResult.value.status}).`
      : "LiteLLM model lookup failed. Is the proxy running?";
    throw new Error(message);
  }

  return [...byId.values()]
    .filter((model) => matchesRequestedLiteLlmProvider(provider, model))
    .sort((left, right) => {
      const providerCompare = (left.providerName ?? "").localeCompare(right.providerName ?? "");
      return providerCompare || left.name.localeCompare(right.name);
    });
}

function addLiteLlmModel(
  models: Map<string, ModelCatalogEntry>,
  requestedProvider: AiProvider,
  model: ModelCatalogEntry
) {
  const existing = models.get(model.id);
  const next = {
    id: model.id,
    name: model.name?.trim() || displayModelName(model.id),
    providerId: model.providerId ?? inferLiteLlmProviderId(model.id),
    providerName: model.providerName ?? providerDisplayName(model.providerId ?? inferLiteLlmProviderId(model.id)),
    subProvider: model.subProvider ?? null,
    description: model.description ?? existing?.description ?? null,
    contextLength: model.contextLength ?? existing?.contextLength ?? null,
    pricing: model.pricing ?? existing?.pricing ?? null
  };
  if (matchesRequestedLiteLlmProvider(requestedProvider, next)) {
    models.set(next.id, { ...existing, ...next });
  } else if (requestedProvider === "litellm") {
    models.set(next.id, { ...existing, ...next });
  }
}

function buildAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const trimmed = apiKey?.trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

function stripV1Suffix(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

function constructCloudApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function inferLiteLlmProviderId(modelId: string, upstreamProvider?: string | null): string {
  const provider = upstreamProvider?.trim();
  if (provider && provider !== "openai") return normalizeProviderId(provider);
  if (modelId.startsWith("github_copilot/")) return "github-copilot";
  if (modelId.startsWith("github-copilot/")) return "github-copilot";
  if (modelId.startsWith("openrouter/")) return "openrouter";
  if (modelId.startsWith("openai/")) return "openai";
  return modelId.includes("/") ? normalizeProviderId(modelId.split("/")[0] ?? "litellm") : "litellm";
}

function normalizeProviderId(value: string): string {
  return value.replace(/_/g, "-").toLowerCase();
}

function providerDisplayName(providerId: string): string {
  if (providerId === "github-copilot") return "GitHub Copilot";
  if (providerId === "openrouter") return "OpenRouter";
  if (providerId === "opencode-zen") return "OpenCode Zen";
  if (providerId === "openai") return "OpenAI";
  if (providerId === "litellm") return "LiteLLM";
  return providerId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayModelName(modelId: string): string {
  const slug = modelId.split("/").at(-1) ?? modelId;
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b(gpt|api|llm|ai)\b/gi, (value) => value.toUpperCase())
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function matchesRequestedLiteLlmProvider(provider: AiProvider, model: Pick<ModelCatalogEntry, "id" | "providerId">): boolean {
  if (provider === "litellm") return true;
  if (provider === "github-copilot") {
    return model.providerId === "github-copilot" || model.id.startsWith("github_copilot/") || model.id.startsWith("github-copilot/");
  }
  return model.providerId === provider || model.id.startsWith(`${provider}/`);
}

function formatLiteLlmPricing(info: LiteLlmModelInfo): string | null {
  const input = info.model_info?.input_cost_per_token;
  const output = info.model_info?.output_cost_per_token;
  if (typeof input !== "number" && typeof output !== "number") return null;
  return `Input ${input ?? "?"} - Output ${output ?? "?"}`;
}
