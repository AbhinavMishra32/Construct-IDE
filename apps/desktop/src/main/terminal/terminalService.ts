import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";

const requireFrom = createRequire(import.meta.url);

export type TerminalEvent =
  | { terminalId: string; kind: "data"; data: string }
  | { terminalId: string; kind: "exit"; exitCode: number };

/**
 * Real shells, one per terminal the learner opens.
 *
 * Construct is an IDE, so the terminal is a genuine pty rather than a command
 * runner: the learner is expected to run their own tools in it, and anything
 * less than a real shell shows up the first time they reach for one.
 */
export class TerminalService {
  private readonly sessions = new Map<string, IPty>();
  /** Output is batched per animation frame's worth of time. A build writing
   *  thousands of small chunks would otherwise cross the IPC boundary
   *  thousands of times and stall the renderer painting them. */
  private readonly pending = new Map<string, { chunks: string[]; timer: ReturnType<typeof setTimeout> | null }>();

  constructor(private readonly emit: (event: TerminalEvent) => void) {}

  create(input: { terminalId: string; cwd: string; cols?: number; rows?: number }): void {
    ensureSpawnHelperExecutable();

    const pty = requireFrom("node-pty") as typeof import("node-pty");
    const cwd = existsSync(input.cwd) ? input.cwd : homedir();
    const shell = resolveShell();

    const child = pty.spawn(shell, ["-i"], {
      name: "xterm-256color",
      cols: input.cols && input.cols > 0 ? input.cols : 80,
      rows: input.rows && input.rows > 0 ? input.rows : 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8",
        /* Electron launched from Finder inherits a minimal PATH that has none
           of the toolchains a developer installed, so a terminal opened there
           would not find node, python, or git. */
        PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });

    child.onData((data) => this.queue(input.terminalId, data));
    child.onExit(({ exitCode }) => {
      this.flush(input.terminalId);
      this.sessions.delete(input.terminalId);
      this.emit({ terminalId: input.terminalId, kind: "exit", exitCode });
    });

    this.sessions.set(input.terminalId, child);
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    /* A zero dimension is what a hidden panel reports, and node-pty throws on
       it rather than ignoring it. */
    if (cols > 0 && rows > 0) this.sessions.get(terminalId)?.resize(cols, rows);
  }

  dispose(terminalId: string): void {
    this.sessions.get(terminalId)?.kill();
    this.sessions.delete(terminalId);
    const pending = this.pending.get(terminalId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pending.delete(terminalId);
  }

  /** Kills every shell. Called on quit, because a pty outlives the window that
   *  opened it and would otherwise be left behind as an orphan. */
  stop(): void {
    for (const terminalId of [...this.sessions.keys()]) this.dispose(terminalId);
  }

  private queue(terminalId: string, data: string): void {
    const entry = this.pending.get(terminalId) ?? { chunks: [], timer: null };
    entry.chunks.push(data);
    if (!entry.timer) entry.timer = setTimeout(() => this.flush(terminalId), 16);
    this.pending.set(terminalId, entry);
  }

  private flush(terminalId: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry || entry.chunks.length === 0) return;
    if (entry.timer) clearTimeout(entry.timer);
    const data = entry.chunks.join("");
    this.pending.set(terminalId, { chunks: [], timer: null });
    this.emit({ terminalId, kind: "data", data });
  }
}

function resolveShell(): string {
  const candidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? "/bin/sh";
}

/**
 * node-pty ships a `spawn-helper` binary that must be executable.
 *
 * Ported from v0.7, where it was found the hard way: pnpm's store and several
 * packaging steps drop the executable bit, and node-pty then fails to spawn
 * with an error that says nothing about file permissions. Restoring the bit is
 * cheap and idempotent; failing to is a terminal that never opens.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform !== "darwin") return;

  try {
    const manifest = requireFrom.resolve("node-pty/package.json");
    const helper = path.join(path.dirname(manifest), "prebuilds", `darwin-${process.arch}`, "spawn-helper");
    const stats = statSync(helper);
    if ((stats.mode & 0o111) !== 0) return;
    chmodSync(helper, 0o755);
  } catch {
    // Let the real spawn error surface if the helper is genuinely unavailable.
  }
}
