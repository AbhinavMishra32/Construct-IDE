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
        return "text-[#ff6b6b]";
      case "warn":
        return "text-[#ffd43b]";
      case "debug":
        return "text-[#a0aec0] opacity-80";
      default:
        return "text-[#e2e8f0]";
    }
  };

  return (
    <TerminalSurface cwd={`Output Logs · ${activeChannel}`}>
      <div className="flex flex-col h-full bg-[#101112] text-[#f4f4f2] overflow-hidden select-text">
        {/* Top Controls Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#2d2e30] bg-[#151618]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400 font-medium select-none">Show output from:</span>
            <select
              value={activeChannel}
              onChange={(e) => setActiveChannel(e.target.value as LogChannel)}
              className="bg-[#202124] text-xs text-neutral-200 border border-[#3e4042] rounded px-2 py-1 outline-none cursor-pointer focus:border-[#4f8cff]"
            >
              <option value="lsp-server">TypeScript LSP Server (stderr)</option>
              <option value="lsp-protocol">TypeScript LSP Protocol (JSON-RPC)</option>
              <option value="main">Electron Main Process</option>
              <option value="renderer">Renderer Console</option>
              <option value="verifier">Verifier Agent</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-[#4f8cff]"
              />
              Auto-scroll
            </label>

            <button
              onClick={handleCopyAll}
              className="text-xs text-neutral-300 hover:text-white bg-[#202124] hover:bg-[#2d2e30] border border-[#3e4042] px-2 py-1 rounded transition-colors"
            >
              Copy All
            </button>

            <button
              onClick={handleClear}
              className="text-xs text-[#ff6b6b] hover:text-white bg-[#202124] hover:bg-[#ff6b6b]/20 border border-[#ff6b6b]/40 px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Logs container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed select-text space-y-1 scrollbar-thin"
        >
          {logs.length === 0 ? (
            <div className="text-neutral-500 italic select-none">No logs available in this channel.</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex items-start hover:bg-[#2d2e30]/30 py-[1px] px-1 rounded">
                <span className="text-[#718096] select-none mr-3 flex-shrink-0 font-light">
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
