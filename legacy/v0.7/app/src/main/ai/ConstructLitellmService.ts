import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

export type LitellmStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export type LitellmState = {
  status: LitellmStatus;
  port: number;
  pid: number | null;
  error: string | null;
};

type LogCallback = (level: string, message: string) => void;

const RECOMMENDED_OPENAI_MODELS = [
  "gpt-5-mini", "gpt-5-nano", "gpt-5.4", "gpt-4.1-mini", "gpt-4.1-nano"
];

const RECOMMENDED_OPENROUTER_MODELS = [
  "deepseek/deepseek-v4-flash", "deepseek/deepseek-chat",
  "anthropic/claude-sonnet-4", "anthropic/claude-3.5-haiku",
  "google/gemini-2.5-flash", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano"
];

export class ConstructLitellmService {
  private process: ChildProcess | null = null;
  private state: LitellmState = { status: "stopped", port: 4000, pid: null, error: null };
  private logCallbacks: LogCallback[] = [];
  private statusCallbacks: Array<(state: LitellmState) => void> = [];
  private configDir: string | null = null;

  getState(): LitellmState {
    return { ...this.state };
  }

  onLog(cb: LogCallback): void {
    this.logCallbacks.push(cb);
  }

  onStatusChange(cb: (state: LitellmState) => void): void {
    this.statusCallbacks.push(cb);
  }

  private setState(update: Partial<LitellmState>): void {
    this.state = { ...this.state, ...update };
    for (const cb of this.statusCallbacks) {
      try {
        cb(this.state);
      } catch { /* ignore */ }
    }
  }

  private emitLog(level: string, message: string): void {
    for (const cb of this.logCallbacks) {
      try {
        cb(level, message);
      } catch { /* ignore */ }
    }
  }

  async start(port: number, openAiApiKey?: string, openRouterApiKey?: string): Promise<void> {
    if (this.state.status === "running") {
      this.emitLog("info", "LiteLLM proxy is already running.");
      return;
    }

    if (this.state.status === "starting") {
      this.emitLog("warn", "LiteLLM proxy is already starting.");
      return;
    }

    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }

    this.setState({ status: "starting", port, error: null, pid: null });
    this.emitLog("info", `Starting LiteLLM proxy on port ${port}...`);

    try {
      const installed = await this.checkInstall();
      if (!installed) {
        this.setState({
          status: "error",
          error: "litellm is not installed. Run: pip3 install litellm"
        });
        this.emitLog("error", "litellm binary not found. Install with: pip3 install litellm");
        return;
      }
      this.emitLog("info", "litellm is installed.");

      this.configDir = await mkdtemp(path.join(tmpdir(), "construct-litellm-"));
      const configPath = path.join(this.configDir, "config.yaml");

      const modelEntries: string[] = [];

      if (openAiApiKey) {
        this.emitLog("info", "Configuring OpenAI models...");
        for (const modelId of RECOMMENDED_OPENAI_MODELS) {
          modelEntries.push(
            `  - model_name: ${modelId}\n    litellm_params:\n      model: openai/${modelId}`
          );
        }
      }

      if (openRouterApiKey) {
        this.emitLog("info", "Configuring OpenRouter models...");
        for (const modelId of RECOMMENDED_OPENROUTER_MODELS) {
          modelEntries.push(
            `  - model_name: ${modelId}\n    litellm_params:\n      model: ${modelId}`
          );
        }
      }

      if (modelEntries.length === 0) {
        this.emitLog("warn", "No API keys configured. LiteLLM will start with no upstream providers.");
      }

      const config = `model_list:\n${modelEntries.join("\n")}\n`;
      await writeFile(configPath, config, "utf-8");
      this.emitLog("info", `Config written to ${configPath}`);

      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (openAiApiKey) env.OPENAI_API_KEY = openAiApiKey;
      if (openRouterApiKey) env.OPENROUTER_API_KEY = openRouterApiKey;

      this.emitLog("info", `Spawning: litellm --port ${port} --config ${configPath}`);

      this.process = spawn("litellm", ["--port", String(port), "--config", configPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      this.setState({ pid: this.process.pid ?? null });

      this.process.stdout?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          for (const line of text.split("\n")) {
            this.emitLog("info", line);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const level = trimmed.includes("ERROR") ? "error"
              : trimmed.includes("WARN") ? "warn"
              : "info";
            this.emitLog(level, trimmed);
          }
        }
      });

      this.process.on("error", (err) => {
        this.emitLog("error", `LiteLLM process error: ${err.message}`);
        this.setState({ status: "error", error: err.message });
      });

      this.process.on("exit", (code, signal) => {
        this.emitLog("info", `LiteLLM exited (code: ${code}, signal: ${signal})`);
        this.process = null;
        this.setState({ status: "stopped", pid: null });
        void this.cleanupConfig();
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.process && this.process.exitCode === null) {
            this.setState({ status: "running" });
            this.emitLog("info", `LiteLLM proxy is running on port ${port}`);
            resolve();
          } else {
            reject(new Error("LiteLLM process exited before becoming ready"));
          }
        }, 2000);

        this.process?.once("exit", () => {
          clearTimeout(timeout);
          if (this.state.status !== "running") {
            reject(new Error("LiteLLM process exited prematurely"));
          }
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog("error", `Failed to start LiteLLM: ${msg}`);
      this.setState({ status: "error", error: msg });
      void this.cleanupConfig();
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.emitLog("info", "LiteLLM proxy is not running.");
      return;
    }

    this.setState({ status: "stopping" });
    this.emitLog("info", "Stopping LiteLLM proxy...");

    this.process.kill("SIGTERM");

    try {
      await new Promise<void>((_resolve, reject) => {
        const timeout = setTimeout(() => {
          this.process?.kill("SIGKILL");
          reject(new Error("forced kill"));
        }, 5000);

        this.process?.on("exit", () => {
          clearTimeout(timeout);
          _resolve();
        });
      });
    } catch {
      this.emitLog("warn", "LiteLLM did not exit gracefully, sent SIGKILL");
    }

    this.process = null;
    this.setState({ status: "stopped", pid: null });
    this.emitLog("info", "LiteLLM proxy stopped.");
    void this.cleanupConfig();
  }

  async checkInstall(): Promise<boolean> {
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("litellm", ["--version"], {
          stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        proc.stdout?.on("data", (d) => { out += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`exit code ${code}: ${out.trim()}`));
        });
        proc.on("error", reject);
      });
      return true;
    } catch {
      return false;
    }
  }

  async autoInstall(): Promise<boolean> {
    this.emitLog("info", "Installing litellm via pip3...");
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("pip3", ["install", "litellm"], {
          stdio: ["ignore", "pipe", "pipe"]
        });
        proc.stdout?.on("data", (d) => { this.emitLog("info", d.toString().trim()); });
        proc.stderr?.on("data", (d) => { this.emitLog("info", d.toString().trim()); });
        proc.on("close", (code) => {
          code === 0 ? resolve() : reject(new Error(`pip3 exit code ${code}`));
        });
        proc.on("error", reject);
      });
      this.emitLog("info", "litellm installed successfully.");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog("error", `Failed to install litellm: ${msg}`);
      return false;
    }
  }

  private async cleanupConfig(): Promise<void> {
    if (this.configDir) {
      try {
        await rm(this.configDir, { recursive: true, force: true });
      } catch { /* ignore */ }
      this.configDir = null;
    }
  }
}
