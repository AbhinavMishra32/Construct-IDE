export type LogEntry = {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error" | "debug";
};

export type LogChannel = "lsp-server" | "lsp-protocol" | "main" | "renderer" | "terminal" | "verifier";

type LogListener = (channel: LogChannel, entry: LogEntry) => void;

class LogStoreClass {
  private logs: Record<LogChannel, LogEntry[]> = {
    "lsp-server": [],
    "lsp-protocol": [],
    main: [],
    renderer: [],
    terminal: [],
    verifier: []
  };

  private listeners = new Set<LogListener>();

  addLog(channel: LogChannel, message: string, level: LogEntry["level"] = "info") {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      message,
      level
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
