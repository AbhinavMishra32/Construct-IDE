import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreationV2Outline,
  CREATION_V2_STAGE_ORDER,
  resolveArtifactLock,
  shouldClarifyRequestedArtifact
} from "./creationPipelineV2.js";

test("creation v2 asks for clarification when a technology-only request is artifact-ambiguous", () => {
  const decision = resolveArtifactLock("implement reactjs from scratch in typescript");

  assert.equal(decision.needsClarification, true);
  assert.match(
    decision.suggestedClarification ?? "",
    /framework\/runtime itself, or to build an app using it/i
  );
});

test("creation v2 does not ask for clarification when the artifact noun is explicit", () => {
  const decision = resolveArtifactLock("build a NestJS backend for research agents");

  assert.equal(decision.needsClarification, false);
  assert.equal(decision.kind, "api");
});

test("creation v2 keeps the stage order artifact-first", () => {
  assert.deepEqual(CREATION_V2_STAGE_ORDER, [
    "artifact-lock",
    "project-spec",
    "solved-project",
    "step-plan",
    "learner-diff",
    "lesson"
  ]);
});

test("creation v2 outline preserves artifact-first invariants", () => {
  const outline = buildCreationV2Outline("build a local RAG backend in NestJS");

  assert.equal(outline.stages[0]?.id, "artifact-lock");
  assert.equal(outline.stages.at(-1)?.id, "lesson");
  assert.equal(
    outline.invariants.some((invariant) => /must not substitute a tutorial-friendly artifact/i.test(invariant)),
    true
  );
  assert.equal(shouldClarifyRequestedArtifact("build a local RAG backend in NestJS"), false);
});
