import type { ConstructProgram } from "../types";
import { reviewConstructAuthoring } from "../lib/bridge";
import { createConstructProjectView } from "./project-view";
import type { ConstructDiagnostic } from "./types";

export type AuthoringSuggestion = {
  id: string;
  severity: "info" | "warning" | "error";
  category: "teaching-order" | "missing-concept" | "bookish-support" | "recall-too-hard" | "code-step-too-large" | "missing-reference" | "missing-doc-link" | "git-milestone" | "other";
  title: string;
  reason: string;
  affectedLines?: number[];
  suggestedFixSummary: string;
  requiresUserApproval: boolean;
};

export async function runSemanticAuthoringReview(program: ConstructProgram, source: string, diagnostics: ConstructDiagnostic[]): Promise<AuthoringSuggestion[]> {
  const projectView = createConstructProjectView(program, diagnostics);
  return reviewConstructAuthoring({
    spec: program.spec,
    projectView,
    diagnostics: diagnostics.map(({ code, severity, message, line, blockId }) => ({ code, severity, message, line, blockId })),
    snippets: collectFocusedSnippets(source, diagnostics)
  });
}

function collectFocusedSnippets(source: string, diagnostics: ConstructDiagnostic[]) {
  const lines = source.split(/\r?\n/);
  const selected = [...new Set(diagnostics.map((item) => item.line).filter((line) => line > 0))].slice(0, 8);
  return selected.map((line) => {
    const start = Math.max(0, line - 4);
    const end = Math.min(lines.length, line + 4);
    return { label: `Diagnostic near ${line}`, startLine: start + 1, text: lines.slice(start, end).join("\n") };
  });
}
