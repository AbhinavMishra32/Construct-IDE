import type { IpcMain, WebContents } from "electron";

import { ConstructLspService } from "../lsp/ConstructLspService";
import type { StoredProject } from "../projects/ConstructProjectTypes";

export class ConstructLspIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    lsp: ConstructLspService;
    findProject: (projectId: string) => Promise<StoredProject>;
    setActiveWebContents: (webContents: WebContents) => void;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:lsp:get-status", async (_event, projectId: string) => {
      return this.options.lsp.getStatus(projectId);
    });

    ipcMain.handle("construct:lsp:install", async (_event, projectId: string) => {
      try {
        const project = await this.options.findProject(projectId);
        this.activate(_event.sender);
        return await this.options.lsp.install(project.workspacePath);
      } catch (err) {
        console.error("[LSP Installer] Error:", err);
        return false;
      }
    });

    ipcMain.handle("construct:lsp:start-server", async (_event, projectId: string) => {
      try {
        const project = await this.options.findProject(projectId);
        this.activate(_event.sender);
        return this.options.lsp.startForProject(project);
      } catch (err) {
        console.error("[LSP] Start server error:", err);
        return {
          languages: [],
          workspacePath: ""
        };
      }
    });

    ipcMain.handle("construct:lsp:stop-server", async () => {
      this.options.lsp.stop();
    });

    ipcMain.handle("construct:lsp:request", async (_event, payload: any) => {
      this.activate(_event.sender);
      return this.options.lsp.request(_event.sender, payload);
    });
  }

  private activate(webContents: WebContents): void {
    this.options.setActiveWebContents(webContents);
    this.options.lsp.setActiveWebContents(webContents);
  }
}
