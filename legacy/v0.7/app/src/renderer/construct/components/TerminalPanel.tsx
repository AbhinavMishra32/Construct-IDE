import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  forwardRef,
  useCallback,
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
    visible?: boolean;
  }
>(function TerminalPanel({ projectId, cwd, theme, visible = true }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCommandsRef = useRef<string[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const pendingWriteChunksRef = useRef<string[]>([]);
  const writeFrameRef = useRef<number | null>(null);
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
      startTerminalSession();
    }
  }));

  const disposeTerminal = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    terminalRef.current = null;
    fitAddonRef.current = null;
    sessionIdRef.current = null;
    startingRef.current = false;
  }, []);

  const startTerminalSession = useCallback(() => {
    if (!containerRef.current || terminalRef.current || startingRef.current) {
      return;
    }

    startingRef.current = true;
    setStatus("starting");
    const isDark = resolveTerminalDark(theme);
    let terminal: XTerm;
    let fitAddon: FitAddon;
    try {
      terminal = new XTerm({
        allowTransparency: true,
        customGlyphs: false,
        cursorBlink: false,
        cursorStyle: "bar",
        cursorWidth: 1.4,
        convertEol: true,
        drawBoldTextInBrightColors: false,
        fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
        fontSize: 12.75,
        letterSpacing: 0,
        lineHeight: 1.18,
        macOptionIsMeta: true,
        scrollback: 20_000,
        smoothScrollDuration: 0,
        theme: terminalTheme(isDark)
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      logStore.addLog("terminal", `Terminal initialization failed\n${message}`, "error");
      console.error("[terminal] initialization failed", error);
      setStatus("unavailable");
      startingRef.current = false;
      return;
    }

    function fitAndResize() {
      if (!visible || !containerRef.current?.offsetParent) {
        return;
      }
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

    let resizeFrame: number | null = null;

    function throttledFitAndResize() {
      if (resizeFrame != null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        fitAndResize();
      });
    }

    function flushTerminalWrites() {
      writeFrameRef.current = null;
      const data = pendingWriteChunksRef.current.join("");
      pendingWriteChunksRef.current = [];
      if (data) {
        terminal.write(data);
      }
    }

    function enqueueTerminalWrite(data: string) {
      pendingWriteChunksRef.current.push(data);
      if (writeFrameRef.current != null) return;
      writeFrameRef.current = window.requestAnimationFrame(flushTerminalWrites);
    }

    try {
      terminal.open(containerRef.current);
      fitAndResize();
      terminal.focus();
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
      logStore.addLog("terminal", `Terminal mount failed\n${message}`, "error");
      console.error("[terminal] mount failed", error);
      setStatus("unavailable");
      startingRef.current = false;
      return;
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
        enqueueTerminalWrite(event.data);
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
        startingRef.current = false;
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
        startingRef.current = false;
      });

    cleanupRef.current = () => {
      if (resizeFrame != null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (writeFrameRef.current != null) {
        window.cancelAnimationFrame(writeFrameRef.current);
        writeFrameRef.current = null;
      }
      pendingWriteChunksRef.current = [];
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void terminalKill(sessionId);
      }
      dataSubscription.dispose();
      removeDataListener();
      removeExitListener();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [projectId, theme, visible]);

  useEffect(() => {
    if (visible) {
      startTerminalSession();
    }
  }, [startTerminalSession, visible]);

  useEffect(() => disposeTerminal, [disposeTerminal, projectId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalTheme(resolveTerminalDark(theme));
  }, [theme]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const sessionId = sessionIdRef.current;
      if (!terminal || !fitAddon) {
        return;
      }
      try {
        fitAddon.fit();
        terminal.focus();
        if (sessionId) {
          void terminalResize(sessionId, terminal.cols, terminal.rows);
        }
      } catch {
        // The terminal can be between layout passes while the panel opens.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <TerminalSurface cwd={`${cwd} · ${status}`}>
      <div
        ref={containerRef}
        data-construct-terminal="true"
        className="h-full min-h-0 w-full overflow-hidden px-2.5 pb-2.5 pt-0 [&_.xterm]:!bg-transparent [&_.xterm-cursor-layer]:[mix-blend-mode:normal] [&_.xterm-rows]:-translate-y-px [&_.xterm-screen]:[font-kerning:none] [&_.xterm-screen]:[text-rendering:optimizeLegibility] [&_.xterm-screen]:antialiased [&_.xterm-viewport]:!bg-transparent"
      />
    </TerminalSurface>
  );
});

function resolveTerminalDark(theme: "light" | "dark" | "system"): boolean {
  if (theme === "light") {
    return false;
  }

  if (theme === "dark") {
    return true;
  }

  const documentTheme = document.documentElement.dataset.constructTheme;
  if (documentTheme === "dark") {
    return true;
  }
  if (documentTheme === "light") {
    return false;
  }

  return document.documentElement.classList.contains("dark");
}

function terminalTheme(isDark: boolean) {
  return {
    background: "#00000000",
    foreground: isDark ? "#d3d3cf" : "#202020",
    cursor: isDark ? "#10a37f" : "#0f7f64",
    cursorAccent: isDark ? "#0f1110" : "#ffffff",
    selectionBackground: isDark ? "#2f80ed59" : "#9cccff70",
    selectionInactiveBackground: isDark ? "#ffffff20" : "#1f29371a",
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
