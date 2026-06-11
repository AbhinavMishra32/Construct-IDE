export type ConstructAgentModel = {
  providerId: "openai" | "openrouter";
  modelId: string;
  url?: string;
  apiKey: string;
};

export function resolveConstructAgentModel(purpose: string): ConstructAgentModel {
  const provider = (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase();
  const openRouter = provider === "openrouter";
  const apiKey = (
    openRouter
      ? process.env.CONSTRUCT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY
  )?.trim();

  if (!apiKey) {
    throw new Error(openRouter
      ? `OPENROUTER_API_KEY or CONSTRUCT_OPENROUTER_API_KEY is required for ${purpose}.`
      : `OPENAI_API_KEY is required for ${purpose}.`);
  }

  if (openRouter) {
    return {
      providerId: "openrouter",
      modelId: process.env.CONSTRUCT_OPENROUTER_MODEL?.trim()
        || process.env.CONSTRUCT_OPENROUTER_FAST_MODEL?.trim()
        || "openai/gpt-5-mini",
      url: process.env.CONSTRUCT_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      apiKey
    };
  }

  return {
    providerId: "openai",
    modelId: process.env.CONSTRUCT_OPENAI_MODEL?.trim()
      || process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim()
      || "gpt-5-mini",
    url: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(),
    apiKey
  };
}

export function resolveConstructOpenAiResponsesConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.CONSTRUCT_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.CONSTRUCT_OPENAI_MODEL?.trim()
      || process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim()
      || "gpt-5-mini"
  };
}
