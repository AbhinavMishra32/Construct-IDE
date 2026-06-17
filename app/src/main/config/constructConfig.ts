import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export type AiProvider = "openai" | "openrouter" | "github-copilot" | "opencode-zen" | "litellm";
export type ConstructAgentRuntimeId = "mastra" | "fxpnt";

export type StoredAiSettings = {
  runtime: ConstructAgentRuntimeId;
  provider: AiProvider;
  openAiApiKey: string;
  openAiModel: string;
  openAiBaseUrl: string;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterBaseUrl: string;
  liteLlmApiKey: string;
  liteLlmModel: string;
  liteLlmBaseUrl: string;
  liteLlmManageServer: boolean;
  opencodeZenApiKey: string;
  opencodeZenBaseUrl: string;
  opencodeZenModel: string;
  githubCopilotModel: string;
  featureModels: Record<string, string>;
};

export type StoredObservabilitySettings = {
  enabled: boolean;
  phoenixEndpoint: string;
  phoenixApiKey: string;
  phoenixProjectName: string;
  batch: boolean;
};

export type StoredSettings = {
  workspaceRoot: string;
  releaseVersion: string;
  ai: StoredAiSettings;
  observability: StoredObservabilitySettings;
};

export type ConstructDataPaths = {
  userDataRoot: string;
  configPath: string;
  projectsRoot: string;
  projectsManifestPath: string;
  legacySettingsPath: string;
  learningStatePath: string;
  workspacesRoot: string;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_LITELLM_BASE_URL = "http://localhost:4000/v1";
const DEFAULT_OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
let configuredDataPaths: ConstructDataPaths | null = null;

export function createConstructDataPaths(userDataRoot: string): ConstructDataPaths {
  const projectsRoot = path.join(userDataRoot, "construct-projects");
  return {
    userDataRoot,
    configPath: path.join(userDataRoot, "construct.config.json"),
    projectsRoot,
    projectsManifestPath: path.join(projectsRoot, "projects.json"),
    legacySettingsPath: path.join(projectsRoot, "settings.json"),
    learningStatePath: path.join(projectsRoot, "learning-state.json"),
    workspacesRoot: path.join(projectsRoot, "workspaces")
  };
}

export function configureConstructDataPaths(paths: ConstructDataPaths | null): void {
  configuredDataPaths = paths;
}

export function readConstructAiSettingsSync(): StoredAiSettings {
  const paths = getElectronDataPaths();
  if (!paths) {
    return defaultAiSettings();
  }

  const config = readJsonFileSync<Partial<StoredSettings>>(paths.configPath)
    ?? readJsonFileSync<Partial<StoredSettings>>(paths.legacySettingsPath);
  return normalizeSettings(config, paths).ai;
}

export async function readConstructSettings(paths = requireElectronDataPaths()): Promise<StoredSettings> {
  await mkdir(paths.projectsRoot, { recursive: true });

  const config = await readJsonFile<Partial<StoredSettings>>(paths.configPath);
  if (config) {
    return normalizeSettings(config, paths);
  }

  const legacy = await readJsonFile<Partial<StoredSettings>>(paths.legacySettingsPath);
  const settings = normalizeSettings(legacy, paths);
  await writeConstructSettings(settings, paths);
  return settings;
}

export async function writeConstructSettings(
  settings: StoredSettings,
  paths = requireElectronDataPaths()
): Promise<StoredSettings> {
  const normalized = normalizeSettings(settings, paths);
  await mkdir(path.dirname(paths.configPath), { recursive: true });
  const temporary = `${paths.configPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, paths.configPath);
  return normalized;
}

export function defaultConstructSettings(paths = getElectronDataPaths()): StoredSettings {
  const resolvedPaths = paths ?? createConstructDataPaths("");
  return {
    workspaceRoot: resolvedPaths.workspacesRoot,
    releaseVersion: process.env.npm_package_version?.trim() || "0.0.3",
    ai: defaultAiSettings(),
    observability: defaultObservabilitySettings()
  };
}

export function normalizeSettings(
  input: Partial<StoredSettings> | null | undefined,
  paths = getElectronDataPaths()
): StoredSettings {
  const defaults = defaultConstructSettings(paths);
  const inputAi = (input?.ai ?? {}) as Partial<StoredAiSettings>;
  const inputObservability = (input?.observability ?? {}) as Partial<StoredObservabilitySettings>;

  return {
    workspaceRoot: normalizeString(input?.workspaceRoot, defaults.workspaceRoot),
    releaseVersion: normalizeString(input?.releaseVersion, defaults.releaseVersion),
    ai: {
      runtime: inputAi.runtime === "fxpnt" ? "fxpnt" : "mastra",
      provider: normalizeAiProvider(inputAi.provider),
      openAiApiKey: normalizeString(inputAi.openAiApiKey, ""),
      openAiModel: normalizeString(inputAi.openAiModel, defaults.ai.openAiModel),
      openAiBaseUrl: normalizeBaseUrl(inputAi.openAiBaseUrl, defaults.ai.openAiBaseUrl),
      openRouterApiKey: normalizeString(inputAi.openRouterApiKey, ""),
      openRouterModel: normalizeString(inputAi.openRouterModel, defaults.ai.openRouterModel),
      openRouterBaseUrl: normalizeBaseUrl(inputAi.openRouterBaseUrl, defaults.ai.openRouterBaseUrl),
      liteLlmApiKey: normalizeString(inputAi.liteLlmApiKey, ""),
      liteLlmModel: normalizeString(inputAi.liteLlmModel, defaults.ai.liteLlmModel),
      liteLlmBaseUrl: normalizeBaseUrl(inputAi.liteLlmBaseUrl, defaults.ai.liteLlmBaseUrl),
      liteLlmManageServer: inputAi.liteLlmManageServer === true,
      opencodeZenApiKey: normalizeString(inputAi.opencodeZenApiKey, ""),
      opencodeZenBaseUrl: normalizeBaseUrl(inputAi.opencodeZenBaseUrl, defaults.ai.opencodeZenBaseUrl),
      opencodeZenModel: normalizeString(inputAi.opencodeZenModel, defaults.ai.opencodeZenModel),
      githubCopilotModel: normalizeString(inputAi.githubCopilotModel, defaults.ai.githubCopilotModel),
      featureModels: normalizeFeatureModels(inputAi.featureModels)
    },
    observability: {
      enabled: inputObservability.enabled === true,
      phoenixEndpoint: normalizeBaseUrl(inputObservability.phoenixEndpoint, defaults.observability.phoenixEndpoint),
      phoenixApiKey: normalizeString(inputObservability.phoenixApiKey, ""),
      phoenixProjectName: normalizeString(inputObservability.phoenixProjectName, defaults.observability.phoenixProjectName),
      batch: inputObservability.batch !== false
    }
  };
}

function defaultAiSettings(): StoredAiSettings {
  return {
    runtime: "mastra",
    provider: "openai",
    openAiApiKey: "",
    openAiModel: "gpt-5-mini",
    openAiBaseUrl: DEFAULT_OPENAI_BASE_URL,
    openRouterApiKey: "",
    openRouterModel: "deepseek/deepseek-v4-flash",
    openRouterBaseUrl: DEFAULT_OPENROUTER_BASE_URL,
    liteLlmApiKey: "",
    liteLlmModel: "openai/gpt-5-mini",
    liteLlmBaseUrl: DEFAULT_LITELLM_BASE_URL,
    liteLlmManageServer: false,
    opencodeZenApiKey: "",
    opencodeZenBaseUrl: DEFAULT_OPENCODE_ZEN_BASE_URL,
    opencodeZenModel: "gpt-5.1-codex",
    githubCopilotModel: "github_copilot/gpt-4",
    featureModels: {}
  };
}

function defaultObservabilitySettings(): StoredObservabilitySettings {
  return {
    enabled: false,
    phoenixEndpoint: "http://localhost:6006",
    phoenixApiKey: "",
    phoenixProjectName: "construct",
    batch: true
  };
}

function getElectronDataPaths(): ConstructDataPaths | null {
  return configuredDataPaths;
}

function requireElectronDataPaths(): ConstructDataPaths {
  const paths = getElectronDataPaths();
  if (!paths) {
    throw new Error("Construct settings require Electron app userData.");
  }
  return paths;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonFileSync<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  return normalizeString(value, fallback).replace(/\/$/, "");
}

function normalizeAiProvider(value: unknown): AiProvider {
  return value === "openrouter"
    || value === "github-copilot"
    || value === "opencode-zen"
    || value === "litellm"
    ? value
    : "openai";
}

function normalizeFeatureModels(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
  );
}
