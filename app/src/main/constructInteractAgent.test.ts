import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDefaultLearningState, type ConstructInteractRuntimeInput } from "../shared/constructLearning";
import { buildConstructInteractInstructions, buildConstructInteractPrompt } from "./constructInteractAgent";

describe("Construct Interact agent boundary", () => {
  it("uses the generic Construct agent runtime instead of importing Mastra directly", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /createConstructAgentRuntime/);
    assert.doesNotMatch(source, /@mastra\/core/);
  });

  it("declares structured actions, generated live steps, and scoped tool guidance", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /ConstructInteractActionSchema/);
    assert.match(source, /GeneratedLiveStepDraftSchema/);
    assert.match(source, /supportsGeneratedLiveSteps/);
    assert.match(source, /go-to-step/);
    assert.match(source, /open-concept/);
    assert.match(source, /generatedLiveSteps/);
    assert.match(source, /Use the smallest relevant set/);
    assert.match(source, /Never generate more than three/);
    assert.match(source, /maxSteps: 12/);
    assert.match(source, /completionGuard/);
    assert.match(source, /Finish the work inside this agent run/);
    assert.match(source, /Never stop with 'let me check'/);
  });

  it("uses Mastra's native multi-step structured agent loop and emits iteration events", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructAgentRuntime.ts", import.meta.url)), "utf8");
    assert.match(source, /structuredOutput: \{[\s\S]*schema: request\.schema,[\s\S]*model/);
    assert.match(source, /maxSteps: request\.maxSteps/);
    assert.match(source, /onIterationComplete/);
    assert.match(source, /title: "Agent iteration"/);
    assert.match(source, /title: "Agent run completed"/);
    assert.match(source, /Complete that work in this run/);
    assert.doesNotMatch(source, /JSON\.parse\(.*output\.text/);
  });

  it("keeps tape-0.4.x prompts agentic without preloading authored answers or learner state", () => {
    const input = interactInput("tape-0.4.1");
    const prompt = buildConstructInteractPrompt(input, true);

    assert.match(prompt, /Project id: project-a/);
    assert.match(prompt, /Learner message:\ndid you explain ABI before\?/);
    assert.doesNotMatch(prompt, /The exact ABI answer/);
    assert.doesNotMatch(prompt, /Basis hidden from learner/);
    assert.doesNotMatch(prompt, /Learning state snapshot/);
    assert.doesNotMatch(prompt, /Resources:/);
  });

  it("requires source provenance and leaves tool choice to the agent", () => {
    const instructions = buildConstructInteractInstructions({
      canGenerateLiveSteps: true,
      formalToolDrivenSpec: true
    });

    assert.match(instructions, /Concept-card and reference-card text are separate sources/);
    assert.match(instructions, /If the detail exists only in a card, say that plainly/);
    assert.match(instructions, /prefer an open-concept action/);
    assert.match(instructions, /Decide which tools, if any/);
    assert.match(instructions, /Do not follow a fixed tool sequence/);
  });
});

function interactInput(tapeSpec: string): ConstructInteractRuntimeInput {
  return {
    projectId: "project-a",
    blockId: "sector-zero-model",
    tapeSpec,
    prompt: "The exact ABI answer is deliberately not preloaded.",
    answer: "did you explain ABI before?",
    basis: "The learner saw a fixed-size sector.",
    understanding: "The learner should connect offsets with external interpretation.",
    assessment: "Ask a smaller follow-up when needed.",
    resources: {
      concepts: ["disk.sector"],
      files: [],
      references: ["mbr-byte-map"],
      steps: ["understand-sector-zero"]
    },
    learningState: createDefaultLearningState("test-device")
  };
}
