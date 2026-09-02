import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { apiOrigin } from "./apiOrigin.js";
import { AuthService } from "./auth.js";
import { installDockIcon } from "./dockIcon.js";
import { installIpc } from "./ipc.js";
import { installMenu } from "./menu.js";
import { ProjectService } from "./projects/projectService.js";
import { ProviderService } from "./provider.js";
import { WorkspaceService } from "./projects/workspaceService.js";
import { SnapshotService } from "./projects/snapshotService.js";
import { SyncService } from "./sync/syncService.js";
import { TerminalService } from "./terminal/terminalService.js";
import { LspService } from "./lsp/lspService.js";
import { LanguageServerService } from "./lsp/languageServerService.js";
import { AgentService } from "./agent/agentService.js";
import { ProjectStore } from "./store/projectStore.js";
import { UpdateService } from "./updates.js";
import { WebSearchService } from "./webSearch.js";
import { MemoryService } from "./memory/memoryService.js";
import { LearnerProfileService, profileMemoryLines } from "./learner/learnerProfile.js";
import { PathService } from "./learning/pathService.js";
import { createMainWindow } from "./window.js";
import { themePreferenceSchema } from "../shared/api.js";

let mainWindow: BrowserWindow | null = null;
let store: ProjectStore;
let updates: UpdateService | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app
    .whenReady()
    .then(async () => {
      const root = path.join(app.getPath("userData"), "construct");
      await mkdir(root, { recursive: true });

      store = new ProjectStore(path.join(root, "state.sqlite3"));
      /* Read before the window exists. Electron paints the OS material behind a
         translucent window before the renderer has run a line, so a theme
         applied later would show as a flash of the wrong one. */
      nativeTheme.themeSource = themePreferenceSchema.catch("system").parse(store.theme());

      const auth = new AuthService(apiOrigin());
      const workspace = new WorkspaceService();
      const snapshots = new SnapshotService();
      /* Flow Memory: the four Markdown files in each project's own `.construct`.
         Created with the project, so it exists before any agent runs. */
      const memory = new MemoryService(workspace);
      /* Who Construct is teaching, for the whole application rather than one
         project. Built before anything that reads it, and beside the database
         because the readable copy belongs with everything else Construct keeps
         about this machine. */
      const learner = new LearnerProfileService(store, root);
      const projects = new ProjectService(store, memory, () => profileMemoryLines(learner.read()));
      /* Nobody who was already using Construct is asked to introduce
         themselves to it. See `adoptExisting`. */
      learner.adoptExisting(projects.list().length > 0);
      const terminals = new TerminalService((event) => mainWindow?.webContents.send("terminal:event", event));
      const lsp = new LspService((event) => mainWindow?.webContents.send("lsp:event", event));
      /* The catalog of language servers and how to get them. Rooted beside the
         database, so every server a learner installs is inside Construct's own
         directory and uninstalling one leaves nothing on their machine. */
      const servers = new LanguageServerService(root, (event) => mainWindow?.webContents.send("lsp:install-event", event));
      const providers = new ProviderService(auth, store, (event) => mainWindow?.webContents.send("provider:oauth-event", event));
      /* The learner's own Exa key, read through the same keychain the provider
         keys live in. Held in the main process because that is the only side
         with keychain access. */
      const web = new WebSearchService(() => auth.readSecret("exa"));
      /* The path: what Construct has decided to teach, in order — kept beside
         memory because planning it rewrites `path.md`. */
      const learningPath = new PathService(store, memory);
      const agent = new AgentService(
        store,
        providers,
        workspace,
        memory,
        learningPath,
        web,
        snapshots,
        learner,
        (event) => mainWindow?.webContents.send("agent:event", event),
        (event) => mainWindow?.webContents.send("agent:stream", event),
      );


      /* One idempotent shutdown path serves both an ordinary quit and an
         update. quitAndInstall closes windows before Electron emits
         before-quit, so waiting for that event would race the installer; the
         updater awaits this first and the later event sees the settled promise
         rather than closing SQLite twice. */
      let shutdown: Promise<void> | null = null;
      const prepareToExit = () =>
        (shutdown ??= (async () => {
          updates?.stop();
          /* Shells outlive the window that opened them, so they are killed
             deliberately rather than left as orphans. */
          terminals.stop();
          /* Language servers are long-lived and memory-hungry; one left behind
             is a few hundred megabytes left behind. */
          lsp.stop();
          agent.stop();
          store.close();
        })());

      /* Asked before the window exists so it opens at the size it belongs at.
         Opening large and resizing once the renderer reports in would read as
         the application correcting a mistake in front of the learner. */
      /* Three sizes, because there are three things the window can be showing
         before it is a workspace: two fields, an intake, or the app. Signing in
         is not the moment Construct becomes a workspace — finishing the intake
         is. */
      const stage = !(await auth.account())
        ? ("sign-in" as const)
        : learner.onboarded()
          ? ("app" as const)
          : ("onboarding" as const);

      /* Sync is deliberately built last and passed in rather than reached for:
         nothing above it may depend on the cloud being there, which is what
         keeps the app whole with no network and no account. */
      const sync = new SyncService(
        store,
        apiOrigin(),
        () => auth.accessToken(),
        () => projects.defaults().directory,
        learner,
        (status) => mainWindow?.webContents.send("sync:status", status),
      );

      installIpc({ store, auth, projects, providers, workspace, terminals, lsp, servers, agent, memory, learningPath, learner, web, sync, window: () => mainWindow });

      /* When a sync actually happens.
         
         On launch, and then on a slow timer. Not after every write: a turn
         writes a message, a concept, a task and a path node within a second of
         each other, and syncing on each would be four round trips describing
         one moment. Five minutes is far below the interval at which a learner
         moves between machines, and the window can always ask for one.
         
         Unawaited and unguarded on purpose — a failure here is reported through
         the status channel and must never reach the launch path. */
      void sync.run();
      const syncTimer = setInterval(() => void sync.run(), 5 * 60_000);
      app.once("before-quit", () => clearInterval(syncTimer));
      updates = new UpdateService(store, () => mainWindow, prepareToExit);
      updates.installIpc();
      installMenu(() => mainWindow);
      installDockIcon();
      mainWindow = createMainWindow({ stage });
      updates.start();

      app.on("before-quit", () => {
        void prepareToExit();
      });
      app.on("activate", async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow({ stage: (await auth.account()) ? "app" : "sign-in" });
        }
      });
    })
    .catch((error: unknown) => {
      /* A rejected async Electron event otherwise becomes an unhandled promise
         and leaves a process with a Dock icon but no window. This is the
         last-resort boundary; recoverable dependencies such as Keychain are
         handled closer to their owner. */
      console.error("Desktop bootstrap failed:", error);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
