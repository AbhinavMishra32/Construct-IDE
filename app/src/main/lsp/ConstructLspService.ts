import path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { totalmem } from "node:os";
import { promisify } from "node:util";

import type { WebContents } from "electron";

import { RUST_ANALYZER_EXCLUDED_PATHS, rustAnalyzerConfigurationForSection } from "../../shared/constructLsp";
import { isFlowProject, isTapeProject, type StoredProject } from "../projects/ConstructProjectTypes";
import type { DebugProcessSnapshot } from "../terminal/ConstructTerminalService";

export type LspLanguage = "typescript" | "python" | "rust" | "go" | "java" | "cpp" | "csharp" | "html" | "css" | "json";
export type LspStatus = "not-installed" | "running" | "stopped" | "installing" | "blocked";
export type LspSkipReason = "no-cargo-project" | "resource-cooldown" | "not-installed";
export type LspSkipReport = {
  blockedUntil?: string;
  memoryLimitMb?: number;
  message: string;
  reason: LspSkipReason;
};
export type LspStartResult = {
  languages: LspLanguage[];
  workspacePath: string;
  projectRoots?: Partial<Record<LspLanguage, string>>;
  skipped?: Partial<Record<LspLanguage, LspSkipReport>>;
};
export type LspStatusReport = Record<LspLanguage, {
  blockedUntil?: string;
  command: string;
  detail?: string;
  installCommand: string;
  installed: boolean;
  label: string;
  memoryLimitMb?: number;
  memoryMb?: number;
  resolvedPath: string | null;
  status: LspStatus;
}>;

type LspServerState = {
  buffer: string;
  monitorInFlight: boolean;
  monitorTimer: NodeJS.Timeout | null;
  pendingRequests: Map<number, {
    reject: (reason?: unknown) => void;
    resolve: (value: unknown) => void;
    timer: NodeJS.Timeout | null;
  }>;
  process: ChildProcess | null;
  resource: LspResourceSnapshot | null;
  startedAt: number | null;
  workspacePath: string | null;
};

type LspServerConfig = {
  args: string[];
  command: string;
  extensions: string[];
  installCommand: string;
  installPackages?: string[];
  label: string;
  scriptPath?: string[];
};

type LspResourcePolicy = {
  cooldownMs: number;
  memoryLimitMb: number;
};

type LspResourceSnapshot = {
  checkedAt: number;
  memoryMb: number;
  processCount: number;
};

type LspResourceBlock = {
  blockedUntil: number;
  memoryLimitMb?: number;
  reason: string;
  workspacePath: string;
};

type ProcessResourceSnapshot = {
  memoryMb: number;
  processCount: number;
};

const execFileAsync = promisify(execFile);

const lspLanguageOrder: LspLanguage[] = ["typescript", "python", "rust", "go", "java", "cpp", "csharp", "html", "css", "json"];
const lspGeneratedDirectoryNames = new Set<string>([
  ...RUST_ANALYZER_EXCLUDED_PATHS,
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "env",
  "venv"
]);
const LSP_REQUEST_TIMEOUT_MS = 15_000;
const LSP_RESOURCE_MONITOR_INTERVAL_MS = 1_000;
const LSP_BUFFER_LIMIT_BYTES = 8 * 1024 * 1024;
const LSP_STDERR_LOG_LIMIT_CHARS = 4_000;
const LSP_PROCESS_KILL_GRACE_MS = 2_000;
const RUST_ANALYZER_MEMORY_FRACTION = 0.25;
const RUST_ANALYZER_MEMORY_MIN_MB = 2_048;
const RUST_ANALYZER_MEMORY_MAX_MB = 3_072;
const RUST_ANALYZER_RESOURCE_POLICY: LspResourcePolicy = {
  cooldownMs: 15 * 60_000,
  memoryLimitMb: resolveRustAnalyzerMemoryLimitMb()
};

const lspConfigs: Record<LspLanguage, LspServerConfig> = {
  typescript: {
    args: ["--stdio"],
    command: "typescript-language-server --stdio",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    installCommand: "npm install --save-dev typescript-language-server typescript",
    installPackages: ["typescript-language-server", "typescript"],
    label: "TypeScript / JavaScript",
    scriptPath: ["typescript-language-server", "lib", "cli.mjs"]
  },
  python: {
    args: ["--stdio"],
    command: "pyright-langserver --stdio",
    extensions: [".py", ".pyi"],
    installCommand: "npm install --save-dev pyright",
    installPackages: ["pyright"],
    label: "Python",
    scriptPath: ["pyright", "langserver.index.js"]
  },
  rust: {
    args: [],
    command: "rust-analyzer",
    extensions: [".rs"],
    installCommand: "rustup component add rust-analyzer",
    label: "Rust"
  },
  go: {
    args: [],
    command: "gopls",
    extensions: [".go"],
    installCommand: "go install golang.org/x/tools/gopls@latest",
    label: "Go"
  },
  java: {
    args: [],
    command: "jdtls",
    extensions: [".java"],
    installCommand: "brew install jdtls",
    label: "Java"
  },
  cpp: {
    args: [],
    command: "clangd",
    extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"],
    installCommand: "brew install llvm",
    label: "C / C++"
  },
  csharp: {
    args: ["--stdio"],
    command: "csharp-ls --stdio",
    extensions: [".cs", ".csx"],
    installCommand: "dotnet tool install --global csharp-ls",
    label: "C#"
  },
  html: {
    args: ["--stdio"],
    command: "vscode-html-language-server --stdio",
    extensions: [".html", ".htm"],
    installCommand: "npm install --save-dev vscode-langservers-extracted",
    installPackages: ["vscode-langservers-extracted"],
    label: "HTML",
    scriptPath: ["vscode-langservers-extracted", "bin", "vscode-html-language-server"]
  },
  css: {
    args: ["--stdio"],
    command: "vscode-css-language-server --stdio",
    extensions: [".css", ".scss", ".sass", ".less"],
    installCommand: "npm install --save-dev vscode-langservers-extracted",
    installPackages: ["vscode-langservers-extracted"],
    label: "CSS",
    scriptPath: ["vscode-langservers-extracted", "bin", "vscode-css-language-server"]
  },
  json: {
    args: ["--stdio"],
    command: "vscode-json-language-server --stdio",
    extensions: [".json", ".jsonc"],
    installCommand: "npm install --save-dev vscode-langservers-extracted",
    installPackages: ["vscode-langservers-extracted"],
    label: "JSON",
    scriptPath: ["vscode-langservers-extracted", "bin", "vscode-json-language-server"]
  }
};

export class ConstructLspService {
  private readonly servers: Record<LspLanguage, LspServerState> = {
    typescript: createServerState(),
    python: createServerState(),
    rust: createServerState(),
    go: createServerState(),
    java: createServerState(),
    cpp: createServerState(),
    csharp: createServerState(),
    html: createServerState(),
    css: createServerState(),
    json: createServerState()
  };
  private readonly resourceBlocks = new Map<string, LspResourceBlock>();
  private activeWebContents: WebContents | null = null;
  private installingLanguage: LspLanguage | "all" | null = null;
  private installProcess: ChildProcess | null = null;

  constructor(private readonly options: {
    appPath: string;
    bundleDir: string;
    cwd: string;
    workspacePathForProject: (projectId: string) => string;
  }) {}

  setActiveWebContents(webContents: WebContents): void {
    this.activeWebContents = webContents;
  }

  getStatus(projectId?: string): LspStatusReport {
    const wsPath = projectId ? this.options.workspacePathForProject(projectId) : this.options.cwd;
    const report = {} as LspStatusReport;

    for (const language of lspLanguageOrder) {
      const server = this.servers[language];
      const resolvedPath = this.resolveServerCommand(wsPath, language);
      const installed = resolvedPath != null;
      const resourceBlock = this.activeResourceBlock(language, wsPath);
      const status: LspStatus = server.process
        ? "running"
        : this.installingLanguage === "all" || this.installingLanguage === language
          ? "installing"
          : resourceBlock
            ? "blocked"
          : installed
            ? "stopped"
            : "not-installed";
      const policy = this.resourcePolicyFor(language);

      report[language] = {
        blockedUntil: resourceBlock ? new Date(resourceBlock.blockedUntil).toISOString() : undefined,
        command: lspConfigs[language].command,
        detail: resourceBlock?.reason,
        installCommand: lspConfigs[language].installCommand,
        installed,
        label: lspConfigs[language].label,
        memoryLimitMb: policy?.memoryLimitMb,
        memoryMb: server.resource?.memoryMb,
        resolvedPath,
        status
      };
    }

    return report;
  }

  startForProject(project: StoredProject): LspStartResult {
    const languages = this.languagesForProject(project);
    const startedLanguages: LspLanguage[] = [];
    const projectRoots: Partial<Record<LspLanguage, string>> = {};
    const skipped: Partial<Record<LspLanguage, LspSkipReport>> = {};

    if (languages.length === 0) {
      const projectLabel = isFlowProject(project) ? "Flow project" : "project";
      console.log(`[LSP] No supported language files found for ${projectLabel}`, { id: project.id });
    }

    for (const language of languages) {
      const languageRoot = language === "rust" ? this.findCargoProjectRoot(project.workspacePath) : project.workspacePath;
      if (language === "rust" && !languageRoot) {
        const message = "Skipping Rust language server because this workspace has Rust files but no Cargo.toml root.";
        skipped.rust = { message, reason: "no-cargo-project" };
        this.emitLog("rust", "warn", message);
        this.stop("rust");
        continue;
      }

      const resourceBlock = this.activeResourceBlock(language, languageRoot ?? project.workspacePath);
      if (resourceBlock) {
        const policy = this.resourcePolicyFor(language);
        skipped[language] = {
          blockedUntil: new Date(resourceBlock.blockedUntil).toISOString(),
          memoryLimitMb: policy?.memoryLimitMb,
          message: resourceBlock.reason,
          reason: "resource-cooldown"
        };
        this.emitLog(language, "warn", resourceBlock.reason);
        this.stop(language);
        continue;
      }

      if (!this.resolveServerCommand(project.workspacePath, language)) {
        skipped[language] = {
          message: `Skipping ${lspConfigs[language].label}; server is not installed.`,
          reason: "not-installed"
        };
        this.emitLog(language, "warn", `Skipping ${lspConfigs[language].label}; server is not installed.`);
        continue;
      }

      if (language === "rust" && languageRoot) {
        projectRoots.rust = languageRoot;
      }

      if (this.startServer(project.workspacePath, language)) {
        startedLanguages.push(language);
      }
    }

    for (const language of lspLanguageOrder) {
      if (!languages.includes(language)) {
        this.stop(language);
      }
    }

    return {
      languages: startedLanguages,
      workspacePath: project.workspacePath,
      projectRoots,
      skipped: Object.keys(skipped).length > 0 ? skipped : undefined
    };
  }

  stop(language?: LspLanguage): void {
    const languages = language ? [language] : lspLanguageOrder;

    for (const currentLanguage of languages) {
      const server = this.servers[currentLanguage];
      if (server.process) {
        console.log(`[LSP] Stopping ${lspConfigs[currentLanguage].command}`);
        this.emitLog(currentLanguage, "info", `Stopping ${lspConfigs[currentLanguage].command}`);
        this.terminateProcess(server.process, currentLanguage);
        server.process = null;
      }
      if (server.monitorTimer) {
        clearInterval(server.monitorTimer);
        server.monitorTimer = null;
      }
      server.monitorInFlight = false;
      server.buffer = "";
      server.resource = null;
      server.startedAt = null;
      server.workspacePath = null;
      for (const pending of server.pendingRequests.values()) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.reject(new Error("LSP server stopped"));
      }
      server.pendingRequests.clear();
    }
  }

  async install(workspacePath: string, language?: LspLanguage): Promise<boolean> {
    if (this.installingLanguage) {
      return false;
    }
    this.installingLanguage = language ?? "all";
    console.log("[LSP Installer] Starting language-server install in workspace:", workspacePath);

    const configs = language ? [lspConfigs[language]] : Object.values(lspConfigs);
    const packages = Array.from(new Set(configs.flatMap((config) => config.installPackages ?? [])));
    const command = packages.length > 0
      ? `npm install --save-dev ${packages.join(" ")}`
      : language
        ? lspConfigs[language].installCommand
        : "";
    if (!command) {
      this.installingLanguage = null;
      return false;
    }

    return new Promise((resolve) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const npmProcess = spawn(shell, ["-c", command], {
        cwd: workspacePath,
        env: {
          ...process.env
        }
      });
      this.installProcess = npmProcess;

      npmProcess.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf8");
        console.log("[LSP Installer stdout]:", text);
        this.activeWebContents?.send("construct:lsp:install-progress", { language: language ?? "all", type: "stdout", text });
      });

      npmProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf8");
        console.warn("[LSP Installer stderr]:", text);
        this.activeWebContents?.send("construct:lsp:install-progress", { language: language ?? "all", type: "stderr", text });
      });

      npmProcess.on("close", (code) => {
        this.installingLanguage = null;
        this.installProcess = null;
        console.log(`[LSP Installer] Process finished with exit code: ${code}`);
        resolve(code === 0);
      });

      npmProcess.on("error", (err) => {
        this.installingLanguage = null;
        this.installProcess = null;
        console.error("[LSP Installer] Process spawn error:", err);
        resolve(false);
      });
    });
  }

  request(webContents: WebContents, payload: any): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const language = this.inferLanguage(payload);
      const server = this.servers[language];
      if (!server.process || !server.process.stdin) {
        reject(new Error(`${lspConfigs[language].label} LSP process not running`));
        return;
      }

      this.activeWebContents = webContents;

      if (payload.id !== undefined) {
        const timer = setTimeout(() => {
          server.pendingRequests.delete(payload.id);
          reject(new Error(`${lspConfigs[language].label} LSP request timed out: ${String(payload.method ?? payload.id)}`));
        }, LSP_REQUEST_TIMEOUT_MS);
        timer.unref?.();
        server.pendingRequests.set(payload.id, { resolve, reject, timer });
      }

      const { languageId: _languageId, ...message } = payload;
      const jsonStr = JSON.stringify(message);
      const formatted = `Content-Length: ${Buffer.byteLength(jsonStr, "utf8")}\r\n\r\n${jsonStr}`;

      server.process.stdin.write(formatted, "utf8");

      if (payload.id === undefined) {
        resolve(null);
      }
    });
  }

  snapshots(): DebugProcessSnapshot[] {
    const snapshots: DebugProcessSnapshot[] = [];

    for (const language of lspLanguageOrder) {
      const server = this.servers[language];
      snapshots.push({
        id: `lsp:${language}`,
        kind: "lsp",
        label: lspConfigs[language].label,
        pid: server.process?.pid ?? null,
        status: server.process ? "running" : "stopped",
        workspacePath: server.workspacePath,
        command: lspConfigs[language].command,
        memoryMb: server.resource?.memoryMb ?? undefined
      });
    }

    if (this.installProcess) {
      snapshots.push({
        id: "installer:lsp",
        kind: "installer",
        label: "LSP dependency installer",
        pid: this.installProcess.pid ?? null,
        status: "running",
        command: "npm install language servers"
      });
    }

    return snapshots;
  }

  private findNodeModuleScript(workspacePath: string, relativeScriptPath: string[]): string | null {
    const candidates = [
      path.join(workspacePath, "node_modules", ...relativeScriptPath),
      path.join(this.options.bundleDir, "..", "node_modules", ...relativeScriptPath),
      path.join(this.options.appPath, "node_modules", ...relativeScriptPath),
      path.join(this.options.cwd, "node_modules", ...relativeScriptPath),
      path.join(this.options.cwd, "app", "node_modules", ...relativeScriptPath)
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    console.warn(`[LSP] Could not resolve ${relativeScriptPath.join("/")} from candidates:\n${candidates.join("\n")}`);
    return null;
  }

  private resolveServerCommand(workspacePath: string, language: LspLanguage): string | null {
    const scriptPath = lspConfigs[language].scriptPath;
    if (scriptPath) {
      return this.findNodeModuleScript(workspacePath, scriptPath);
    }
    const executable = lspConfigs[language].command.split(/\s+/)[0];
    return this.findExecutable(workspacePath, executable);
  }

  private findExecutable(workspacePath: string, executable: string): string | null {
    const candidates = [
      path.join(workspacePath, "node_modules", ".bin", executable),
      ...((process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executable)))
    ];
    for (const candidate of candidates) {
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private languageForPath(filePath: string): LspLanguage | null {
    const lower = filePath.toLowerCase().split("?")[0] ?? filePath.toLowerCase();
    for (const language of lspLanguageOrder) {
      if (lspConfigs[language].extensions.some((extension) => lower.endsWith(extension))) {
        return language;
      }
    }

    return null;
  }

  private languagesForProject(project: StoredProject): LspLanguage[] {
    const languages = new Set<LspLanguage>();

    if (isTapeProject(project)) {
      for (const file of project.program.files ?? []) {
        if (this.isIgnoredDiscoveryPath(file.path)) {
          continue;
        }
        const language = this.languageForPath(file.path);
        if (language) {
          languages.add(language);
        }
      }
    }

    if (project.activeFilePath && !this.isIgnoredDiscoveryPath(project.activeFilePath)) {
      const language = this.languageForPath(project.activeFilePath);
      if (language) {
        languages.add(language);
      }
    }

    if (languages.size === 0) {
      this.scanWorkspaceForLanguages(project.workspacePath, languages);
    }

    return [...languages];
  }

  private scanWorkspaceForLanguages(workspacePath: string, languages: Set<LspLanguage>, depth = 0): void {
    if (depth > 3 || !existsSync(workspacePath)) return;
    try {
      const entries = readdirSync(workspacePath, { withFileTypes: true });
      for (const entry of entries) {
        if (this.isIgnoredDiscoveryDirectory(entry.name)) continue;
        const fullPath = path.join(workspacePath, entry.name);
        if (entry.isDirectory()) {
          this.scanWorkspaceForLanguages(fullPath, languages, depth + 1);
        } else if (entry.isFile()) {
          const language = this.languageForPath(entry.name);
          if (language) {
            languages.add(language);
          }
        }
      }
    } catch {
      // Ignore permission errors or broken symlinks
    }
  }

  private emitLog(language: LspLanguage, level: "info" | "warn" | "error", text: string): void {
    const line = `[${lspConfigs[language].label}] ${text}`;
    if (this.activeWebContents && !this.activeWebContents.isDestroyed()) {
      this.activeWebContents.send("construct:lsp:stderr", { language, level, text: line });
    }
  }

  private findCargoProjectRoot(workspacePath: string): string | null {
    const cargoToml = path.join(workspacePath, "Cargo.toml");
    if (existsSync(cargoToml)) {
      return workspacePath;
    }

    try {
      const entries = readdirSync(workspacePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || this.isIgnoredDiscoveryDirectory(entry.name)) continue;
        const candidate = path.join(workspacePath, entry.name, "Cargo.toml");
        if (existsSync(candidate)) {
          return path.join(workspacePath, entry.name);
        }
      }
    } catch {}

    return null;
  }

  private startServer(workspacePath: string, language: LspLanguage): boolean {
    const server = this.servers[language];
    const config = lspConfigs[language];
    let cwd = workspacePath;
    if (language === "rust") {
      const cargoRoot = this.findCargoProjectRoot(workspacePath);
      if (cargoRoot) {
        cwd = cargoRoot;
        console.log(`[LSP] Found Rust project root: ${cargoRoot}`);
        this.emitLog(language, "info", `Using Rust project root ${cargoRoot}`);
      } else {
        const msg = "No Cargo.toml found in workspace; Rust LSP requires a Cargo project.";
        console.warn(`[LSP] ${msg}`);
        this.emitLog(language, "warn", msg);
        return false;
      }
    }

    if (server.process && server.workspacePath === cwd) {
      return true;
    }

    this.stop(language);

    console.log(`[LSP] Starting ${config.command} in:`, cwd);
    this.emitLog(language, "info", `Starting ${config.command} in ${cwd}`);

    const executable = this.resolveServerCommand(workspacePath, language);

    if (!executable) {
      const message = `${config.label} server is not installed. Install with: ${config.installCommand}`;
      console.error("[LSP] " + message);
      this.emitLog(language, "error", message);
      return false;
    }

    const resourceBlock = this.activeResourceBlock(language, cwd);
    if (resourceBlock) {
      this.emitLog(language, "warn", resourceBlock.reason);
      return false;
    }

    console.log(`[LSP] Using ${language} server path: ${executable}`);
    this.emitLog(language, "info", `Using server ${executable}`);

    const command = config.scriptPath ? process.execPath : executable;
    const args = config.scriptPath ? [executable, ...config.args] : config.command.split(/\s+/).slice(1);
    const resourcePolicy = this.resourcePolicyFor(language);
    server.process = this.spawnServerProcess(command, args, {
      cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      },
      resourcePolicy
    });
    server.workspacePath = cwd;
    server.startedAt = Date.now();
    server.resource = null;
    this.startResourceMonitor(language, resourcePolicy);

    server.process.stdout?.on("data", (chunk: Buffer) => {
      this.handleData(language, chunk);
    });

    server.process.stderr?.on("data", (data: Buffer) => {
      const text = truncateLspLogText(data.toString("utf8"));
      console.warn(`[LSP ${language} stderr]:`, text);
      this.emitLog(language, "warn", text);
    });

    server.process.on("close", (code, signal) => {
      const detail = `Process exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`;
      console.log(`[LSP] ${language} ${detail}`);
      this.emitLog(language, code === 0 ? "info" : "warn", detail);
      server.process = null;
      if (server.monitorTimer) {
        clearInterval(server.monitorTimer);
        server.monitorTimer = null;
      }
      server.monitorInFlight = false;
      server.buffer = "";
      server.workspacePath = null;
      server.startedAt = null;
      for (const pending of server.pendingRequests.values()) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.reject(new Error("LSP server stopped"));
      }
      server.pendingRequests.clear();
    });

    server.process.on("error", (err) => {
      console.error(`[LSP] ${language} process error:`, err);
      this.emitLog(language, "error", err instanceof Error ? err.message : String(err));
      this.stop(language);
    });

    return true;
  }

  private inferLanguage(payload: any): LspLanguage {
    if (lspLanguageOrder.includes(payload?.languageId)) {
      return payload.languageId;
    }

    const uri = payload?.params?.textDocument?.uri;
    if (typeof uri === "string") {
      const clean = uri.split("?")[0]?.toLowerCase() ?? "";
      for (const language of lspLanguageOrder) {
        if (lspConfigs[language].extensions.some((extension) => clean.endsWith(extension))) {
          return language;
        }
      }
    }

    return "typescript";
  }

  private handleData(language: LspLanguage, chunk: Buffer): void {
    const server = this.servers[language];
    server.buffer += chunk.toString("utf8");
    if (Buffer.byteLength(server.buffer, "utf8") > LSP_BUFFER_LIMIT_BYTES) {
      const message = `${lspConfigs[language].label} LSP output exceeded ${Math.round(LSP_BUFFER_LIMIT_BYTES / 1024 / 1024)} MB before a complete JSON-RPC frame; stopping server.`;
      this.emitLog(language, "error", message);
      this.stop(language);
      return;
    }
    while (true) {
      const contentLengthIndex = server.buffer.indexOf("Content-Length:");
      if (contentLengthIndex === -1) {
        break;
      }

      const headerEndIndex = server.buffer.indexOf("\r\n\r\n", contentLengthIndex);
      if (headerEndIndex === -1) {
        break;
      }

      const contentLengthStr = server.buffer.slice(contentLengthIndex + 15, headerEndIndex).trim();
      const contentLength = parseInt(contentLengthStr, 10);
      if (isNaN(contentLength)) {
        server.buffer = "";
        break;
      }

      const bodyStartIndex = headerEndIndex + 4;
      if (server.buffer.length < bodyStartIndex + contentLength) {
        break;
      }

      const body = server.buffer.slice(bodyStartIndex, bodyStartIndex + contentLength);
      server.buffer = server.buffer.slice(bodyStartIndex + contentLength);

      try {
        const message = JSON.parse(body);
        this.handleMessage(language, message);
      } catch (err) {
        console.error("[LSP] Failed to parse JSON body:", err);
        this.emitLog(language, "error", `Failed to parse server JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private handleMessage(language: LspLanguage, message: any): void {
    const server = this.servers[language];
    if (message.id !== undefined && message.method !== undefined) {
      const result = this.clientRequestResult(language, message.method, message.params);
      if (server.process?.stdin) {
        const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
        server.process.stdin.write(`Content-Length: ${Buffer.byteLength(response, "utf8")}\r\n\r\n${response}`);
        this.emitLog(language, "info", `Responded to server request ${message.method} (${message.id})`);
      }
    } else if (message.id !== undefined) {
      const pending = server.pendingRequests.get(message.id);
      if (pending) {
        server.pendingRequests.delete(message.id);
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.resolve(message);
      }
    } else if (message.method !== undefined) {
      if (this.activeWebContents && !this.activeWebContents.isDestroyed()) {
        this.activeWebContents.send("construct:lsp:notification", { ...message, languageId: language });
      }
    }
  }

  private clientRequestResult(language: LspLanguage, method: string, params: any): unknown {
    switch (method) {
      case "workspace/configuration":
        return Array.isArray(params?.items)
          ? params.items.map((item: { section?: string | null }) => this.configurationForItem(language, item.section))
          : [];
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
        return null;
      case "workspace/applyEdit":
        return { applied: false, failureReason: "Construct does not apply language-server workspace edits automatically." };
      default:
        return null;
    }
  }

  private configurationForItem(language: LspLanguage, section?: string | null): unknown {
    if (section === "formattingOptions") {
      return { tabSize: 2, insertSpaces: true, trimTrailingWhitespace: true, insertFinalNewline: true };
    }

    if (language === "rust") {
      return rustAnalyzerConfigurationForSection(section, this.servers.rust.workspacePath);
    }

    return null;
  }

  private isIgnoredDiscoveryDirectory(name: string): boolean {
    return name.startsWith(".") || lspGeneratedDirectoryNames.has(name);
  }

  private isIgnoredDiscoveryPath(filePath: string): boolean {
    return filePath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .some((segment) => this.isIgnoredDiscoveryDirectory(segment));
  }

  private resourcePolicyFor(language: LspLanguage): LspResourcePolicy | null {
    return language === "rust" ? RUST_ANALYZER_RESOURCE_POLICY : null;
  }

  private activeResourceBlock(language: LspLanguage, workspacePath: string): LspResourceBlock | null {
    const candidates = [workspacePath];
    if (language === "rust") {
      const cargoRoot = this.findCargoProjectRoot(workspacePath);
      if (cargoRoot && cargoRoot !== workspacePath) {
        candidates.push(cargoRoot);
      }
    }

    for (const candidate of candidates) {
      const key = this.resourceBlockKey(language, candidate);
      const block = this.resourceBlocks.get(key);
      if (!block) {
        continue;
      }
      if (Date.now() >= block.blockedUntil) {
        this.resourceBlocks.delete(key);
        continue;
      }
      return block;
    }

    return null;
  }

  private resourceBlockKey(language: LspLanguage, workspacePath: string): string {
    return `${language}:${path.resolve(workspacePath)}`;
  }

  private spawnServerProcess(command: string, args: string[], input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    resourcePolicy: LspResourcePolicy | null;
  }): ChildProcess {
    const detached = process.platform !== "win32";
    if (input.resourcePolicy && detached && isExecutableFile("/bin/sh")) {
      const memoryLimitKb = String(input.resourcePolicy.memoryLimitMb * 1024);
      return spawn("/bin/sh", [
        "-c",
        [
          "limit_kb=\"$1\"",
          "command_path=\"$2\"",
          "shift 2",
          "ulimit -v \"$limit_kb\" 2>/dev/null || true",
          "ulimit -m \"$limit_kb\" 2>/dev/null || true",
          "exec \"$command_path\" \"$@\""
        ].join("; "),
        "construct-lsp-limit",
        memoryLimitKb,
        command,
        ...args
      ], {
        cwd: input.cwd,
        detached,
        env: input.env
      });
    }

    return spawn(command, args, {
      cwd: input.cwd,
      detached,
      env: input.env
    });
  }

  private startResourceMonitor(language: LspLanguage, policy: LspResourcePolicy | null): void {
    const server = this.servers[language];
    if (server.monitorTimer) {
      clearInterval(server.monitorTimer);
      server.monitorTimer = null;
    }

    if (!policy || !server.process?.pid) {
      return;
    }

    server.monitorTimer = setInterval(() => {
      void this.checkResourceLimit(language, policy);
    }, LSP_RESOURCE_MONITOR_INTERVAL_MS);
    server.monitorTimer.unref?.();
    void this.checkResourceLimit(language, policy);
  }

  private async checkResourceLimit(language: LspLanguage, policy: LspResourcePolicy): Promise<void> {
    const server = this.servers[language];
    const pid = server.process?.pid;
    if (!pid || server.monitorInFlight) {
      return;
    }

    server.monitorInFlight = true;
    try {
      const usage = await collectProcessTreeResource(pid);
      if (server.process?.pid !== pid) {
        return;
      }

      server.resource = {
        checkedAt: Date.now(),
        memoryMb: usage.memoryMb,
        processCount: usage.processCount
      };

      if (usage.memoryMb <= policy.memoryLimitMb) {
        return;
      }

      const workspacePath = server.workspacePath ?? this.options.cwd;
      const blockedUntil = Date.now() + policy.cooldownMs;
      const reason = `${lspConfigs[language].label} stopped after using ${usage.memoryMb} MB across ${usage.processCount} process(es), above the ${policy.memoryLimitMb} MB Construct safety limit. Auto-restart is blocked until ${new Date(blockedUntil).toLocaleTimeString()}.`;
      this.resourceBlocks.set(this.resourceBlockKey(language, workspacePath), {
        blockedUntil,
        memoryLimitMb: policy.memoryLimitMb,
        reason,
        workspacePath
      });
      this.emitLog(language, "error", reason);
      this.stop(language);
    } catch (error) {
      this.emitLog(language, "warn", `Unable to inspect ${lspConfigs[language].label} memory usage: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      server.monitorInFlight = false;
    }
  }

  private terminateProcess(child: ChildProcess, language: LspLanguage): void {
    const pid = child.pid;
    const sendSignal = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && typeof pid === "number" && pid > 0) {
          process.kill(-pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        try {
          child.kill(signal);
        } catch (fallbackError) {
          if (signal === "SIGTERM") {
            console.error(`[LSP] Error killing ${language} process:`, fallbackError || error);
          }
        }
      }
    };

    sendSignal("SIGTERM");
    const killTimer = setTimeout(() => sendSignal("SIGKILL"), LSP_PROCESS_KILL_GRACE_MS);
    killTimer.unref?.();
    child.once("close", () => clearTimeout(killTimer));
  }
}

function createServerState(): LspServerState {
  return {
    buffer: "",
    monitorInFlight: false,
    monitorTimer: null,
    pendingRequests: new Map(),
    process: null,
    resource: null,
    startedAt: null,
    workspacePath: null
  };
}

function isExecutableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveRustAnalyzerMemoryLimitMb(): number {
  const configured = Number(process.env.CONSTRUCT_RUST_ANALYZER_MEMORY_MB);
  if (Number.isFinite(configured) && configured >= 256) {
    return Math.floor(configured);
  }

  const systemMemoryMb = Math.floor(totalmem() / 1024 / 1024);
  return clamp(
    Math.floor(systemMemoryMb * RUST_ANALYZER_MEMORY_FRACTION),
    RUST_ANALYZER_MEMORY_MIN_MB,
    RUST_ANALYZER_MEMORY_MAX_MB
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncateLspLogText(text: string): string {
  if (text.length <= LSP_STDERR_LOG_LIMIT_CHARS) {
    return text;
  }

  return `${text.slice(0, LSP_STDERR_LOG_LIMIT_CHARS)}... [${text.length - LSP_STDERR_LOG_LIMIT_CHARS} chars omitted]`;
}

async function collectProcessTreeResource(rootPid: number): Promise<ProcessResourceSnapshot> {
  if (process.platform === "win32") {
    return { memoryMb: 0, processCount: 1 };
  }

  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="], {
    maxBuffer: 4 * 1024 * 1024
  });
  const rssByPid = new Map<number, number>();
  const childrenByParent = new Map<number, number[]>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const rssKb = Number(match[3]);
    rssByPid.set(pid, rssKb);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  let rssKbTotal = 0;
  const stack = [rootPid];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || visited.has(pid)) {
      continue;
    }
    visited.add(pid);
    rssKbTotal += rssByPid.get(pid) ?? 0;
    stack.push(...(childrenByParent.get(pid) ?? []));
  }

  return {
    memoryMb: Math.round((rssKbTotal / 1024) * 10) / 10,
    processCount: visited.size
  };
}
