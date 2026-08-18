import assert from "node:assert/strict";
import test from "node:test";

import { excerptLines, normalizeSelectionText } from "./selectionContext";

test("normalizeSelectionText trims drag-selection whitespace and bounds context", () => {
  assert.equal(normalizeSelectionText("  z.object({  \n  a: z.number() \t\n"), "z.object({\n  a: z.number()");
  assert.equal(normalizeSelectionText("abcdef", 4), "abcd…");
});

test("excerptLines keeps nearby code and preserves source line numbers", () => {
  const content = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  assert.equal(
    excerptLines(content, 6, 7, 2),
    ["4: line 4", "5: line 5", "6: line 6", "7: line 7", "8: line 8", "9: line 9"].join("\n")
  );
});
