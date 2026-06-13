import React, { useEffect, useRef, useState } from "react";
import { Bot, Braces, Check, ChevronDown } from "lucide-react";
import { logStore, AGENT_CHANNELS, type AgentLogChannel, type LogChannel, type LogEntry } from "../lib/logStore";
import { debugProcesses } from "../lib/bridge";
import type { DebugProcessSnapshot } from "../types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
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
  { id: "terminal", label: "Terminal" }
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
  const effectiveLogChannel: LogChannel | null = activeChannel === "agents"
    ? activeAgentChannel
    : activeChannel === "debug-processes"
      ? null
      : activeChannel;
  const activeAgentMeta = AGENT_CHANNELS.find((agent) => agent.id === activeAgentChannel);

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

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

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
        return "text-[var(--opaline-danger)] font-medium";
      case "warn":
        return "text-[var(--opaline-warning)] font-medium";
      case "debug":
        return "text-[var(--opaline-text-tertiary)] opacity-85";
      default:
        return "text-[var(--opaline-text-primary)]";
    }
  };

  return (
    <TerminalSurface cwd={`Output · ${activeChannel === "agents" ? `Agents · ${activeAgentMeta?.label ?? activeAgentChannel}` : getChannelLabel(activeChannel)}`}>
      <div className="flex h-full flex-col overflow-hidden bg-transparent text-[var(--opaline-text-primary)] select-text">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium text-[var(--opaline-text-primary)] hover:bg-[color-mix(in_srgb,var(--opaline-text-primary)_6%,transparent)]"
                >
                  {activeChannel === "agents" ? (
                    <span className="inline-flex items-center gap-1">
                      <Bot size={13} className="text-[var(--opaline-accent)]" />
                      Agents
                    </span>
                  ) : (
                    getChannelLabel(activeChannel)
                  )}
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px]">
                {SYSTEM_CHANNELS.map((channel) => (
                  <DropdownMenuItem key={channel.id} onSelect={() => setActiveChannel(channel.id)}>
                    <span className="inline-flex w-4 items-center justify-center">
                      {channel.id === activeChannel ? <Check size={13} /> : null}
                    </span>
                    {channel.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {activeChannel === "agents" ? (
              <>
                <span className="text-[var(--opaline-text-tertiary)]">/</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-[26px] max-w-[220px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium text-[var(--opaline-text-primary)] hover:bg-[color-mix(in_srgb,var(--opaline-text-primary)_6%,transparent)]"
                    >
                      <Bot size={13} className="shrink-0 text-[var(--opaline-accent)]" />
                      <span className="truncate">{activeAgentMeta?.label ?? activeAgentChannel}</span>
                      <ChevronDown size={14} className="shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[240px]">
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--opaline-text-tertiary)]">
                      <Bot size={12} />
                      Agent channel
                    </DropdownMenuLabel>
                    {AGENT_CHANNELS.map((agent) => (
                      <DropdownMenuItem key={agent.id} onSelect={() => setActiveAgentChannel(agent.id)}>
                        <span className="inline-flex w-4 items-center justify-center">
                          {agent.id === activeAgentChannel ? <Check size={13} /> : null}
                        </span>
                        <span className="flex flex-col">
                          <span>{agent.label}</span>
                          <span className="text-[10.5px] text-[var(--opaline-text-tertiary)] font-normal">{agent.description}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="truncate text-[11px] text-[var(--opaline-text-tertiary)]">{activeAgentMeta?.description}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {activeChannel === "agents" ? (
              <button
                type="button"
                onClick={() => setJsonOnly((value) => !value)}
                className={`inline-flex h-[24px] items-center gap-1 rounded-[7px] px-2 text-[12px] ${
                  jsonOnly ? "text-[var(--opaline-text-primary)]" : "text-[var(--opaline-text-tertiary)]"
                } hover:bg-[color-mix(in_srgb,var(--opaline-text-primary)_6%,transparent)]`}
                title="Toggle raw JSON view for structured agent payloads"
              >
                <Braces size={12} />
                JSON only
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAutoScroll((value) => !value)}
              className={`inline-flex h-[24px] items-center rounded-[7px] px-2 text-[12px] ${autoScroll ? "text-[var(--opaline-text-primary)]" : "text-[var(--opaline-text-tertiary)]"} hover:bg-[color-mix(in_srgb,var(--opaline-text-primary)_6%,transparent)]`}
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
          className="flex-1 overflow-auto px-3 py-2 text-[12.5px] leading-[1.45] select-text space-y-0.5 scrollbar-thin bg-transparent"
          style={{ fontFamily: "var(--opaline-font-mono)" }}
        >
          {activeChannel === "debug-processes" ? (
            <DebugProcesses processes={processes} />
          ) : logs.length === 0 ? (
            <div className="text-[var(--opaline-text-tertiary)] italic select-none" style={{ fontFamily: "var(--opaline-font-mono)" }}>
              No logs available in this channel.
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex items-start hover:bg-[color-mix(in_srgb,var(--opaline-text-primary)_4%,transparent)] py-[1px] px-1 rounded" style={{ fontFamily: "var(--opaline-font-mono)" }}>
                <span className="text-[var(--opaline-text-tertiary)] select-none mr-3 flex-shrink-0 font-light text-[12px]" style={{ fontFamily: "var(--opaline-font-mono)" }}>
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span className={`whitespace-pre-wrap break-all ${getLevelColor(log.level)}`} style={{ fontFamily: "var(--opaline-font-mono)" }}>
                  {formatLogMessage(log, activeChannel === "agents" && jsonOnly)}
                </span>
              </div>
            ))
          )}
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
    <div className="construct-debug-processes">
      <div className="construct-debug-processes__header">
        <div>
          <span>DEBUG PROCESS MATRIX</span>
          <strong>{running}/{processes.length} online</strong>
        </div>
        <div>
          <span>RSS</span>
          <strong>{totalMemory ? `${totalMemory.toFixed(1)} MB` : "scanning"}</strong>
        </div>
      </div>

      {processes.length === 0 ? (
        <div className="construct-debug-processes__empty">No managed PTY, LSP, or installer process is online.</div>
      ) : (
        <div className="construct-debug-processes__grid">
          {processes.map((process) => (
            <div key={process.id} className={`construct-debug-process ${process.status === "running" ? "is-running" : "is-stopped"}`}>
              <div className="construct-debug-process__topline">
                <span>{process.kind}</span>
                <b>{process.status}</b>
              </div>
              <strong>{process.label}</strong>
              <dl>
                <div><dt>pid</dt><dd>{process.pid ?? "--"}</dd></div>
                <div><dt>cpu</dt><dd>{formatPercent(process.cpuPercent)}</dd></div>
                <div><dt>rss</dt><dd>{formatMemory(process.memoryMb)}</dd></div>
                <div><dt>age</dt><dd>{process.elapsed ?? "--"}</dd></div>
              </dl>
              <code title={process.command ?? ""}>{process.command ?? "idle"}</code>
              {process.workspacePath && <small title={process.workspacePath}>{process.workspacePath}</small>}
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
