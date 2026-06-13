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

  it("persists generated live steps and status changes without mutating authored tape source", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-live-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const authoredSource = `@construct spec="tape-0.4"\n# Static tape stays clean\n`;

    await store.applyPatch({
      generatedLiveSteps: {
        projectId: "project-a",
        steps: [
          {
            id: "live-1",
            projectId: "project-a",
            source: "construct-interact",
            sourceBlockId: "interact-1",
            sourceStepId: "step-2",
            sourceRunId: "run-1",
            insertAfterStepId: "step-2",
            title: "Review runtime validation",
            reason: "The learner missed the prerequisite concept.",
            status: "pending",
            blocks: [
              {
                kind: "explain",
                id: "live-1-explain",
                content: "Runtime validation checks values as they cross trust boundaries.",
                concepts: ["runtime.validation"]
              }
            ],
            conceptIds: ["runtime.validation"],
            createdAt: "2026-06-13T00:00:00.000Z",
            updatedAt: "2026-06-13T00:00:00.000Z"
          }
        ],
        run: {
          id: "run-1",
          source: "construct-interact",
          sourceBlockId: "interact-1",
          sourceStepId: "step-2",
          generatedStepIds: ["live-1"],
          actions: [
            {
              type: "create-live-steps",
              stepIds: ["live-1"],
              label: "Review generated live step",
              reason: "Focused remediation is useful here."
            }
          ],
          toolCalls: [
            {
              id: "getCurrentStep-1",
              name: "getCurrentStep",
              reason: "Anchor to current authored step.",
              createdAt: "2026-06-13T00:00:00.000Z"
            }
          ],
          validation: [
            {
              draftTitle: "Review runtime validation",
              stepId: "live-1",
              status: "accepted",
              reason: "Accepted safe generated live step draft.",
              createdAt: "2026-06-13T00:00:00.000Z"
            }
          ],
          createdAt: "2026-06-13T00:00:00.000Z"
        }
      }
    });

    let state = await store.getState();
    assert.equal(state.projects["project-a"]?.generatedLiveSteps.length, 1);
    assert.equal(state.projects["project-a"]?.generatedLiveStepRuns[0]?.toolCalls[0]?.name, "getCurrentStep");

    state = await store.applyPatch({
      generatedLiveStepStatus: {
        projectId: "project-a",
        stepId: "live-1",
        status: "completed",
        updatedAt: "2026-06-13T00:01:00.000Z"
      }
    });
    assert.equal(state.projects["project-a"]?.generatedLiveSteps[0]?.status, "completed");

    state = await store.applyPatch({
      generatedLiveStepStatus: {
        projectId: "project-a",
        stepId: "live-1",
        status: "dismissed",
        updatedAt: "2026-06-13T00:02:00.000Z"
      }
    });
    assert.equal(state.projects["project-a"]?.generatedLiveSteps[0]?.status, "dismissed");
    assert.equal(authoredSource, `@construct spec="tape-0.4"\n# Static tape stays clean\n`);
  });
});
