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
  root: ["files", "concept", "reference", "target", "orientation", "trace", "guide.orientation", "guide.trace", "step", "git"],
  step: ["preflight", "trace", "why-now", "mental-model", "misconception", "analogy", "guide.preflight", "guide.trace", "guide.why-now", "guide.mental-model", "guide.misconception", "guide.analogy", "explain", "edit", "recall", "run", "expect", "checkpoint"],
  edit: ["note", "why-now", "guide.why-now"],
  concept: ["summary", "why", "example", "docs", "common-mistake", "misconception", "analogy", "guide.misconception", "guide.analogy"],
  support: ["intent", "concepts", "api", "mental-model", "common-mistake"],
  git: ["suggest", "include"],
  orientation: ["problem", "flow", "promise", "misconception", "guide.problem", "guide.flow", "guide.promise", "guide.misconception"],
  trace: ["flow", "trusted", "untrusted", "guide.flow", "guide.trusted", "guide.untrusted"],
  preflight: ["knows", "can-explain", "guide.knows", "guide.can-explain"],
  "guide.orientation": ["guide.problem", "guide.flow", "guide.promise", "guide.misconception"],
  "guide.trace": ["guide.flow", "guide.trusted", "guide.untrusted"],
  "guide.preflight": ["guide.knows", "guide.can-explain"]
} as const;

const tape031 = {
  ...tape03,
  root: ["files", "concept", "reference", "target", "guide.orientation", "guide.trace", "step", "git"],
  step: ["guide.preflight", "guide.trace", "guide.why-now", "guide.mental-model", "guide.misconception", "guide.analogy", "explain", "edit", "recall", "run", "expect", "checkpoint"],
  edit: ["note", "guide.why-now"],
  concept: ["summary", "why", "example", "docs", "common-mistake", "guide.misconception", "guide.analogy"]
} as const;

const grammars: Record<string, Record<string, readonly string[]>> = {
  "tape-0.1": tape01,
  "tape-0.2": tape02,
  "tape-0.3": tape03,
  "tape-0.3.1": tape031
};

export function getConstructGrammar(spec: ConstructSpec): ConstructGrammar {
  const grammarKey = resolveGrammarKey(spec);
  const allowedChildren = grammars[grammarKey] ?? tape031;
  const knownBlocks = new Set<string>();
  for (const [parent, children] of Object.entries(allowedChildren)) {
    if (parent !== "root") knownBlocks.add(parent);
    children.forEach((child) => knownBlocks.add(child));
  }
  return {
    spec,
    allowedChildren,
    knownBlocks,
    topLevelResources: grammarKey === "tape-0.3" || grammarKey === "tape-0.3.1" ? ["concept", "reference"] : ["reference"]
  };
}

export function canContain(grammar: ConstructGrammar, parentKind: string, childKind: string): boolean {
  return grammar.allowedChildren[parentKind]?.includes(childKind) ?? false;
}

export function resolveGrammarKey(spec: ConstructSpec): "tape-0.1" | "tape-0.2" | "tape-0.3" | "tape-0.3.1" | string {
  if (spec === "tape-0.1" || spec === "tape-0.2" || spec === "tape-0.3" || spec === "tape-0.3.1") {
    return spec;
  }
  if (/^tape-0\.3\.\d+$/.test(spec)) return "tape-0.3.1";
  return spec;
}
