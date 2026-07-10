import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { resolveConstructCloudEndpoint } from "../../../shared/constructCloud";
import type { ConstructProjectsApi, RuntimeInfo } from "../types";

/**
 * Renderer-side replacement for the Electron preload. It reconstructs the exact
 * `window.construct` / `window.constructProjects` API the app expects, but backs
 * it with the localhost WebSocket bridge to the Node sidecar instead of Electron
 * IPC. Native concerns (file dialogs, reading picked files, opening links) use
 * the official Tauri plugins.
 */

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };
type EventListener = (payload: unknown) => void;

interface BridgeGlobal {
  port: number;
  token: string;
}

declare global {
  interface Window {
    __CONSTRUCT_BRIDGE__?: BridgeGlobal;
  }
}

class BridgeClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly outbox: string[] = [];
  private connected = false;

  constructor(private readonly config: BridgeGlobal) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.config.port}/?token=${encodeURIComponent(this.config.token)}`;
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.connected = true;
        for (const message of this.outbox.splice(0)) socket.send(message);
        resolve();
      });
      socket.addEventListener("error", () => {
        if (!this.connected) reject(new Error("Failed to connect to Construct bridge."));
      });
      socket.addEventListener("close", () => {
        this.connected = false;
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("Construct bridge connection closed."));
        }
        this.pending.clear();
      });
      socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    });
  }

  private onMessage(raw: string): void {
    let message: { k: string; id?: number; ok?: boolean; value?: unknown; error?: { message?: string }; channel?: string; payload?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.k === "result" && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error?.message ?? "Bridge invoke failed."));
      return;
    }

    if (message.k === "event" && typeof message.channel === "string") {
      const set = this.listeners.get(message.channel);
      if (set) for (const listener of set) listener(message.payload);
    }
  }

  private ship(message: string): void {
    if (this.connected && this.socket) this.socket.send(message);
    else this.outbox.push(message);
  }

  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ship(JSON.stringify({ k: "invoke", id, channel, args }));
    });
  }

  send(channel: string, ...args: unknown[]): void {
    this.ship(JSON.stringify({ k: "send", channel, args }));
  }

  on(channel: string, listener: EventListener): () => void {
    const set = this.listeners.get(channel) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => {
      set.delete(listener);
    };
  }
}

let runtimeInfo: RuntimeInfo | null = null;

/**
 * Connect to the sidecar bridge and install the global API objects. Must be
 * awaited before the React app renders (mirrors preload availability).
 */
export async function installConstructBridge(): Promise<void> {
  const config = window.__CONSTRUCT_BRIDGE__;
  if (!config) {
    throw new Error(
      "Construct bridge configuration is missing. The app must be launched through Tauri."
    );
  }

  const client = new BridgeClient(config);
  await client.connect();

  runtimeInfo = await client.invoke<RuntimeInfo>("__bridge:runtime-info");

  window.construct = {
    getRuntimeInfo: (): RuntimeInfo =>
      runtimeInfo ?? {
        name: "Construct",
        electron: "",
        chrome: "",
        node: "",
        platform: navigator.platform,
        constructCloudEndpoint: resolveConstructCloudEndpoint(undefined)
      }
  };

  const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    client.invoke<T>(channel, ...args);
  const subscribe = (channel: string) => (callback: (payload: unknown) => void) =>
    client.on(channel, callback);

  const api = {
    setThemeSource: async (theme: "light" | "dark" | "system") => {
      // Persist through the sidecar and apply the native window theme.
      await invoke("construct:theme:set", theme);
      try {
        await getCurrentWindow().setTheme(theme === "system" ? null : theme);
      } catch {
        // Non-fatal: theme is also applied via CSS in the renderer.
      }
    },
    getUiState: (input: unknown) => invoke("construct:ui-state:get", input),
    setUiState: (input: unknown) => invoke("construct:ui-state:set", input),
    flushStorage: () => invoke("construct:storage:flush"),
    storageMetrics: () => invoke("construct:storage:metrics"),
    ensureProject: (input: unknown) => invoke("construct:project:ensure", input),
    importProject: (input: unknown) => invoke("construct:project:import", input),
    createFlowProject: (input: unknown) => invoke("construct:flow:create", input),

    // Native dialogs via Tauri plugins (replaces Electron dialog in the sidecar).
    openConstructFile: async () => {
      const selected = await openDialog({
        title: "Open .construct project",
        multiple: false,
        directory: false,
        filters: [
          { name: "Construct Projects", extensions: ["construct"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (typeof selected !== "string") return null;
      // Read the picked file in the sidecar (Node fs), matching the original
      // Electron dialog handler and avoiding fs-plugin path-scope friction.
      const source = await invoke<string>("__bridge:read-file-abs", selected);
      return { path: selected, source };
    },
    selectWorkspaceDirectory: async (input?: { defaultPath?: string }) => {
      const selected = await openDialog({
        title: "Choose project workspace",
        directory: true,
        multiple: false,
        defaultPath: input?.defaultPath
      });
      return typeof selected === "string" ? selected : null;
    },

    getSettings: () => invoke("construct:settings:get"),
    openConfigFile: () => invoke("construct:settings:open-config-file"),
    setWorkspaceRoot: (input: unknown) => invoke("construct:settings:set-workspace-root", input),
    updateAiSettings: (input: unknown) => invoke("construct:settings:update-ai", input),
    updateAppSettings: (input: unknown) => invoke("construct:settings:update-app", input),
    updateObservabilitySettings: (input: unknown) =>
      invoke("construct:settings:update-observability", input),
    listAiFeatures: () => invoke("construct:settings:list-ai-features"),
    listModels: (input: unknown) => invoke("construct:settings:list-models", input),
    getLearningState: () => invoke("construct:learning:get-state"),
    getProjectLearningState: (projectId: string) =>
      invoke("construct:learning:get-project", projectId),
    applyLearningPatch: (input: unknown) => invoke("construct:learning:apply-patch", input),
    getWeakConcepts: (input: unknown) => invoke("construct:learning:weak-concepts", input),
    saveKnowledgeConcept: (input: unknown) => invoke("construct:learning:knowledge-save", input),
    openKnowledgeConcept: (input: unknown) => invoke("construct:learning:knowledge-open", input),
    recordConceptOpen: (input: unknown) => invoke("construct:learning:concept-open", input),
    removeKnowledgeConcept: (input: unknown) => invoke("construct:learning:knowledge-remove", input),
    listProjects: () => invoke("construct:project:list"),
    openProject: (id: string) => invoke("construct:project:open", id),
    updateProject: (input: unknown) => invoke("construct:project:update", input),
    readProjectTape: (projectId: string) => invoke("construct:project:read-tape", projectId),
    updateProjectTape: (input: unknown) => invoke("construct:project:update-tape", input),
    listFiles: (projectId: string) => invoke("construct:project:list-files", projectId),
    readFile: (input: unknown) => invoke("construct:project:read-file", input),
    readLspSourceFile: (input: unknown) => invoke("construct:lsp:read-source-file", input),
    writeFile: (input: unknown) => invoke("construct:project:write-file", input),
    deleteFile: (input: unknown) => invoke("construct:project:delete-file", input),
    renameFile: (input: unknown) => invoke("construct:project:rename-file", input),
    createFolder: (input: unknown) => invoke("construct:project:create-folder", input),
    duplicateFile: (input: unknown) => invoke("construct:project:duplicate-file", input),
    verifyRecall: (input: unknown) => invoke("construct:project:verify-recall", input),
    runConstructInteract: (input: unknown) => invoke("construct:project:interact", input),
    runConstructFlowAgent: (input: unknown) => invoke("construct:flow:run-agent", input),
    runConstructFlowResearch: (input: unknown) => invoke("construct:flow:research", input),
    readFlowMemory: (input: unknown) => invoke("construct:flow:memory-read", input),
    updateFlowMemory: (input: unknown) => invoke("construct:flow:memory-update", input),
    submitFlowTask: (input: unknown) => invoke("construct:flow:submit-task", input),
    rewindFlowSession: (input: unknown) => invoke("construct:flow:rewind-session", input),
    onConstructFlowSessionEvent: subscribe("construct:flow:session-event"),
    onConstructInteractSessionEvent: subscribe("construct:project:interact-session-event"),
    reviewConstructAuthoring: (input: unknown) => invoke("construct:project:review-authoring", input),
    explainSelection: (input: unknown) => invoke("construct:project:explain-selection", input),
    startCodeGhostStream: (input: unknown) => {
      client.send("construct:project:code-ghost:explain", input);
    },
    onCodeGhostToken: subscribe("construct:project:code-ghost:token"),
    deleteProject: (input: unknown) => invoke("construct:project:delete", input),
    gitStatus: (projectId: string) => invoke("construct:project:git-status", projectId),
    gitCommit: (input: unknown) => invoke("construct:project:git-commit", input),
    gitPush: (projectId: string) => invoke("construct:project:git-push", projectId),
    terminalCreate: (input: unknown) => invoke("construct:project:terminal-create", input),
    terminalInput: (input: unknown) => invoke("construct:project:terminal-input", input),
    terminalResize: (input: unknown) => invoke("construct:project:terminal-resize", input),
    terminalKill: (input: unknown) => invoke("construct:project:terminal-kill", input),
    debugProcesses: () => invoke("construct:debug:processes"),
    onTerminalData: subscribe("construct:project:terminal-data"),
    onTerminalExit: subscribe("construct:project:terminal-exit"),
    onVerifyLog: subscribe("construct:project:verify-log"),
    onSelectionExplanationLog: subscribe("construct:project:explain-selection-log"),
    onAgentLog: subscribe("construct:project:agent-log"),
    lspRequest: (payload: unknown) => invoke("construct:lsp:request", payload),
    onLspNotification: subscribe("construct:lsp:notification"),
    onLspStderr: subscribe("construct:lsp:stderr"),
    onMainLog: subscribe("construct:main:log"),
    onLspInstallProgress: subscribe("construct:lsp:install-progress"),
    lspGetStatus: (projectId: string) => invoke("construct:lsp:get-status", projectId),
    lspInstall: (input: unknown) => invoke("construct:lsp:install", input),
    lspStart: (projectId: string) => invoke("construct:lsp:start-server", projectId),
    lspStop: () => invoke("construct:lsp:stop-server"),
    litellmStart: (input: unknown) => invoke("construct:litellm:start", input),
    litellmStop: () => invoke("construct:litellm:stop"),
    litellmStatus: () => invoke("construct:litellm:status"),
    litellmCheckInstall: () => invoke("construct:litellm:check-install"),
    litellmInstall: () => invoke("construct:litellm:install"),
    onLitellmLog: subscribe("construct:litellm:log"),
    onLitellmStatusChange: subscribe("construct:litellm:status-change"),
    importOpencodeAuth: () => invoke("construct:settings:import-opencode-auth"),
    onProviderLog: subscribe("construct:provider:log"),
    onFileChanged: (callback: (payload: unknown) => void) =>
      client.on("construct:project:file-changed", (payload) => callback(payload ?? {})),
    closeProject: () => invoke("construct:project:close")
  };

  window.constructProjects = api as unknown as ConstructProjectsApi;

  // Route external links through the OS browser (replaces Electron's
  // setWindowOpenHandler / shell.openExternal).
  window.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest?.("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    if (target.getAttribute("target") === "_blank" || target.dataset.external === "true") {
      event.preventDefault();
      void openUrl(href);
    }
  });
}
