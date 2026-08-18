import type { ConstructBlock, ConstructProgram, GuideBlock, RecallBlock } from "../types";
import { collectInlineRefs } from "../lib/inlineRefs";
import type { ConstructDiagnostic, ConstructDocument, ConstructFix, ConstructNode } from "./types";
import { supportsConstructInteract } from "../../../shared/tapeFeatures";

export function lintConstructProgram(program: ConstructProgram, document: ConstructDocument): { diagnostics: ConstructDiagnostic[]; suggestions: ConstructFix[] } {
  const diagnostics: ConstructDiagnostic[] = [];
  const suggestions: ConstructFix[] = [];
  const conceptIds = new Set(program.concepts.map((concept) => concept.id));
  const referenceIds = new Set(program.references.map((reference) => reference.id));
  const completionIds = new Set<string>();
  const proposedConcepts = new Set<string>();
  const introducedConceptIds = new Set<string>();
  const knownFiles = new Set(program.files.map((file) => file.path));
  const knownAnchorsByPath = new Map<string, Set<string>>();

  for (const target of program.targets) {
    knownFiles.add(target.path);
    const anchors = knownAnchorsByPath.get(target.path) ?? new Set<string>();
    anchors.add(target.id);
    if (target.anchor) anchors.add(target.anchor);
    knownAnchorsByPath.set(target.path, anchors);
  }
  for (const step of program.steps) {
    for (const block of step.blocks) {
      if (block.kind !== "edit") continue;
      knownFiles.add(block.path);
      if (!block.anchor) continue;
      const anchors = knownAnchorsByPath.get(block.path) ?? new Set<string>();
      anchors.add(block.anchor);
      knownAnchorsByPath.set(block.path, anchors);
    }
  }

  if (program.audience === "zero-prerequisite" && !hasOpeningOrientation(program)) {
    diagnostics.push(lintDiagnostic(
      program.spec,
      "W_ORIENTATION_MISSING",
      "Zero-prerequisite tapes should begin with a system picture, trace, or mental model.",
      program.id
    ));
  }

  for (const concept of program.concepts) {
    if (!concept.summary.trim()) diagnostics.push(lintDiagnostic(program.spec, "W_CONCEPT_SUMMARY", `Concept "${concept.title}" has no summary.`, concept.id));
    if (concept.kind.includes("library") && concept.docs.length === 0) diagnostics.push(lintDiagnostic(program.spec, "I_MISSING_DOCS", `External concept "${concept.title}" has no official docs link.`, concept.id, "info"));
  }

  for (const step of program.steps) {
    for (const conceptId of step.requires) {
      if (!conceptIds.has(conceptId)) {
        diagnostics.push(lintDiagnostic(program.spec, "W_STEP_REQUIRES_MISSING", `Step "${step.title}" requires concept "${conceptId}" but no ::concept card exists.`, step.id));
      } else if (!introducedConceptIds.has(conceptId)) {
        diagnostics.push(lintDiagnostic(program.spec, "W_STEP_REQUIRES_ORDER", `Step "${step.title}" requires concept "${conceptId}" before an earlier step teaches it.`, step.id));
      }
    }
    for (const conceptId of step.teaches) {
      if (!conceptIds.has(conceptId)) diagnostics.push(lintDiagnostic(program.spec, "W_STEP_TEACHES_MISSING", `Step "${step.title}" teaches concept "${conceptId}" but no ::concept card exists.`, step.id));
    }
    if (/\b(Reveal why|Picture before plumbing|Problem before tool|Mental model before code|Teach the|Introduce concept)\b/i.test(step.title)) {
      diagnostics.push(lintDiagnostic(program.spec, "W_GUIDE_TITLE_PEDAGOGY_LEAK", `Step title "${step.title}" exposes an authoring rule. Use a natural engineering milestone title.`, step.id));
    }

    for (const block of step.blocks) {
      completionIds.add(block.id);
      if (block.kind === "edit") {
        const lines = block.content.split("\n").length;
        if (lines > 120) diagnostics.push(lintDiagnostic(program.spec, "W_GHOST_TOO_LARGE", `Code step "${block.id}" is ${lines} lines. Split it into smaller implementation steps.`, block.id));
        if (/\.(md|mdx|txt|rst)$/i.test(block.path)) diagnostics.push(lintDiagnostic(program.spec, "W_DOCS_GHOST_TYPED", `Documentation file "${block.path}" uses guided code entry. Prefer an initial ::file.`, block.id));
      }
      lintBlockReferences(program, block, knownFiles, knownAnchorsByPath, diagnostics);
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
        const hasEvidence =
          block.verify.evidence.files.length > 0 ||
          Boolean(block.verify.evidence.answer || block.verify.evidence.interaction || block.verify.evidence.terminalCommand || block.verify.evidence.terminalOutput);
        const needsMessages = !supportsConstructInteract(program.spec) && (!block.verify.messages?.success || !block.verify.messages?.failure);
        const missing = [!block.verify.goal && "goal", !hasEvidence && "evidence", !block.verify.rubric && "rubric", needsMessages && "messages"].filter(Boolean);
        if (missing.length > 0) diagnostics.push(lintDiagnostic(program.spec, "W_INCOMPLETE_VERIFY", `Verifier "${block.verify.id}" is missing ${missing.join(", ")}.`, block.verify.id));
      }
    }
    step.teaches.forEach((conceptId) => introducedConceptIds.add(conceptId));
  }

  for (const guide of program.guides) lintTextReferences(program, guideText(guide), guide.id, knownFiles, knownAnchorsByPath, diagnostics);
  for (const concept of program.concepts) {
    lintTextReferences(program, [concept.summary, concept.why, concept.commonMistake ?? "", concept.example, ...concept.guides.flatMap(guideText)], concept.id, knownFiles, knownAnchorsByPath, diagnostics);
  }
  for (const reference of program.references) lintTextReferences(program, [reference.body], reference.id, knownFiles, knownAnchorsByPath, diagnostics);

  for (const git of program.gitMilestones) {
    if (!completionIds.has(git.after)) diagnostics.push(lintDiagnostic(program.spec, "W_UNKNOWN_GIT_TARGET", `Git milestone "${git.id}" references unknown target "${git.after}".`, git.id));
  }

  return { diagnostics, suggestions };
}

function hasOpeningOrientation(program: ConstructProgram): boolean {
  return program.guides.some((guide) => guide.guideKind === "guide.orientation")
    || program.steps[0]?.blocks.some((block) => block.kind === "guide" && ["guide.orientation", "guide.trace", "guide.mental-model"].includes(block.guideKind)) === true;
}

function lintBlockReferences(
  program: ConstructProgram,
  block: ConstructBlock,
  knownFiles: Set<string>,
  knownAnchorsByPath: Map<string, Set<string>>,
  diagnostics: ConstructDiagnostic[]
) {
  let texts: string[] = [];
  if (block.kind === "guide") texts = guideText(block);
  else if (block.kind === "edit") texts = [...block.notes.map((note) => note.content), ...block.guides.flatMap(guideText)];
  else if (block.kind === "recall") texts = [block.task, block.support, ...block.supportSections.map((section) => section.content)];
  else if (block.kind === "interact") texts = [block.prompt];
  else if (block.kind !== "run") texts = [block.content];
  lintTextReferences(program, texts, block.id, knownFiles, knownAnchorsByPath, diagnostics);
}

function guideText(guide: GuideBlock): string[] {
  return [guide.content, ...guide.sections.map((section) => section.content)];
}

function lintTextReferences(
  program: ConstructProgram,
  texts: string[],
  blockId: string,
  knownFiles: Set<string>,
  knownAnchorsByPath: Map<string, Set<string>>,
  diagnostics: ConstructDiagnostic[]
) {
  for (const reference of texts.flatMap(collectInlineRefs)) {
    if (reference.kind !== "file") continue;
    if (!knownFiles.has(reference.path)) {
      diagnostics.push(lintDiagnostic(program.spec, "W_FILE_REF_MISSING", `${reference.raw} points to a file that is not created by ::files or ::edit.`, blockId));
      continue;
    }
    if (reference.anchor && !knownAnchorsByPath.get(reference.path)?.has(reference.anchor)) {
      diagnostics.push(lintDiagnostic(program.spec, "W_FILE_REF_ANCHOR_MISSING", `${reference.raw} points to an unknown anchor in "${reference.path}".`, blockId));
    }
  }
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
