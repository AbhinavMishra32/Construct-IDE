import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke as invokeNative } from "@tauri-apps/api/core";
import { listen as listenNative } from "@tauri-apps/api/event";

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
  const nativeSubscribe = (channel: string) => (callback: (payload: unknown) => void) => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenNative(channel, (event) => callback(event.payload))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  };

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
    getUiState: (input: unknown) => invokeNative("rust_ui_state_get", { input }),
    setUiState: (input: unknown) => invokeNative("rust_ui_state_set", { input }),
    flushStorage: () => invokeNative("rust_storage_flush"),
    storageMetrics: () => invokeNative("rust_storage_metrics"),
    ensureProject: (input: unknown) => invokeNative("rust_project_ensure", { input }),
    importProject: (input: unknown) => invokeNative("rust_project_import", { input }),
    createFlowProject: (input: unknown) => invokeNative("rust_flow_create", { input }),

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

    getSettings: () => invokeNative("rust_settings_get"),
    openConfigFile: () => invokeNative("rust_settings_open_config"),
    setWorkspaceRoot: (input: unknown) => invokeNative("rust_settings_set_workspace_root", { input }),
    updateAiSettings: (input: unknown) => invokeNative("rust_settings_update_ai", { input }),
    updateAppSettings: (input: unknown) => invokeNative("rust_settings_update_app", { input }),
    updateObservabilitySettings: (input: unknown) =>
      invokeNative("rust_settings_update_observability", { input }),
    listAiFeatures: () => invokeNative("rust_settings_features"),
    listModels: (input: unknown) => invokeNative("rust_settings_list_models", { input }),
    getLearningState: () => invokeNative("rust_learning_get"),
    getProjectLearningState: (projectId: string) =>
      invokeNative("rust_learning_project", { projectId }),
    applyLearningPatch: (patch: unknown) => invokeNative("rust_learning_patch", { patch }),
    getWeakConcepts: (input: unknown) => invokeNative("rust_learning_weak", { input }),
    saveKnowledgeConcept: (input: unknown) => invokeNative("rust_learning_save", { input }),
    openKnowledgeConcept: (input: unknown) => invokeNative("rust_learning_open", { input }),
    recordConceptOpen: (input: unknown) => invokeNative("rust_learning_concept_open", { input }),
    removeKnowledgeConcept: (input: unknown) => invokeNative("rust_learning_remove", { input }),
    listProjects: () => invokeNative("rust_projects_list"),
    openProject: async (id: string) => {
      const project = await invokeNative("rust_project_open", { id });
      await invokeNative("rust_workspace_watch_start", { projectId: id });
      return project;
    },
    updateProject: (input: unknown) => invokeNative("rust_project_update", { input }),
    readProjectTape: (projectId: string) => invokeNative("rust_project_read_tape", { projectId }),
    updateProjectTape: (input: unknown) => invokeNative("rust_project_update_tape", { input }),
    listFiles: (projectId: string) => invokeNative("rust_workspace_list", { projectId }),
    readFile: (input: unknown) => invokeNative("rust_workspace_read", { input }),
    readLspSourceFile: (input: unknown) => invoke("construct:lsp:read-source-file", input),
    writeFile: (input: unknown) => invokeNative("rust_workspace_write", { input }),
    deleteFile: (input: unknown) => invokeNative("rust_workspace_remove", { input }),
    renameFile: (input: unknown) => invokeNative("rust_workspace_rename", { input }),
    createFolder: (input: unknown) => invokeNative("rust_workspace_create_folder", { input }),
    duplicateFile: (input: unknown) => invokeNative("rust_workspace_duplicate", { input }),
    verifyRecall: (input: unknown) => invoke("construct:project:verify-recall", input),
    runConstructInteract: (input: unknown) => invoke("construct:project:interact", input),
    runConstructFlowAgent: (input: unknown) => invokeNative("rust_flow_run", { input }),
    runConstructFlowResearch: (input: unknown) => invokeNative("rust_flow_research", { input }),
    readFlowMemory: (input: unknown) => invokeNative("rust_flow_memory_read", { input }),
    updateFlowMemory: (input: unknown) => invokeNative("rust_flow_memory_update", { input }),
    submitFlowTask: (input: unknown) => invokeNative("rust_flow_submit_task", { input }),
    rewindFlowSession: (input: unknown) => invokeNative("rust_flow_rewind", { input }),
    onConstructFlowSessionEvent: nativeSubscribe("construct:flow:session-event"),
    onConstructInteractSessionEvent: subscribe("construct:project:interact-session-event"),
    reviewConstructAuthoring: (input: unknown) => invoke("construct:project:review-authoring", input),
    explainSelection: (input: unknown) => invoke("construct:project:explain-selection", input),
    startCodeGhostStream: (input: unknown) => {
      client.send("construct:project:code-ghost:explain", input);
    },
    onCodeGhostToken: subscribe("construct:project:code-ghost:token"),
    deleteProject: (input: unknown) => invokeNative("rust_project_delete", { input }),
    gitStatus: (projectId: string) => invokeNative("rust_git_status", { projectId }),
    gitCommit: (input: unknown) => invokeNative("rust_git_commit", { input }),
    gitPush: (projectId: string) => invokeNative("rust_git_push", { projectId }),
    terminalCreate: (input: unknown) => invokeNative("rust_terminal_create", { input }),
    terminalInput: (input: unknown) => invokeNative("rust_terminal_input", { input }),
    terminalResize: (input: unknown) => invokeNative("rust_terminal_resize", { input }),
    terminalKill: (input: unknown) => invokeNative("rust_terminal_kill", { input }),
    debugProcesses: () => invoke("construct:debug:processes"),
    onTerminalData: nativeSubscribe("construct:project:terminal-data"),
    onTerminalExit: nativeSubscribe("construct:project:terminal-exit"),
    onVerifyLog: subscribe("construct:project:verify-log"),
    onSelectionExplanationLog: subscribe("construct:project:explain-selection-log"),
    onAgentLog: subscribe("construct:project:agent-log"),
    lspRequest: (payload: unknown) => invokeNative("rust_lsp_request", { payload }),
    onLspNotification: nativeSubscribe("construct:lsp:notification"),
    onLspStderr: nativeSubscribe("construct:lsp:stderr"),
    onMainLog: subscribe("construct:main:log"),
    onLspInstallProgress: nativeSubscribe("construct:lsp:install-progress"),
    lspGetStatus: (projectId: string) => invokeNative("rust_lsp_status", { projectId }),
    lspInstall: (input: unknown) => invokeNative("rust_lsp_install", { input }),
    lspStart: (projectId: string) => invokeNative("rust_lsp_start", { projectId }),
    lspStop: () => invokeNative("rust_lsp_stop"),
    litellmStart: (input: unknown) => invoke("construct:litellm:start", input),
    litellmStop: () => invoke("construct:litellm:stop"),
    litellmStatus: () => invoke("construct:litellm:status"),
    litellmCheckInstall: () => invoke("construct:litellm:check-install"),
    litellmInstall: () => invoke("construct:litellm:install"),
    onLitellmLog: subscribe("construct:litellm:log"),
    onLitellmStatusChange: subscribe("construct:litellm:status-change"),
    importOpencodeAuth: () => invokeNative("rust_settings_import_opencode_auth"),
    onProviderLog: subscribe("construct:provider:log"),
    onFileChanged: (callback: (payload: unknown) => void) => {
      let disposed = false;
      let unlisten: (() => void) | null = null;
      void listenNative("construct:project:file-changed", (event) => callback(event.payload ?? {}))
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
    closeProject: async () => {
      await invokeNative("rust_workspace_watch_stop");
      return invoke("construct:project:close");
    }
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
