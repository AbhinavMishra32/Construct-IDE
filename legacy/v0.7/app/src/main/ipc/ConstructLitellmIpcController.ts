import type { IpcMain, WebContents } from "electron";

import { ConstructLitellmService } from "../ai/ConstructLitellmService";

export class ConstructLitellmIpcController {
  constructor(
    private readonly options: {
      ipcMain: IpcMain;
      litellm: ConstructLitellmService;
    }
  ) {}

  register(webContentsProvider: () => WebContents | null): void {
    const { ipcMain, litellm } = this.options;

    litellm.onLog((level, message) => {
      const wc = webContentsProvider();
      if (wc && !wc.isDestroyed()) {
        wc.send("construct:litellm:log", { level, message });
      }
    });

    litellm.onStatusChange((state) => {
      const wc = webContentsProvider();
      if (wc && !wc.isDestroyed()) {
        wc.send("construct:litellm:status-change", state);
      }
    });

    ipcMain.handle("construct:litellm:start", async (_event, input: {
      port: number;
      openAiApiKey?: string;
      openRouterApiKey?: string;
    }) => {
      await litellm.start(input.port, input.openAiApiKey, input.openRouterApiKey);
      return litellm.getState();
    });

    ipcMain.handle("construct:litellm:stop", async () => {
      await litellm.stop();
      return litellm.getState();
    });

    ipcMain.handle("construct:litellm:status", async () => {
      return litellm.getState();
    });

    ipcMain.handle("construct:litellm:check-install", async () => {
      return litellm.checkInstall();
    });

    ipcMain.handle("construct:litellm:install", async () => {
      return litellm.autoInstall();
    });
  }
}
