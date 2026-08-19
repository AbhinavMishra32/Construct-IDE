import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ConstructApi } from "../../../shared/api";
import "@xterm/xterm/css/xterm.css";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  terminalId: string;
  onExit(): void;
};

/**
 * One xterm bound to one pty in the main process.
 *
 * The renderer owns the presentation and nothing else: keystrokes go out over
 * IPC and output comes back, so the shell survives this component unmounting
 * and there is no way for the renderer to hold a process handle.
 */
export function TerminalPanel({ api, projectId, terminalId, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current || !api) return;

    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      /* Transparent so the panel's own background — and the native material
         behind it — shows through, rather than xterm painting an opaque black
         rectangle into a translucent window. */
      theme: { background: "#00000000" },
      allowTransparency: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();

    void api.createTerminal({ projectId, terminalId, cols: terminal.cols, rows: terminal.rows });

    const input = terminal.onData((data) => void api.writeTerminal({ terminalId, data }));
    const unsubscribe = api.onTerminalEvent((event) => {
      if (event.terminalId !== terminalId) return;
      if (event.kind === "data") terminal.write(event.data);
      else onExit();
    });

    /* The pty has to be told the new size, or a full-screen program like vim
       keeps drawing to the old one. */
    const observer = new ResizeObserver(() => {
      fit.fit();
      void api.resizeTerminal({ terminalId, cols: terminal.cols, rows: terminal.rows });
    });
    observer.observe(host.current);

    return () => {
      observer.disconnect();
      input.dispose();
      unsubscribe();
      terminal.dispose();
      void api.disposeTerminal({ terminalId });
    };
  }, [api, projectId, terminalId, onExit]);

  return <div ref={host} className="h-full w-full px-2 py-1" />;
}
