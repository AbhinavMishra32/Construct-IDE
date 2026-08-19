import { contextBridge, ipcRenderer } from "electron";
import {
  ipc,
  type ConstructApi,
  type MenuCommand,
  type NativeSurface,
  type ProviderId,
  type ProviderOAuthEvent,
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
  deleteProject: (input) => ipcRenderer.invoke(ipc.projectsDelete, input),

  listFiles: (input) => ipcRenderer.invoke(ipc.filesList, input),
  readFile: (input) => ipcRenderer.invoke(ipc.filesRead, input),
  writeFile: (input) => ipcRenderer.invoke(ipc.filesWrite, input),

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
  setTheme: (theme) => ipcRenderer.invoke(ipc.settingsTheme, theme),
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
