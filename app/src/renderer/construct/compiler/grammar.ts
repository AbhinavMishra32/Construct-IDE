import type { ConstructSpec } from "./types";

export type ConstructGrammar = {
  spec: ConstructSpec;
  allowedChildren: Record<string, readonly string[]>;
  knownBlocks: ReadonlySet<string>;
  topLevelResources: readonly string[];
};

const tape01 = {
  root: ["files", "target", "step"],
  files: ["file"],
  step: ["explain", "edit", "run", "expect", "checkpoint"],
  edit: ["note"]
} as const;

const tape02 = {
  ...tape01,
  root: ["files", "reference", "target", "step"],
  step: ["explain", "edit", "recall", "run", "expect", "checkpoint"],
  recall: ["task", "support", "verify"],
  verify: ["goal", "evidence", "rubric", "messages"],
  reference: ["body", "links"],
  links: ["link"]
} as const;

const tape03 = {
  ...tape02,
  root: ["files", "concept", "reference", "target", "guide.orientation", "guide.trace", "step", "git"],
  step: ["guide.preflight", "guide.trace", "guide.why-now", "guide.mental-model", "guide.misconception", "guide.analogy", "explain", "edit", "recall", "run", "expect", "checkpoint"],
  edit: ["note", "guide.why-now"],
  concept: ["summary", "why", "example", "docs", "common-mistake", "guide.misconception", "guide.analogy"],
  support: ["intent", "concepts", "api", "mental-model", "common-mistake"],
  git: ["suggest", "include"],
  "guide.orientation": ["guide.problem", "guide.flow", "guide.promise", "guide.misconception"],
  "guide.trace": ["guide.flow", "guide.trusted", "guide.untrusted"],
  "guide.preflight": ["guide.knows", "guide.can-explain"]
} as const;

const grammars: Record<string, Record<string, readonly string[]>> = {
  "tape-0.1": tape01,
  "tape-0.2": tape02,
  "tape-0.3": tape03
};

export function getConstructGrammar(spec: ConstructSpec): ConstructGrammar {
  const allowedChildren = grammars[spec] ?? tape03;
  const knownBlocks = new Set<string>();
  for (const [parent, children] of Object.entries(allowedChildren)) {
    if (parent !== "root") knownBlocks.add(parent);
    children.forEach((child) => knownBlocks.add(child));
  }
  return {
    spec,
    allowedChildren,
    knownBlocks,
    topLevelResources: spec === "tape-0.3" ? ["concept", "reference"] : ["reference"]
  };
}

export function canContain(grammar: ConstructGrammar, parentKind: string, childKind: string): boolean {
  return grammar.allowedChildren[parentKind]?.includes(childKind) ?? false;
}
