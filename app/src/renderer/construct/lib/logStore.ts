import type { AgentStructuredLogMeta } from "../types";

export type LogEntry = {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error" | "debug";
  structured?: AgentStructuredLogMeta;
};

export type SystemLogChannel = "lsp-server" | "lsp-protocol" | "main" | "renderer" | "terminal" | "litellm";

export type AgentLogChannel = "verifier" | "authoring-review" | "selection-explain" | "interact" | "flow" | "code-ghost";

export type LogChannel = SystemLogChannel | AgentLogChannel;

export const AGENT_CHANNELS: Array<{ id: AgentLogChannel; label: string; description: string }> = [
  { id: "verifier", label: "Verifier", description: "Recall block verification" },
  { id: "authoring-review", label: "Authoring Review", description: "Tape authoring review" },
  { id: "selection-explain", label: "Selection Explain", description: "Text selection explanation" },
  { id: "interact", label: "Interact", description: "Interactive Q&A" },
  { id: "flow", label: "Flow", description: "Flow agent sessions" },
  { id: "code-ghost", label: "Code Ghost", description: "Code ghost completions" }
];

type LogListener = (channel: LogChannel, entry: LogEntry) => void;

class LogStoreClass {
  private logs: Record<LogChannel, LogEntry[]> = {
    "lsp-server": [],
    "lsp-protocol": [],
    main: [],
    renderer: [],
    terminal: [],
    litellm: [],
    verifier: [],
    "authoring-review": [],
    "selection-explain": [],
    interact: [],
    flow: [],
    "code-ghost": []
  };

  private listeners = new Set<LogListener>();

  addLog(channel: LogChannel, message: string, level: LogEntry["level"] = "info", structured?: AgentStructuredLogMeta) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      message,
      level,
      structured
    };

    const channelLogs = this.logs[channel] ?? (this.logs[channel] = []);
    channelLogs.push(entry);
    if (channelLogs.length > 2000) {
      channelLogs.shift();
    }

    this.listeners.forEach((listener) => {
      try {
        listener(channel, entry);
      } catch (err) {
        console.error("Error in log store listener:", err);
      }
    });
  }

  getLogs(channel: LogChannel): LogEntry[] {
    return this.logs[channel] ?? [];
  }

  clearLogs(channel: LogChannel) {
    this.logs[channel] = [];
    // Notify with a special clear token
    const clearEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      message: "--- Log cleared ---",
      level: "info"
    };
    this.listeners.forEach((listener) => {
      try {
        listener(channel, clearEntry);
      } catch {}
    });
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const logStore = new LogStoreClass();
