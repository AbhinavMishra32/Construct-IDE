import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("construct", {
  getRuntimeInfo: () => ({
    name: "Construct",
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform
  })
});

contextBridge.exposeInMainWorld("constructProjects", {
  setThemeSource: (theme: "light" | "dark" | "system") =>
    ipcRenderer.invoke("construct:theme:set", theme),
  ensureProject: (input: unknown) =>
    ipcRenderer.invoke("construct:project:ensure", input),
  importProject: (input: unknown) =>
    ipcRenderer.invoke("construct:project:import", input),
  openConstructFile: () =>
    ipcRenderer.invoke("construct:dialog:open-construct-file"),
  selectWorkspaceDirectory: (input: unknown) =>
    ipcRenderer.invoke("construct:dialog:select-workspace-directory", input),
  getSettings: () => ipcRenderer.invoke("construct:settings:get"),
  setWorkspaceRoot: (input: unknown) =>
    ipcRenderer.invoke("construct:settings:set-workspace-root", input),
  listProjects: () => ipcRenderer.invoke("construct:project:list"),
  openProject: (id: string) => ipcRenderer.invoke("construct:project:open", id),
  updateProject: (input: unknown) =>
    ipcRenderer.invoke("construct:project:update", input),
  listFiles: (projectId: string) =>
    ipcRenderer.invoke("construct:project:list-files", projectId),
  readFile: (input: unknown) => ipcRenderer.invoke("construct:project:read-file", input),
  writeFile: (input: unknown) => ipcRenderer.invoke("construct:project:write-file", input),
  deleteFile: (input: unknown) => ipcRenderer.invoke("construct:project:delete-file", input),
  renameFile: (input: unknown) => ipcRenderer.invoke("construct:project:rename-file", input),
  createFolder: (input: unknown) => ipcRenderer.invoke("construct:project:create-folder", input),
  duplicateFile: (input: unknown) => ipcRenderer.invoke("construct:project:duplicate-file", input),
  verifyRecall: (input: unknown) =>
    ipcRenderer.invoke("construct:project:verify-recall", input),
  reviewConstructAuthoring: (input: unknown) =>
    ipcRenderer.invoke("construct:project:review-authoring", input),
  explainSelection: (input: unknown) =>
    ipcRenderer.invoke("construct:project:explain-selection", input),
  gitStatus: (projectId: string) =>
    ipcRenderer.invoke("construct:project:git-status", projectId),
  gitCommit: (input: unknown) =>
    ipcRenderer.invoke("construct:project:git-commit", input),
  gitPush: (projectId: string) =>
    ipcRenderer.invoke("construct:project:git-push", projectId),
  terminalCreate: (input: unknown) =>
    ipcRenderer.invoke("construct:project:terminal-create", input),
  terminalInput: (input: unknown) =>
    ipcRenderer.invoke("construct:project:terminal-input", input),
  terminalResize: (input: unknown) =>
    ipcRenderer.invoke("construct:project:terminal-resize", input),
  terminalKill: (input: unknown) =>
    ipcRenderer.invoke("construct:project:terminal-kill", input),
  onTerminalData: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:project:terminal-data", listener);
    return () => ipcRenderer.off("construct:project:terminal-data", listener);
  },
  onTerminalExit: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:project:terminal-exit", listener);
    return () => ipcRenderer.off("construct:project:terminal-exit", listener);
  },
  onVerifyLog: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:project:verify-log", listener);
    return () => ipcRenderer.off("construct:project:verify-log", listener);
  },
  onSelectionExplanationLog: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("construct:project:explain-selection-log", listener);
    return () => ipcRenderer.off("construct:project:explain-selection-log", listener);
  },
  lspRequest: (payload: unknown) =>
    ipcRenderer.invoke("construct:lsp:request", payload),
  onLspNotification: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => {
      callback(payload);
    };
    ipcRenderer.on("construct:lsp:notification", listener);
    return () => ipcRenderer.off("construct:lsp:notification", listener);
  },
  onLspStderr: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:lsp:stderr", listener);
    return () => ipcRenderer.off("construct:lsp:stderr", listener);
  },
  onMainLog: (callback: (payload: { level: string; message: string; timestamp: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { level: string; message: string; timestamp: string }) => {
      callback(payload);
    };
    ipcRenderer.on("construct:main:log", listener);
    return () => ipcRenderer.off("construct:main:log", listener);
  },
  onLspInstallProgress: (callback: (payload: { language?: string; type: "stdout" | "stderr"; text: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { language?: string; type: "stdout" | "stderr"; text: string }) => {
      callback(payload);
    };
    ipcRenderer.on("construct:lsp:install-progress", listener);
    return () => ipcRenderer.off("construct:lsp:install-progress", listener);
  },
  lspGetStatus: (projectId: string) => ipcRenderer.invoke("construct:lsp:get-status", projectId),
  lspInstall: (projectId: string) => ipcRenderer.invoke("construct:lsp:install", projectId),
  lspStart: (projectId: string) => ipcRenderer.invoke("construct:lsp:start-server", projectId),
  lspStop: () => ipcRenderer.invoke("construct:lsp:stop-server")
});
