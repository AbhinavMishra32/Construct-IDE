import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isCompleteLearnerFacingReply,
  selectLearnerFacingReply
} from "./constructInteractReply";

describe("Construct Interact agent guidance", () => {
  it("keeps general responses proportional without canned fragment handling", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /Match the response to the request/);
    assert.match(source, /Do not include a project introduction or capability list unless it directly answers the user/);
    assert.doesNotMatch(source, /fragment/);
    assert.doesNotMatch(source, /Example: if the message is just/);
  });

  it("streams live agent activity without synthetic thinking recap labels", () => {
    const source = readFileSync(fileURLToPath(new URL("./ai/ConstructInteractService.ts", import.meta.url)), "utf8");
    const runtimeSource = readFileSync(fileURLToPath(new URL("./constructAgentRuntime.ts", import.meta.url)), "utf8");
    assert.match(source, /applyPartialResultToSession/);
    assert.match(source, /onToolCallStart:/);
    assert.match(runtimeSource, /status: "running"/);
    assert.match(source, /Agent tool call started/);
    assert.match(runtimeSource, /title: "Analyzing request"/);
    assert.match(runtimeSource, /title: `Model step \$\{iteration\.iteration\}`/);
    assert.match(runtimeSource, /abortSignal: request\.abortSignal/);
    assert.match(runtimeSource, /Promise\.all\(\[/);
    assert.match(runtimeSource, /this\.observeStream\(output\.fullStream/);
    assert.match(runtimeSource, /responseText: state\.text/);
    assert.doesNotMatch(runtimeSource, /schema: request\.schema,\s*model/);
    assert.doesNotMatch(runtimeSource, /deferredWorkPromise/);
    assert.doesNotMatch(source, /completionGuard:/);
    assert.match(source, /result\.reply = runError\s*\? result\.reply/);
    assert.match(source, /if \(runError \|\| mode === "general"\)/);
    assert.match(source, /selectLearnerFacingReply\(result, streamedReply\)/);
    assert.match(source, /if \(type === "updated"\)/);
    assert.match(runtimeSource, /`\$\{runEventId\}:reasoning`/);
    assert.doesNotMatch(runtimeSource, /event\.text\s*=/);
    assert.doesNotMatch(runtimeSource, /outputPreview = event\.text/);
    assert.doesNotMatch(source, /Thinking through your request/);
    assert.doesNotMatch(source, /Reviewing your answer/);
    assert.doesNotMatch(source, /The AI model call did not finish cleanly/);
    assert.doesNotMatch(source, /Hint: \$\{assessmentClue\}/);
  });

  it("never persists an incomplete streamed reply as the final response", () => {
    assert.equal(isCompleteLearnerFacingReply("I can see you're on the step **"), false);
    assert.equal(isCompleteLearnerFacingReply("I created the **next step** for you."), true);
    assert.equal(selectLearnerFacingReply({
      requestedOutcome: "create-dynamic-steps",
      reply: "I can see you're on the step **",
      dynamicSteps: [{
        source: "construct-interact",
        title: "See the sandbox lifecycle",
        reason: "Break the concept into a smaller explanation.",
        blocks: [{
          kind: "explain",
          id: "explain-lifecycle",
          content: "A sandbox moves through a small lifecycle."
        }]
      }],
      actions: []
    }, "I can see you're on the step **"), "Created 1 Dynamic Step: See the sandbox lifecycle. Review it below.");
  });

  it("creates Dynamic Steps through tape tools instead of the response schema", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /"create-dynamic-steps"/);
    assert.match(source, /create them with createDynamicStep/);
    assert.match(source, /parseDynamicStep or compileDynamicStep/);
    assert.doesNotMatch(source, /GeneratedLiveStepDraftSchema/);
    assert.doesNotMatch(source, /confidence: z\.enum\(\["low", "medium", "high"\]\)/);
  });
});
