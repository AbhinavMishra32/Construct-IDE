import path from "node:path";
import { mkdir } from "node:fs/promises";

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

    ipcMain.handle("construct:settings:list-ai-features", async () => {
      return featureSettingsView((await this.options.readSettings()).ai);
    });

    ipcMain.handle("construct:settings:list-models", async (_event, input) => {
      const provider = input?.provider === "openrouter" ? "openrouter" : "openai";
      const apiKey = String(input?.apiKey ?? "").trim();
      const settings = await this.options.readSettings();

      if (!apiKey) {
        throw new Error(`Enter a ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key first.`);
      }

      return fetchProviderModels({
        provider,
        apiKey,
        baseUrl: provider === "openrouter"
          ? settings.ai.openRouterBaseUrl
          : settings.ai.openAiBaseUrl
      });
    });
  }
}
