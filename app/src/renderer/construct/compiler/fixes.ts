import { getConstructGrammar } from "./grammar";
import { parseConstructDocument } from "./parser";
import { applyConstructPatch } from "./patches";
import type { AppliedConstructFix, ConstructDiagnostic, ConstructDocument, ConstructFix, ConstructNode } from "./types";

const blockAliases: Record<string, string> = {
  common_mistake: "common-mistake",
  mental_model: "mental-model",
  orientation: "guide.orientation",
  problem: "guide.problem",
  flow: "guide.flow",
  promise: "guide.promise",
  misconception: "guide.misconception",
  trace: "guide.trace",
  trusted: "guide.trusted",
  untrusted: "guide.untrusted",
  preflight: "guide.preflight",
  knows: "guide.knows",
  "can-explain": "guide.can-explain",
  "why-now": "guide.why-now",
  analogy: "guide.analogy"
};

const blocksRequiringId = new Set([
  "step",
  "edit",
  "recall",
  "run",
  "expect",
  "checkpoint",
  "reference",
  "concept",
  "git",
  "target",
  "verify"
]);

export function collectCompilerFixes(document: ConstructDocument): ConstructFix[] {
  const fixes: ConstructFix[] = [];
  fixes.push(...metadataFixes(document));
  fixes.push(...aliasFixes(document));
  fixes.push(...attributeFixes(document));
  fixes.push(...missingIdFixes(document));

  for (const diagnostic of document.diagnostics) {
    const node = diagnostic.childKind ? findNode(document.root, diagnostic.line, diagnostic.childKind) : null;
    if (diagnostic.code.endsWith("E_UNEXPECTED_CHILD") && node) {
      if ((node.kind === "reference" || node.kind === "concept") && node.parent?.kind !== "root" && node.close) {
        fixes.push(hoistResourceFix(document, diagnostic, node));
      } else if (node.kind === "note" && node.parent?.kind === "step") {
        const adjacentEdit = node.parent.children[node.parent.children.indexOf(node) + 1];
        if (node.open.attributes?.when && adjacentEdit?.kind === "edit" && node.close) {
          fixes.push(moveNoteIntoEditFix(document, diagnostic, node, adjacentEdit));
        } else {
          fixes.push(renameNodeFix(document, diagnostic, node, "explain", "Converted misplaced ::note to ::explain."));
        }
      } else if (node.kind === "step" && node.parent?.kind !== "root") {
        fixes.push(closeBeforeTopLevelFix(document, diagnostic, node));
      }
    }
  }

  const unclosed = document.diagnostics.filter((item) => item.code.endsWith("E_UNCLOSED_BLOCK"));
  if (unclosed.length === 1) {
    const diagnostic = unclosed[0];
    fixes.push({
      id: `insert-end:${diagnostic.line}`,
      diagnosticId: diagnostic.id,
      title: `Close ::${diagnostic.childKind}`,
      description: `Inserted the single obvious missing ::end for ${describeDiagnosticBlock(diagnostic)}.`,
      safety: "safe-auto",
      kind: "insert-end",
      line: document.root.range.endLine,
      before: "(end of file)",
      after: "::end",
      patch: { edits: [{ start: document.source.length, end: document.source.length, text: `${document.source.endsWith("\n") ? "" : "\n"}::end\n` }] }
    });
  }

  return dedupeFixes(fixes);
}

function missingIdFixes(document: ConstructDocument): ConstructFix[] {
  const fixes: ConstructFix[] = [];

  visitNodes(document.root, (node) => {
    if (!blocksRequiringId.has(node.kind) || node.attributes.id) return;
    const siblings = node.parent?.children.filter((item) => item.kind === node.kind) ?? [node];
    const ordinal = Math.max(1, siblings.indexOf(node) + 1);
    const parentId = node.parent?.attributes.id || node.parent?.kind || "project";
    const id = slugify(`${parentId}-${node.kind}-${ordinal}`);
    const nextLine = `${node.open.text.trimEnd()} id="${id}"`;

    fixes.push({
      id: `add-id:${node.kind}:${node.open.line}`,
      title: `Add id to ::${node.kind}`,
      description: `Generated the stable id "${id}" required by the tape runtime.`,
      safety: "safe-auto",
      kind: "custom",
      line: node.open.line,
      before: node.open.text.trim(),
      after: nextLine.trim(),
      patch: {
        edits: [{
          start: node.open.start,
          end: node.open.end,
          text: `${nextLine}${node.open.end > node.open.start + node.open.text.length ? "\n" : ""}`
        }]
      }
    });
  });

  return fixes;
}

export function applySafeCompilerFixes(source: string, maxPasses = 20): { source: string; fixes: AppliedConstructFix[] } {
  let current = source;
  const applied: AppliedConstructFix[] = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const document = parseConstructDocument(current);
    const fix = collectCompilerFixes(document).find((item) => item.safety === "safe-auto");
    if (!fix) break;
    const next = applyConstructPatch(current, fix.patch);
    if (next === current) break;
    current = next;
    applied.push({ ...fix, appliedAt: new Date().toISOString() });
  }

  return { source: current, fixes: applied };
}

function metadataFixes(document: ConstructDocument): ConstructFix[] {
  const token = document.tokens.find((item) => item.kind === "metadata" && item.text.trim().startsWith("@construct"));
  if (!token || !/\bversion="0\.[123]"/.test(token.text)) return [];
  const replacement = token.text.replace(/\bversion="(0\.[123])"/, 'spec="tape-$1"');
  return [{
    id: `normalize-spec:${token.line}`,
    title: "Normalize tape metadata",
    description: "Replaced legacy @construct version metadata with the canonical spec attribute.",
    safety: "safe-auto",
    kind: "rename-block",
    line: token.line,
    before: token.text.trim(),
    after: replacement.trim(),
    patch: { edits: [{ start: token.start, end: token.end, text: `${replacement}${token.end > token.start + token.text.length ? "\n" : ""}` }] }
  }];
}

function aliasFixes(document: ConstructDocument): ConstructFix[] {
  return document.tokens.flatMap((token) => {
    if (token.kind !== "block" || !token.name || !blockAliases[token.name]) return [];
    const replacement = blockAliases[token.name];
    if (replacement.startsWith("guide.") && !guideAliasFitsParent(token.name, parentKindAtLine(document, token.line))) return [];
    const line = token.text.replace(`::${token.name}`, `::${replacement}`);
    return [{
      id: `alias:${token.name}:${token.line}`,
      title: `Normalize ::${token.name}`,
      description: `Renamed the known alias to ::${replacement}.`,
      safety: "safe-auto" as const,
      kind: "rename-block" as const,
      line: token.line,
      before: token.text.trim(),
      after: line.trim(),
      patch: { edits: [{ start: token.start, end: token.end, text: `${line}${token.end > token.start + token.text.length ? "\n" : ""}` }] }
    }];
  });
}

function parentKindAtLine(document: ConstructDocument, line: number): string | null {
  const node = findNode(document.root, line, document.tokens.find((token) => token.line === line)?.name ?? "");
  return node?.parent?.kind ?? null;
}

function guideAliasFitsParent(alias: string, parent: string | null): boolean {
  if (!parent) return false;
  if (alias === "orientation") return parent === "root";
  if (["problem", "flow", "promise"].includes(alias)) return parent === "orientation" || parent === "guide.orientation" || parent === "trace" || parent === "guide.trace";
  if (["trusted", "untrusted"].includes(alias)) return parent === "trace" || parent === "guide.trace";
  if (["knows", "can-explain"].includes(alias)) return parent === "preflight" || parent === "guide.preflight";
  if (alias === "preflight" || alias === "why-now" || alias === "analogy" || alias === "misconception") return ["step", "edit", "concept"].includes(parent);
  return false;
}

function attributeFixes(document: ConstructDocument): ConstructFix[] {
  return document.tokens.flatMap((token) => {
    if (token.kind !== "block" || token.name !== "edit" || token.attributes?.typing !== "guided") return [];
    const line = token.text.replace('typing="guided"', 'typing="ghost"');
    return [{
      id: `typing-ghost:${token.line}`,
      title: "Normalize guided typing mode",
      description: "Renamed the legacy guided typing value to the current ghost typing mode.",
      safety: "safe-auto" as const,
      kind: "rename-block" as const,
      line: token.line,
      before: token.text.trim(),
      after: line.trim(),
      patch: { edits: [{ start: token.start, end: token.end, text: `${line}${token.end > token.start + token.text.length ? "\n" : ""}` }] }
    }];
  });
}

function hoistResourceFix(document: ConstructDocument, diagnostic: ConstructDiagnostic, node: ConstructNode): ConstructFix {
  const text = document.source.slice(node.range.start, node.range.end).trimEnd();
  const insertion = resourceInsertionOffset(document);
  return {
    id: `hoist:${node.kind}:${node.open.line}`,
    diagnosticId: diagnostic.id,
    title: `Move ${node.kind} to project resources`,
    description: `Moved ${describeNode(node)} out of ::${node.parent?.kind} and into the top-level resource section.`,
    safety: "safe-auto",
    kind: "hoist-resource",
    line: node.open.line,
    before: `Inside ::${node.parent?.kind}`,
    after: "Top-level resource",
    patch: {
      edits: [
        { start: node.range.start, end: node.range.end, text: "" },
        { start: insertion, end: insertion, text: `${insertion > 0 ? "\n" : ""}${text}\n` }
      ]
    }
  };
}

function renameNodeFix(document: ConstructDocument, diagnostic: ConstructDiagnostic, node: ConstructNode, replacement: string, description: string): ConstructFix {
  const line = node.open.text.replace(`::${node.kind}`, `::${replacement}`);
  return {
    id: `convert:${node.kind}:${node.open.line}`,
    diagnosticId: diagnostic.id,
    title: `Convert ::${node.kind} to ::${replacement}`,
    description,
    safety: "safe-auto",
    kind: "convert-block",
    line: node.open.line,
    before: node.open.text.trim(),
    after: line.trim(),
    patch: { edits: [{ start: node.open.start, end: node.open.end, text: `${line}${node.open.end > node.open.start + node.open.text.length ? "\n" : ""}` }] }
  };
}

function closeBeforeTopLevelFix(document: ConstructDocument, diagnostic: ConstructDiagnostic, node: ConstructNode): ConstructFix {
  let parent = node.parent;
  let count = 0;
  while (parent && parent.kind !== "root") {
    count += 1;
    parent = parent.parent;
  }
  const inserted = Array.from({ length: count }, () => "::end").join("\n");
  return {
    id: `close-before-step:${node.open.line}`,
    diagnosticId: diagnostic.id,
    title: "Close blocks before the next step",
    description: `Inserted ${count} missing ::end marker${count === 1 ? "" : "s"} before step "${node.attributes.id ?? node.attributes.title ?? "next"}".`,
    safety: "safe-auto",
    kind: "insert-end",
    line: node.open.line,
    before: node.open.text.trim(),
    after: `${inserted}\n${node.open.text.trim()}`,
    patch: { edits: [{ start: node.open.start, end: node.open.start, text: `${inserted}\n` }] }
  };
}

function moveNoteIntoEditFix(document: ConstructDocument, diagnostic: ConstructDiagnostic, note: ConstructNode, edit: ConstructNode): ConstructFix {
  const text = document.source.slice(note.range.start, note.range.end).trimEnd();
  return {
    id: `move-note:${note.open.line}:${edit.open.line}`,
    diagnosticId: diagnostic.id,
    title: "Move note into the following edit",
    description: `Move the ${note.attributes.when} note into edit "${edit.attributes.id ?? edit.attributes.path ?? "next"}" instead of converting it to an explanation.`,
    safety: "suggested",
    kind: "move-block",
    line: note.open.line,
    before: "Direct child of ::step",
    after: `Inside ::edit ${edit.attributes.id ?? ""}`.trim(),
    patch: {
      edits: [
        { start: note.range.start, end: note.range.end, text: "" },
        { start: edit.open.end, end: edit.open.end, text: `${text}\n` }
      ]
    }
  };
}

function resourceInsertionOffset(document: ConstructDocument): number {
  const grammar = getConstructGrammar(document.spec);
  const candidates = document.root.children.filter((node) => node.close && (node.kind === "files" || grammar.topLevelResources.includes(node.kind)));
  return candidates.length > 0 ? Math.max(...candidates.map((node) => node.range.end)) : metadataEnd(document);
}

function metadataEnd(document: ConstructDocument): number {
  const metadata = document.tokens.filter((token) => token.kind === "metadata");
  return metadata.length > 0 ? metadata[metadata.length - 1].end : 0;
}

function findNode(root: ConstructNode, line: number, kind: string): ConstructNode | null {
  for (const child of root.children) {
    if (child.open.line === line && child.kind === kind) return child;
    const nested = findNode(child, line, kind);
    if (nested) return nested;
  }
  return null;
}

function describeNode(node: ConstructNode): string {
  const name = node.attributes.id || node.attributes.title;
  return name ? `${node.kind} "${name}"` : `::${node.kind}`;
}

function describeDiagnosticBlock(diagnostic: ConstructDiagnostic): string {
  return diagnostic.blockId ? `::${diagnostic.childKind} "${diagnostic.blockId}"` : `::${diagnostic.childKind}`;
}

function dedupeFixes(fixes: ConstructFix[]): ConstructFix[] {
  return [...new Map(fixes.map((fix) => [fix.id, fix])).values()];
}

function visitNodes(node: ConstructNode, visitor: (node: ConstructNode) => void): void {
  for (const child of node.children) {
    visitor(child);
    visitNodes(child, visitor);
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "construct-block";
}
