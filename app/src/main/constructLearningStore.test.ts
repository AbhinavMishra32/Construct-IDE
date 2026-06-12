import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ConstructLearningStore } from "./constructLearningStore";

describe("ConstructLearningStore", () => {
  it("records knowledge, opens, recall attempts, and weak concepts in one state file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));

    await store.saveKnowledgeConcept({
      id: "sandbox.runtime",
      sourceProjectId: "project-a",
      sourceProjectTitle: "Project A",
      title: "Sandbox runtime",
      kind: "concept",
      tags: ["runtime"],
      summary: "A resumable workspace.",
      why: "It keeps execution state explicit.",
      docs: [],
      savedAt: "2026-06-12T00:00:00.000Z",
      openCount: 0,
      usedInRecall: false
    });

    await store.openKnowledgeConcept({
      id: "sandbox.runtime",
      sourceProjectId: "project-a",
      sourceProjectTitle: "Project A",
      title: "Sandbox runtime",
      kind: "concept",
      tags: ["runtime"],
      summary: "A resumable workspace.",
      why: "It keeps execution state explicit.",
      docs: [],
      savedAt: "2026-06-12T00:00:00.000Z",
      openCount: 0,
      usedInRecall: false
    });

    await store.recordRecallAttempt({
      id: "attempt-1",
      projectId: "project-a",
      recallId: "recall-runtime",
      mode: "reply",
      answer: "The runtime depends on a provider contract.",
      passed: false,
      status: "almost",
      confidence: "medium",
      conceptIds: ["sandbox.runtime"],
      createdAt: "2026-06-12T00:00:01.000Z"
    });

    const state = await store.getState();
    assert.equal(state.knowledgeBase.concepts["project-a:sandbox.runtime"]?.openCount, 1);
    assert.equal(state.projects["project-a"]?.recallAttempts.length, 1);
    assert.equal(state.learner.globalConceptUnderstanding["sandbox.runtime"]?.confidence, "weak");
    assert.equal((await store.getWeakConcepts("project-a"))[0]?.conceptId, "sandbox.runtime");

    await store.removeKnowledgeConcept("project-a", "sandbox.runtime");
    assert.equal((await store.getState()).knowledgeBase.concepts["project-a:sandbox.runtime"], undefined);
  });
});
