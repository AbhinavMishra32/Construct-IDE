import { useEffect } from "react";

import { onAgentLog, onLitellmLog } from "./bridge";
import { logStore, type LogChannel } from "./logStore";

export function useConstructLogBridge(): void {
  useEffect(() => {
    logStore.addLog("lsp-server", "Language server log channel attached.", "debug");
    logStore.addLog("lsp-protocol", "LSP protocol log channel attached.", "debug");

    const constructProjects = window.constructProjects;
    if (!constructProjects) {
      logStore.addLog("main", "Construct project bridge is unavailable outside Electron.", "warn");
      return;
    }

    const unsubscribeLsp = constructProjects.onLspStderr((payload) => {
      const text = typeof payload === "string" ? payload : payload.text;
      const level = typeof payload === "string" ? "info" : payload.level;
      logStore.addLog("lsp-server", text, level);
    });

    const unsubscribeMain = constructProjects.onMainLog((payload) => {
      const level = payload.level === "error" || payload.level === "warn" || payload.level === "debug"
        ? payload.level
        : "info";
      logStore.addLog("main", payload.message, level);
    });

    const unsubscribeAgent = onAgentLog((payload) => {
      const channel = payload.agent as LogChannel;
      const level = payload.level === "error" || payload.level === "warn" || payload.level === "debug"
        ? payload.level
        : "info";
      logStore.addLog(channel, payload.message, level, payload.structured);
    });

    const unsubscribeLitellm = onLitellmLog((payload) => {
      const level = payload.level === "error" || payload.level === "warn"
        ? payload.level
        : "info";
      logStore.addLog("litellm", payload.message, level);
    });

    return () => {
      unsubscribeLsp();
      unsubscribeMain();
      unsubscribeAgent();
      unsubscribeLitellm();
    };
  }, []);
}
