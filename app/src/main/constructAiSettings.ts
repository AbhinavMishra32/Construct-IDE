import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { app } from "electron";

export type StoredAiSettings = {
  provider: "openai" | "openrouter";
  openAiApiKey: string;
  openAiModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  featureModels: Record<string, string>;
};

function defaultAiSettings(): StoredAiSettings {
  return {
    provider: "openai",
    openAiApiKey: "",
    openAiModel: "gpt-5-mini",
    openRouterApiKey: "",
    openRouterModel: "openai/gpt-5-mini",
    featureModels: {}
  };
}

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "construct-projects", "settings.json");
}

function readStoredAiSettings(): StoredAiSettings {
  if (!existsSync(settingsFilePath())) {
    return defaultAiSettings();
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFilePath(), "utf8")) as {
      ai?: Partial<StoredAiSettings>;
    };
    const defaults = defaultAiSettings();
    return {
      provider: parsed.ai?.provider === "openrouter" ? "openrouter" : "openai",
      openAiApiKey: parsed.ai?.openAiApiKey?.trim?.() || defaults.openAiApiKey,
      openAiModel: parsed.ai?.openAiModel?.trim?.() || defaults.openAiModel,
      openRouterApiKey: parsed.ai?.openRouterApiKey?.trim?.() || defaults.openRouterApiKey,
      openRouterModel: parsed.ai?.openRouterModel?.trim?.() || defaults.openRouterModel,
      featureModels: parsed.ai?.featureModels && typeof parsed.ai.featureModels === "object"
        ? Object.fromEntries(
            Object.entries(parsed.ai.featureModels)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
          )
        : {}
    };
  } catch {
    return defaultAiSettings();
  }
}

export function resolveConstructAiSettings(): StoredAiSettings {
  if (process.env.VITE_DEV_SERVER_URL) {
    return {
      provider: (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase() === "openrouter"
        ? "openrouter"
        : "openai",
      openAiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
      openAiModel: process.env.CONSTRUCT_OPENAI_MODEL?.trim()
        || process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim()
        || "gpt-5-mini",
      openRouterApiKey: (process.env.CONSTRUCT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY)?.trim() || "",
      openRouterModel: process.env.CONSTRUCT_OPENROUTER_MODEL?.trim()
        || process.env.CONSTRUCT_OPENROUTER_FAST_MODEL?.trim()
        || "openai/gpt-5-mini",
      featureModels: {}
    };
  }

  return readStoredAiSettings();
}
