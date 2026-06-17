import type { AgentStructuredLogMeta } from "../types";

export type LogEntry = {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error" | "debug";
  structured?: AgentStructuredLogMeta;
};

export type ProviderLogChannel = "openai" | "openrouter" | "opencode-zen" | "litellm" | "github-copilot";

export type SystemLogChannel = "lsp-server" | "lsp-protocol" | "main" | "renderer" | "terminal" | ProviderLogChannel;

export type AgentLogChannel = "verifier" | "authoring-review" | "selection-explain" | "interact" | "flow" | "code-ghost";

export type LogChannel = SystemLogChannel | AgentLogChannel;

export const PROVIDER_CHANNELS: Array<{ id: ProviderLogChannel; label: string; description: string }> = [
  { id: "openai", label: "OpenAI", description: "OpenAI API calls and errors" },
  { id: "openrouter", label: "OpenRouter", description: "OpenRouter API calls and errors" },
  { id: "opencode-zen", label: "OpenCode Zen", description: "OpenCode Zen API calls and errors" },
  { id: "litellm", label: "LiteLLM", description: "LiteLLM proxy server logs" },
  { id: "github-copilot", label: "GitHub Copilot", description: "GitHub Copilot API calls and errors" }
];

export const AGENT_CHANNELS: Array<{ id: AgentLogChannel; label: string; description: string }> = [
  { id: "verifier", label: "Verifier", description: "Recall block verification" },
  { id: "authoring-review", label: "Authoring Review", description: "Tape authoring review" },
  { id: "selection-explain", label: "Selection Explain", description: "Text selection explanation" },
  { id: "interact", label: "Interact", description: "Interactive Q&A" },
  { id: "flow", label: "Flow", description: "Flow agent sessions" },
  { id: "code-ghost", label: "Code Ghost", description: "Code ghost completions" }
];

export type LogGroupId = "ai" | "agents" | "lsp" | "system" | "terminal" | "debug";

export type LogGroup = {
  id: LogGroupId;
  label: string;
  children: Array<{ id: string; label: string; description?: string; channel?: LogChannel }>;
};

export const LOG_GROUPS: LogGroup[] = [
  {
    id: "ai",
    label: "AI",
    children: PROVIDER_CHANNELS.map((p) => ({ id: p.id, label: p.label, description: p.description, channel: p.id }))
  },
  {
    id: "agents",
    label: "Agents",
    children: AGENT_CHANNELS.map((a) => ({ id: a.id, label: a.label, description: a.description, channel: a.id }))
  },
  {
    id: "lsp",
    label: "LSP",
    children: [
      { id: "lsp-server", label: "Server", channel: "lsp-server" },
      { id: "lsp-protocol", label: "Protocol", channel: "lsp-protocol" }
    ]
  },
  {
    id: "system",
    label: "System",
    children: [
      { id: "main", label: "Main", channel: "main" },
      { id: "renderer", label: "Renderer", channel: "renderer" }
    ]
  },
  {
    id: "terminal",
    label: "Terminal",
    children: [{ id: "terminal", label: "Terminal", channel: "terminal" }]
  },
  {
    id: "debug",
    label: "Debug",
    children: [{ id: "debug-processes", label: "Processes" }]
  }
];

type LogListener = (channel: LogChannel, entry: LogEntry) => void;

class LogStoreClass {
  private logs: Record<LogChannel, LogEntry[]> = {
    "lsp-server": [],
    "lsp-protocol": [],
    main: [],
    renderer: [],
    terminal: [],
    openai: [],
    openrouter: [],
    "opencode-zen": [],
    litellm: [],
    "github-copilot": [],
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
