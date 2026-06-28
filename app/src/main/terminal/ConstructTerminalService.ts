import * as pty from "node-pty";

import type { StoredProject } from "../projects/ConstructProjectTypes";

export type TerminalSessionMeta = {
  projectId: string;
  workspacePath: string;
  shellPath: string;
  startedAt: number;
};

export type DebugProcessSnapshot = {
  id: string;
  kind: "terminal" | "lsp" | "installer";
  label: string;
  pid: number | null;
  status: "running" | "stopped";
  workspacePath?: string | null;
  command?: string;
  cpuPercent?: number | null;
  memoryMb?: number | null;
  elapsed?: string | null;
};

export class ConstructTerminalService {
  private readonly sessions = new Map<string, pty.IPty>();
  private readonly sessionMeta = new Map<string, TerminalSessionMeta>();
  private readonly latestOutputByProject = new Map<string, string>();

  constructor(private readonly sendToRenderers: (channel: string, payload: unknown) => void) {}

  createSession(input: {
    sessionId: string;
    project: StoredProject;
    cols?: number;
    rows?: number;
  }): { sessionId: string } {
    const shellPath = process.env.SHELL || "/bin/zsh";
    const child = pty.spawn(shellPath, ["-i"], {
      name: "xterm-256color",
      cols: typeof input.cols === "number" ? input.cols : 80,
      rows: typeof input.rows === "number" ? input.rows : 24,
      cwd: input.project.workspacePath,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8"
      }
    });

    this.sessions.set(input.sessionId, child);
    this.sessionMeta.set(input.sessionId, {
      projectId: input.project.id,
      workspacePath: input.project.workspacePath,
      shellPath,
      startedAt: Date.now()
    });

    child.onData((data) => {
      this.appendOutput(input.project.id, data);
      this.sendToRenderers("construct:project:terminal-data", {
        sessionId: input.sessionId,
        data
      });
    });

    child.onExit(({ exitCode }) => {
      this.sessions.delete(input.sessionId);
      this.sessionMeta.delete(input.sessionId);
      this.sendToRenderers("construct:project:terminal-exit", {
        sessionId: input.sessionId,
        exitCode
      });
    });

    return { sessionId: input.sessionId };
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && cols > 0 && rows > 0) {
      try {
        session.resize(cols, rows);
      } catch {
        // Ignore resize races when the pty is tearing down.
      }
    }
  }

  kill(sessionId: string): void {
    this.sessions.get(sessionId)?.kill();
    this.sessions.delete(sessionId);
    this.sessionMeta.delete(sessionId);
  }

  appendOutput(projectId: string, data: string): void {
    const previous = this.latestOutputByProject.get(projectId) ?? "";
    const next = `${previous}${data}`;
    this.latestOutputByProject.set(projectId, next.slice(-30_000));
  }

  latestOutput(projectId: string): string {
    return this.latestOutputByProject.get(projectId) ?? "";
  }

  snapshots(): DebugProcessSnapshot[] {
    const snapshots: DebugProcessSnapshot[] = [];

    for (const [sessionId, session] of this.sessions) {
      const meta = this.sessionMeta.get(sessionId);
      snapshots.push({
        id: sessionId,
        kind: "terminal",
        label: `Terminal ${sessionId.slice(0, 8)}`,
        pid: typeof session.pid === "number" ? session.pid : null,
        status: "running",
        workspacePath: meta?.workspacePath ?? null,
        command: meta?.shellPath
      });
    }

    return snapshots;
  }
}
