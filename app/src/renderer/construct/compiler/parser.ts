import { canContain, getConstructGrammar, resolveGrammarKey } from "./grammar";
import { lexConstruct, readDeclaredSpec } from "./lexer";
import type { ConstructDiagnostic, ConstructDocument, ConstructNode, ConstructToken } from "./types";

function extractLineText(source: string, line: number): string | undefined {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const index = line - 1;
  if (index >= 0 && index < lines.length) {
    return lines[index];
  }
  return undefined;
}

export function parseConstructDocument(source: string): ConstructDocument {
  const tokens = lexConstruct(source);
  const spec = readDeclaredSpec(source);
  const grammar = getConstructGrammar(spec);
  const rootToken: ConstructToken = { kind: "block", name: "root", text: "", line: 1, column: 1, start: 0, end: 0 };
  const root: ConstructNode = {
    kind: "root",
    attributes: {},
    children: [],
    parent: null,
    open: rootToken,
    range: { start: 0, end: source.length, startLine: 1, endLine: Math.max(1, source.split(/\r?\n/).length) }
  };
  const stack: ConstructNode[] = [root];
  const diagnostics: ConstructDiagnostic[] = [];

  if (!["tape-0.1", "tape-0.2", "tape-0.3", "tape-0.3.1", "tape-0.4"].includes(resolveGrammarKey(spec))) {
    diagnostics.push({ id: `unknown-spec:${spec}`, severity: "error", code: `${spec}/E_UNKNOWN_SPEC`, message: `Unsupported Construct tape spec "${spec}".`, line: 1, lineText: extractLineText(source, 1), spec, details: "Use tape-0.1, tape-0.2, tape-0.3, tape-0.3.1, or tape-0.4." });
  }

  const fenceTokens = tokens.filter((token) => token.kind === "fence");
  if (fenceTokens.length % 2 !== 0) {
    const fence = fenceTokens[fenceTokens.length - 1];
    diagnostics.push({ id: `unclosed-fence:${fence.line}`, severity: "error", code: `${spec}/E_UNCLOSED_FENCE`, message: "Code fence is not closed.", line: fence.line, column: fence.column, lineText: extractLineText(source, fence.line), spec, details: "Close the code fence before the next Construct block marker." });
  }

  for (const token of tokens) {
    if (token.kind === "end") {
      if (stack.length === 1) {
        diagnostics.push(diagnostic(spec, "E_STRAY_END", "Unexpected ::end with no open block.", token, undefined, undefined, undefined, source));
        continue;
      }
      const node = stack.pop()!;
      node.close = token;
      node.range.end = token.end;
      node.range.endLine = token.line;
      continue;
    }

    if (token.kind !== "block" || !token.name) continue;
    const parent = stack[stack.length - 1];
    const node: ConstructNode = {
      kind: token.name,
      attributes: token.attributes ?? {},
      children: [],
      parent,
      open: token,
      range: { start: token.start, end: source.length, startLine: token.line, endLine: root.range.endLine }
    };
    parent.children.push(node);

    if (!grammar.knownBlocks.has(node.kind)) {
      diagnostics.push(diagnostic(spec, "E_UNKNOWN_BLOCK", `Unknown block ::${node.kind} for ${spec}.`, token, node, parent, grammar.allowedChildren[parent.kind], source));
    } else if (!canContain(grammar, parent.kind, node.kind)) {
      diagnostics.push(diagnostic(
        spec,
        "E_UNEXPECTED_CHILD",
        `::${node.kind} is not allowed inside ::${parent.kind}.`,
        token,
        node,
        parent,
        grammar.allowedChildren[parent.kind],
        source
      ));
    }
    stack.push(node);
  }

  for (const node of stack.slice(1).reverse()) {
    diagnostics.push({
      id: `unclosed:${node.kind}:${node.open.line}`,
      severity: "error",
      code: `${spec}/E_UNCLOSED_BLOCK`,
      message: `::${node.kind}${node.attributes.id ? ` "${node.attributes.id}"` : ""} is not closed.`,
      line: node.open.line,
      column: node.open.column,
      lineText: extractLineText(source, node.open.line),
      blockId: node.attributes.id,
      parentKind: node.parent?.kind,
      childKind: node.kind,
      spec,
      details: "Insert ::end before the next incompatible block or at the end of the file.",
      fixIds: [`insert-end:${node.open.line}`]
    });
  }

  return { source, spec, tokens, root, diagnostics };
}

function diagnostic(
  spec: string,
  code: string,
  message: string,
  token: ConstructToken,
  node?: ConstructNode,
  parent?: ConstructNode,
  allowedChildren?: readonly string[],
  source?: string
): ConstructDiagnostic {
  return {
    id: `${code}:${token.line}:${node?.kind ?? "end"}`,
    severity: "error",
    code: `${spec}/${code}`,
    message,
    line: token.line,
    column: token.column,
    lineText: source ? extractLineText(source, token.line) : undefined,
    blockId: node?.attributes.id,
    parentKind: parent?.kind,
    childKind: node?.kind,
    spec,
    allowedChildren: allowedChildren ? [...allowedChildren] : undefined,
    details: parent && node
      ? `Parent block: ::${parent.kind}. Allowed children: ${(allowedChildren ?? []).map((child) => `::${child}`).join(", ") || "none"}.`
      : undefined
  };
}
