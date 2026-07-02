import path from "node:path";
import os from "node:os";
import { mkdir, readFile } from "node:fs/promises";

import type { IpcMain } from "electron";

import { featureSettingsView } from "../constructAiFeatures";
import { fetchProviderModels } from "../config/modelCatalog";
import type { StoredSettings } from "../config/constructConfig";
import type { ProjectSummary, StoredProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";

export class ConstructSettingsIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    defaultWorkspaceParent: () => string;
    readSettings: () => Promise<StoredSettings>;
    writeSettings: (settings: StoredSettings) => Promise<StoredSettings>;
    readProjects: () => Promise<StoredProject[]>;
    writeProjects: (projects: StoredProject[]) => Promise<void>;
    workspace: ConstructProjectWorkspaceService;
    summarizeProject: (project: StoredProject) => ProjectSummary;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:settings:get", async () => {
      return this.options.readSettings();
    });

    ipcMain.handle("construct:settings:set-workspace-root", async (_event, input) => {
      const workspaceRoot = path.resolve(String(input.workspaceRoot || this.options.defaultWorkspaceParent()));
      const projects = await this.options.readProjects();
      const currentSettings = await this.options.readSettings();

      await mkdir(workspaceRoot, { recursive: true });
      await this.options.workspace.migrateProjectsToWorkspaceRoot(projects, workspaceRoot);

      const settings = await this.options.writeSettings({
        ...currentSettings,
        workspaceRoot
      });
      await this.options.writeProjects(projects);

      return {
        settings,
        projects: projects.map(this.options.summarizeProject)
      };
    });

    ipcMain.handle("construct:settings:update-ai", async (_event, input) => {
      const current = await this.options.readSettings();
      return this.options.writeSettings({
        ...current,
        ai: {
          ...current.ai,
          ...(typeof input?.ai === "object" && input.ai ? input.ai : {})
        }
      });
    });

    ipcMain.handle("construct:settings:update-app", async (_event, input) => {
      const current = await this.options.readSettings();
      return this.options.writeSettings({
        ...current,
        app: {
          ...current.app,
          ...(typeof input?.app === "object" && input.app ? input.app : {})
        }
      });
    });

    ipcMain.handle("construct:settings:update-observability", async (_event, input) => {
      const current = await this.options.readSettings();
      return this.options.writeSettings({
        ...current,
        observability: {
          ...current.observability,
          ...(typeof input?.observability === "object" && input.observability ? input.observability : {})
        }
      });
    });

    ipcMain.handle("construct:settings:list-ai-features", async () => {
      return featureSettingsView((await this.options.readSettings()).ai);
    });

    ipcMain.handle("construct:settings:import-opencode-auth", async () => {
      try {
        const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
        const content = await readFile(authPath, "utf-8");
        const data = JSON.parse(content) as Record<string, { apiKey?: string }>;
        const key = data.opencode?.apiKey ?? data["opencode-zen"]?.apiKey ?? null;
        return key ?? null;
      } catch {
        return null;
      }
    });

    ipcMain.handle("construct:settings:list-models", async (_event, input) => {
      const provider = input?.provider === "openrouter"
        || input?.provider === "github-copilot"
        || input?.provider === "opencode-zen"
        || input?.provider === "litellm"
        || input?.provider === "construct-cloud"
        ? input.provider
        : "openai";
      const apiKey = String(input?.apiKey ?? "").trim();
      const settings = await this.options.readSettings();
      const usesLiteLlm = provider === "github-copilot" || provider === "litellm";

      const baseUrl = provider === "construct-cloud"
        ? settings.ai.constructCloudBaseUrl
        : provider === "openrouter"
        ? settings.ai.openRouterBaseUrl
        : provider === "opencode-zen"
          ? settings.ai.opencodeZenBaseUrl
          : usesLiteLlm
            ? settings.ai.liteLlmBaseUrl
            : settings.ai.openAiBaseUrl;

      return fetchProviderModels({
        provider,
        apiKey: provider === "construct-cloud"
          ? (apiKey || settings.ai.constructCloudAccessToken)
          : usesLiteLlm
            ? settings.ai.liteLlmApiKey
            : apiKey,
        baseUrl
      });
    });
  }
}
