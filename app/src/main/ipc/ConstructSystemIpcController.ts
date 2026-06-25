import { readFile } from "node:fs/promises";

import { dialog, nativeTheme, type IpcMain } from "electron";

import {
  APPLICATION_SCOPE,
  StorageScope,
  StorageTarget,
  workspaceStorageScope,
  type IStorageService,
  type StorageScopeRef
} from "../storage/storage";

export class ConstructSystemIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    defaultWorkspaceParent: () => string;
    collectDebugProcessSnapshots: () => Promise<unknown>;
    storage: IStorageService;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:theme:set", async (_event, theme: "light" | "dark" | "system") => {
      nativeTheme.themeSource = theme;
      this.options.storage.store("construct.ui.theme", theme, APPLICATION_SCOPE, StorageTarget.USER);
    });

    ipcMain.handle("construct:ui-state:get", async (_event, input) => {
      const key = normalizeUiStateKey(input?.key);
      return this.options.storage.getObject(key, uiStateScope(input), input?.fallback ?? null);
    });

    ipcMain.handle("construct:ui-state:set", async (_event, input) => {
      const key = normalizeUiStateKey(input?.key);
      this.options.storage.store(key, input?.value ?? null, uiStateScope(input), StorageTarget.USER);
      return { ok: true };
    });

    ipcMain.handle("construct:storage:flush", async () => {
      await this.options.storage.flush();
      return { ok: true };
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

function uiStateScope(input: unknown): StorageScopeRef {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (value.scope === "workspace" && typeof value.projectId === "string" && value.projectId.trim()) {
    return workspaceStorageScope(value.projectId.trim());
  }
  if (value.scope === StorageScope.WORKSPACE && typeof value.projectId === "string" && value.projectId.trim()) {
    return workspaceStorageScope(value.projectId.trim());
  }
  return APPLICATION_SCOPE;
}

function normalizeUiStateKey(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("UI state key is required.");
  }
  return raw.startsWith("construct.ui.") ? raw : `construct.ui.${raw}`;
}
