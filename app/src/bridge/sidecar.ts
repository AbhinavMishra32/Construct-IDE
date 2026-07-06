/**
 * Node.js sidecar entry point for the Tauri build.
 *
 * Tauri spawns this process, reads the `CONSTRUCT_BRIDGE_PORT=<port>` line from
 * stdout, and points the webview's bridge client at that localhost WebSocket.
 * The existing Electron main process (`src/main/index.ts`) runs unchanged — at
 * bundle time `"electron"` is aliased to `./electron-shim`, so `ipcMain`,
 * `BrowserWindow`, `app`, etc. are backed by the transport instead of Electron.
 */
import { bridgeTransport } from "./transport";
import { app } from "./electron-shim";

// Importing the main process registers its `app.whenReady()` handler (still
// pending) and constructs all services. It must be imported before we mark the
// app ready so handler wiring is queued ahead of the first renderer message.
import "../main/index";

async function main(): Promise<void> {
  const port = await bridgeTransport.listen("127.0.0.1");

  // Resolve `app.whenReady()`, which triggers IPC handler registration in
  // src/main/index.ts. The transport buffers early invokes until handlers land.
  app.markReady();

  const shutdown = (): void => app.requestShutdown();
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Announce the port + token last so the Rust shell only connects once we are
  // wired up. The token gates the localhost WebSocket to this launch only.
  process.stdout.write(`CONSTRUCT_BRIDGE_PORT=${port}\n`);
  process.stdout.write(`CONSTRUCT_BRIDGE_TOKEN=${bridgeTransport.token}\n`);
}

void main().catch((err) => {
  process.stderr.write(`[sidecar] fatal: ${String(err)}\n`);
  process.exit(1);
});
