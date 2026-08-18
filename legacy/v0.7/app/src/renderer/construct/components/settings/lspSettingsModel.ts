export type LspLanguageId = "typescript" | "python" | "rust" | "go" | "java" | "cpp" | "csharp" | "html" | "css" | "json";
export type LspServerStatus = "not-installed" | "running" | "stopped" | "installing" | "blocked";

export type LspStatusReport = Record<LspLanguageId, {
  blockedUntil?: string;
  command: string;
  detail?: string;
  installCommand: string;
  installed: boolean;
  label: string;
  memoryLimitMb?: number;
  memoryMb?: number;
  resolvedPath: string | null;
  status: LspServerStatus;
}>;

export const lspLanguageOrder: LspLanguageId[] = ["typescript", "python", "rust", "go", "java", "cpp", "csharp", "html", "css", "json"];

export function createEmptyLspStatusReport(): LspStatusReport {
  return {
    typescript: {
      command: "typescript-language-server --stdio",
      installCommand: "npm install --save-dev typescript-language-server typescript",
      installed: false,
      label: "TypeScript / JavaScript",
      resolvedPath: null,
      status: "not-installed"
    },
    python: {
      command: "pyright-langserver --stdio",
      installCommand: "npm install --save-dev pyright",
      installed: false,
      label: "Python",
      resolvedPath: null,
      status: "not-installed"
    },
    rust: {
      command: "rust-analyzer",
      installCommand: "rustup component add rust-analyzer",
      installed: false,
      label: "Rust",
      resolvedPath: null,
      status: "not-installed"
    },
    go: {
      command: "gopls",
      installCommand: "go install golang.org/x/tools/gopls@latest",
      installed: false,
      label: "Go",
      resolvedPath: null,
      status: "not-installed"
    },
    java: {
      command: "jdtls",
      installCommand: "brew install jdtls",
      installed: false,
      label: "Java",
      resolvedPath: null,
      status: "not-installed"
    },
    cpp: {
      command: "clangd",
      installCommand: "brew install llvm",
      installed: false,
      label: "C / C++",
      resolvedPath: null,
      status: "not-installed"
    },
    csharp: {
      command: "csharp-ls --stdio",
      installCommand: "dotnet tool install --global csharp-ls",
      installed: false,
      label: "C#",
      resolvedPath: null,
      status: "not-installed"
    },
    html: {
      command: "vscode-html-language-server --stdio",
      installCommand: "npm install --save-dev vscode-langservers-extracted",
      installed: false,
      label: "HTML",
      resolvedPath: null,
      status: "not-installed"
    },
    css: {
      command: "vscode-css-language-server --stdio",
      installCommand: "npm install --save-dev vscode-langservers-extracted",
      installed: false,
      label: "CSS",
      resolvedPath: null,
      status: "not-installed"
    },
    json: {
      command: "vscode-json-language-server --stdio",
      installCommand: "npm install --save-dev vscode-langservers-extracted",
      installed: false,
      label: "JSON",
      resolvedPath: null,
      status: "not-installed"
    }
  };
}

export function aggregateLspStatus(report: LspStatusReport): LspServerStatus {
  const statuses = lspLanguageOrder.map((language) => report[language].status);
  if (statuses.includes("installing")) return "installing";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("stopped")) return "stopped";
  return "not-installed";
}
