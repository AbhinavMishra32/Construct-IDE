import type { WebContents } from "electron";

type ProviderLogCallback = (provider: string, message: string, level: string) => void;

class ProviderLogServiceClass {
  private logCallbacks: ProviderLogCallback[] = [];
  private webContentsProvider: (() => WebContents | null) | null = null;

  setWebContentsProvider(provider: () => WebContents | null): void {
    this.webContentsProvider = provider;
  }

  emitLog(provider: string, message: string, level: string = "info"): void {
    // Notify all registered callbacks
    this.logCallbacks.forEach(callback => {
      try {
        callback(provider, message, level);
      } catch (err) {
        console.error("Provider log callback error:", err);
      }
    });

    // Send to renderer via IPC
    if (this.webContentsProvider) {
      const webContents = this.webContentsProvider();
      if (webContents && !webContents.isDestroyed()) {
        webContents.send("construct:provider:log", { provider, message, level });
      }
    }
  }

  onLog(callback: ProviderLogCallback): () => void {
    this.logCallbacks.push(callback);
    return () => {
      this.logCallbacks = this.logCallbacks.filter(cb => cb !== callback);
    };
  }
}

export const providerLogService = new ProviderLogServiceClass();

export function emitProviderLog(provider: string, message: string, level: string = "info"): void {
  providerLogService.emitLog(provider, message, level);
}