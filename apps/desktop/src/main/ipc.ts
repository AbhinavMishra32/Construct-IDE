import { BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from "electron";
import { z } from "zod";
import {
  authRequestInput,
  contextMenuInput,
  ipc,
  taskSubmitInput,
  projectCreateInput,
  conceptDeleteInput,
  projectDefaultsInput,
  learnerDraftInput,
  learnerOpeningInput,
  learnerProfileInput,
  windowStageSchema,
  projectIdInput,
  projectImportInput,
  projectRenameInput,
  projectFlagInput,
  workspaceListInput,
  workspacePathInput,
  workspaceRenameInput,
  workspaceWriteInput,
  sourcePathInput,
  terminalCreateInput,
  terminalWriteInput,
  terminalResizeInput,
  terminalIdInput,
  lspStartInput,
  lspSendInput,
  lspStopInput,
  lspServerIdInput,
  agentEditInput,
  agentSendInput,
  agentAnswerInput,
  providerSettingsInput,
  reasoningEffortSchema,
  themePreferenceSchema,
  type BootstrapData,
  type ProviderId,
} from "../shared/api.js";
import { fitWindowTo } from "./window.js";
import type { AuthService } from "./auth.js";
import type { ProjectService } from "./projects/projectService.js";
import type { LearnerProfileService } from "./learner/learnerProfile.js";
import type { ProviderService } from "./provider.js";
import type { WorkspaceService } from "./projects/workspaceService.js";
import { SourceService } from "./projects/sourceService.js";
import type { TerminalService } from "./terminal/terminalService.js";
import type { LspService } from "./lsp/lspService.js";
import type { LanguageServerService } from "./lsp/languageServerService.js";
import type { AgentService } from "./agent/agentService.js";
import type { SyncService } from "./sync/syncService.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { WebSearchService } from "./webSearch.js";
import type { MemoryService } from "./memory/memoryService.js";
import type { PathService } from "./learning/pathService.js";

type Dependencies = {
  store: ProjectStore;
  auth: AuthService;
  projects: ProjectService;
  providers: ProviderService;
  workspace: WorkspaceService;
  terminals: TerminalService;
  lsp: LspService;
  servers: LanguageServerService;
  agent: AgentService;
  memory: MemoryService;
  learningPath: PathService;
  web: WebSearchService;
  window: () => BrowserWindow | null;
  learner: LearnerProfileService;
  sync: SyncService;
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
export function installIpc({ store, auth, projects, providers, workspace, terminals, lsp, servers, agent, memory, learningPath, learner, web, sync, window }: Dependencies): void {
  const handle = <T>(channel: string, handler: (input: unknown) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_event, input: unknown) => handler(input));
  };

  handle(ipc.bootstrap, async (): Promise<BootstrapData> => {
    const account = await auth.account();
    return {
      signedIn: Boolean(account),
      email: account?.email ?? null,
      theme: store.theme(),
      projectDefaults: projects.defaults(),
      learner: learner.read(),
      onboarded: learner.onboarded(),
      projects: projects.list(),
      providers: await providers.inventory(),
      notices: [],
    };
  });

  /* ---- Projects --------------------------------------------------------- */

  handle(ipc.projectsList, () => projects.list());

  handle(ipc.projectsCreate, async (input) => {
    const project = await projects.create(projectCreateInput.parse(input));
    /* Deliberately not awaited. Creating a project returns as soon as the folder
       exists; Construct then reads up on the domain and opens the project with
       its first real teaching step, reporting itself on the agent event channel
       like any other turn. Awaiting it here would leave the learner staring at a
       dialog while a research pass ran. */
    void agent.begin(project.id).catch((cause: unknown) => {
      console.error("[construct] project start failed", cause);
    });
    return project;
  });

  handle(ipc.projectsImport, (input) => projects.import(projectImportInput.parse(input)));

  handle(ipc.projectsOpen, (input) => {
    const detail = projects.open(projectIdInput.parse(input).projectId);
    /* Resumes a start that never finished.
       
       Creating a project kicks off research and the first teaching turn without
       awaiting them, so anything that ends the main process in the meantime —
       a quit, a crash, a reload during development — leaves the project with
       its folder and its memory files and an empty thread, and nothing ever
       tries again. Opening it is the natural moment to notice.

       The question is whether anyone has been *taught* yet, not whether the
       thread is empty. A kickoff stores a system note between its two turns, so
       "no messages at all" declared a project started the moment it had read up
       on itself — and one interrupted in that gap was never resumed, showing a
       single line about research and then silence for good. `begin` makes the
       same judgement itself and skips the reading it has already done. */
    if (!detail.messages.some((message) => message.role === "agent" || message.role === "learner") && !agent.busy(detail.summary.id)) {
      void agent.begin(detail.summary.id).catch((cause: unknown) => {
        console.error("[construct] project start failed", cause);
      });
    }
    return detail;
  });

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

  /* Source files, absolute and read-only — see `SourceService`. No project is
     named because a definition can be outside every project Construct knows;
     the service reads and never writes, which is what keeps that safe. */
  const source = new SourceService();

  handle(ipc.sourceStat, (input) => source.stat(sourcePathInput.parse(input).path));
  handle(ipc.sourceRead, (input) => source.read(sourcePathInput.parse(input).path));
  handle(ipc.sourceList, (input) => source.list(sourcePathInput.parse(input).path));

  handle(ipc.filesWrite, (input) => {
    const { projectId, path: relative, content } = workspaceWriteInput.parse(input);
    return workspace.write(directoryOf(projectId), relative, content);
  });

  /* The tree's own edits. The service has had these since it was written; they
     had no channel, so the file tree was read-only in an app that calls itself
     an IDE. Every one goes through the same `resolveInsideReal` containment the
     read and write paths use — a rename is checked at both ends. */
  handle(ipc.filesCreate, (input) => {
    const { projectId, path: relative } = workspacePathInput.parse(input);
    return workspace.createFile(directoryOf(projectId), relative);
  });

  handle(ipc.filesCreateDirectory, (input) => {
    const { projectId, path: relative } = workspacePathInput.parse(input);
    return workspace.createDirectory(directoryOf(projectId), relative);
  });

  handle(ipc.filesRename, (input) => {
    const { projectId, from, to } = workspaceRenameInput.parse(input);
    return workspace.rename(directoryOf(projectId), from, to);
  });

  handle(ipc.filesRemove, (input) => {
    const { projectId, path: relative } = workspacePathInput.parse(input);
    return workspace.remove(directoryOf(projectId), relative);
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

  handle(ipc.lspStart, async (input) => {
    const { projectId, sessionId, serverId } = lspStartInput.parse(input);
    /* Resolved at start rather than remembered: a server can be installed,
       removed or updated between one file being opened and the next. */
    const server = await servers.command(serverId);
    if (!server) throw new Error("That language server is not installed.");
    lsp.start({ sessionId, server, cwd: directoryOf(projectId) });
  });

  handle(ipc.lspSend, (input) => {
    const { sessionId, message } = lspSendInput.parse(input);
    lsp.send(sessionId, message);
  });

  handle(ipc.lspStop, (input) => lsp.stopSession(lspStopInput.parse(input).sessionId));
  handle(ipc.lspCatalog, () => servers.list());
  handle(ipc.lspInstall, (input) => servers.install(lspServerIdInput.parse(input).serverId));
  handle(ipc.lspUninstall, (input) => servers.uninstall(lspServerIdInput.parse(input).serverId));

  /* ---- The agent --------------------------------------------------------- */

  handle(ipc.agentMessages, (input) => agent.messages(projectIdInput.parse(input).projectId));
  handle(ipc.agentStatus, (input) => agent.status(projectIdInput.parse(input).projectId));
  /* Sync is asked for, never imposed. It runs when the window asks — on open,
     after a turn, and from the account panel — so a learner who never signs in
     never talks to the network. */
  handle(ipc.syncNow, () => sync.run());
  handle(ipc.syncStatus, () => sync.current());

  handle(ipc.tasksList, (input) => store.listTasks(projectIdInput.parse(input).projectId));

  /**
   * The learner says a task is done.
   *
   * Moves it to "submitted" and asks the agent to judge it in the same breath.
   * Two steps rather than one message, because the status is what the card
   * reads from — a task waiting on review has to look different from one nobody
   * has looked at, and a chat message alone cannot say that.
   */
  handle(ipc.tasksSubmit, (input) => {
    const { projectId, taskId } = taskSubmitInput.parse(input);
    const task = store.listTasks(projectId).find((entry) => entry.taskId === taskId);
    if (!task) throw new Error("That task no longer exists.");

    store.setTaskStatus(projectId, taskId, "submitted");
    /* Sent on the same channel the agent's own events use, so the window has
       one place to learn that tasks changed. */
    window()?.webContents.send("agent:event", { projectId, kind: "tasks" });
    void agent
      .send(projectId, `I have finished the task "${task.title}". Please review it against its criteria.`)
      .catch((cause: unknown) => console.error("[construct] task review failed", cause));
  });

  handle(ipc.suggestProjectName, async (input) => {
    const { goal } = z.object({ goal: z.string().trim().min(1).max(2_000) }).parse(input);
    return agent.nameFor(goal);
  });

  handle(ipc.agentStop, (input) => agent.stopTurn(projectIdInput.parse(input).projectId));

  handle(ipc.agentEdit, (input) => {
    const { projectId, messageId, body } = agentEditInput.parse(input);
    return agent.editMessage(projectId, messageId, body);
  });

  handle(ipc.agentSteer, (input) => {
    const { projectId, body } = agentSendInput.parse(input);
    return agent.steer(projectId, body);
  });

  handle(ipc.agentUndoable, (input) => store.snapshotMessageIds(projectIdInput.parse(input).projectId));

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

  handle(ipc.conceptsList, (input) => store.listConcepts(projectIdInput.parse(input).projectId));
  handle(ipc.conceptsAtlas, () => store.listAllConcepts());

  handle(ipc.memoryRead, (input) => {
    const project = store.readProject(projectIdInput.parse(input).projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    return memory.read(project.directory);
  });

  handle(ipc.pathRead, (input) => learningPath.read(projectIdInput.parse(input).projectId));
  handle(ipc.conceptsHistory, (input) => {
    const { projectId, conceptId } = conceptDeleteInput.parse(input);
    return store.listConceptEvents(projectId, conceptId);
  });

  handle(ipc.conceptsDelete, (input) => {
    const { projectId, conceptId } = conceptDeleteInput.parse(input);
    store.deleteConcept(projectId, conceptId);
  });

  /* ---- Account ---------------------------------------------------------- */

  handle(ipc.authRequest, (input) => auth.request(authRequestInput.parse(input)));
  /* Signing out empties the device, not just the keychain.
     Nothing in the local store carries an account, so anything left behind is
     served straight to whoever signs in next — which is exactly what happened:
     a newly created account opened onto the previous learner's projects and
     skipped intake entirely, because "already onboarded" was recorded about the
     computer rather than about the person.

     The flush comes first, while the token still authenticates. After the wipe
     there is no way up: work that never reached the cloud would be gone, and
     losing a turn because somebody signed out is not a trade worth making. It
     is allowed to fail — signing out has to work on a plane. */
  handle(ipc.authSignOut, async () => {
    await sync.run().catch(() => undefined);
    await auth.signOut();
    store.clearAccountData();
  });
  /* No flush here, and that asymmetry is deliberate. The account is being
     destroyed on the server; pushing this device's last few rows into it first
     would be writing to something that is about to stop existing. */
  handle(ipc.authDeleteAccount, async () => {
    await auth.deleteAccount();
    store.clearAccountData();
  });

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

  handle(ipc.settingsProjectDefaults, (input) => projects.setDefaults(projectDefaultsInput.parse(input)));

  /* ---- Who Construct is teaching ---------------------------------------- */

  handle(ipc.learnerRead, () => learner.read());

  handle(ipc.learnerSave, async (input) => {
    const profile = await learner.save(learnerProfileInput.parse(input));
    /* The home language chosen on the way in becomes what new projects
       inherit. Asking for it twice — once in the intake and again in the
       dialog — is asking the same question twice and then ignoring the first
       answer. Their own later change in Settings still wins, because this only
       runs when the profile is saved. */
    await projects.setDefaults({ language: profile.language });
    return profile;
  });

  handle(ipc.learnerQuestion, (input) => agent.learnerQuestion(learnerDraftInput.parse(input)));
  handle(ipc.learnerPortrait, (input) => agent.learnerPortrait(learnerDraftInput.parse(input)));
  handle(ipc.learnerOpening, (input) => {
    const { taken, ...draft } = learnerOpeningInput.parse(input);
    return agent.learnerOpening(draft, taken);
  });

  handle(ipc.windowStage, (input) => fitWindowTo(window(), windowStageSchema.parse(input)));

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

  /**
   * The platform's own context menu.
   *
   * Built here rather than drawn in the renderer because a menu is one of the
   * few things a web view cannot fake convincingly: the real one takes the
   * system's font, spacing, highlight, keyboard handling, and its behaviour
   * near a screen edge, and on macOS it is the only kind that does not look
   * like a web page pretending.
   *
   * `popup` resolves as soon as the menu is shown, so the choice is reported
   * through a promise the click settles — and `callback` runs on dismissal
   * whether or not anything was picked, which is what closes it out with null.
   */
  ipcMain.handle(ipc.showContextMenu, async (event, raw) => {
    const { items } = contextMenuInput.parse(raw);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null;
      const menu = Menu.buildFromTemplate(
        items.map((item) =>
          item.type === "separator"
            ? { type: "separator" as const }
            : {
                label: item.label ?? "",
                enabled: item.enabled !== false,
                click: () => {
                  chosen = item.id ?? null;
                },
              },
        ),
      );
      /* Resolved from the dismissal callback rather than from each click, so
         there is exactly one place the promise can settle and a menu closed
         with Escape settles it too. */
      menu.popup({ window, callback: () => resolve(chosen) });
    });
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
