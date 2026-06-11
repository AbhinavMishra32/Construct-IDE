import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyConstructPatch } from "./patches";
import { validateConstructSource } from "./pipeline";

const header = `@construct spec="tape-0.3"
@id "fixer-demo"
@title "Fixer demo"
@description "Compiler repair fixture"
`;

describe("construct fixer pipeline", () => {
  it("normalizes legacy metadata and known aliases", () => {
    const result = validateConstructSource(`${header.replace('spec="tape-0.3"', 'version="0.3"')}
::concept id="x" title="X"
::summary
X.
::end
::common_mistake
Avoid X.
::end
::end
::step id="s" title="S"
::explain
Done.
::end
::end`);

    assert.match(result.source, /@construct spec="tape-0.3"/);
    assert.match(result.source, /::common-mistake/);
    assert.equal(result.valid, true);
  });

  it("generates stable ids for runtime blocks that omit them", () => {
    const result = validateConstructSource(`${header}
::step id="run-app" title="Run the app"
::run id="start-app"
npm run dev
::end
::expect
The app starts.
::end
::end
`);

    assert.equal(result.valid, true);
    assert.match(result.source, /::expect id="run-app-expect-1"/);
    assert.ok(result.appliedFixes.some((fix) => fix.id.startsWith("add-id:expect:")));
  });

  it("hoists references and converts step notes", () => {
    const result = validateConstructSource(`${header}
::step id="s" title="S"
::reference id="r" title="Reference"
::body
Help.
::end
::end
::note
Explain this.
::end
::end`);

    assert.ok(result.appliedFixes.some((fix) => fix.kind === "hoist-resource"));
    assert.ok(result.appliedFixes.some((fix) => fix.kind === "convert-block"));
    assert.ok(result.source.indexOf("::reference") < result.source.indexOf("::step"));
    assert.match(result.source, /::explain/);
    assert.equal(result.valid, true);
  });

  it("inserts an obvious missing final end", () => {
    const result = validateConstructSource(`${header}
::step id="s" title="S"
::explain
Done.
::end`);

    assert.ok(result.appliedFixes.some((fix) => fix.kind === "insert-end"));
    assert.equal(result.valid, true);
  });

  it("keeps timed step notes selectable when they precede an edit", () => {
    const result = validateConstructSource(`${header}
::step id="s" title="S"
::note when="start"
Read this before typing.
::end
::edit id="e" path="src/a.ts" typing="guided"
\`\`\`ts
export const value = 1;
\`\`\`
::end
::end`);

    assert.ok(result.appliedFixes.some((fix) => fix.id.startsWith("typing-ghost")));
    const suggestion = result.suggestions.find((fix) => fix.id.startsWith("move-note"));
    assert.ok(suggestion);
    assert.equal(result.valid, false);
    assert.equal(validateConstructSource(applyConstructPatch(result.source, suggestion.patch)).valid, true);
  });

  it("applies previewable range patches", () => {
    assert.equal(applyConstructPatch("abc", { edits: [{ start: 1, end: 2, text: "Z" }] }), "aZc");
  });

  it("offers focused teaching patches without an agent call", () => {
    const result = validateConstructSource(`${header}
::step id="s" title="S"
::recall id="r" uses="zod.object-schema"
::task
Define a schema.
::end
::end
::end`);

    assert.equal(result.valid, true);
    assert.ok(result.suggestions.some((fix) => fix.kind === "add-missing-support"));
    assert.ok(result.suggestions.some((fix) => fix.kind === "add-concept-card"));
  });

  it("reports file navigation and teaching-order warnings before project creation", () => {
    const result = validateConstructSource(`${header}
@audience "zero-prerequisite"
::concept id="known.concept" title="Known concept"
::summary
Known.
::end
::end
::step id="s" title="Reveal why the boundary works" requires="known.concept missing.concept"
::explain
Open [[file:src/missing.ts|the boundary]].
::end
::end`);

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    assert.ok(codes.includes("tape-0.3/W_ORIENTATION_MISSING"));
    assert.ok(codes.includes("tape-0.3/W_STEP_REQUIRES_MISSING"));
    assert.ok(codes.includes("tape-0.3/W_STEP_REQUIRES_ORDER"));
    assert.ok(codes.includes("tape-0.3/W_GUIDE_TITLE_PEDAGOGY_LEAK"));
    assert.ok(codes.includes("tape-0.3/W_FILE_REF_MISSING"));
    assert.equal(result.valid, true);
  });
});
