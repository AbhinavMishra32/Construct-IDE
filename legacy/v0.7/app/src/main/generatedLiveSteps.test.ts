import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGeneratedLiveStepDrafts } from "./generatedLiveSteps";
import type { GeneratedLiveStepDraft } from "../shared/constructLearning";

const context = {
  projectId: "project-a",
  sourceBlockId: "interact-1",
  sourceStepId: "step-2",
  sourceRunId: "run-1",
  validStepIds: new Set(["step-1", "step-2", "step-3"]),
  validConceptIds: new Set(["runtime.validation", "provider.contract"]),
  now: "2026-06-13T00:00:00.000Z"
};

describe("generated live step validation", () => {
  it("accepts a small explain/interact/reply-recall live step", () => {
    const draft: GeneratedLiveStepDraft = {
      id: "live-runtime-validation",
      source: "construct-interact",
      insertAfterStepId: "step-2",
      title: "Rebuild the validation idea",
      reason: "The learner mixed up runtime validation with static typing.",
      conceptIds: ["runtime.validation"],
      blocks: [
        {
          kind: "explain",
          id: "live-explain",
          content: "Runtime validation checks unknown data while the app is running.",
          concepts: ["runtime.validation"]
        },
        {
          kind: "interact",
          id: "live-interact",
          prompt: "Why is runtime validation still useful in a TypeScript app?",
          basis: "TypeScript does not verify external input at runtime.",
          understanding: "The learner distinguishes compile-time types from runtime data checks.",
          assessment: "Pass if they mention external/unknown data and runtime checks.",
          concepts: ["runtime.validation"]
        },
        {
          kind: "recall",
          id: "live-recall",
          mode: "reply",
          task: "Explain the difference in one sentence.",
          support: "Mention static types and runtime input.",
          concepts: ["runtime.validation"]
        }
      ]
    };

    const result = validateGeneratedLiveStepDrafts([draft], context);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].projectId, "project-a");
    assert.equal(result.steps[0].sourceBlockId, "interact-1");
    assert.equal(result.steps[0].status, "pending");
    assert.equal(result.validation[0].status, "accepted");
  });

  it("rejects invalid insertion targets and unsafe code-edit blocks", () => {
    const drafts = [
      {
        source: "construct-interact",
        insertAfterStepId: "missing-step",
        title: "Bad target",
        reason: "Invalid target should not render.",
        blocks: [{ kind: "explain", id: "explain", content: "Small help." }]
      },
      {
        source: "construct-interact",
        insertAfterStepId: "step-2",
        title: "Edit code",
        reason: "Generated live step edits require a safe project path.",
        blocks: [{ kind: "edit", id: "edit", content: "code" }]
      }
    ] as unknown as GeneratedLiveStepDraft[];

    const result = validateGeneratedLiveStepDrafts(drafts, context);
    assert.equal(result.steps.length, 0);
    assert.equal(result.validation.length, 2);
    assert.match(result.validation[0].reason, /Invalid insertAfterStepId/);
    assert.match(result.validation[1].reason, /safe project-relative path/);
  });

  it("saves at most three live steps per generation", () => {
    const drafts: GeneratedLiveStepDraft[] = Array.from({ length: 5 }, (_, index) => ({
      id: `live-${index}`,
      source: "construct-interact",
      insertAfterStepId: "step-2",
      title: `Live ${index}`,
      reason: "Small focused remediation.",
      blocks: [{ kind: "explain", id: `explain-${index}`, content: "A compact explanation." }]
    }));

    const result = validateGeneratedLiveStepDrafts(drafts, context);
    assert.equal(result.steps.length, 3);
    assert.equal(result.validation.filter((record) => record.status === "accepted").length, 3);
    assert.match(result.validation.at(-1)?.reason ?? "", /Rejected 2 extra drafts/);
  });

  it("normalizes generated markdown and accepts authored-style block shapes", () => {
    const draft: GeneratedLiveStepDraft = {
      source: "construct-interact",
      title: "Build and inspect the runtime",
      reason: "The learner needs a concrete project-shaped walkthrough.",
      blocks: [
        {
          kind: "guide",
          id: "guide-runtime",
          title: "Runtime shape",
          content: "## Runtime shape  Read the fields before editing.  - identity  - lifecycle"
        },
        {
          kind: "edit",
          id: "edit-runtime",
          path: "src/runtime.ts",
          mode: "create",
          language: "typescript",
          content: "export type Runtime = { id: string };"
        },
        {
          kind: "run",
          id: "run-runtime",
          command: "npm test",
          cwd: "."
        },
        {
          kind: "checkpoint",
          id: "checkpoint-runtime",
          content: "Confirm the runtime has an identity and lifecycle."
        }
      ]
    };

    const result = validateGeneratedLiveStepDrafts([draft], context);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].blocks.length, 4);
    assert.equal(result.steps[0].blocks[0].kind, "guide");
    if (result.steps[0].blocks[0].kind === "guide") {
      assert.match(result.steps[0].blocks[0].content, /## Runtime shape\n\nRead/);
      assert.match(result.steps[0].blocks[0].content, /\n\n- identity/);
    }
  });
});
