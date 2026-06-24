import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";
import {
  logStore,
  LOG_GROUPS,
  PROVIDER_CHANNELS,
  AGENT_CHANNELS,
  type LogGroupId,
  type LogChannel,
  type LogGroup,
  type LogEntry
} from "../lib/logStore";
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

function findGroup(groupId: LogGroupId): LogGroup {
  return LOG_GROUPS.find((g) => g.id === groupId) ?? LOG_GROUPS[0];
}

function resolveChannel(groupId: LogGroupId, childId: string): LogChannel | null {
  const group = findGroup(groupId);
  const child = group.children.find((c) => c.id === childId);
  return child?.channel ?? null;
}

function formatTimestamp(isoString: string) {
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
}

function getLevelColor(level: LogEntry["level"]) {
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
}

function formatLogMessage(log: LogEntry, jsonOnly: boolean) {
  if (jsonOnly && log.structured?.kind === "structured") {
    return `${log.structured.title}\n${log.structured.raw}`;
  }

  if (!jsonOnly && log.structured?.kind === "structured") {
    return log.structured.preview || log.structured.title;
  }

  return log.message;
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

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "--";
}

function formatMemory(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)} MB` : "--";
}

function DebugProcesses({ processes }: { processes: DebugProcessSnapshot[] }) {
  const running = processes.filter((process) => process.status === "running").length;
  const totalMemory = processes.reduce((sum, process) => sum + (process.memoryMb ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-[8px] border bg-muted/25 p-3 text-xs">
        <div>
          <span className="block text-xs text-muted-foreground">Debug process matrix</span>
          <strong className="font-medium">{running}/{processes.length} online</strong>
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">RSS</span>
          <strong className="font-medium">{totalMemory ? `${totalMemory.toFixed(1)} MB` : "scanning"}</strong>
        </div>
      </div>

      {processes.length === 0 ? (
        <div className="rounded-[8px] border border-dashed p-6 text-center text-sm text-muted-foreground">No managed PTY, LSP, or installer process is online.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {processes.map((process) => (
            <div key={process.id} className={`rounded-[8px] border p-3 text-xs ${process.status === "running" ? "bg-muted/25" : "bg-muted/15 opacity-75"}`}>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
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
              <code className="mt-3 block truncate rounded-[7px] bg-muted px-2 py-1 font-mono text-[10px]" title={process.command ?? ""}>{process.command ?? "idle"}</code>
              {process.workspacePath && <small className="mt-1 block truncate text-[10px] text-muted-foreground" title={process.workspacePath}>{process.workspacePath}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface StructuredLogItemProps {
  log: LogEntry;
  isToolsChannel: boolean;
}

const StructuredLogItem: React.FC<StructuredLogItemProps> = ({ log, isToolsChannel }) => {
  const [expanded, setExpanded] = useState(false);

  const timestamp = formatTimestamp(log.timestamp);
  const structured = log.structured?.kind === "structured" ? log.structured : null;
  const title = structured?.title || log.message;

  // Extract tool info if possible
  const payloadObj = structured?.payload as any;
  const isToolPayload = payloadObj && typeof payloadObj === "object" && (
    "input" in payloadObj || "output" in payloadObj || "name" in payloadObj
  );

  return (
    <div className="flex flex-col border-b border-border/20 py-1.5 font-mono">
      <div
        className="flex items-center gap-2 cursor-pointer select-none px-2 py-1 rounded transition-colors hover:bg-muted/40"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10.5px] text-muted-foreground select-none shrink-0">
          [{timestamp}]
        </span>
        <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded shrink-0 ${
          log.level === "error" ? "bg-destructive/15 text-destructive border border-destructive/20" :
          log.level === "warn" ? "bg-amber-500/15 text-amber-500 border border-amber-500/20" :
          "bg-muted text-muted-foreground border border-border/40"
        }`}>
          {log.level}
        </span>
        <span className="text-xs font-semibold text-foreground truncate flex-1 pl-1">
          {title}
        </span>
        <span className="text-muted-foreground shrink-0 pl-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {expanded && (
        <div className="mt-1.5 ml-8 mr-2 p-3 bg-muted/45 rounded-lg border border-border/50 space-y-3 font-mono text-[11.5px] overflow-hidden">
          {isToolsChannel && isToolPayload ? (
            <div className="space-y-3">
              {payloadObj.name && (
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground font-semibold shrink-0">Tool Name:</span>
                  <code className="text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded text-[11px] border border-emerald-500/20">{payloadObj.name}</code>
                </div>
              )}
              {payloadObj.status && (
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground font-semibold shrink-0">Status:</span>
                  <span className={`font-semibold text-[11px] px-1.5 py-0.5 rounded border ${
                    payloadObj.status === "error"
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  }`}>
                    {payloadObj.status}
                  </span>
                </div>
              )}
              {payloadObj.input !== undefined && (
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold block">Input Parameters:</span>
                  <pre className="p-2.5 bg-background/70 rounded-md border border-border/40 overflow-x-auto text-[11px] leading-relaxed max-w-full whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto font-mono">
                    {typeof payloadObj.input === "object"
                      ? JSON.stringify(payloadObj.input, null, 2)
                      : String(payloadObj.input)}
                  </pre>
                </div>
              )}
              {payloadObj.output !== undefined && (
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold block">Output / Result:</span>
                  <pre className="p-2.5 bg-background/70 rounded-md border border-border/40 overflow-x-auto text-[11px] leading-relaxed max-w-full whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto font-mono">
                    {typeof payloadObj.output === "object"
                      ? JSON.stringify(payloadObj.output, null, 2)
                      : String(payloadObj.output)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <span className="text-muted-foreground font-semibold block">Payload Details:</span>
              <pre className="p-2.5 bg-background/70 rounded-md border border-border/40 overflow-x-auto text-[11px] leading-relaxed max-w-full whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto font-mono">
                {structured?.raw || JSON.stringify(structured?.payload || log.message, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const LogsPanel: React.FC<{ theme: "light" | "dark" | "system" }> = ({ theme }) => {
  const [activeGroup, setActiveGroup] = useState<LogGroupId>("ai");
  const [activeChildId, setActiveChildId] = useState<string>("litellm");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processes, setProcesses] = useState<DebugProcessSnapshot[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jsonOnly, setJsonOnly] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const group = findGroup(activeGroup);
  const children = group.children;
  const isDebug = activeGroup === "debug";
  const channel = isDebug ? null : resolveChannel(activeGroup, activeChildId);
  const activeChildMeta = children.find((c) => c.id === activeChildId);
  const hasChildren = children.length > 0;

  // Reset child when group changes
  useEffect(() => {
    if (children.length > 0 && !children.some((c) => c.id === activeChildId)) {
      setActiveChildId(children[0].id);
    }
  }, [activeGroup, children, activeChildId]);

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, []);

  // Sync logs when active channel changes
  useEffect(() => {
    if (channel) {
      setLogs([...logStore.getLogs(channel)]);
    }
  }, [channel]);

  // Subscribe to logStore updates
  useEffect(() => {
    const unsubscribe = logStore.subscribe((ch, entry) => {
      if (!channel) return;
      if (ch === channel) {
        if (entry.message === "--- Log cleared ---") {
          setLogs([]);
        } else {
          setLogs((prev) => [...prev, entry]);
        }
      }
    });
    return unsubscribe;
  }, [channel]);

  // Debug processes polling
  useEffect(() => {
    if (!isDebug) return;

    let disposed = false;
    const refresh = async () => {
      try {
        const snapshot = await debugProcesses();
        if (!disposed) setProcesses(snapshot);
      } catch {
        if (!disposed) setProcesses([]);
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 1800);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [isDebug]);

  useLayoutEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [logs, processes, autoScroll, scrollToBottom]);

  const handleCopyAll = () => {
    if (isDebug) {
      const text = processes.map(formatProcessLine).join("\n");
      navigator.clipboard.writeText(text);
      return;
    }

    if (!channel) return;
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const handleClear = () => {
    if (isDebug) {
      setProcesses([]);
      return;
    }
    if (channel) logStore.clearLogs(channel);
  };

  const titleParts: string[] = [];
  if (activeGroup === "ai") {
    const provider = PROVIDER_CHANNELS.find((p) => p.id === activeChildId);
    titleParts.push(`AI · ${provider?.label ?? activeChildId}`);
  } else if (activeGroup === "agents") {
    const agent = AGENT_CHANNELS.find((a) => a.id === activeChildId);
    titleParts.push(`Agents · ${agent?.label ?? activeChildId}`);
  } else {
    titleParts.push(group.label || activeChildMeta?.label || activeGroup);
  }

  return (
    <TerminalSurface
      className="flex h-full min-h-0 flex-col"
      cwd={`Output · ${titleParts.join(" · ")}`}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-foreground select-text">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Group selector */}
            <Select
              value={activeGroup}
              onValueChange={(value) => setActiveGroup(value as LogGroupId)}
            >
              <SelectTrigger className="h-7 max-w-[160px] border-transparent bg-transparent text-xs font-medium hover:bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[160px]">
                {LOG_GROUPS.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sub-channel selector for groups with children */}
            {hasChildren && (
              <>
                <span className="text-muted-foreground">/</span>
                <Select
                  value={activeChildId}
                  onValueChange={(value) => { if (value) setActiveChildId(value); }}
                >
                  <SelectTrigger className="h-7 max-w-[200px] border-transparent bg-transparent text-xs font-medium hover:bg-muted" title={activeChildMeta?.description}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" className="min-w-[220px]">
                    {children.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        <span className="flex flex-col">
                          <span>{child.label}</span>
                          {child.description ? (
                            <span className="text-[10.5px] text-muted-foreground font-normal">{child.description}</span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeChildMeta?.description ? (
                  <span className="hidden truncate text-[11px] text-muted-foreground md:inline">{activeChildMeta.description}</span>
                ) : null}
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
            {activeGroup === "agents" ? (
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
                  if (next) scrollToBottom();
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
          {isDebug ? (
            <DebugProcesses processes={processes} />
          ) : logs.length === 0 ? (
            <div className="font-mono text-muted-foreground italic select-none">
              No logs available in this channel.
            </div>
          ) : (
            logs.map((log, index) => {
              if (log.structured?.kind === "structured") {
                return (
                  <StructuredLogItem
                    key={index}
                    log={log}
                    isToolsChannel={channel === "tools"}
                  />
                );
              }
              return (
                <div key={index} className="flex items-start rounded px-1 py-px font-mono hover:bg-muted/50">
                  <span className="mr-3 flex-shrink-0 text-xs font-light text-muted-foreground select-none">
                    [{formatTimestamp(log.timestamp)}]
                  </span>
                  <span className={`whitespace-pre-wrap break-all font-mono ${getLevelColor(log.level)}`}>
                    {formatLogMessage(log, activeGroup === "agents" && jsonOnly)}
                  </span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
      </div>
    </TerminalSurface>
  );
}
