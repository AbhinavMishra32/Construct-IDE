import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectInlineRefs, decodeInlineRefHref, parseInlineFileRef, parseInlineRef, renderInlineRefsAsMarkdown } from "./inlineRefs";

describe("inline Construct references", () => {
  it("parses file lines, ranges, anchors, and explicit concepts", () => {
    assert.deepEqual(parseInlineRef("file:src/a.ts:24-42", "implementation"), {
      kind: "file", path: "src/a.ts", label: "implementation", line: 24, endLine: 42, anchor: undefined,
      raw: "[[file:src/a.ts:24-42|implementation]]"
    });
    assert.equal(parseInlineRef("file:src/a.ts#tool.contract").kind, "file");
    assert.deepEqual(parseInlineRef("concept:zod.object", "Zod"), {
      kind: "concept", id: "zod.object", label: "Zod", raw: "[[concept:zod.object|Zod]]"
    });
    assert.deepEqual(parseInlineRef("source:mdn-js", "MDN"), {
      kind: "source", id: "mdn-js", label: "MDN", raw: "[[source:mdn-js|MDN]]"
    });
    assert.deepEqual(parseInlineRef("src/legacy.ts:3", "legacy file"), {
      kind: "file", path: "src/legacy.ts", label: "legacy file", line: 3, endLine: undefined, anchor: undefined,
      raw: "[[src/legacy.ts:3|legacy file]]"
    });
  });

  it("does not rewrite reference-looking text in fenced code", () => {
    const markdown = renderInlineRefsAsMarkdown("Open [[file:src/a.ts|a.ts]].\n```ts\nconst x = '[[file:no.ts]]';\n```");
    assert.match(markdown, /#construct-ref=/);
    assert.match(markdown, /\[\[file:no\.ts\]\]/);
    const href = markdown.match(/\((#construct-ref=[^)]+)\)/)?.[1];
    assert.equal(decodeInlineRefHref(href ?? "")?.kind, "file");
  });

  it("collects learner-facing refs without reading fenced code", () => {
    const references = collectInlineRefs("Open [[file:src/a.ts:4-8|implementation]] and [[concept:x|X]].\n```ts\n[[file:hidden.ts]]\n```");
    assert.equal(references.length, 2);
    assert.equal(references[0]?.kind, "file");
    assert.equal(references[1]?.kind, "concept");
  });

  it("recognizes plain inline code file targets without treating prose as files", () => {
    assert.deepEqual(parseInlineFileRef("src/flow/task.ts:7-9"), {
      kind: "file",
      path: "src/flow/task.ts",
      label: "src/flow/task.ts",
      line: 7,
      endLine: 9,
      anchor: undefined,
      raw: "[[src/flow/task.ts:7-9]]"
    });
    assert.equal(parseInlineFileRef("open src/flow/task.ts"), null);
    assert.equal(parseInlineFileRef("concept:cpp.render-loop"), null);
  });
});
