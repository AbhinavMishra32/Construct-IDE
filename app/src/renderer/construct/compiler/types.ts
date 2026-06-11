export type ConstructSpec = "tape-0.1" | "tape-0.2" | "tape-0.3" | "tape-0.3.1" | string;

export type SourceRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};

export type ConstructToken = {
  kind: "metadata" | "block" | "end" | "text" | "fence";
  text: string;
  line: number;
  column: number;
  start: number;
  end: number;
  name?: string;
  attributes?: Record<string, string>;
};

export type ConstructNode = {
  kind: string;
  attributes: Record<string, string>;
  children: ConstructNode[];
  parent: ConstructNode | null;
  open: ConstructToken;
  close?: ConstructToken;
  range: SourceRange;
};

export type ConstructDocument = {
  source: string;
  spec: ConstructSpec;
  tokens: ConstructToken[];
  root: ConstructNode;
  diagnostics: ConstructDiagnostic[];
};

export type ConstructDiagnostic = {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line: number;
  column?: number;
  blockId?: string;
  parentKind?: string;
  childKind?: string;
  spec: ConstructSpec;
  details?: string;
  allowedChildren?: string[];
  fixIds?: string[];
};

export type ConstructTextEdit = {
  start: number;
  end: number;
  text: string;
};

export type ConstructPatch = {
  edits: ConstructTextEdit[];
};

export type ConstructFix = {
  id: string;
  diagnosticId?: string;
  title: string;
  description: string;
  safety: "safe-auto" | "suggested" | "semantic";
  kind:
    | "insert-end"
    | "move-block"
    | "rename-block"
    | "wrap-as-markdown"
    | "convert-block"
    | "hoist-resource"
    | "split-ghost-edit"
    | "add-missing-support"
    | "add-concept-card"
    | "add-reference-card"
    | "custom";
  patch: ConstructPatch;
  line?: number;
  before?: string;
  after?: string;
};

export type AppliedConstructFix = ConstructFix & {
  appliedAt: string;
};

export type ConstructValidationResult = {
  originalSource: string;
  source: string;
  document: ConstructDocument;
  diagnostics: ConstructDiagnostic[];
  appliedFixes: AppliedConstructFix[];
  suggestions: ConstructFix[];
  valid: boolean;
};
