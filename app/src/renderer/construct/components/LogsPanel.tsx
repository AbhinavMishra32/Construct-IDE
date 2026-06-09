import React, { useEffect, useRef, useState } from "react";
import { logStore, type LogChannel, type LogEntry } from "../lib/logStore";
import { TerminalSurface } from "@/components/open-shell";

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
        return "text-[var(--codex-danger)] font-medium";
      case "warn":
        return "text-[var(--codex-warning)] font-medium";
      case "debug":
        return "text-[var(--codex-text-tertiary)] opacity-80";
      default:
        return "text-[var(--codex-text-primary)]";
    }
  };

  return (
    <TerminalSurface cwd={`Output Logs · ${activeChannel}`}>
      <div className="flex flex-col h-full bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)] font-[var(--codex-font-sans)] overflow-hidden select-text">
        {/* Top Controls Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--codex-border-subtle)] bg-[var(--codex-bg-secondary)]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--codex-text-secondary)] font-medium select-none">Show output from:</span>
            <select
              value={activeChannel}
              onChange={(e) => setActiveChannel(e.target.value as LogChannel)}
              className="bg-[color-mix(in_srgb,var(--codex-text-primary)_7%,transparent)] text-xs text-[var(--codex-text-primary)] border-0 rounded-[8px] px-3 py-1 outline-none cursor-pointer font-sans h-[30px]"
            >
              <option value="lsp-server" className="bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)]">TypeScript LSP Server (stderr)</option>
              <option value="lsp-protocol" className="bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)]">TypeScript LSP Protocol (JSON-RPC)</option>
              <option value="main" className="bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)]">Electron Main Process</option>
              <option value="renderer" className="bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)]">Renderer Console</option>
              <option value="verifier" className="bg-[var(--codex-bg-primary)] text-[var(--codex-text-primary)]">Verifier Agent</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-[var(--codex-text-secondary)] select-none cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-[var(--codex-accent)]"
              />
              Auto-scroll
            </label>

            <button
              onClick={handleCopyAll}
              className="text-xs text-[var(--codex-text-primary)] hover:bg-[color-mix(in_srgb,var(--codex-text-primary)_12%,transparent)] bg-[color-mix(in_srgb,var(--codex-text-primary)_7%,transparent)] px-3 h-[30px] rounded-[8px] transition-colors font-medium"
            >
              Copy All
            </button>

            <button
              onClick={handleClear}
              className="text-xs text-[var(--codex-danger)] hover:bg-[color-mix(in_srgb,var(--codex-danger)_10%,transparent)] bg-[color-mix(in_srgb,var(--codex-danger)_5%,transparent)] px-3 h-[30px] rounded-[8px] transition-colors font-medium"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Logs container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 font-[var(--codex-font-mono)] text-[13px] leading-relaxed select-text space-y-1 scrollbar-thin bg-[var(--codex-bg-primary)]"
        >
          {logs.length === 0 ? (
            <div className="text-[var(--codex-text-tertiary)] italic select-none">No logs available in this channel.</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex items-start hover:bg-[color-mix(in_srgb,var(--codex-text-primary)_4%,transparent)] py-[1px] px-1 rounded">
                <span className="text-[var(--codex-text-tertiary)] select-none mr-3 flex-shrink-0 font-light text-[12px]">
                  [{formatTimestamp(log.timestamp)}]
                </span>
                <span className={`whitespace-pre-wrap break-all ${getLevelColor(log.level)}`}>
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
