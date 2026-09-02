import assert from "node:assert/strict";
import test from "node:test";

import {
  addInlineCitationLinks,
  extractOpenAiExplanation,
  searchNeedles
} from "./constructSelectionExplainAgent";

test("selection research extracts and numbers hosted web citations", () => {
  const extracted = extractOpenAiExplanation({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "Zod validates runtime values.",
        annotations: [{
          type: "url_citation",
          url: "https://zod.dev/basics",
          title: "Zod basics",
          start_index: 0,
          end_index: 3
        }]
      }]
    }]
  });

  assert.equal(extracted.citations.length, 1);
  assert.equal(
    addInlineCitationLinks(extracted.text, extracted.citations),
    "Zod [1](https://zod.dev/basics) validates runtime values."
  );
});

test("selection research derives bounded literal workspace searches", () => {
  assert.deepEqual(searchNeedles("defineTool schema validation"), [
    "defineTool schema validation",
    "defineTool",
    "validation"
  ]);
  assert.equal(searchNeedles("a").length, 0);
});
