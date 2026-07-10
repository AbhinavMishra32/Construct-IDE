import { useEffect } from "react";

import type { ProjectRecord } from "../types";
import { logStore } from "./logStore";
import { lspClient } from "./lspClient";
import { apiTracker } from "./apiTracker";

type LspProject = Pick<ProjectRecord, "id" | "workspacePath"> | null;
type SkippedLanguageMap = Partial<Record<string, { message: string; reason: string }>>;

export function useProjectLspLifecycle(project: LspProject): void {
  useEffect(() => {
    let cancelled = false;

    if (project) {
      const enabled = localStorage.getItem("construct.lsp.enabled") !== "false";
      if (enabled) {
        console.log("[LSP Client] Workspace path changed, initializing LSP for:", project.workspacePath);
        apiTracker.setLspStatus("Starting");
        void window.constructProjects.lspStart(project.id)
          .then((result) => {
            if (cancelled) {
              return;
            }
            logSkippedLanguages(result.skipped);
            if (result.languages.length > 0) {
              const label = result.languages
                .map(lspStatusLabel)
                .join("/");
              apiTracker.setLspStatus(label);
              void lspClient.initialize(project.workspacePath, {
                languages: result.languages,
                projectRoots: result.projectRoots
              });
            } else {
              apiTracker.setLspStatus(hasResourceCooldown(result.skipped) ? "Blocked" : "Inactive");
              console.log("[LSP Client] No supported language servers were started for this project.");
            }
          })
          .catch(() => {
            if (cancelled) {
              return;
            }
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
      cancelled = true;
      lspClient.dispose();
    };
  }, [project?.id, project?.workspacePath]);

}

function logSkippedLanguages(result?: SkippedLanguageMap): void {
  if (!result) {
    return;
  }

  for (const [language, skip] of Object.entries(result)) {
    if (!skip) {
      continue;
    }
    logStore.addLog("lsp-server", `[${language}] ${skip.message}`, "warn");
  }
}

function hasResourceCooldown(result?: SkippedLanguageMap): boolean {
  return Object.values(result ?? {}).some((skip) => skip?.reason === "resource-cooldown");
}

function lspStatusLabel(language: string): string {
  const labels: Record<string, string> = {
    typescript: "TS",
    python: "PY",
    rust: "RS",
    go: "GO",
    java: "Java",
    cpp: "C++",
    csharp: "C#",
    html: "HTML",
    css: "CSS",
    json: "JSON"
  };
  return labels[language] ?? language;
}
