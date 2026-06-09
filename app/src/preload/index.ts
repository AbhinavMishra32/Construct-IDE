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
  }
});
