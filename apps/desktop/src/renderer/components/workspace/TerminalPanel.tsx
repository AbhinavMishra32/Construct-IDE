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
 * The renderer owns presentation and nothing else: keystrokes go out over IPC
 * and output comes back, so the shell has no handle the renderer could hold.
 *
 * Critically, unmounting does **not** kill the shell. Two reasons, and the
 * first is a bug this cost:
 *
 * React's StrictMode mounts, unmounts and remounts every effect in
 * development. With a kill in the cleanup, the sequence became create →
 * dispose → create, and because both cross IPC asynchronously the dispose
 * frequently landed after the second create and killed the shell that had just
 * started. The exit event then closed the panel, about a millisecond after it
 * opened.
 *
 * The second reason is the behaviour anyone would want regardless: collapsing
 * the terminal should not kill a build that is halfway through. The shell
 * belongs to the project, so the Workspace disposes it when it closes the
 * project — see its cleanup.
 */
export function TerminalPanel({ api, projectId, terminalId, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const exit = useRef(onExit);
  exit.current = onExit;

  useEffect(() => {
    if (!host.current || !api) return;

    const dark = document.documentElement.classList.contains("dark");
    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      /* Transparent background so the panel's own fill shows through, and a
         foreground taken from the theme rather than xterm's default. Left to
         itself xterm paints light grey text whatever the appearance, which on a
         light panel is text you cannot read. */
      theme: {
        background: "#00000000",
        foreground: dark ? "#c9d1d9" : "#33363b",
        cursor: dark ? "#c9d1d9" : "#33363b",
        selectionBackground: dark ? "#3a3a3a" : "#dcdcdc",
      },
      allowTransparency: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();

    /* Idempotent in the main process: a terminal id that already has a shell is
       left alone, so a remount reattaches instead of starting a second one. */
    void api.createTerminal({ projectId, terminalId, cols: terminal.cols, rows: terminal.rows });

    const input = terminal.onData((data) => void api.writeTerminal({ terminalId, data }));
    const unsubscribe = api.onTerminalEvent((event) => {
      if (event.terminalId !== terminalId) return;
      if (event.kind === "data") terminal.write(event.data);
      else exit.current();
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
      /* No disposeTerminal here — see the note above. */
    };
  }, [api, projectId, terminalId]);

  return <div ref={host} className="h-full w-full px-2 py-1" />;
}
