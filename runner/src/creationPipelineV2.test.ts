import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreationV2Outline,
  CREATION_V2_STAGE_ORDER,
  resolveArtifactLock,
  shouldClarifyRequestedArtifact
} from "./creationPipelineV2.js";
import {
  buildDeterministicCreationQuestionDraft,
  buildUnifiedCreationContract,
  inferCreationGoalScope
} from "./creationKernel.js";

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

test("creation kernel scopes and asks intake deterministically without model-shaped quiz questions", () => {
  const artifact = resolveArtifactLock("implement a leaky bucket limiter in typescript");
  const scope = inferCreationGoalScope("implement a leaky bucket limiter in typescript", artifact);
  const intake = buildDeterministicCreationQuestionDraft({
    goal: "implement a leaky bucket limiter in typescript",
    artifact,
    goalScope: scope
  });

  assert.equal(scope.shouldResearch, false);
  assert.equal(scope.engagementMode, "implementation-first");
  assert.equal(intake.questions.length, 2);
  assert.equal(intake.questions[0]?.conceptId, "artifact.first-slice");
  assert.doesNotMatch(intake.questions.map((question) => question.prompt).join("\n"), /which command|what syntax|correct api/i);
});

test("creation kernel gives ambiguous technology requests one artifact-lock question", () => {
  const artifact = resolveArtifactLock("implement reactjs from scratch in typescript");
  const scope = inferCreationGoalScope("implement reactjs from scratch in typescript", artifact);
  const intake = buildDeterministicCreationQuestionDraft({
    goal: "implement reactjs from scratch in typescript",
    artifact,
    goalScope: scope
  });

  assert.equal(artifact.needsClarification, true);
  assert.equal(intake.questions[0]?.conceptId, "artifact.identity");
  assert.match(intake.questions[0]?.prompt ?? "", /which artifact/i);
});

test("creation kernel contract makes solved project the source of truth", () => {
  const contract = buildUnifiedCreationContract({
    goal: "build a NestJS backend for research agents"
  });

  assert.equal(contract.architecture, "artifact-first-project-compiler");
  assert.equal(contract.pedagogy, "naive-first-progressive");
  assert.equal(contract.stagePolicy.scope, "deterministic");
  assert.equal(contract.stagePolicy.intake, "deterministic");
  assert.equal(contract.stagePolicy.research, "disabled-by-default");
  assert.equal(contract.hardRules.some((rule) => /solved project is the source of truth/i.test(rule)), true);
});

test("creation kernel requires naive-first progression for compact algorithm artifacts", () => {
  const contract = buildUnifiedCreationContract({
    goal: "implement a leaky bucket limiter in typescript"
  });
  const rules = contract.hardRules.join("\n");

  assert.equal(contract.goalScope.scopeSummary, "Small real artifact");
  assert.match(rules, /first implementation slice should be the naive version/i);
  assert.match(rules, /concrete shortcoming/i);
  assert.match(rules, /Do not expose production-ready private fields/i);
});
