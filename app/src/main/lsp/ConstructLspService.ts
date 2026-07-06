import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";

import type { WebContents } from "electron";

import { isFlowProject, isTapeProject, type StoredProject } from "../projects/ConstructProjectTypes";
import type { DebugProcessSnapshot } from "../terminal/ConstructTerminalService";

export type LspLanguage = "typescript" | "python" | "rust" | "go" | "java" | "cpp" | "csharp" | "html" | "css" | "json";
export type LspStatus = "not-installed" | "running" | "stopped" | "installing";
export type LspStartResult = {
  languages: LspLanguage[];
  workspacePath: string;
};
export type LspStatusReport = Record<LspLanguage, {
  command: string;
  installCommand: string;
  installed: boolean;
  label: string;
  resolvedPath: string | null;
  status: LspStatus;
}>;

type LspServerState = {
  buffer: string;
  pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>;
  process: ChildProcess | null;
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

const lspLanguageOrder: LspLanguage[] = ["typescript", "python", "rust", "go", "java", "cpp", "csharp", "html", "css", "json"];

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
    typescript: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    python: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    rust: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    go: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    java: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    cpp: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    csharp: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    html: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    css: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
    json: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null }
  };
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
      const status: LspStatus = server.process
        ? "running"
        : this.installingLanguage === "all" || this.installingLanguage === language
          ? "installing"
          : installed
            ? "stopped"
            : "not-installed";

      report[language] = {
        command: lspConfigs[language].command,
        installCommand: lspConfigs[language].installCommand,
        installed,
        label: lspConfigs[language].label,
        resolvedPath,
        status
      };
    }

    return report;
  }

  startForProject(project: StoredProject): LspStartResult {
    const languages = this.languagesForProject(project);
    const startedLanguages: LspLanguage[] = [];

    if (languages.length === 0) {
      const projectLabel = isFlowProject(project) ? "Flow project" : "project";
      console.log(`[LSP] No supported language files found for ${projectLabel}`, { id: project.id });
    }

    for (const language of languages) {
      if (this.resolveServerCommand(project.workspacePath, language)) {
        if (this.startServer(project.workspacePath, language)) {
          startedLanguages.push(language);
        }
      } else {
        this.emitLog(language, "warn", `Skipping ${lspConfigs[language].label}; server is not installed.`);
      }
    }

    for (const language of lspLanguageOrder) {
      if (!languages.includes(language)) {
        this.stop(language);
      }
    }

    return {
      languages: startedLanguages,
      workspacePath: project.workspacePath
    };
  }

  stop(language?: LspLanguage): void {
    const languages = language ? [language] : lspLanguageOrder;

    for (const currentLanguage of languages) {
      const server = this.servers[currentLanguage];
      if (server.process) {
        console.log(`[LSP] Stopping ${lspConfigs[currentLanguage].command}`);
        this.emitLog(currentLanguage, "info", `Stopping ${lspConfigs[currentLanguage].command}`);
        try {
          server.process.kill();
        } catch (err) {
          console.error("[LSP] Error killing process:", err);
        }
        server.process = null;
      }
      server.buffer = "";
      server.workspacePath = null;
      for (const pending of server.pendingRequests.values()) {
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
        server.pendingRequests.set(payload.id, { resolve, reject });
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
        command: lspConfigs[language].command
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
        const language = this.languageForPath(file.path);
        if (language) {
          languages.add(language);
        }
      }
    }

    if (project.activeFilePath) {
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
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
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

  private startServer(workspacePath: string, language: LspLanguage): boolean {
    const server = this.servers[language];
    if (server.process && server.workspacePath === workspacePath) {
      return true;
    }

    this.stop(language);

    const config = lspConfigs[language];
    console.log(`[LSP] Starting ${config.command} in:`, workspacePath);
    this.emitLog(language, "info", `Starting ${config.command} in ${workspacePath}`);

    const executable = this.resolveServerCommand(workspacePath, language);

    if (!executable) {
      const message = `${config.label} server is not installed. Install with: ${config.installCommand}`;
      console.error("[LSP] " + message);
      this.emitLog(language, "error", message);
      return false;
    }

    console.log(`[LSP] Using ${language} server path: ${executable}`);
    this.emitLog(language, "info", `Using server ${executable}`);

    const command = config.scriptPath ? process.execPath : executable;
    const args = config.scriptPath ? [executable, ...config.args] : config.command.split(/\s+/).slice(1);
    server.process = spawn(command, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      }
    });
    server.workspacePath = workspacePath;

    server.process.stdout?.on("data", (chunk: Buffer) => {
      this.handleData(language, chunk);
    });

    server.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      console.warn(`[LSP ${language} stderr]:`, text);
      this.emitLog(language, "warn", text);
    });

    server.process.on("close", (code, signal) => {
      const detail = `Process exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`;
      console.log(`[LSP] ${language} ${detail}`);
      this.emitLog(language, code === 0 ? "info" : "warn", detail);
      server.process = null;
      server.buffer = "";
      server.workspacePath = null;
      for (const pending of server.pendingRequests.values()) {
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
      const result = this.clientRequestResult(message.method, message.params);
      if (server.process?.stdin) {
        const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
        server.process.stdin.write(`Content-Length: ${Buffer.byteLength(response, "utf8")}\r\n\r\n${response}`);
        this.emitLog(language, "info", `Responded to server request ${message.method} (${message.id})`);
      }
    } else if (message.id !== undefined) {
      const pending = server.pendingRequests.get(message.id);
      if (pending) {
        server.pendingRequests.delete(message.id);
        pending.resolve(message);
      }
    } else if (message.method !== undefined) {
      if (this.activeWebContents && !this.activeWebContents.isDestroyed()) {
        this.activeWebContents.send("construct:lsp:notification", { ...message, languageId: language });
      }
    }
  }

  private clientRequestResult(method: string, params: any): unknown {
    switch (method) {
      case "workspace/configuration":
        return Array.isArray(params?.items)
          ? params.items.map((item: { section?: string }) => item.section === "formattingOptions"
            ? { tabSize: 2, insertSpaces: true, trimTrailingWhitespace: true, insertFinalNewline: true }
            : null)
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
}

function isExecutableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
