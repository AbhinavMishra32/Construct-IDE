import * as pty from "node-pty";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

import type { StoredProject } from "../projects/ConstructProjectTypes";

const require = createRequire(import.meta.url);

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
  private readonly pendingOutput = new Map<string, { chunks: string[]; projectId: string; timer: NodeJS.Timeout | null }>();

  constructor(private readonly sendToRenderers: (channel: string, payload: unknown) => void) {}

  createSession(input: {
    sessionId: string;
    project: StoredProject;
    cols?: number;
    rows?: number;
  }): { sessionId: string } {
    ensureNodePtySpawnHelperExecutable();
    const cols = typeof input.cols === "number" && input.cols > 0 ? input.cols : 80;
    const rows = typeof input.rows === "number" && input.rows > 0 ? input.rows : 24;
    const cwdCandidates = terminalWorkspaceCandidates(input.project.workspacePath);
    const shellCandidates = terminalShellCandidates();
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
      PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    };

    let child: pty.IPty | null = null;
    let shellPath = shellCandidates[0] ?? "/bin/zsh";
    let workspacePath = cwdCandidates[0] ?? homedir();
    let lastError: unknown = null;

    for (const candidateShell of shellCandidates) {
      for (const candidateCwd of cwdCandidates) {
        try {
          child = pty.spawn(candidateShell, ["-i"], {
            name: "xterm-256color",
            cols,
            rows,
            cwd: candidateCwd,
            env
          });
          shellPath = candidateShell;
          workspacePath = candidateCwd;
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (child) {
        break;
      }
    }

    if (!child) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(
        `Failed to spawn terminal for project ${input.project.id}. shells=${shellCandidates.join(", ")} cwd=${cwdCandidates.join(", ")} cause=${message}`
      );
    }

    this.sessions.set(input.sessionId, child);
    this.sessionMeta.set(input.sessionId, {
      projectId: input.project.id,
      workspacePath,
      shellPath,
      startedAt: Date.now()
    });

    child.onData((data) => {
      this.queueOutput(input.sessionId, input.project.id, data);
    });

    child.onExit(({ exitCode }) => {
      this.flushOutput(input.sessionId);
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
    this.flushOutput(sessionId);
    this.sessions.get(sessionId)?.kill();
    this.sessions.delete(sessionId);
    this.sessionMeta.delete(sessionId);
  }

  queueOutput(sessionId: string, projectId: string, data: string): void {
    const pending = this.pendingOutput.get(sessionId) ?? { chunks: [], projectId, timer: null };
    pending.projectId = projectId;
    pending.chunks.push(data);
    if (!pending.timer) {
      pending.timer = setTimeout(() => this.flushOutput(sessionId), 8);
    }
    this.pendingOutput.set(sessionId, pending);
  }

  flushOutput(sessionId: string): void {
    const pending = this.pendingOutput.get(sessionId);
    if (!pending) return;
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pendingOutput.delete(sessionId);
    const data = pending.chunks.join("");
    if (!data) return;
    this.appendOutput(pending.projectId, data);
    this.sendToRenderers("construct:project:terminal-data", {
      sessionId,
      data
    });
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

function terminalShellCandidates(): string[] {
  const seen = new Set<string>();
  const candidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
  const result: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const value = candidate.trim();
    if (!value || seen.has(value) || !isExecutableFile(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result.length > 0 ? result : ["/bin/sh"];
}

function terminalWorkspaceCandidates(workspacePath: string): string[] {
  const seen = new Set<string>();
  const candidates = [workspacePath, process.cwd(), homedir()];
  const result: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const value = candidate.trim();
    if (!value || seen.has(value) || !isDirectory(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result.length > 0 ? result : [homedir()];
}

function isExecutableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    const packageJsonPath = require.resolve("node-pty/package.json");
    const helperPath = path.join(path.dirname(packageJsonPath), "prebuilds", `darwin-${process.arch}`, "spawn-helper");
    const stats = statSync(helperPath);
    if ((stats.mode & 0o111) !== 0) {
      return;
    }
    chmodSync(helperPath, 0o755);
  } catch {
    // Ignore helper fixups and let the real spawn error surface if the helper is unavailable.
  }
}
