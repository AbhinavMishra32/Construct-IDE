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
  formatCourseCreatorPolicyForPrompt,
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
  assert.equal(intake.questions.length, 1);
  assert.equal(intake.questions[0]?.conceptId, "teaching.depth");
  assert.equal(intake.questions.some((question) => question.conceptId === "artifact.first-slice"), false);
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
  assert.equal(contract.courseCreator.role, "central-course-creator");
  assert.equal(contract.stagePolicy.scope, "deterministic");
  assert.equal(contract.stagePolicy.intake, "deterministic");
  assert.equal(contract.stagePolicy.research, "disabled-by-default");
  assert.equal(contract.hardRules.some((rule) => /solved project is the source of truth/i.test(rule)), true);
});

test("creation kernel centralizes course style in the course creator policy", () => {
  const contract = buildUnifiedCreationContract({
    goal: "implement a leaky bucket limiter in typescript"
  });
  const promptLines = formatCourseCreatorPolicyForPrompt("plan").join("\n");

  assert.equal(contract.goalScope.scopeSummary, "Small real artifact");
  assert.match(contract.courseCreator.systemPrompt, /progressive construction/i);
  assert.match(promptLines, /Course creator policy/i);
  assert.match(promptLines, /simple version, shortcoming, next capability/i);
  assert.match(contract.hardRules.join("\n"), /course creator policy controls the course shape/i);
});

test("creation kernel lets the course creator system prompt override course shape", () => {
  const previous = process.env.CONSTRUCT_COURSE_CREATOR_SYSTEM_PROMPT;
  process.env.CONSTRUCT_COURSE_CREATOR_SYSTEM_PROMPT = "Production-first course: start with the final public API, then teach internals after.";

  try {
    const contract = buildUnifiedCreationContract({
      goal: "implement a leaky bucket limiter in typescript"
    });
    const promptLines = formatCourseCreatorPolicyForPrompt("blueprint").join("\n");

    assert.match(contract.courseCreator.systemPrompt, /Production-first course/i);
    assert.match(promptLines, /Production-first course/i);
  } finally {
    if (previous === undefined) {
      delete process.env.CONSTRUCT_COURSE_CREATOR_SYSTEM_PROMPT;
    } else {
      process.env.CONSTRUCT_COURSE_CREATOR_SYSTEM_PROMPT = previous;
    }
  }
});
