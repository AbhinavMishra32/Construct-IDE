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
import { TerminalService } from "./terminal/terminalService.js";
import { LspService } from "./lsp/lspService.js";
import { AgentService } from "./agent/agentService.js";
import { ProjectStore } from "./store/projectStore.js";
import { UpdateService } from "./updates.js";
import { WebSearchService } from "./webSearch.js";
import { MemoryService } from "./memory/memoryService.js";
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
      /* Flow Memory: the four Markdown files in each project's own `.construct`.
         Created with the project, so it exists before any agent runs. */
      const memory = new MemoryService(workspace);
      const projects = new ProjectService(store, memory);
      const terminals = new TerminalService((event) => mainWindow?.webContents.send("terminal:event", event));
      const lsp = new LspService((event) => mainWindow?.webContents.send("lsp:event", event));
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
      const stage = (await auth.account()) ? ("app" as const) : ("sign-in" as const);

      installIpc({ store, auth, projects, providers, workspace, terminals, lsp, agent, memory, learningPath, web, window: () => mainWindow });
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
