import type { ConstructProgram } from "../types";
import type { ConstructDiagnostic, ConstructFix } from "./types";

export type ConstructProjectView = {
  spec: string;
  title: string;
  concepts: Array<{ id: string; title: string; tags?: string[] }>;
  references: Array<{ id: string; title: string }>;
  steps: Array<{
    id: string;
    title: string;
    blocks: Array<{ id?: string; kind: string; path?: string; teaches?: string[]; uses?: string[]; references?: string[]; approxLines?: number }>;
  }>;
  recalls: Array<{ id: string; stepId: string; uses?: string[]; references?: string[]; hasSupport: boolean; hasVerify: boolean }>;
  largeGhostEdits: Array<{ id: string; path: string; lineCount: number }>;
  unsupportedBlocks: Array<{ line: number; block: string; parent: string }>;
};

export function createConstructProjectView(program: ConstructProgram, diagnostics: ConstructDiagnostic[] = []): ConstructProjectView {
  return {
    spec: program.spec,
    title: program.title,
    concepts: program.concepts.map(({ id, title, tags }) => ({ id, title, tags })),
    references: program.references.map(({ id, title }) => ({ id, title })),
    steps: program.steps.map((step) => ({
      id: step.id,
      title: step.title,
      blocks: step.blocks.map((block) => ({
        id: block.id,
        kind: block.kind,
        path: block.kind === "edit" || block.kind === "recall" ? block.path : undefined,
        teaches: block.kind === "explain" ? block.concepts : undefined,
        uses: block.kind === "recall" ? block.concepts : block.kind === "interact" ? block.uses : undefined,
        references: block.kind === "recall" ? block.references : undefined,
        approxLines: block.kind === "edit" ? block.content.split("\n").length : undefined
      }))
    })),
    recalls: program.steps.flatMap((step) => step.blocks.filter((block) => block.kind === "recall").map((block) => ({
      id: block.id,
      stepId: step.id,
      uses: block.concepts,
      references: block.references,
      hasSupport: Boolean(block.support.trim() || block.supportSections.length > 0),
      hasVerify: Boolean(block.verify)
    }))),
    largeGhostEdits: program.steps.flatMap((step) => step.blocks.flatMap((block) => {
      if (block.kind !== "edit") return [];
      const lineCount = block.content.split("\n").length;
      return lineCount > 120 ? [{ id: block.id, path: block.path, lineCount }] : [];
    })),
    unsupportedBlocks: diagnostics.filter((item) => item.childKind && item.code.includes("E_")).map((item) => ({ line: item.line, block: item.childKind!, parent: item.parentKind ?? "root" }))
  };
}

export type { ConstructDiagnostic, ConstructFix };
