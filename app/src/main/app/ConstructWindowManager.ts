import path from "node:path";
import { existsSync } from "node:fs";

import { app, BrowserWindow, nativeImage, shell } from "electron";

export class ConstructWindowManager {
  constructor(private readonly options: {
    bundleDir: string;
    isDev: boolean;
    devServerUrl?: string;
    openDevTools: boolean;
  }) {}

  createWindow(): BrowserWindow {
    const iconPath = this.resolveIconPath();
    const isMac = process.platform === "darwin";
    const isWindows = process.platform === "win32";

    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 860,
      minHeight: 560,
      backgroundColor: "#00000000",
      backgroundMaterial: isWindows ? "acrylic" : undefined,
      transparent: true,
      vibrancy: isMac ? "sidebar" : undefined,
      visualEffectState: isMac ? "active" : undefined,
      trafficLightPosition: { x: 16, y: 17 },
      roundedCorners: true,
      titleBarStyle: isMac ? "hiddenInset" : isWindows ? "hidden" : "default",
      titleBarOverlay: isWindows
        ? {
            color: "#00000000",
            symbolColor: "#f5f5f5",
            height: 30
          }
        : undefined,
      title: "Construct",
      icon: iconPath,
      webPreferences: {
        preload: path.join(this.options.bundleDir, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      },
      show: false
    });

    if (isWindows) {
      try {
        window.setBackgroundMaterial("acrylic");
      } catch (err) {
        console.warn("Failed to set Windows background material:", err);
      }
    }

    if (process.platform === "darwin" && app.dock && existsSync(iconPath)) {
      try {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      } catch (err) {
        console.error("Failed to set dock icon:", err);
      }
    }

    window.once("ready-to-show", () => window.show());

    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      const logLevel = level >= 3 ? "error" : level >= 2 ? "warn" : "info";
      console[logLevel]("[renderer console]", message, { sourceId, line });
    });

    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("[crash:renderer]", details);
    });

    window.webContents.on("unresponsive", () => {
      console.warn("[crash:renderer] window became unresponsive");
    });

    window.webContents.on("responsive", () => {
      console.log("[renderer] window became responsive");
    });

    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[renderer] failed to load", { errorCode, errorDescription, validatedURL });
    });

    app.on("child-process-gone", (_event, details) => {
      console.error("[crash:child-process]", details);
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url).catch((error) => {
        console.error("[shell] failed to open external URL", { url, error });
      });
      return { action: "deny" };
    });

    if (this.options.isDev && this.options.devServerUrl) {
      void window.loadURL(this.options.devServerUrl);
      if (this.options.openDevTools) {
        window.webContents.openDevTools({ mode: "detach" });
      }
      return window;
    }

    void window.loadFile(path.join(this.options.bundleDir, "renderer", "index.html"));
    return window;
  }

  private resolveIconPath(): string {
    const candidates = [
      path.join(this.options.bundleDir, "..", "assets", "runtime-icon.png"),
      path.join(this.options.bundleDir, "..", "build", "icons", "icon.png"),
      path.join(this.options.bundleDir, "..", "assets", "icon.png")
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
  }
}
