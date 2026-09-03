import { contextBridge, ipcRenderer } from "electron";
import {
  ipc,
  type ConstructApi,
  type MenuCommand,
  type NativeSurface,
  type ProviderId,
  type ProviderOAuthEvent,
  type TerminalEvent,
  type LspEvent,
  type LanguageServerInstallEvent,
  type AgentEvent,
  type AgentStreamEvent,
  type UpdateState,
  type WindowControls,
} from "../shared/api.js";

/** Reads one `--name=value` the main process put on the command line. These
 *  carry facts the window needs on frame one — the OS material behind it and
 *  which edge its buttons sit on — that a round trip would deliver too late. */
function launchFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
}

/** Subscribes to a main-process event and returns the unsubscribe. Returning it
 *  rather than exposing `removeListener` is what stops a renderer from
 *  detaching a listener it does not own. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
}

const api: ConstructApi = {
  bootstrap: () => ipcRenderer.invoke(ipc.bootstrap),

  listProjects: () => ipcRenderer.invoke(ipc.projectsList),
  createProject: (input) => ipcRenderer.invoke(ipc.projectsCreate, input),
  importProject: (input) => ipcRenderer.invoke(ipc.projectsImport, input),
  openProject: (input) => ipcRenderer.invoke(ipc.projectsOpen, input),
  renameProject: (input) => ipcRenderer.invoke(ipc.projectsRename, input),
  setProjectPinned: (input) => ipcRenderer.invoke(ipc.projectsPin, input),
  setProjectArchived: (input) => ipcRenderer.invoke(ipc.projectsArchive, input),
  deleteProject: (input) => ipcRenderer.invoke(ipc.projectsDelete, input),

  listFiles: (input) => ipcRenderer.invoke(ipc.filesList, input),
  readFile: (input) => ipcRenderer.invoke(ipc.filesRead, input),
  writeFile: (input) => ipcRenderer.invoke(ipc.filesWrite, input),
  statSource: (input) => ipcRenderer.invoke(ipc.sourceStat, input),
  readSource: (input) => ipcRenderer.invoke(ipc.sourceRead, input),
  listSource: (input) => ipcRenderer.invoke(ipc.sourceList, input),
  createFile: (input) => ipcRenderer.invoke(ipc.filesCreate, input),
  createDirectory: (input) => ipcRenderer.invoke(ipc.filesCreateDirectory, input),
  renameFile: (input) => ipcRenderer.invoke(ipc.filesRename, input),
  removeFile: (input) => ipcRenderer.invoke(ipc.filesRemove, input),

  createTerminal: (input) => ipcRenderer.invoke(ipc.terminalCreate, input),
  writeTerminal: (input) => ipcRenderer.invoke(ipc.terminalWrite, input),
  resizeTerminal: (input) => ipcRenderer.invoke(ipc.terminalResize, input),
  disposeTerminal: (input) => ipcRenderer.invoke(ipc.terminalDispose, input),
  onTerminalEvent: (listener) => subscribe<TerminalEvent>("terminal:event", listener),

  startLanguageServer: (input) => ipcRenderer.invoke(ipc.lspStart, input),
  sendToLanguageServer: (input) => ipcRenderer.invoke(ipc.lspSend, input),
  stopLanguageServer: (input) => ipcRenderer.invoke(ipc.lspStop, input),
  onLanguageServerEvent: (listener) => subscribe<LspEvent>("lsp:event", listener),
  listLanguageServers: () => ipcRenderer.invoke(ipc.lspCatalog),
  installLanguageServer: (input) => ipcRenderer.invoke(ipc.lspInstall, input),
  uninstallLanguageServer: (input) => ipcRenderer.invoke(ipc.lspUninstall, input),
  onLanguageServerInstall: (listener) => subscribe<LanguageServerInstallEvent>("lsp:install-event", listener),

  agentMessages: (input) => ipcRenderer.invoke(ipc.agentMessages, input),
  agentStatus: (input) => ipcRenderer.invoke(ipc.agentStatus, input),
  sendToAgent: (input) => ipcRenderer.invoke(ipc.agentSend, input),
  answerAgent: (input) => ipcRenderer.invoke(ipc.agentAnswer, input),
  listConcepts: (input) => ipcRenderer.invoke(ipc.conceptsList, input),
  conceptStandings: (input) => ipcRenderer.invoke(ipc.conceptsStandings, input),
  conceptEvidence: (input) => ipcRenderer.invoke(ipc.conceptsEvidence, input),
  conceptAtlas: () => ipcRenderer.invoke(ipc.conceptsAtlas),
  deleteConcept: (input) => ipcRenderer.invoke(ipc.conceptsDelete, input),
  conceptHistory: (input) => ipcRenderer.invoke(ipc.conceptsHistory, input),
  readMemory: (input) => ipcRenderer.invoke(ipc.memoryRead, input),
  readPath: (input) => ipcRenderer.invoke(ipc.pathRead, input),
  onAgentEvent: (listener) => subscribe<AgentEvent>("agent:event", listener),
  onAgentStream: (listener) => subscribe<AgentStreamEvent>("agent:stream", listener),

  auth: (request) => ipcRenderer.invoke(ipc.authRequest, request),
  signOut: () => ipcRenderer.invoke(ipc.authSignOut),
  deleteAccount: () => ipcRenderer.invoke(ipc.authDeleteAccount),

  listProviders: () => ipcRenderer.invoke(ipc.settingsProviders),
  saveProviderSecret: (input) => ipcRenderer.invoke(ipc.settingsSaveSecret, input),
  disconnectProvider: (provider: ProviderId) => ipcRenderer.invoke(ipc.settingsProviderDisconnect, provider),
  setDefaultProvider: (provider: ProviderId, model: string) => ipcRenderer.invoke(ipc.settingsProviderDefault, { provider, model }),
  providerUsage: (provider: ProviderId) => ipcRenderer.invoke(ipc.settingsProviderUsage, provider),
  setReasoningEffort: (effort) => ipcRenderer.invoke(ipc.settingsReasoningEffort, effort),
  startProviderOAuth: (provider) => ipcRenderer.invoke(ipc.settingsProviderOauthStart, provider),
  submitProviderOAuth: (flowId: string, value: string) => ipcRenderer.invoke(ipc.settingsProviderOauthSubmit, { flowId, value }),
  cancelProviderOAuth: (flowId: string) => ipcRenderer.invoke(ipc.settingsProviderOauthCancel, flowId),
  webSearchStatus: () => ipcRenderer.invoke(ipc.settingsWebSearch),
  saveWebSearchKey: (key: string) => ipcRenderer.invoke(ipc.settingsWebSearchSave, key),
  clearWebSearchKey: () => ipcRenderer.invoke(ipc.settingsWebSearchClear),
  setWebSearchEnabled: (enabled: boolean) => ipcRenderer.invoke(ipc.settingsWebSearchEnabled, enabled),

  openExternal: (url: string) => ipcRenderer.invoke(ipc.settingsOpenExternal, url),
  showContextMenu: (input) => ipcRenderer.invoke(ipc.showContextMenu, input),
  suggestProjectName: (input) => ipcRenderer.invoke(ipc.suggestProjectName, input),
  stopAgent: (input) => ipcRenderer.invoke(ipc.agentStop, input),
  editMessage: (input) => ipcRenderer.invoke(ipc.agentEdit, input),
  steerAgent: (input) => ipcRenderer.invoke(ipc.agentSteer, input),
  undoableMessages: (input) => ipcRenderer.invoke(ipc.agentUndoable, input),
  syncNow: () => ipcRenderer.invoke(ipc.syncNow),
  syncStatus: () => ipcRenderer.invoke(ipc.syncStatus),
  onSyncStatus: (listener) => subscribe("sync:status", listener),
  listTasks: (input) => ipcRenderer.invoke(ipc.tasksList, input),
  submitTask: (input) => ipcRenderer.invoke(ipc.tasksSubmit, input),
  setTheme: (theme) => ipcRenderer.invoke(ipc.settingsTheme, theme),
  setProjectDefaults: (input) => ipcRenderer.invoke(ipc.settingsProjectDefaults, input),

  readLearner: () => ipcRenderer.invoke(ipc.learnerRead),
  saveLearner: (input) => ipcRenderer.invoke(ipc.learnerSave, input),
  learnerQuestion: (input) => ipcRenderer.invoke(ipc.learnerQuestion, input),
  learnerPortrait: (input) => ipcRenderer.invoke(ipc.learnerPortrait, input),
  learnerOpening: (input) => ipcRenderer.invoke(ipc.learnerOpening, input),
  setWindowStage: (stage) => ipcRenderer.invoke(ipc.windowStage, stage),
  updateState: () => ipcRenderer.invoke(ipc.updateState),
  checkForUpdate: () => ipcRenderer.invoke(ipc.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(ipc.updateDownload),
  dismissUpdateChangelog: (version: string) => ipcRenderer.invoke(ipc.updateDismissChangelog, version),

  onUpdateState: (listener) => subscribe<UpdateState>("update:state", listener),
  onProviderOAuthEvent: (listener) => subscribe<ProviderOAuthEvent>("provider:oauth-event", listener),
  onMenuCommand: (listener) => subscribe<MenuCommand>("menu:command", listener),
  onNativeSurface: (listener) => subscribe<NativeSurface>("window:surface", listener),

  chrome: {
    platform: process.platform,
    surface: launchFlag("construct-surface", "none") as NativeSurface,
    controls: launchFlag("construct-controls", process.platform === "darwin" ? "left" : "right") as WindowControls,
  },
  build: {
    version: launchFlag("construct-version", "0.0.0"),
    commit: launchFlag("construct-commit", "") || null,
    branch: launchFlag("construct-branch", "") || null,
    packaged: launchFlag("construct-packaged", "0") === "1",
  },
};

/** Choosing where a project lives. Not part of `ConstructApi` because it is a
 *  host capability rather than a Construct one — the renderer asks the OS for a
 *  path through the main process and never composes one itself. */
const host = {
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:choose-directory"),
};

contextBridge.exposeInMainWorld("construct", api);
contextBridge.exposeInMainWorld("constructHost", host);

export type ConstructHost = typeof host;
