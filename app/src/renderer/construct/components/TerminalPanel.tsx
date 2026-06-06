import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";

import { TerminalSurface } from "@/components/open-shell";

import {
  onTerminalData,
  onTerminalExit,
  terminalCreate,
  terminalInput,
  terminalKill
} from "../lib/bridge";

export type TerminalPanelHandle = {
  runCommand: (command: string, cwd: string) => void;
};

export const TerminalPanel = forwardRef<
  TerminalPanelHandle,
  {
    projectId: string;
    cwd: string;
  }
>(function TerminalPanel({ projectId, cwd }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCommandsRef = useRef<string[]>([]);
  const [status, setStatus] = useState("starting");

  useImperativeHandle(ref, () => ({
    runCommand(command: string, cwd: string) {
      const sessionId = sessionIdRef.current;
      const actualCommand = cwd && cwd !== "." ? `(cd ${shellQuote(cwd)} && ${command})` : command;

      if (sessionId) {
        void terminalInput(sessionId, actualCommand);
        return;
      }

      pendingCommandsRef.current.push(actualCommand);
    }
  }));

  useEffect(() => {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"Geist Mono Variable", "SF Mono", Menlo, monospace',
      fontSize: 12,
      theme: {
        background: isDark ? "#101112" : "#ffffff",
        foreground: isDark ? "#f4f4f2" : "#1d1d1f",
        cursor: isDark ? "#f4f4f2" : "#1d1d1f",
        selectionBackground: isDark ? "#4f8cff44" : "#0a84ff33"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminalRef.current = terminal;

    if (containerRef.current) {
      terminal.open(containerRef.current);
      fitAddon.fit();
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const dataSubscription = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void terminalInput(sessionId, data);
      }
    });

    const removeDataListener = onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });
    const removeExitListener = onTerminalExit((event) => {
      if (event.sessionId === sessionIdRef.current) {
        setStatus(`exited ${event.exitCode ?? ""}`.trim());
        terminal.write(`\r\n[process exited ${event.exitCode ?? ""}]\r\n`);
      }
    });

    void terminalCreate(projectId).then(({ sessionId }) => {
      sessionIdRef.current = sessionId;
      setStatus("running");
      for (const command of pendingCommandsRef.current.splice(0)) {
        void terminalInput(sessionId, command);
      }
    });

    return () => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void terminalKill(sessionId);
      }
      dataSubscription.dispose();
      removeDataListener();
      removeExitListener();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      sessionIdRef.current = null;
    };
  }, [projectId]);

  return (
    <TerminalSurface cwd={`${cwd} · ${status}`}>
      <div ref={containerRef} className="terminal-panel__screen" />
    </TerminalSurface>
  );
});

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
