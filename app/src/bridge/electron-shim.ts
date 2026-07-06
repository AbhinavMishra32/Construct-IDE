import { EventEmitter } from "node:events";
import path from "node:path";
import { homedir } from "node:os";

import { bridgeTransport, type InvokeHandler, type SendHandler } from "./transport";

/**
 * Drop-in replacement for the subset of the Electron main-process API used by
 * Construct. At bundle time `"electron"` is aliased to this module, so the
 * entire existing main process runs unchanged inside a plain Node.js sidecar
 * while Tauri owns the native window. Only the surface actually referenced by
 * `src/main` and consumed at runtime is implemented here.
 */

// --- WebContents ----------------------------------------------------------

class VirtualWebContents extends EventEmitter {
  private destroyed = false;

  send(channel: string, payload?: unknown): void {
    bridgeTransport.broadcast(channel, payload);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  openDevTools(): void {
    // No-op: Tauri owns devtools.
  }

  setWindowOpenHandler(): void {
    // External-link handling lives in the renderer (Tauri opener plugin).
  }

  destroy(): void {
    this.destroyed = true;
  }
}

// A single virtual webContents represents the one Tauri webview. Broadcasts
// reach every connected renderer, matching this app's single-window model.
const sharedWebContents = new VirtualWebContents();
bridgeTransport.senderProvider = () => sharedWebContents;

// --- BrowserWindow --------------------------------------------------------

const openWindows = new Set<VirtualBrowserWindow>();

class VirtualBrowserWindow extends EventEmitter {
  readonly webContents = sharedWebContents;

  constructor(_options?: unknown) {
    super();
    openWindows.add(this);
    // The renderer is shown by Tauri; emit ready-to-show on next tick so any
    // `once("ready-to-show")` handlers still fire.
    queueMicrotask(() => this.emit("ready-to-show"));
  }

  static getAllWindows(): VirtualBrowserWindow[] {
    return [...openWindows];
  }

  show(): void {}
  focus(): void {}
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  loadFile(): Promise<void> {
    return Promise.resolve();
  }
  setBackgroundMaterial(): void {}
  isDestroyed(): boolean {
    return false;
  }
  close(): void {
    openWindows.delete(this);
    this.emit("closed");
  }
}

// Exported under the Electron name.
const BrowserWindow = VirtualBrowserWindow;

// --- ipcMain --------------------------------------------------------------

const ipcMain = {
  handle(channel: string, handler: InvokeHandler): void {
    bridgeTransport.registerInvoke(channel, handler);
  },
  handleOnce(channel: string, handler: InvokeHandler): void {
    const wrapped: InvokeHandler = (event, ...args) => {
      bridgeTransport.removeInvoke(channel);
      return handler(event, ...args);
    };
    bridgeTransport.registerInvoke(channel, wrapped);
  },
  removeHandler(channel: string): void {
    bridgeTransport.removeInvoke(channel);
  },
  on(channel: string, handler: SendHandler) {
    bridgeTransport.registerSend(channel, handler);
    return ipcMain;
  },
  once(channel: string, handler: SendHandler) {
    const wrapped: SendHandler = (event, ...args) => {
      bridgeTransport.removeSend(channel, wrapped);
      handler(event, ...args);
    };
    bridgeTransport.registerSend(channel, wrapped);
    return ipcMain;
  },
  off(channel: string, handler: SendHandler) {
    bridgeTransport.removeSend(channel, handler);
    return ipcMain;
  },
  removeAllListeners(channel?: string) {
    if (channel) bridgeTransport.removeSend(channel);
    return ipcMain;
  }
};

// --- app ------------------------------------------------------------------

function resolveUserData(): string {
  const home = homedir();
  const productName = "Construct";
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(base, productName);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", productName);
  }
  const base = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return path.join(base, productName);
}

function resolveAppPath(): string {
  if (process.env.CONSTRUCT_APP_PATH) {
    return process.env.CONSTRUCT_APP_PATH;
  }
  // Bundled sidecar lives at <appRoot>/dist/sidecar.cjs -> app root is one up.
  return path.resolve(__dirname, "..");
}

let readyResolve: () => void = () => {};
const readyPromise = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

class BeforeQuitEvent {
  defaultPrevented = false;
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class AppShim extends EventEmitter {
  readonly dock = { setIcon: (_icon?: unknown): void => {} };
  private packaged = process.env.CONSTRUCT_PACKAGED === "1";
  private userData = resolveUserData();
  private appPath = resolveAppPath();

  get isPackaged(): boolean {
    return this.packaged;
  }

  whenReady(): Promise<void> {
    return readyPromise;
  }

  getPath(name: string): string {
    switch (name) {
      case "userData":
        return this.userData;
      case "home":
        return homedir();
      case "temp":
        return process.env.TMPDIR ?? "/tmp";
      default:
        return this.userData;
    }
  }

  getAppPath(): string {
    return this.appPath;
  }

  quit(): void {
    process.exit(0);
  }

  /** Called by the sidecar entry once the transport is listening. */
  markReady(): void {
    readyResolve();
  }

  /** Trigger the Electron-style before-quit lifecycle, then exit. */
  requestShutdown(): void {
    const event = new BeforeQuitEvent();
    this.emit("before-quit", event);
    if (!event.defaultPrevented) {
      process.exit(0);
    }
    // If a listener called preventDefault (async cleanup), it must call quit().
  }
}

const app = new AppShim();

// --- dialog (native dialogs handled by the renderer via Tauri plugins) ----

const dialog = {
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
  async showSaveDialog(): Promise<{ canceled: boolean; filePath?: string }> {
    return { canceled: true };
  },
  showErrorBox(_title: string, _content: string): void {}
};

// --- nativeTheme ----------------------------------------------------------

const nativeTheme = {
  themeSource: "system" as "light" | "dark" | "system",
  shouldUseDarkColors: false
};

// --- shell (external navigation handled by the renderer via Tauri) --------

const shell = {
  async openExternal(_url: string): Promise<void> {},
  async showItemInFolder(_fullPath: string): Promise<void> {},
  async openPath(_path: string): Promise<string> {
    return "";
  }
};

// --- nativeImage ----------------------------------------------------------

const nativeImage = {
  createFromPath(_path: string): Record<string, never> {
    return {};
  }
};

export { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, nativeImage };
export { VirtualBrowserWindow };
