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

contextBridge.exposeInMainWorld("constructV2", {
  ensureProject: (input: unknown) =>
    ipcRenderer.invoke("construct:v2:ensure-project", input),
  listProjects: () => ipcRenderer.invoke("construct:v2:list-projects"),
  openProject: (id: string) => ipcRenderer.invoke("construct:v2:open-project", id),
  updateProject: (input: unknown) =>
    ipcRenderer.invoke("construct:v2:update-project", input),
  listFiles: (projectId: string) =>
    ipcRenderer.invoke("construct:v2:list-files", projectId),
  readFile: (input: unknown) => ipcRenderer.invoke("construct:v2:read-file", input),
  writeFile: (input: unknown) => ipcRenderer.invoke("construct:v2:write-file", input),
  terminalCreate: (input: unknown) =>
    ipcRenderer.invoke("construct:v2:terminal-create", input),
  terminalInput: (input: unknown) =>
    ipcRenderer.invoke("construct:v2:terminal-input", input),
  terminalKill: (input: unknown) =>
    ipcRenderer.invoke("construct:v2:terminal-kill", input),
  onTerminalData: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:v2:terminal-data", listener);
    return () => ipcRenderer.off("construct:v2:terminal-data", listener);
  },
  onTerminalExit: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("construct:v2:terminal-exit", listener);
    return () => ipcRenderer.off("construct:v2:terminal-exit", listener);
  }
});
