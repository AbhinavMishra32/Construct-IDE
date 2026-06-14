import { readFile } from "node:fs/promises";

import { dialog, nativeTheme, type IpcMain } from "electron";

export class ConstructSystemIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    defaultWorkspaceParent: () => string;
    collectDebugProcessSnapshots: () => Promise<unknown>;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:theme:set", async (_event, theme: "light" | "dark" | "system") => {
      nativeTheme.themeSource = theme;
    });

    ipcMain.handle("construct:debug:processes", async () => {
      return this.options.collectDebugProcessSnapshots();
    });

    ipcMain.handle("construct:dialog:open-construct-file", async () => {
      const result = await dialog.showOpenDialog({
        title: "Open .construct project",
        properties: ["openFile"],
        filters: [
          { name: "Construct Projects", extensions: ["construct"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

      if (result.canceled || result.filePaths[0] == null) {
        return null;
      }

      const sourcePath = result.filePaths[0];
      return {
        path: sourcePath,
        source: await readFile(sourcePath, "utf8")
      };
    });

    ipcMain.handle("construct:dialog:select-workspace-directory", async (_event, input) => {
      const result = await dialog.showOpenDialog({
        title: "Choose project workspace",
        defaultPath: typeof input?.defaultPath === "string" ? input.defaultPath : this.options.defaultWorkspaceParent(),
        properties: ["openDirectory", "createDirectory"]
      });

      if (result.canceled || result.filePaths[0] == null) {
        return null;
      }

      return result.filePaths[0];
    });
  }
}
