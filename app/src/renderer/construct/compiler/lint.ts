import type { ConstructProgram, RecallBlock } from "../types";
import type { ConstructDiagnostic, ConstructDocument, ConstructFix, ConstructNode } from "./types";

export function lintConstructProgram(program: ConstructProgram, document: ConstructDocument): { diagnostics: ConstructDiagnostic[]; suggestions: ConstructFix[] } {
  const diagnostics: ConstructDiagnostic[] = [];
  const suggestions: ConstructFix[] = [];
  const conceptIds = new Set(program.concepts.map((concept) => concept.id));
  const referenceIds = new Set(program.references.map((reference) => reference.id));
  const completionIds = new Set<string>();
  const proposedConcepts = new Set<string>();

  for (const concept of program.concepts) {
    if (!concept.summary.trim()) diagnostics.push(lintDiagnostic(program.spec, "W_CONCEPT_SUMMARY", `Concept "${concept.title}" has no summary.`, concept.id));
    if (concept.kind.includes("library") && concept.docs.length === 0) diagnostics.push(lintDiagnostic(program.spec, "I_MISSING_DOCS", `External concept "${concept.title}" has no official docs link.`, concept.id, "info"));
  }

  for (const step of program.steps) {
    for (const block of step.blocks) {
      completionIds.add(block.id);
      if (block.kind === "edit") {
        const lines = block.content.split("\n").length;
        if (lines > 120) diagnostics.push(lintDiagnostic(program.spec, "W_GHOST_TOO_LARGE", `Ghost edit "${block.id}" is ${lines} lines. Split it into smaller guided edits.`, block.id));
        if (/\.(md|mdx|txt|rst)$/i.test(block.path)) diagnostics.push(lintDiagnostic(program.spec, "W_DOCS_GHOST_TYPED", `Documentation file "${block.path}" is ghost-typed. Prefer an initial ::file.`, block.id));
      }
      if (block.kind !== "recall") continue;
      const recallNode = findNodeById(document.root, "recall", block.id);
      if (!block.support.trim() && block.supportSections.length === 0) {
        diagnostics.push(lintDiagnostic(program.spec, "W_RECALL_NO_SUPPORT", `Recall "${block.id}" has no support block.`, block.id));
        if (recallNode) suggestions.push(addSupportFix(block, recallNode));
      }
      block.concepts.forEach((id) => {
        if (!conceptIds.has(id)) {
          diagnostics.push(lintDiagnostic(program.spec, "W_UNKNOWN_CONCEPT", `Recall "${block.id}" uses unknown concept "${id}".`, block.id));
          if (!proposedConcepts.has(id)) {
            proposedConcepts.add(id);
            suggestions.push(addConceptFix(document, id, block.id));
          }
        }
      });
      block.references.forEach((id) => {
        if (!referenceIds.has(id)) diagnostics.push(lintDiagnostic(program.spec, "W_UNKNOWN_REFERENCE", `Recall "${block.id}" references missing card "${id}".`, block.id));
      });
      if (block.verify) {
        completionIds.add(block.verify.id);
        const missing = [!block.verify.goal && "goal", block.verify.evidence.files.length === 0 && "evidence", !block.verify.rubric && "rubric", (!block.verify.messages.success || !block.verify.messages.failure) && "messages"].filter(Boolean);
        if (missing.length > 0) diagnostics.push(lintDiagnostic(program.spec, "W_INCOMPLETE_VERIFY", `Verifier "${block.verify.id}" is missing ${missing.join(", ")}.`, block.verify.id));
      }
    }
  }

  for (const git of program.gitMilestones) {
    if (!completionIds.has(git.after)) diagnostics.push(lintDiagnostic(program.spec, "W_UNKNOWN_GIT_TARGET", `Git milestone "${git.id}" references unknown target "${git.after}".`, git.id));
  }

  return { diagnostics, suggestions };
}

function addSupportFix(recall: RecallBlock, node: ConstructNode): ConstructFix {
  const text = `\n::support\n\n::intent\nDescribe what the learner is building and why.\n::end\n\n::mental-model\nExplain the concept that makes the task understandable.\n::end\n\n::common-mistake\nName the most likely incorrect approach without giving away the answer.\n::end\n\n::end\n`;
  return {
    id: `semantic:add-support:${recall.id}`,
    title: `Add support scaffold to ${recall.id}`,
    description: "Insert a structured tape-0.3 support block for the author to refine.",
    safety: "semantic",
    kind: "add-missing-support",
    line: node.open.line,
    before: "Recall has no ::support block",
    after: "Intent, mental model, and common mistake sections",
    patch: { edits: [{ start: node.open.end, end: node.open.end, text }] }
  };
}

function addConceptFix(document: ConstructDocument, conceptId: string, recallId: string): ConstructFix {
  const title = conceptId.split(/[._-]+/).map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word).join(" ");
  const text = `\n::concept id="${conceptId}" title="${title}" kind="concept"\n\n::summary\nExplain ${title} in one clear paragraph.\n::end\n\n::why\nExplain why this concept matters before recall task "${recallId}".\n::end\n\n::end\n`;
  const insertion = resourceInsertionOffset(document);
  return {
    id: `semantic:add-concept:${conceptId}`,
    title: `Add concept card for ${conceptId}`,
    description: `The recall uses "${conceptId}" before a top-level concept card introduces it.`,
    safety: "semantic",
    kind: "add-concept-card",
    line: 1,
    before: `uses="${conceptId}" with no matching ::concept`,
    after: `Top-level ::concept id="${conceptId}" scaffold`,
    patch: { edits: [{ start: insertion, end: insertion, text }] }
  };
}

function resourceInsertionOffset(document: ConstructDocument): number {
  const resources = document.root.children.filter((node) => node.close && ["files", "concept", "reference"].includes(node.kind));
  if (resources.length > 0) return Math.max(...resources.map((node) => node.range.end));
  const metadata = document.tokens.filter((token) => token.kind === "metadata");
  return metadata.length > 0 ? metadata[metadata.length - 1].end : 0;
}

function findNodeById(root: ConstructNode, kind: string, id: string): ConstructNode | null {
  for (const node of root.children) {
    if (node.kind === kind && node.attributes.id === id) return node;
    const nested = findNodeById(node, kind, id);
    if (nested) return nested;
  }
  return null;
}

function lintDiagnostic(spec: string, code: string, message: string, blockId: string, severity: "error" | "warning" | "info" = "warning"): ConstructDiagnostic {
  return { id: `lint:${code}:${blockId}`, severity, code: `${spec}/${code}`, message, line: 1, blockId, spec };
}
