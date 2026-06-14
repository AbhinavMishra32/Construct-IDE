export type LspLanguageId = "typescript" | "python";
export type LspServerStatus = "not-installed" | "running" | "stopped" | "installing";

export type LspStatusReport = Record<LspLanguageId, {
  command: string;
  installCommand: string;
  installed: boolean;
  label: string;
  resolvedPath: string | null;
  status: LspServerStatus;
}>;

export const lspLanguageOrder: LspLanguageId[] = ["typescript", "python"];

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
    }
  };
}

export function aggregateLspStatus(report: LspStatusReport): LspServerStatus {
  const statuses = lspLanguageOrder.map((language) => report[language].status);
  if (statuses.includes("installing")) return "installing";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("stopped")) return "stopped";
  return "not-installed";
}
