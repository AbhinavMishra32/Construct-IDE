import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getConstructGrammar } from "./grammar";
import { lexConstruct } from "./lexer";
import { parseConstructDocument } from "./parser";

describe("construct compiler front-end", () => {
  it("ignores block-looking text inside code fences", () => {
    const tokens = lexConstruct(`@construct spec="tape-0.3"
::step id="x" title="x"
::edit id="e" path="src/a.ts"
\`\`\`ts
const marker = "::step id=\\"not-real\\"";
\`\`\`
::end
::end`);

    assert.equal(tokens.filter((token) => token.kind === "block" && token.name === "step").length, 1);
  });

  it("defines canonical tape-0.3 concept and support children", () => {
    const grammar = getConstructGrammar("tape-0.3");
    assert.deepEqual(grammar.allowedChildren.concept, ["summary", "why", "example", "docs", "common-mistake", "guide.misconception", "guide.analogy"]);
    assert.deepEqual(grammar.allowedChildren.support, ["intent", "concepts", "api", "mental-model", "common-mistake"]);
  });

  it("parses dotted guide block names and validates their parents", () => {
    const valid = parseConstructDocument(`@construct spec="tape-0.3"
::guide.orientation id="map" title="System picture"
::guide.problem
Understand the boundary.
::end
::end
::step id="s" title="Build the boundary"
::guide.why-now
This creates the trust boundary.
::end
::end`);
    assert.equal(valid.diagnostics.length, 0);
    assert.ok(valid.tokens.some((token) => token.name === "guide.orientation"));
    assert.ok(valid.tokens.some((token) => token.name === "guide.why-now"));

    const invalid = parseConstructDocument(`@construct spec="tape-0.3"
::guide.why-now
Too early.
::end`);
    assert.ok(invalid.diagnostics.some((item) => item.code.endsWith("E_UNEXPECTED_CHILD")));
  });

  it("reports misplaced resources and notes with compiler diagnostics", () => {
    const document = parseConstructDocument(`@construct spec="tape-0.3"
@id "demo"
@title "Demo"
@description "Demo"
::step id="x" title="X"
::reference id="r" title="R"
::body
Body
::end
::end
::note
Explain this.
::end
::end`);

    assert.ok(document.diagnostics.some((item) => item.code.endsWith("E_UNEXPECTED_CHILD") && item.childKind === "reference"));
    assert.ok(document.diagnostics.some((item) => item.code.endsWith("E_UNEXPECTED_CHILD") && item.childKind === "note"));
  });

  it("reports one obvious unclosed block", () => {
    const document = parseConstructDocument(`@construct spec="tape-0.3"
::step id="x" title="X"
::explain
Hello
::end`);
    assert.ok(document.diagnostics.some((item) => item.code.endsWith("E_UNCLOSED_BLOCK") && item.childKind === "step"));
  });
});
