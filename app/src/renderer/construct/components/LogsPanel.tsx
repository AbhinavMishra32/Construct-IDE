import React, { useEffect, useRef, useState } from "react";
import { logStore, type LogChannel, type LogEntry } from "../lib/logStore";
import { TerminalSurface, SettingsSelect, Button } from "@opaline/ui";

export const LogsPanel: React.FC<{ theme: "light" | "dark" | "system" }> = ({ theme }) => {
  const [activeChannel, setActiveChannel] = useState<LogChannel>("lsp-server");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync logs when active channel changes
  useEffect(() => {
    setLogs([...logStore.getLogs(activeChannel)]);
  }, [activeChannel]);

  // Subscribe to logStore updates
  useEffect(() => {
    const unsubscribe = logStore.subscribe((channel, entry) => {
      if (channel === activeChannel) {
        if (entry.message === "--- Log cleared ---") {
          setLogs([]);
        } else {
          setLogs((prev) => [...prev, entry]);
        }
      }
    });
    return unsubscribe;
  }, [activeChannel]);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyAll = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const handleClear = () => {
    logStore.clearLogs(activeChannel);
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
    <TerminalSurface cwd={`Output Logs · ${activeChannel}`}>
      <div className="flex flex-col h-full bg-transparent text-[var(--opaline-text-primary)] font-[var(--opaline-font-sans)] overflow-hidden select-text">
        {/* Top Controls Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--opaline-border-subtle)] bg-transparent">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--opaline-text-secondary)] font-medium select-none">Show output from:</span>
            <SettingsSelect
              value={activeChannel}
              onChange={(e) => setActiveChannel(e.target.value as LogChannel)}
              className="text-xs h-[30px] min-w-[200px]"
            >
              <option value="lsp-server" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">Language Servers</option>
              <option value="lsp-protocol" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">LSP Protocol</option>
              <option value="main" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">Electron Main Process</option>
              <option value="renderer" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">Renderer Console</option>
              <option value="terminal" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">Terminal</option>
              <option value="verifier" className="bg-[var(--opaline-bg-primary)] text-[var(--opaline-text-primary)] font-sans">Verifier Agent</option>
            </SettingsSelect>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-[var(--opaline-text-secondary)] select-none cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-[var(--opaline-accent)]"
              />
              Auto-scroll
            </label>

            <Button
              onClick={handleCopyAll}
              variant="secondary"
              size="small"
              className="h-[30px] rounded-[8px] font-medium"
            >
              Copy All
            </Button>

            <Button
              onClick={handleClear}
              variant="danger"
              size="small"
              className="h-[30px] rounded-[8px] font-medium"
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Logs container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 text-[13px] leading-relaxed select-text space-y-1 scrollbar-thin bg-transparent"
          style={{ fontFamily: "var(--opaline-font-mono)" }}
        >
          {logs.length === 0 ? (
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
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </TerminalSurface>
  );
};
