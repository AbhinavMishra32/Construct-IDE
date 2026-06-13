import { parseConstructSource } from "../lib/parser";
import { applySafeCompilerFixes, collectCompilerFixes } from "./fixes";
import { lintConstructProgram } from "./lint";
import { parseConstructDocument } from "./parser";
import type { ConstructValidationResult } from "./types";

function extractLineFromError(message: string): number | undefined {
  const match = message.match(/(?:line|at line)\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractLineText(source: string, line: number): string | undefined {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const index = line - 1;
  if (index >= 0 && index < lines.length) {
    return lines[index];
  }
  return undefined;
}

export function validateConstructSource(source: string): ConstructValidationResult {
  const repaired = applySafeCompilerFixes(source);
  const document = parseConstructDocument(repaired.source);
  let diagnostics = [...document.diagnostics];
  let suggestions = collectCompilerFixes(document).filter((fix) => fix.safety !== "safe-auto");
  let runtimeValid = false;

  if (!diagnostics.some((item) => item.severity === "error")) {
    try {
      const program = parseConstructSource(repaired.source);
      runtimeValid = true;
      const lint = lintConstructProgram(program, document);
      diagnostics = [...diagnostics, ...lint.diagnostics];
      suggestions = [...suggestions, ...lint.suggestions];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const extractedLine = extractLineFromError(message);
      const line = extractedLine ?? 1;
      diagnostics.push({
        id: "strict-parser",
        severity: "error",
        code: `${document.spec}/E_STRICT_PARSE`,
        message,
        line,
        lineText: extractedLine ? extractLineText(repaired.source, extractedLine) : undefined,
        spec: document.spec,
        details: "The tolerant parser recovered a tree, but the runtime parser still rejected the tape."
      });
    }
  }

  return {
    originalSource: source,
    source: repaired.source,
    document,
    diagnostics,
    appliedFixes: repaired.fixes,
    suggestions,
    valid: runtimeValid && !document.diagnostics.some((item) => item.severity === "error")
  };
}
