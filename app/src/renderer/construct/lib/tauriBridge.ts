import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke as invokeNative } from "@tauri-apps/api/core";
import { listen as listenNative } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";

import { resolveConstructCloudEndpoint } from "../../../shared/constructCloud";
import type { ConstructProjectsApi, RuntimeInfo } from "../types";

/**
 * Renderer-side replacement for the Electron preload. It reconstructs the exact
 * `window.construct` / `window.constructProjects` API the app expects and maps
 * it to typed Rust commands and native Tauri events.
 */

let runtimeInfo: RuntimeInfo | null = null;

/**
 * Install the compatibility globals before React renders.
 */
export async function installConstructBridge(): Promise<void> {
  runtimeInfo = await invokeNative<RuntimeInfo>("rust_runtime_info");

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
      await invokeNative("rust_theme_set", { theme });
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
      const source = await readTextFile(selected);
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
    readLspSourceFile: (input: unknown) => invokeNative("rust_read_lsp_source", { input }),
    writeFile: (input: unknown) => invokeNative("rust_workspace_write", { input }),
    deleteFile: (input: unknown) => invokeNative("rust_workspace_remove", { input }),
    renameFile: (input: unknown) => invokeNative("rust_workspace_rename", { input }),
    createFolder: (input: unknown) => invokeNative("rust_workspace_create_folder", { input }),
    duplicateFile: (input: unknown) => invokeNative("rust_workspace_duplicate", { input }),
    verifyRecall: (input: unknown) => invokeNative("rust_verify_recall", { input }),
    runConstructInteract: (input: unknown) => invokeNative("rust_interact", { input }),
    runConstructFlowAgent: (input: unknown) => invokeNative("rust_flow_run", { input }),
    runConstructFlowResearch: (input: unknown) => invokeNative("rust_flow_research", { input }),
    readFlowMemory: (input: unknown) => invokeNative("rust_flow_memory_read", { input }),
    updateFlowMemory: (input: unknown) => invokeNative("rust_flow_memory_update", { input }),
    submitFlowTask: (input: unknown) => invokeNative("rust_flow_submit_task", { input }),
    rewindFlowSession: (input: unknown) => invokeNative("rust_flow_rewind", { input }),
    onConstructFlowSessionEvent: nativeSubscribe("construct:flow:session-event"),
    onConstructInteractSessionEvent: nativeSubscribe("construct:project:interact-session-event"),
    reviewConstructAuthoring: (input: unknown) => invokeNative("rust_authoring_review", { input }),
    explainSelection: (input: unknown) => invokeNative("rust_selection_explain", { input }),
    startCodeGhostStream: (input: unknown) => {
      void invokeNative("rust_code_ghost", { input });
    },
    onCodeGhostToken: nativeSubscribe("construct:project:code-ghost:token"),
    deleteProject: (input: unknown) => invokeNative("rust_project_delete", { input }),
    gitStatus: (projectId: string) => invokeNative("rust_git_status", { projectId }),
    gitCommit: (input: unknown) => invokeNative("rust_git_commit", { input }),
    gitPush: (projectId: string) => invokeNative("rust_git_push", { projectId }),
    terminalCreate: (input: unknown) => invokeNative("rust_terminal_create", { input }),
    terminalInput: (input: unknown) => invokeNative("rust_terminal_input", { input }),
    terminalResize: (input: unknown) => invokeNative("rust_terminal_resize", { input }),
    terminalKill: (input: unknown) => invokeNative("rust_terminal_kill", { input }),
    debugProcesses: () => invokeNative("rust_debug_processes"),
    onTerminalData: nativeSubscribe("construct:project:terminal-data"),
    onTerminalExit: nativeSubscribe("construct:project:terminal-exit"),
    onVerifyLog: nativeSubscribe("construct:project:verify-log"),
    onSelectionExplanationLog: nativeSubscribe("construct:project:explain-selection-log"),
    onAgentLog: nativeSubscribe("construct:project:agent-log"),
    lspRequest: (payload: unknown) => invokeNative("rust_lsp_request", { payload }),
    onLspNotification: nativeSubscribe("construct:lsp:notification"),
    onLspStderr: nativeSubscribe("construct:lsp:stderr"),
    onMainLog: nativeSubscribe("construct:main:log"),
    onLspInstallProgress: nativeSubscribe("construct:lsp:install-progress"),
    lspGetStatus: (projectId: string) => invokeNative("rust_lsp_status", { projectId }),
    lspInstall: (input: unknown) => invokeNative("rust_lsp_install", { input }),
    lspStart: (projectId: string) => invokeNative("rust_lsp_start", { projectId }),
    lspStop: () => invokeNative("rust_lsp_stop"),
    litellmStart: (_input: unknown) => invokeNative("rust_litellm_state"),
    litellmStop: () => invokeNative("rust_litellm_state"),
    litellmStatus: () => invokeNative("rust_litellm_state"),
    litellmCheckInstall: () => invokeNative("rust_litellm_check"),
    litellmInstall: () => Promise.resolve(false),
    onLitellmLog: nativeSubscribe("construct:litellm:log"),
    onLitellmStatusChange: nativeSubscribe("construct:litellm:status-change"),
    importOpencodeAuth: () => invokeNative("rust_settings_import_opencode_auth"),
    onProviderLog: nativeSubscribe("construct:provider:log"),
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
      return { success: true };
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
