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

import { TerminalSurface } from "@opaline/ui";

import {
  onTerminalData,
  onTerminalExit,
  terminalCreate,
  terminalInput,
  terminalKill,
  terminalResize
} from "../lib/bridge";
import { logStore } from "../lib/logStore";

export type TerminalPanelHandle = {
  runCommand: (command: string, cwd: string) => void;
};

export const TerminalPanel = forwardRef<
  TerminalPanelHandle,
  {
    projectId: string;
    cwd: string;
    theme: "light" | "dark" | "system";
  }
>(function TerminalPanel({ projectId, cwd, theme }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCommandsRef = useRef<string[]>([]);
  const [status, setStatus] = useState("starting");

  useImperativeHandle(ref, () => ({
    runCommand(command: string, cwd: string) {
      const sessionId = sessionIdRef.current;
      const actualCommand = `${cwd && cwd !== "." ? `(cd ${shellQuote(cwd)} && ${command})` : command}\r`;

      if (sessionId) {
        void terminalInput(sessionId, actualCommand);
        return;
      }

      pendingCommandsRef.current.push(actualCommand);
    }
  }));

  useEffect(() => {
    const isDark = resolveTerminalDark(theme);
    let terminal: XTerm;
    let fitAddon: FitAddon;
    try {
      terminal = new XTerm({
        allowTransparency: true,
        customGlyphs: false,
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 1.4,
        convertEol: true,
        drawBoldTextInBrightColors: false,
        fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
        fontSize: 12.75,
        letterSpacing: 0,
        lineHeight: 1.18,
        macOptionIsMeta: true,
        scrollback: 50_000,
        smoothScrollDuration: 45,
        theme: terminalTheme(isDark)
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminalRef.current = terminal;
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      logStore.addLog("terminal", `Terminal initialization failed\n${message}`, "error");
      console.error("[terminal] initialization failed", error);
      setStatus("unavailable");
      return;
    }

    function fitAndResize() {
      try {
        fitAddon.fit();
      } catch {
        return;
      }

      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void terminalResize(sessionId, terminal.cols, terminal.rows);
      }
    }

    let lastResizeTime = 0;
    let resizeTimeout: NodeJS.Timeout | null = null;

    function throttledFitAndResize() {
      const now = Date.now();
      const throttleMs = 100;
      
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }

      if (now - lastResizeTime >= throttleMs) {
        fitAndResize();
        lastResizeTime = now;
      } else {
        resizeTimeout = setTimeout(() => {
          fitAndResize();
          lastResizeTime = Date.now();
        }, throttleMs - (now - lastResizeTime));
      }
    }

    if (containerRef.current) {
      try {
        terminal.open(containerRef.current);
        fitAndResize();
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
        logStore.addLog("terminal", `Terminal mount failed\n${message}`, "error");
        console.error("[terminal] mount failed", error);
        setStatus("unavailable");
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      throttledFitAndResize();
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

    void terminalCreate(projectId, { cols: terminal.cols, rows: terminal.rows })
      .then(({ sessionId }) => {
        sessionIdRef.current = sessionId;
        setStatus("running");
        void terminalResize(sessionId, terminal.cols, terminal.rows);
        for (const command of pendingCommandsRef.current.splice(0)) {
          void terminalInput(sessionId, command);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logStore.addLog("terminal", `PTY session failed: ${message}`, "error");
        setStatus("unavailable");
      });

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
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

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalTheme(resolveTerminalDark(theme));
  }, [theme]);

  return (
    <TerminalSurface cwd={`${cwd} · ${status}`}>
      <div ref={containerRef} className="terminal-panel__screen" style={{ width: "100%", height: "100%" }} />
    </TerminalSurface>
  );
});

function resolveTerminalDark(theme: "light" | "dark" | "system"): boolean {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  return theme === "dark";
}

function terminalTheme(isDark: boolean) {
  return {
    background: "#00000000",
    foreground: isDark ? "#d3d3cf" : "#202020",
    cursor: isDark ? "#10a37f" : "#0f7f64",
    cursorAccent: isDark ? "#0f1110" : "#ffffff",
    selectionBackground: isDark ? "#10a37f33" : "#0f7f6426",
    black: "#171717",
    red: "#ff6b6b",
    green: "#10a37f",
    yellow: "#e2b340",
    blue: "#63a8ff",
    magenta: "#c792ea",
    cyan: "#56c7d9",
    white: "#d6d6d2",
    brightBlack: "#737373",
    brightRed: "#ff8a8a",
    brightGreen: "#32d79a",
    brightYellow: "#f3cc61",
    brightBlue: "#8abfff",
    brightMagenta: "#d8adff",
    brightCyan: "#83ddea",
    brightWhite: "#ffffff"
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
