import { useEffect } from "react";

import type { ProjectRecord } from "../types";
import { logStore } from "./logStore";
import { lspClient } from "./lspClient";
import { restartProjectLsp } from "./lspRuntime";
import { apiTracker } from "./apiTracker";

type LspProject = Pick<ProjectRecord, "id" | "workspacePath"> | null;

export function useProjectLspLifecycle(project: LspProject): void {
  useEffect(() => {
    if (project) {
      const enabled = localStorage.getItem("construct.lsp.enabled") !== "false";
      if (enabled) {
        console.log("[LSP Client] Workspace path changed, initializing LSP for:", project.workspacePath);
        apiTracker.setLspStatus("Starting");
        void window.constructProjects.lspStart(project.id)
          .then((result) => {
            if (result.languages.length > 0) {
              const label = result.languages
                .map((l) => (l === "typescript" ? "TS" : "PY"))
                .join("/");
              apiTracker.setLspStatus(label);
              void lspClient.initialize(project.workspacePath, { languages: result.languages });
            } else {
              apiTracker.setLspStatus("Inactive");
              console.log("[LSP Client] No supported language servers were started for this project.");
            }
          })
          .catch(() => {
            apiTracker.setLspStatus("Failed");
          });
      } else {
        console.log("[LSP Client] LSP disabled in settings, stopping server process.");
        apiTracker.setLspStatus("Disabled");
        void window.constructProjects.lspStop();
      }
    } else {
      console.log("[LSP Client] No active project, disposing LSP");
      apiTracker.setLspStatus(null);
      lspClient.dispose();
    }

    return () => {
      lspClient.dispose();
    };
  }, [project?.id, project?.workspacePath]);

  useEffect(() => {
    if (!project) {
      return;
    }

    let refreshTimer: number | null = null;
    let lastRefreshAt = 0;

    const refreshLsp = () => {
      const enabled = localStorage.getItem("construct.lsp.enabled") !== "false";
      if (!enabled || document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAt < 10_000) {
        return;
      }
      lastRefreshAt = now;

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        logStore.addLog("lsp-server", "Refreshing language server after app focus.", "info");
        void restartProjectLsp(project.id).then((result) => {
          if (result.languages.length > 0) {
            void lspClient.initialize(project.workspacePath, {
              force: true,
              languages: result.languages
            });
          }
        });
      }, 250);
    };

    window.addEventListener("focus", refreshLsp);
    document.addEventListener("visibilitychange", refreshLsp);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener("focus", refreshLsp);
      document.removeEventListener("visibilitychange", refreshLsp);
    };
  }, [project?.id, project?.workspacePath]);
}
