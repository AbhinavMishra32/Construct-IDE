import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./Workspace.tsx", import.meta.url), "utf8");

test("workspace concept cards pass the full project concept graph", () => {
  assert.match(source, /<KnowledgeCard[\s\S]*relatedConcepts=\{project\.program\.concepts\}/);
});
