import type { WebContents } from "electron";

export class MainProcessLogBridge {
  private readonly originalLog = console.log;
  private readonly originalError = console.error;
  private readonly originalWarn = console.warn;
  private installed = false;

  constructor(private readonly options: {
    activeWebContents: () => WebContents | null;
  }) {}

  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;

    console.log = (...args: any[]) => {
      this.originalLog(...args);
      this.send("info", ...args);
    };

    console.error = (...args: any[]) => {
      this.originalError(...args);
      this.send("error", ...args);
    };

    console.warn = (...args: any[]) => {
      this.originalWarn(...args);
      this.send("warn", ...args);
    };

    process.on("uncaughtException", (error) => {
      this.logCrashSurface("main:uncaughtException", error);
    });

    process.on("unhandledRejection", (reason) => {
      this.logCrashSurface("main:unhandledRejection", reason);
    });

    process.on("warning", (warning) => {
      console.warn("[process warning]", warning.name, warning.message, warning.stack ?? "");
    });
  }

  private send(level: "info" | "warn" | "error", ...args: any[]): void {
    try {
      const message = args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.message}\n${arg.stack}`;
        }
        if (typeof arg === "object" && arg !== null) {
          try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
        }
        return String(arg);
      }).join(" ");

      const activeWebContents = this.options.activeWebContents();
      if (activeWebContents && !activeWebContents.isDestroyed()) {
        activeWebContents.send("construct:main:log", {
          level,
          message,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      this.originalError("Error in MainProcessLogBridge:", err);
    }
  }

  private logCrashSurface(scope: string, error: unknown): void {
    if (error instanceof Error) {
      console.error(`[crash:${scope}] ${error.message}`, error.stack ?? "");
      return;
    }

    console.error(`[crash:${scope}]`, error);
  }
}
