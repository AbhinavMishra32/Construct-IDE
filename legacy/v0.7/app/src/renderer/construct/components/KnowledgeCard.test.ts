import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./KnowledgeCard.tsx", import.meta.url), "utf8");

test("concept card exposes the graph from header chrome", () => {
  assert.match(source, /NetworkIcon/);
  assert.match(source, /aria-label=\{graphOpen \? "Hide concept graph" : "Show concept graph"\}/);
  assert.match(source, /<ConceptGraphOverlay/);
  assert.match(source, /<KnowledgeGraphPanel/);
});

test("concept graph uses the shared concepts graph controller", () => {
  assert.match(source, /import \{ KnowledgeGraphPanel \} from "\.\/KnowledgeBaseSurface"/);
  assert.doesNotMatch(source, /ForceGraph3D/);
  assert.doesNotMatch(source, /cameraPosition/);
  assert.doesNotMatch(source, /zoomToFit/);
  assert.doesNotMatch(source, /selectedPulseRef/);
});

test("concept graph selects the current concept immediately", () => {
  assert.match(source, /selectedKey=\{currentGraphRecordKey\}/);
  assert.doesNotMatch(source, /setSelectedGraphKey/);
  assert.doesNotMatch(source, /selectionTimer/);
  assert.doesNotMatch(source, /2000\)/);
});

test("concept graph passes global knowledge records into the shared graph", () => {
  assert.match(source, /readKnowledgeRecords/);
  assert.match(source, /subscribeKnowledgeRecords/);
  assert.match(source, /buildKnowledgeCardGraphRecords\(concept, relatedConcepts, globalKnowledgeRecords\)/);
  assert.match(source, /for \(const record of globalRecords\) addRecord\(record\)/);
  assert.doesNotMatch(source, /buildConceptFiles\(concept, relatedConcepts\)/);
});

test("body no longer renders the old inline concept tree disclosure", () => {
  assert.doesNotMatch(source, /View concept tree/);
  assert.doesNotMatch(source, /concept-tree-accordion/);
});
