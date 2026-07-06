import { randomUUID } from "node:crypto";

import { WebSocketServer, type WebSocket } from "ws";

/**
 * Low-level transport that replaces Electron's IPC channel between the main
 * process (now a Node sidecar) and the renderer (now a Tauri webview).
 *
 * Protocol (JSON over a localhost WebSocket):
 *   renderer -> sidecar:
 *     { k: "invoke", id, channel, args }   // maps to ipcMain.handle
 *     { k: "send",   channel, args }       // maps to ipcMain.on   (fire-and-forget)
 *   sidecar -> renderer:
 *     { k: "result", id, ok, value }       // reply to an invoke
 *     { k: "result", id, ok: false, error }
 *     { k: "event",  channel, payload }    // maps to webContents.send (broadcast)
 */

export type BridgeEvent = { sender: unknown };
export type InvokeHandler = (event: BridgeEvent, ...args: unknown[]) => unknown | Promise<unknown>;
export type SendHandler = (event: BridgeEvent, ...args: unknown[]) => void;

type Inbound =
  | { k: "invoke"; id: number; channel: string; args?: unknown[] }
  | { k: "send"; channel: string; args?: unknown[] };

function serializeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  return { message: String(err) };
}

const HANDLER_WAIT_TIMEOUT_MS = 15_000;

export class BridgeTransport {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly invokeHandlers = new Map<string, InvokeHandler>();
  private readonly sendHandlers = new Map<string, Set<SendHandler>>();
  private readonly handlerWaiters = new Map<string, Array<() => void>>();

  /** Provides the virtual WebContents used as `event.sender` for every message. */
  senderProvider: () => unknown = () => null;

  /** Per-launch secret required to connect, so no other local process can attach. */
  readonly token = randomUUID();

  async listen(host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host, port: 0 });
      this.wss = wss;
      wss.on("listening", () => {
        const address = wss.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
      wss.on("error", reject);
      wss.on("connection", (socket, request) => {
        // Reject any connection that does not present the launch token.
        const url = new URL(request.url ?? "/", "ws://127.0.0.1");
        if (url.searchParams.get("token") !== this.token) {
          socket.close(1008, "unauthorized");
          return;
        }
        this.handleConnection(socket);
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    this.clients.add(socket);
    console.log(`[bridge] renderer connected (${this.clients.size} active)`);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
    socket.on("message", (raw) => {
      void this.handleMessage(socket, typeof raw === "string" ? raw : raw.toString());
    });
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: Inbound;
    try {
      message = JSON.parse(raw) as Inbound;
    } catch {
      return;
    }

    const event: BridgeEvent = { sender: this.senderProvider() };

    if (message.k === "invoke") {
      try {
        const handler = await this.resolveInvokeHandler(message.channel);
        const value = await handler(event, ...(message.args ?? []));
        this.reply(socket, message.id, true, value);
      } catch (err) {
        this.replyError(socket, message.id, err);
      }
      return;
    }

    if (message.k === "send") {
      const handlers = this.sendHandlers.get(message.channel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event, ...(message.args ?? []));
          } catch {
            // Fire-and-forget: swallow handler errors, matching ipcMain.on semantics.
          }
        }
      }
    }
  }

  /**
   * Resolve the handler for a channel, waiting briefly if it has not been
   * registered yet. This removes the ordering race between the renderer
   * connecting and the sidecar finishing its async startup / handler wiring.
   */
  private resolveInvokeHandler(channel: string): Promise<InvokeHandler> {
    const existing = this.invokeHandlers.get(channel);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.handlerWaiters.get(channel);
        if (waiters) {
          const index = waiters.indexOf(onReady);
          if (index >= 0) waiters.splice(index, 1);
        }
        reject(new Error(`No handler registered for channel: ${channel}`));
      }, HANDLER_WAIT_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timer);
        const handler = this.invokeHandlers.get(channel);
        if (handler) resolve(handler);
        else reject(new Error(`No handler registered for channel: ${channel}`));
      };

      const waiters = this.handlerWaiters.get(channel) ?? [];
      waiters.push(onReady);
      this.handlerWaiters.set(channel, waiters);
    });
  }

  private reply(socket: WebSocket, id: number, ok: boolean, value: unknown): void {
    this.safeSend(socket, JSON.stringify({ k: "result", id, ok, value }));
  }

  private replyError(socket: WebSocket, id: number, err: unknown): void {
    this.safeSend(socket, JSON.stringify({ k: "result", id, ok: false, error: serializeError(err) }));
  }

  private safeSend(socket: WebSocket, data: string): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }

  // --- Electron-shim facing API -------------------------------------------

  registerInvoke(channel: string, handler: InvokeHandler): void {
    this.invokeHandlers.set(channel, handler);
    const waiters = this.handlerWaiters.get(channel);
    if (waiters) {
      this.handlerWaiters.delete(channel);
      for (const notify of waiters) notify();
    }
  }

  removeInvoke(channel: string): void {
    this.invokeHandlers.delete(channel);
  }

  registerSend(channel: string, handler: SendHandler): void {
    const set = this.sendHandlers.get(channel) ?? new Set<SendHandler>();
    set.add(handler);
    this.sendHandlers.set(channel, set);
  }

  removeSend(channel: string, handler?: SendHandler): void {
    if (!handler) {
      this.sendHandlers.delete(channel);
      return;
    }
    this.sendHandlers.get(channel)?.delete(handler);
  }

  /** Broadcast an event to every connected renderer (webContents.send). */
  broadcast(channel: string, payload: unknown): void {
    const data = JSON.stringify({ k: "event", channel, payload });
    for (const socket of this.clients) {
      this.safeSend(socket, data);
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  close(): void {
    for (const socket of this.clients) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}

/** Singleton transport shared by the Electron shim. */
export const bridgeTransport = new BridgeTransport();
