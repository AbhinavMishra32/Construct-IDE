import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import ConstructApp from "./construct/App";
import { TooltipProvider } from "./components/ui/tooltip";
import { logStore } from "./construct/lib/logStore";

// 1. Capture Renderer process console logs
const originalRendererLog = console.log;
const originalRendererError = console.error;
const originalRendererWarn = console.warn;

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
  logStore.addLog("renderer", formatArgs(...args), "info");
};

console.error = (...args: any[]) => {
  originalRendererError(...args);
  logStore.addLog("renderer", formatArgs(...args), "error");
};

console.warn = (...args: any[]) => {
  originalRendererWarn(...args);
  logStore.addLog("renderer", formatArgs(...args), "warn");
};

// 2. Capture Electron Main process logs via IPC
if (window.constructProjects && typeof window.constructProjects.onMainLog === "function") {
  window.constructProjects.onMainLog((payload) => {
    logStore.addLog("main", payload.message, payload.level as any);
  });
}

// 3. Capture LSP installation progress logs
if (window.constructProjects && typeof window.constructProjects.onLspInstallProgress === "function") {
  window.constructProjects.onLspInstallProgress((payload) => {
    logStore.addLog("lsp-server", payload.text, payload.type === "stderr" ? "warn" : "info");
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
document.documentElement.dataset.opalineOs = os;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <ConstructApp />
    </TooltipProvider>
  </React.StrictMode>
);
