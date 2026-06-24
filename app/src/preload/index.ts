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
  createFlowProject: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:create", input),
  openConstructFile: () =>
    ipcRenderer.invoke("construct:dialog:open-construct-file"),
  selectWorkspaceDirectory: (input: unknown) =>
    ipcRenderer.invoke("construct:dialog:select-workspace-directory", input),
  getSettings: () => ipcRenderer.invoke("construct:settings:get"),
  setWorkspaceRoot: (input: unknown) =>
    ipcRenderer.invoke("construct:settings:set-workspace-root", input),
  updateAiSettings: (input: unknown) =>
    ipcRenderer.invoke("construct:settings:update-ai", input),
  updateAppSettings: (input: unknown) =>
    ipcRenderer.invoke("construct:settings:update-app", input),
  listAiFeatures: () =>
    ipcRenderer.invoke("construct:settings:list-ai-features"),
  listModels: (input: unknown) =>
    ipcRenderer.invoke("construct:settings:list-models", input),
  getLearningState: () =>
    ipcRenderer.invoke("construct:learning:get-state"),
  getProjectLearningState: (projectId: string) =>
    ipcRenderer.invoke("construct:learning:get-project", projectId),
  applyLearningPatch: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:apply-patch", input),
  getWeakConcepts: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:weak-concepts", input),
  saveKnowledgeConcept: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:knowledge-save", input),
  openKnowledgeConcept: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:knowledge-open", input),
  recordConceptOpen: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:concept-open", input),
  removeKnowledgeConcept: (input: unknown) =>
    ipcRenderer.invoke("construct:learning:knowledge-remove", input),
  listProjects: () => ipcRenderer.invoke("construct:project:list"),
  openProject: (id: string) => ipcRenderer.invoke("construct:project:open", id),
  updateProject: (input: unknown) =>
    ipcRenderer.invoke("construct:project:update", input),
  readProjectTape: (projectId: string) =>
    ipcRenderer.invoke("construct:project:read-tape", projectId),
  updateProjectTape: (input: unknown) =>
    ipcRenderer.invoke("construct:project:update-tape", input),
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
  runConstructInteract: (input: unknown) =>
    ipcRenderer.invoke("construct:project:interact", input),
  runConstructFlowAgent: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:run-agent", input),
  runConstructFlowResearch: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:research", input),
  readFlowMemory: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:memory-read", input),
  updateFlowMemory: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:memory-update", input),
  submitFlowTask: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:submit-task", input),
  rewindFlowSession: (input: unknown) =>
    ipcRenderer.invoke("construct:flow:rewind-session", input),
  onConstructFlowSessionEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("construct:flow:session-event", listener);
    return () => ipcRenderer.off("construct:flow:session-event", listener);
  },
  onConstructInteractSessionEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("construct:project:interact-session-event", listener);
    return () => ipcRenderer.off("construct:project:interact-session-event", listener);
  },
  reviewConstructAuthoring: (input: unknown) =>
    ipcRenderer.invoke("construct:project:review-authoring", input),
  explainSelection: (input: unknown) =>
    ipcRenderer.invoke("construct:project:explain-selection", input),
  startCodeGhostStream: (input: unknown) => {
    ipcRenderer.send("construct:project:code-ghost:explain", input);
  },
  onCodeGhostToken: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("construct:project:code-ghost:token", listener);
    return () => { ipcRenderer.off("construct:project:code-ghost:token", listener); };
  },
  deleteProject: (input: unknown) =>
    ipcRenderer.invoke("construct:project:delete", input),
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
  debugProcesses: () =>
    ipcRenderer.invoke("construct:debug:processes"),
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
  onAgentLog: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("construct:project:agent-log", listener);
    return () => ipcRenderer.off("construct:project:agent-log", listener);
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
  lspStop: () => ipcRenderer.invoke("construct:lsp:stop-server"),
  litellmStart: (input: { port: number; openAiApiKey?: string; openRouterApiKey?: string }) =>
    ipcRenderer.invoke("construct:litellm:start", input),
  litellmStop: () =>
    ipcRenderer.invoke("construct:litellm:stop"),
  litellmStatus: () =>
    ipcRenderer.invoke("construct:litellm:status"),
  litellmCheckInstall: () =>
    ipcRenderer.invoke("construct:litellm:check-install"),
  litellmInstall: () =>
    ipcRenderer.invoke("construct:litellm:install"),
  onLitellmLog: (callback: (payload: { level: string; message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { level: string; message: string }) => {
      callback(payload);
    };
    ipcRenderer.on("construct:litellm:log", listener);
    return () => ipcRenderer.off("construct:litellm:log", listener);
  },
  onLitellmStatusChange: (callback: (payload: { status: string; port: number; pid: number | null; error: string | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => {
      callback(payload);
    };
    ipcRenderer.on("construct:litellm:status-change", listener);
    return () => ipcRenderer.off("construct:litellm:status-change", listener);
  },
  importOpencodeAuth: () =>
    ipcRenderer.invoke("construct:settings:import-opencode-auth"),
  onProviderLog: (callback: (payload: { provider: string; message: string; level: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { provider: string; message: string; level: string }) => {
      callback(payload);
    };
    ipcRenderer.on("construct:provider:log", listener);
    return () => ipcRenderer.off("construct:provider:log", listener);
  },
  onFileChanged: (callback: (payload: { eventType?: string; path?: string | null; paths?: string[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload?: { eventType?: string; path?: string | null; paths?: string[] }) => {
      callback(payload ?? {});
    };
    ipcRenderer.on("construct:project:file-changed", listener);
    return () => ipcRenderer.off("construct:project:file-changed", listener);
  },
  closeProject: () => ipcRenderer.invoke("construct:project:close")
});
