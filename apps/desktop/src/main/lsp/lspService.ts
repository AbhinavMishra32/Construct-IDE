import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { LspEvent } from "../../shared/api.js";

export type { LspEvent };

/** What it takes to start a server: a program and its arguments. Which program
 *  is the catalog's business, and getting it onto the machine is the
 *  installer's — see `languageServers.ts` and `serverInstaller.ts`. */
export type ServerCommand = { command: string; args: readonly string[] };

/**
 * Language servers, one per project and server.
 *
 * The main process owns the processes and does no interpretation: it frames
 * and unframes LSP's `Content-Length` protocol and passes messages through in
 * both directions. Deciding what a message means belongs to the client in the
 * renderer, next to the editor it is talking about — and keeping this side
 * dumb means a protocol feature can be added without touching it.
 *
 * It knows nothing about languages, and that is the point. It used to hold a
 * three-entry table of the servers Construct shipped, which is why adding a
 * language meant editing this file. It is handed a command now, so a language
 * is a row in a catalog and nothing more.
 */
export class LspService {
  private readonly sessions = new Map<string, { child: ChildProcessWithoutNullStreams; buffer: Buffer }>();

  constructor(private readonly emit: (event: LspEvent) => void) {}

  /** Starts a server, or does nothing if that session is already running.
   *  Idempotent because the renderer starts one whenever a file that server
   *  claims is opened, which is many times per session. */
  start(input: { sessionId: string; server: ServerCommand; cwd: string }): void {
    if (this.sessions.has(input.sessionId)) return;

    /* A server written in JavaScript is run under Electron's own Node rather
       than a system one, which may not exist on a learner's machine —
       ELECTRON_RUN_AS_NODE makes the same binary behave as plain Node. A
       downloaded binary is simply executed. */
    const node = /\.[cm]?js$/.test(input.server.command);
    const child = spawn(node ? process.execPath : input.server.command, node ? [input.server.command, ...input.server.args] : [...input.server.args], {
      cwd: input.cwd,
      env: node ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const session = { child, buffer: Buffer.alloc(0) };
    this.sessions.set(input.sessionId, session);

    child.stdout.on("data", (chunk: Buffer) => {
      session.buffer = Buffer.concat([session.buffer, chunk]);
      for (const message of drain(session)) this.emit({ sessionId: input.sessionId, kind: "message", message });
    });
    /* A language server's stderr is diagnostics about itself, not about the
       learner's code. Kept out of the interface, but not discarded — this is
       the only place a crashing server explains itself. */
    child.stderr.on("data", (chunk: Buffer) => console.error(`[lsp:${input.sessionId}]`, String(chunk).trimEnd()));
    /* A server that cannot be spawned at all — a binary deleted from under
       Construct, a toolchain uninstalled — reports as an exit rather than an
       unhandled error, so the editor learns about it through the one channel it
       already listens on. */
    child.on("error", () => {
      this.sessions.delete(input.sessionId);
      this.emit({ sessionId: input.sessionId, kind: "exit", code: null });
    });
    child.on("exit", (code) => {
      this.sessions.delete(input.sessionId);
      this.emit({ sessionId: input.sessionId, kind: "exit", code });
    });
  }

  /** Sends one JSON-RPC message, adding the header the protocol requires. */
  send(sessionId: string, message: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const body = Buffer.from(JSON.stringify(message), "utf8");
    session.child.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    session.child.stdin.write(body);
  }

  stopSession(sessionId: string): void {
    this.sessions.get(sessionId)?.child.kill();
    this.sessions.delete(sessionId);
  }

  /** Kills every server. Language servers are long-lived and memory-hungry, so
   *  leaving one behind on quit is leaving a few hundred MB behind. */
  stop(): void {
    for (const sessionId of [...this.sessions.keys()]) this.stopSession(sessionId);
  }
}

/**
 * Pulls every complete message out of the buffer, leaving any partial tail.
 *
 * TCP-style chunking means a single read can hold half a message, several
 * messages, or a header split from its body — so the buffer is drained in a
 * loop rather than parsed once per chunk.
 */
function* drain(session: { buffer: Buffer }): Generator<unknown> {
  for (;;) {
    const separator = session.buffer.indexOf("\r\n\r\n");
    if (separator === -1) return;

    const header = session.buffer.subarray(0, separator).toString("utf8");
    const length = /content-length:\s*(\d+)/i.exec(header)?.[1];
    if (!length) {
      /* A header with no Content-Length cannot be recovered from by waiting
         for more bytes — drop it rather than spin. */
      session.buffer = session.buffer.subarray(separator + 4);
      continue;
    }

    const start = separator + 4;
    const end = start + Number(length);
    if (session.buffer.byteLength < end) return;

    const body = session.buffer.subarray(start, end).toString("utf8");
    session.buffer = session.buffer.subarray(end);

    try {
      yield JSON.parse(body) as unknown;
    } catch {
      // A malformed body is the server's bug; skipping it keeps the stream alive.
    }
  }
}

export const __test = { drain };
