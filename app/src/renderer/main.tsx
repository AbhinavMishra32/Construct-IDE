import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import "./index.css";
import ConstructApp from "./construct/ConstructApplication";
import { ConstructDesktopWindowControls } from "./construct/components/ConstructDesktopWindowControls";
import { TooltipProvider } from "./components/ui/tooltip";
import { logStore } from "./construct/lib/logStore";
import { performanceProfiler } from "./construct/lib/performanceProfiler";
import { installConstructBridge } from "./construct/lib/tauriBridge";

// 1. Capture Renderer process console logs
const originalRendererLog = console.log;
const originalRendererError = console.error;
const originalRendererWarn = console.warn;

if (typeof window !== "undefined") {
  (window as any).__originalRendererLog = originalRendererLog;
  (window as any).__originalRendererError = originalRendererError;
  (window as any).__originalRendererWarn = originalRendererWarn;
}

function formatArgs(...args: any[]): string {
  return args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.message}\n${arg.stack}`;
    }
    if (typeof arg === "object" && arg !== null) {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
  }).join(" ");
}

console.log = (...args: any[]) => {
  originalRendererLog(...args);
  setTimeout(() => {
    logStore.addLog("renderer", formatArgs(...args), "info");
  }, 0);
};

console.error = (...args: any[]) => {
  originalRendererError(...args);
  setTimeout(() => {
    logStore.addLog("renderer", formatArgs(...args), "error");
  }, 0);
};

console.warn = (...args: any[]) => {
  originalRendererWarn(...args);
  setTimeout(() => {
    logStore.addLog("renderer", formatArgs(...args), "warn");
  }, 0);
};

// 2. Capture Electron Main process logs via IPC
if (window.constructProjects && typeof window.constructProjects.onMainLog === "function") {
  window.constructProjects.onMainLog((payload) => {
    logStore.addLog("main", payload.message, payload.level as any);
  });
}

async function bootstrap(): Promise<void> {
  // Install the native Tauri-backed compatibility API before React renders.
  await installConstructBridge();

  // 3. Capture LSP installation progress logs
  if (window.constructProjects && typeof window.constructProjects.onLspInstallProgress === "function") {
    window.constructProjects.onLspInstallProgress((payload) => {
      const prefix = payload.language && payload.language !== "all" ? `[${payload.language}] ` : "[installer] ";
      logStore.addLog("lsp-server", `${prefix}${payload.text}`, payload.type === "stderr" ? "warn" : "info");
    });
  }

  const os =
    navigator.userAgent.includes("Windows") || navigator.platform.toLowerCase().startsWith("win")
      ? "win32"
      : navigator.userAgent.includes("Linux") || navigator.platform.toLowerCase().includes("linux")
        ? "linux"
        : "darwin";

  document.documentElement.dataset.opalineWindowType = "electron";
  document.documentElement.dataset.windowType = "electron";
  document.documentElement.dataset.runtime = "electron";
  document.documentElement.dataset.opalineOs = os;

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <TooltipProvider>
        <React.Profiler
          id="ConstructApp"
          onRender={(id, phase, actualDuration, baseDuration) => {
            if (phase !== "mount" && actualDuration < 8) return;
            performanceProfiler.record({
              kind: "mark",
              label: `react.${phase}:${id}`,
              durationMs: actualDuration,
              detail: { baseDuration },
              severity: actualDuration > 32 ? "warn" : "info"
            });
          }}
        >
          <ConstructApp />
        </React.Profiler>
        <Toaster richColors position="bottom-right" toastOptions={{ className: "font-sans" }} />
        <ConstructDesktopWindowControls />
      </TooltipProvider>
    </React.StrictMode>
  );
}

void bootstrap().catch((error) => {
  console.error("Failed to start Construct:", error);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML =
      `<div style="font-family:system-ui;padding:24px;color:#f5f5f5">Failed to start Construct.<br/>${String(error)}</div>`;
  }
});
