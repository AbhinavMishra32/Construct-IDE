import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

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
  const electronApp = getElectronApp();
  if (!electronApp) {
    return "";
  }

  return path.join(electronApp.getPath("userData"), "construct-projects", "settings.json");
}

function readStoredAiSettings(): StoredAiSettings {
  const settingsPath = settingsFilePath();
  if (!settingsPath || !existsSync(settingsPath)) {
    return defaultAiSettings();
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
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

function getElectronApp(): { getPath(name: "userData"): string } | null {
  if (!process.versions.electron) {
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    const electron = require("electron") as { app?: { getPath(name: "userData"): string } };
    return electron.app ?? null;
  } catch {
    return null;
  }
}

export function resolveConstructAiSettings(): StoredAiSettings {
  const stored = readStoredAiSettings();
  if (process.env.VITE_DEV_SERVER_URL) {
    return {
      provider: (process.env.CONSTRUCT_AGENT_PROVIDER ?? stored.provider).trim().toLowerCase() === "openrouter"
        ? "openrouter"
        : "openai",
      openAiApiKey: process.env.OPENAI_API_KEY?.trim() || stored.openAiApiKey,
      openAiModel: process.env.CONSTRUCT_OPENAI_MODEL?.trim()
        || process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim()
        || stored.openAiModel,
      openRouterApiKey: (process.env.CONSTRUCT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY)?.trim() || stored.openRouterApiKey,
      openRouterModel: process.env.CONSTRUCT_OPENROUTER_MODEL?.trim()
        || process.env.CONSTRUCT_OPENROUTER_FAST_MODEL?.trim()
        || stored.openRouterModel,
      featureModels: stored.featureModels
    };
  }

  return stored;
}
