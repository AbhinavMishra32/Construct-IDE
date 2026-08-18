import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./Workspace.tsx", import.meta.url), "utf8");

test("workspace concept cards pass the full project concept graph", () => {
  assert.match(source, /<KnowledgeCard[\s\S]*relatedConcepts=\{project\.program\.concepts\}/);
});

test("workspace restores project-scoped context card identities before persisting them", () => {
  assert.match(source, /WORKSPACE_CONTEXT_CARDS_UI_STATE_KEY = "workspace\.context-cards"/);
  assert.match(source, /getUiState<WorkspaceContextCardsUiState \| null>\(\{[\s\S]*scope: "workspace",[\s\S]*projectId: project\.id/);
  assert.match(source, /filter\(\(id\) => conceptIds\.has\(id\)\)/);
  assert.match(source, /if \(!contextCardsUiStateHydrated\) return;/);
  assert.match(source, /setUiState\(\{[\s\S]*openConceptIds/);
});
