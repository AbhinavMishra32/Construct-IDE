import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import type { z } from "zod";
import {
  authRequestInput,
  ipc,
  projectCreateInput,
  projectIdInput,
  projectImportInput,
  projectRenameInput,
  projectFlagInput,
  workspaceListInput,
  workspacePathInput,
  workspaceWriteInput,
  terminalCreateInput,
  terminalWriteInput,
  terminalResizeInput,
  terminalIdInput,
  lspStartInput,
  lspSendInput,
  lspStopInput,
  agentSendInput,
  agentAnswerInput,
  providerSettingsInput,
  reasoningEffortSchema,
  themePreferenceSchema,
  type BootstrapData,
  type ProviderId,
} from "../shared/api.js";
import type { AuthService } from "./auth.js";
import type { ProjectService } from "./projects/projectService.js";
import type { ProviderService } from "./provider.js";
import type { WorkspaceService } from "./projects/workspaceService.js";
import type { TerminalService } from "./terminal/terminalService.js";
import type { LspService } from "./lsp/lspService.js";
import type { AgentService } from "./agent/agentService.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { WebSearchService } from "./webSearch.js";

type Dependencies = {
  store: ProjectStore;
  auth: AuthService;
  projects: ProjectService;
  providers: ProviderService;
  workspace: WorkspaceService;
  terminals: TerminalService;
  lsp: LspService;
  agent: AgentService;
  web: WebSearchService;
  window: () => BrowserWindow | null;
};

/**
 * Every channel the renderer may call, in one place.
 *
 * Two rules hold throughout. Input that came from the renderer is parsed by the
 * schema the contract declares before anything touches it — a renderer is not a
 * trusted caller just because Construct wrote it. And a handler's failure is
 * allowed to reach the renderer as a message, because every one of these is
 * surfaced to a person who has to decide what to do next.
 */
export function installIpc({ store, auth, projects, providers, workspace, terminals, lsp, agent, web, window }: Dependencies): void {
  const handle = <T>(channel: string, handler: (input: unknown) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_event, input: unknown) => handler(input));
  };

  handle(ipc.bootstrap, async (): Promise<BootstrapData> => {
    const account = await auth.account();
    return {
      signedIn: Boolean(account),
      email: account?.email ?? null,
      theme: store.theme(),
      projects: projects.list(),
      providers: await providers.inventory(),
      notices: [],
    };
  });

  /* ---- Projects --------------------------------------------------------- */

  handle(ipc.projectsList, () => projects.list());

  handle(ipc.projectsCreate, (input) => projects.create(projectCreateInput.parse(input)));

  handle(ipc.projectsImport, (input) => projects.import(projectImportInput.parse(input)));

  handle(ipc.projectsOpen, (input) => projects.open(projectIdInput.parse(input).projectId));

  handle(ipc.projectsRename, (input) => {
    const { projectId, name } = projectRenameInput.parse(input);
    projects.rename(projectId, name);
  });

  handle(ipc.projectsPin, (input) => {
    const { projectId, value } = projectFlagInput.parse(input);
    projects.setPinned(projectId, value);
  });

  handle(ipc.projectsArchive, (input) => {
    const { projectId, value } = projectFlagInput.parse(input);
    projects.setArchived(projectId, value);
  });

  handle(ipc.projectsDelete, (input) => projects.delete(projectIdInput.parse(input).projectId));

  /* ---- Files -------------------------------------------------------------
     Every handler resolves the project first, so a renderer naming a project
     it does not have open still cannot reach a path outside that project. */

  const directoryOf = (projectId: string): string => {
    const project = projects.list().find((row) => row.id === projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    if (!project.present) throw new Error(`Construct cannot find ${project.directory}.`);
    return project.directory;
  };

  handle(ipc.filesList, (input) => {
    const { projectId, directory } = workspaceListInput.parse(input);
    return workspace.list(directoryOf(projectId), directory ?? "");
  });

  handle(ipc.filesRead, (input) => {
    const { projectId, path: relative } = workspacePathInput.parse(input);
    return workspace.read(directoryOf(projectId), relative);
  });

  handle(ipc.filesWrite, (input) => {
    const { projectId, path: relative, content } = workspaceWriteInput.parse(input);
    return workspace.write(directoryOf(projectId), relative, content);
  });

  /* ---- Terminals --------------------------------------------------------- */

  handle(ipc.terminalCreate, (input) => {
    const { projectId, terminalId, cols, rows } = terminalCreateInput.parse(input);
    terminals.create({ terminalId, cwd: directoryOf(projectId), ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) });
  });

  handle(ipc.terminalWrite, (input) => {
    const { terminalId, data } = terminalWriteInput.parse(input);
    terminals.write(terminalId, data);
  });

  handle(ipc.terminalResize, (input) => {
    const { terminalId, cols, rows } = terminalResizeInput.parse(input);
    terminals.resize(terminalId, cols, rows);
  });

  handle(ipc.terminalDispose, (input) => terminals.dispose(terminalIdInput.parse(input).terminalId));

  /* ---- Language servers -------------------------------------------------- */

  handle(ipc.lspStart, (input) => {
    const { projectId, sessionId, language } = lspStartInput.parse(input);
    lsp.start({ sessionId, language, cwd: directoryOf(projectId) });
  });

  handle(ipc.lspSend, (input) => {
    const { sessionId, message } = lspSendInput.parse(input);
    lsp.send(sessionId, message);
  });

  handle(ipc.lspStop, (input) => lsp.stopSession(lspStopInput.parse(input).sessionId));

  /* ---- The agent --------------------------------------------------------- */

  handle(ipc.agentMessages, (input) => agent.messages(projectIdInput.parse(input).projectId));

  handle(ipc.agentSend, (input) => {
    const { projectId, body } = agentSendInput.parse(input);
    /* Deliberately not awaited. A turn runs for minutes; the renderer's call
       returns as soon as the turn is accepted and follows it on the event
       channel instead of holding an IPC reply open. */
    void agent.send(projectId, body);
  });

  handle(ipc.agentAnswer, (input) => {
    const { projectId, answer } = agentAnswerInput.parse(input);
    agent.answer(projectId, answer);
  });

  /* ---- Account ---------------------------------------------------------- */

  handle(ipc.authRequest, (input) => auth.request(authRequestInput.parse(input)));
  handle(ipc.authSignOut, () => auth.signOut());
  handle(ipc.authDeleteAccount, () => auth.deleteAccount());

  /* ---- Inference -------------------------------------------------------- */

  handle(ipc.settingsProviders, () => providers.inventory());
  handle(ipc.settingsSaveSecret, (input) => providers.saveCredential(providerSettingsInput.parse(input)));
  handle(ipc.settingsProviderDisconnect, (input) => providers.disconnect(input as ProviderId));
  handle(ipc.settingsProviderDefault, (input) => {
    const { provider, model } = input as { provider: ProviderId; model: string };
    return providers.setDefault(provider, model);
  });
  handle(ipc.settingsProviderUsage, (input) => providers.subscriptionUsage(input as ProviderId));
  handle(ipc.settingsProviderOauthStart, (input) => providers.startOAuth(input as Parameters<ProviderService["startOAuth"]>[0]));
  handle(ipc.settingsProviderOauthSubmit, (input) => {
    const { flowId, value } = input as { flowId: string; value: string };
    return providers.submitOAuth(flowId, value);
  });
  handle(ipc.settingsProviderOauthCancel, (input) => providers.cancelOAuth(String(input)));
  handle(ipc.settingsReasoningEffort, (input) => providers.setReasoningEffort(reasoningEffortSchema.parse(input)));

  /* Whether the agent can reach the web, and where its key came from. The key
     itself is never read back — Settings shows the state, not the secret. */
  handle(ipc.settingsWebSearch, async () => ({
    source: await web.keySource(),
    enabled: store.getSetting<boolean>("web-search-enabled", true),
  }));
  handle(ipc.settingsWebSearchSave, (input) => auth.saveSecret("exa", String(input)));
  handle(ipc.settingsWebSearchClear, () => auth.deleteSecret("exa"));
  /* Separate from holding a key: someone can keep their key and still want a
     session that only reads their own project. */
  handle(ipc.settingsWebSearchEnabled, (input) => store.setSetting("web-search-enabled", Boolean(input)));

  /* ---- Application ------------------------------------------------------ */

  handle(ipc.settingsTheme, (input) => {
    const theme = themePreferenceSchema.parse(input);
    store.setTheme(theme);
    /* Electron owns what the OS paints behind a translucent window, so the
       preference has to reach nativeTheme and not only the stylesheet. */
    nativeTheme.themeSource = theme;
  });

  handle(ipc.settingsOpenExternal, async (input) => {
    const url = String(input);
    /* Only ever a web page. `shell.openExternal` will hand file: and custom
       schemes to whatever the OS has registered for them, which turns a link in
       agent output into arbitrary local execution. */
    if (!/^https:\/\//i.test(url)) throw new Error("Construct only opens https links.");
    await shell.openExternal(url);
  });

  /* Choosing where a project lives. The picker runs in the main process and
     returns a path the renderer never composed, which is what keeps the
     filesystem out of the renderer's reach. */
  ipcMain.handle("dialog:choose-directory", async () => {
    const parent = window();
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

export type { Dependencies as IpcDependencies };
export type ProviderSettingsInput = z.infer<typeof providerSettingsInput>;
