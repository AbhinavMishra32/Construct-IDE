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

  it("defines tape-0.3 concept/support children with legacy guide compatibility", () => {
    const grammar = getConstructGrammar("tape-0.3");
    assert.ok(grammar.allowedChildren.concept.includes("guide.misconception"));
    assert.ok(grammar.allowedChildren.concept.includes("misconception"));
    assert.deepEqual(grammar.allowedChildren.support, ["intent", "concepts", "api", "mental-model", "common-mistake"]);
  });

  it("keeps tape-0.3 legacy guide names valid and treats tape-0.3.1 as canonical", () => {
    const legacy = parseConstructDocument(`@construct spec="tape-0.3"
::orientation id="map" title="System picture"
::problem
Understand the boundary.
::end
::end`);
    assert.equal(legacy.diagnostics.length, 0);

    const canonical = parseConstructDocument(`@construct spec="tape-0.3.1"
::guide.orientation id="map" title="System picture"
::guide.problem
Understand the boundary.
::end
::end`);
    assert.equal(canonical.diagnostics.length, 0);
    assert.equal(canonical.spec, "tape-0.3.1");
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
