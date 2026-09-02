import { parseConstructSource } from "../lib/parser";
import { applySafeCompilerFixes, collectCompilerFixes } from "./fixes";
import { lintConstructProgram } from "./lint";
import { parseConstructDocument } from "./parser";
import type { ConstructValidationResult } from "./types";

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
      diagnostics.push({
        id: "strict-parser",
        severity: "error",
        code: `${document.spec}/E_STRICT_PARSE`,
        message: error instanceof Error ? error.message : String(error),
        line: 1,
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
