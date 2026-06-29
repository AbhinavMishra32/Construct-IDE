import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

test("Concepts surface renders saved concepts as an expandable tree", () => {
  const source = readFileSync(fileURLToPath(new URL("./KnowledgeBaseSurface.tsx", import.meta.url)), "utf8");

  assert.match(source, /aria-label="Concept tree"/);
  assert.match(source, /ConceptTreeListNode/);
  assert.match(source, /buildConceptRecordTree/);
  assert.match(source, /collapsedTreePaths/);
  assert.match(source, /conceptTreePath/);
  assert.match(source, /conceptSegmentLabel/);
  assert.doesNotMatch(source, /aria-label="Concept cards"/);
});
