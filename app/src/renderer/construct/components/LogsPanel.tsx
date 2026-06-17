import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { logStore, AGENT_CHANNELS, type AgentLogChannel, type LogChannel, type LogEntry } from "../lib/logStore";
import { debugProcesses } from "../lib/bridge";
import type { DebugProcessSnapshot } from "../types";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TerminalSurface,
} from "@opaline/ui";

type OutputChannel = Exclude<LogChannel, AgentLogChannel> | "debug-processes" | "agents";

const SYSTEM_CHANNELS: Array<{ id: OutputChannel; label: string }> = [
  { id: "debug-processes", label: "Debug processes" },
  { id: "agents", label: "Agents" },
  { id: "lsp-server", label: "Language servers" },
  { id: "lsp-protocol", label: "LSP protocol" },
  { id: "main", label: "Electron main" },
  { id: "renderer", label: "Renderer console" },
  { id: "terminal", label: "Terminal" },
  { id: "litellm", label: "LiteLLM" }
];

function getChannelLabel(channel: OutputChannel): string {
  if (channel === "debug-processes") return "Debug processes";
  if (channel === "agents") return "Agents";
  const system = SYSTEM_CHANNELS.find((c) => c.id === channel);
  if (system) return system.label;
  return channel;
}

export const LogsPanel: React.FC<{ theme: "light" | "dark" | "system" }> = ({ theme }) => {
  const [activeChannel, setActiveChannel] = useState<OutputChannel>("lsp-server");
  const [activeAgentChannel, setActiveAgentChannel] = useState<AgentLogChannel>("interact");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processes, setProcesses] = useState<DebugProcessSnapshot[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jsonOnly, setJsonOnly] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const effectiveLogChannel: LogChannel | null = activeChannel === "agents"
    ? activeAgentChannel
    : activeChannel === "debug-processes"
      ? null
      : activeChannel;
  const activeAgentMeta = AGENT_CHANNELS.find((agent) => agent.id === activeAgentChannel);
  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, []);

  // Sync logs when active channel changes
  useEffect(() => {
    if (effectiveLogChannel) {
      setLogs([...logStore.getLogs(effectiveLogChannel)]);
    }
  }, [effectiveLogChannel]);

  // Subscribe to logStore updates
  useEffect(() => {
    const unsubscribe = logStore.subscribe((channel, entry) => {
      if (!effectiveLogChannel) {
        return;
      }
      if (channel === effectiveLogChannel) {
        if (entry.message === "--- Log cleared ---") {
          setLogs([]);
        } else {
          setLogs((prev) => [...prev, entry]);
        }
      }
    });
    return unsubscribe;
  }, [effectiveLogChannel]);

  useEffect(() => {
    if (activeChannel !== "debug-processes") {
      return;
    }

    let disposed = false;
    const refresh = async () => {
      try {
        const snapshot = await debugProcesses();
        if (!disposed) {
          setProcesses(snapshot);
        }
      } catch {
        if (!disposed) {
          setProcesses([]);
        }
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 1800);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [activeChannel]);

  useLayoutEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [logs, processes, autoScroll, scrollToBottom]);

  const handleCopyAll = () => {
    if (activeChannel === "debug-processes") {
      const text = processes.map(formatProcessLine).join("\n");
      navigator.clipboard.writeText(text);
      return;
    }

    if (!effectiveLogChannel) {
      return;
    }

    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const handleClear = () => {
    if (activeChannel === "debug-processes") {
      setProcesses([]);
      return;
    }

    if (effectiveLogChannel) {
      logStore.clearLogs(effectiveLogChannel);
    }
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(undefined, {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3
      } as any);
    } catch {
      return isoString;
    }
  };

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "text-destructive font-medium";
      case "warn":
        return "text-amber-600 dark:text-amber-400 font-medium";
      case "debug":
        return "text-muted-foreground opacity-85";
      default:
        return "text-foreground";
    }
  };

  return (
    <TerminalSurface
      className="flex h-full min-h-0 flex-col"
      cwd={`Output · ${activeChannel === "agents" ? `Agents · ${activeAgentMeta?.label ?? activeAgentChannel}` : getChannelLabel(activeChannel)}`}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-foreground select-text">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Select
              value={activeChannel}
              onValueChange={(value) => setActiveChannel(value as OutputChannel)}
            >
              <SelectTrigger className="h-7 max-w-[220px] border-transparent bg-transparent text-xs font-medium hover:bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[220px]">
                {SYSTEM_CHANNELS.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeChannel === "agents" ? (
              <>
                <span className="text-muted-foreground">/</span>
                <Select
                  value={activeAgentChannel}
                  onValueChange={(value) => setActiveAgentChannel(value as AgentLogChannel)}
                >
                  <SelectTrigger className="h-7 max-w-[220px] border-transparent bg-transparent text-xs font-medium hover:bg-muted" title={activeAgentMeta?.description}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" className="min-w-[240px]">
                    {AGENT_CHANNELS.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <span className="flex flex-col">
                          <span>{agent.label}</span>
                          <span className="text-[10.5px] text-muted-foreground font-normal">{agent.description}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="truncate text-[11px] text-muted-foreground">{activeAgentMeta?.description}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {activeChannel === "agents" ? (
              <button
                type="button"
                onClick={() => setJsonOnly((value) => !value)}
                className={`inline-flex h-[24px] items-center gap-1 rounded-[7px] px-2 text-[12px] ${
                  jsonOnly ? "text-foreground" : "text-muted-foreground"
                } hover:bg-muted`}
                title="Toggle raw JSON view for structured agent payloads"
              >
                <Braces size={12} />
                JSON only
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAutoScroll((value) => {
                  const next = !value;
                  if (next) {
                    scrollToBottom();
                  }
                  return next;
                });
              }}
              className={`inline-flex h-6 items-center rounded-md px-2 text-xs ${autoScroll ? "text-foreground" : "text-muted-foreground"} hover:bg-muted`}
            >
              Auto-scroll
            </button>
            <Button onClick={handleCopyAll} variant="secondary" size="small" className="h-[24px] rounded-[7px] px-2.5 text-[12px]">
              Copy
            </Button>
            <Button onClick={handleClear} variant="secondary" size="small" className="h-[24px] rounded-[7px] px-2.5 text-[12px]">
              Clear
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="h-0 min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden bg-transparent px-3 py-2 font-mono text-xs leading-relaxed select-text"
        >
          {activeChannel === "debug-processes" ? (
            <DebugProcesses processes={processes} />
          ) : logs.length === 0 ? (
            <div className="font-mono text-muted-foreground italic select-none">
              No logs available in this channel.
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex items-start rounded px-1 py-px font-mono hover:bg-muted/50">
                <span className="mr-3 flex-shrink-0 text-xs font-light text-muted-foreground select-none">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span className={`whitespace-pre-wrap break-all font-mono ${getLevelColor(log.level)}`}>
                  {formatLogMessage(log, activeChannel === "agents" && jsonOnly)}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
      </div>
    </TerminalSurface>
  );
};

function formatLogMessage(log: LogEntry, jsonOnly: boolean) {
  if (jsonOnly && log.structured?.kind === "structured") {
    return `${log.structured.title}\n${log.structured.raw}`;
  }

  if (!jsonOnly && log.structured?.kind === "structured") {
    return log.structured.preview || log.structured.title;
  }

  return log.message;
}

function DebugProcesses({ processes }: { processes: DebugProcessSnapshot[] }) {
  const running = processes.filter((process) => process.status === "running").length;
  const totalMemory = processes.reduce((sum, process) => sum + (process.memoryMb ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-xs">
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Debug process matrix</span>
          <strong className="font-medium">{running}/{processes.length} online</strong>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">RSS</span>
          <strong className="font-medium">{totalMemory ? `${totalMemory.toFixed(1)} MB` : "scanning"}</strong>
        </div>
      </div>

      {processes.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No managed PTY, LSP, or installer process is online.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {processes.map((process) => (
            <div key={process.id} className={`rounded-md border p-3 text-xs ${process.status === "running" ? "border-primary/30 bg-primary/5" : "bg-muted/20 opacity-75"}`}>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>{process.kind}</span>
                <b className="font-medium">{process.status}</b>
              </div>
              <strong className="mt-1 block truncate text-sm font-medium">{process.label}</strong>
              <dl className="mt-3 grid grid-cols-4 gap-2">
                <div><dt className="text-muted-foreground">pid</dt><dd>{process.pid ?? "--"}</dd></div>
                <div><dt className="text-muted-foreground">cpu</dt><dd>{formatPercent(process.cpuPercent)}</dd></div>
                <div><dt className="text-muted-foreground">rss</dt><dd>{formatMemory(process.memoryMb)}</dd></div>
                <div><dt className="text-muted-foreground">age</dt><dd>{process.elapsed ?? "--"}</dd></div>
              </dl>
              <code className="mt-3 block truncate rounded bg-muted px-2 py-1 font-mono text-[10px]" title={process.command ?? ""}>{process.command ?? "idle"}</code>
              {process.workspacePath && <small className="mt-1 block truncate text-[10px] text-muted-foreground" title={process.workspacePath}>{process.workspacePath}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "--";
}

function formatMemory(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)} MB` : "--";
}

function formatProcessLine(process: DebugProcessSnapshot): string {
  return [
    process.kind,
    process.status,
    `pid=${process.pid ?? "--"}`,
    `cpu=${formatPercent(process.cpuPercent)}`,
    `rss=${formatMemory(process.memoryMb)}`,
    `elapsed=${process.elapsed ?? "--"}`,
    process.label,
    process.command ?? ""
  ].join(" ");
}
