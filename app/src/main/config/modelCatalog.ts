import type { AiProvider } from "./constructConfig";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  description?: string | null;
  contextLength?: number | null;
  pricing?: string | null;
};

export async function fetchProviderModels(input: {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
}): Promise<ModelCatalogEntry[]> {
  return input.provider === "openrouter"
    ? fetchOpenRouterModels(input.apiKey, input.baseUrl)
    : fetchOpenAiModels(input.apiKey, input.baseUrl);
}

async function fetchOpenAiModels(apiKey: string, baseUrl: string): Promise<ModelCatalogEntry[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenAI model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{ id: string }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.id
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<ModelCatalogEntry[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
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
      description: model.description ?? null,
      contextLength: model.context_length ?? null,
      pricing: model.pricing
        ? `Prompt ${model.pricing.prompt ?? "?"} - Completion ${model.pricing.completion ?? "?"}`
        : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
