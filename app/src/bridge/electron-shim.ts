import { EventEmitter } from "node:events";
import path from "node:path";
import { homedir } from "node:os";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>;
type SendHandler = (event: IpcMainEvent, ...args: any[]) => void;
const invokeHandlers = new Map<string, InvokeHandler>();
const sendHandlers = new Map<string, Set<SendHandler>>();

/**
 * Compile-time compatibility for retained Mastra modules that still reference
 * Electron types. This module is isolated to the AI worker bundle; it does not
 * host application commands, persistence, processes, or renderer transport.
 */

// --- WebContents ----------------------------------------------------------

class VirtualWebContents extends EventEmitter {
  private destroyed = false;

  send(channel: string, ...args: any[]): void {
    void channel;
    void args;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  openDevTools(..._args: any[]): void {
    // No-op: Tauri owns devtools.
  }

  setWindowOpenHandler(_handler?: (details: { url: string }) => unknown): void {
    // External-link handling lives in the renderer (Tauri opener plugin).
  }

  destroy(): void {
    this.destroyed = true;
  }
}

// A single virtual webContents represents the one Tauri webview. Broadcasts
// reach every connected renderer, matching this app's single-window model.
const sharedWebContents = new VirtualWebContents();

// --- BrowserWindow --------------------------------------------------------

const openWindows = new Set<BrowserWindow>();

// Named `BrowserWindow` so `import { BrowserWindow } from "electron"` resolves
// as both a value and a type (Electron's class is used both ways).
class BrowserWindow extends EventEmitter {
  readonly webContents = sharedWebContents;

  constructor(_options?: unknown) {
    super();
    openWindows.add(this);
    // The renderer is shown by Tauri; emit ready-to-show on next tick so any
    // `once("ready-to-show")` handlers still fire.
    queueMicrotask(() => this.emit("ready-to-show"));
  }

  static getAllWindows(): BrowserWindow[] {
    return [...openWindows];
  }

  show(): void {}
  focus(): void {}
  loadURL(_url?: string): Promise<void> {
    return Promise.resolve();
  }
  loadFile(_path?: string): Promise<void> {
    return Promise.resolve();
  }
  setBackgroundMaterial(_material?: string): void {}
  isDestroyed(): boolean {
    return false;
  }
  close(): void {
    openWindows.delete(this);
    this.emit("closed");
  }
}

// --- ipcMain --------------------------------------------------------------

// Electron-compatible listener signatures: `any` args so the existing handlers
// can annotate their input types (e.g. `(event, input: FooInput) => ...`).
type InvokeListener = (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>;
type SendListener = (event: IpcMainEvent, ...args: any[]) => void;

const ipcMain = {
  handle(channel: string, listener: InvokeListener): void {
    invokeHandlers.set(channel, listener as InvokeHandler);
  },
  handleOnce(channel: string, listener: InvokeListener): void {
    const wrapped: InvokeHandler = (event, ...args) => {
      invokeHandlers.delete(channel);
      return (listener as InvokeHandler)(event, ...args);
    };
    invokeHandlers.set(channel, wrapped);
  },
  removeHandler(channel: string): void {
    invokeHandlers.delete(channel);
  },
  on(channel: string, listener: SendListener) {
    const listeners = sendHandlers.get(channel) ?? new Set<SendHandler>();
    listeners.add(listener as SendHandler);
    sendHandlers.set(channel, listeners);
    return ipcMain;
  },
  once(channel: string, listener: SendListener) {
    const wrapped: SendHandler = (event, ...args) => {
      sendHandlers.get(channel)?.delete(wrapped);
      (listener as SendHandler)(event, ...args);
    };
    const listeners = sendHandlers.get(channel) ?? new Set<SendHandler>();
    listeners.add(wrapped);
    sendHandlers.set(channel, listeners);
    return ipcMain;
  },
  off(channel: string, listener: SendListener) {
    sendHandlers.get(channel)?.delete(listener as SendHandler);
    return ipcMain;
  },
  removeAllListeners(channel?: string) {
    if (channel) sendHandlers.delete(channel);
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
  // The bundled worker lives at <appRoot>/dist/mastra-worker.cjs.
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

  /** Compatibility hook for legacy AI modules; the Rust host owns readiness. */
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
  async showOpenDialog(_options?: unknown): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
  async showSaveDialog(_options?: unknown): Promise<{ canceled: boolean; filePath?: string }> {
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

// Type aliases so `import type { IpcMain, WebContents } from "electron"` in the
// existing main-process code keeps resolving once the electron dependency is
// dropped (tsconfig maps "electron" to this module).
export type IpcMain = typeof ipcMain;
export type WebContents = VirtualWebContents;
export interface IpcMainInvokeEvent {
  sender: VirtualWebContents;
}
export interface IpcMainEvent {
  sender: VirtualWebContents;
}
