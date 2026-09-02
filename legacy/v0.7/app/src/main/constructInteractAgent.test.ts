import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isCompleteLearnerFacingReply,
  selectLearnerFacingReply
} from "./constructInteractReply";
import {
  createConstructAgentRuntime,
  type ConstructAgentTraceEntry
} from "./constructAgentRuntime";
import type { ConstructAgentRunEvent } from "../shared/constructLearning";

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
    assert.match(runtimeSource, /title: "Thinking"/);
    assert.match(runtimeSource, /title: `Model step \$\{iteration\.iteration\}`/);
    assert.match(runtimeSource, /abortSignal: request\.abortSignal/);
    assert.match(runtimeSource, /Promise\.all\(\[/);
    assert.match(runtimeSource, /this\.observeStream\(output\.fullStream/);
    assert.match(runtimeSource, /responseText: state\.text/);
    assert.match(runtimeSource, /const startTextSegment = \(rawId: string \| undefined\) => \{/);
    assert.match(runtimeSource, /const id = nextMessageId\(\);/);
    assert.match(runtimeSource, /closeTextSegment\("reasoning-start"\)/);
    assert.match(runtimeSource, /closeActiveReasoningSegment\("reasoning-start"\)/);
    assert.match(runtimeSource, /startReasoningSegment/);
    assert.match(runtimeSource, /id: nextToolEventId\(\)/);
    assert.doesNotMatch(runtimeSource, /streamScopedId/);
    assert.doesNotMatch(runtimeSource, /schema: request\.schema,\s*model/);
    assert.doesNotMatch(runtimeSource, /deferredWorkPromise/);
    assert.doesNotMatch(source, /completionGuard:/);
    assert.match(source, /result\.reply = runError\s*\? result\.reply/);
    assert.match(source, /if \(runError \|\| mode === "general"\)/);
    assert.match(source, /selectLearnerFacingReply\(result, streamedReply\)/);
    assert.match(source, /const state = stateOverride \?\? await store\.upsertConstructInteractSession\(snapshot\)/);
    assert.doesNotMatch(source, /if \(type === "updated"\)\s*{\s*onSessionEvent/s);
    assert.match(runtimeSource, /nextEventOrdinal/);
    assert.match(runtimeSource, /state\.event\.text = state\.text/);
    assert.match(runtimeSource, /summarizeReasoningText\(state\.text\)/);
    assert.doesNotMatch(source, /Thinking through your request/);
    assert.doesNotMatch(source, /Reviewing your answer/);
    assert.doesNotMatch(source, /The AI model call did not finish cleanly/);
    assert.doesNotMatch(source, /Hint: \$\{assessmentClue\}/);
  });

  it("keeps repeated provider stream ids as separate timeline events", async () => {
    const runtime = createConstructAgentRuntime() as unknown as {
      observeStream<T>(
        stream: { getReader: () => { read: () => Promise<{ done?: boolean; value?: unknown }>; releaseLock?: () => void } },
        request: { id: string; onTrace?: (entry: ConstructAgentTraceEntry<T>) => void },
        runStartedAt: number,
        runEventId: string
      ): Promise<{ text: string }>;
    };
    const traces: ConstructAgentTraceEntry[] = [];

    const observed = await runtime.observeStream(
      streamFromChunks([
        { type: "reasoning-start", id: "0" },
        { type: "reasoning-delta", id: "0", text: "thinking 1" },
        { type: "text-start", id: "txt-0" },
        { type: "text-delta", id: "txt-0", text: "final text 1" },
        { type: "text-end", id: "txt-0" },
        { type: "tool-call", id: "call-0", toolName: "read", args: { path: "a.ts" } },
        { type: "tool-result", id: "call-0", toolName: "read", result: "a" },
        { type: "reasoning-start", id: "0" },
        { type: "reasoning-delta", id: "0", text: "thinking 2" },
        { type: "reasoning-end", id: "0" },
        { type: "text-start", id: "txt-0" },
        { type: "text-delta", id: "txt-0", text: "final text 2" },
        { type: "text-end", id: "txt-0" },
        { type: "tool-call", id: "call-0", toolName: "read", args: { path: "b.ts" } },
        { type: "tool-result", id: "call-0", toolName: "read", result: "b" }
      ]),
      { id: "stream-test", onTrace: (entry) => traces.push(entry) },
      Date.now(),
      "stream-test-run"
    );

    assert.equal(observed.text, "final text 1final text 2");

    const completedEvents = uniqueCompletedEvents(traces);
    const reasoningEvents = completedEvents.filter((event) => event.type === "reasoning");
    const messageEvents = completedEvents.filter((event) => event.type === "message");
    const toolEvents = completedEvents.filter((event) => event.type === "tool");

    assert.deepEqual(reasoningEvents.map((event) => event.text), ["thinking 1", "thinking 2"]);
    assert.notEqual(reasoningEvents[0].id, reasoningEvents[1].id);
    assert.deepEqual(messageEvents.map((event) => event.text), ["final text 1", "final text 2"]);
    assert.notEqual(messageEvents[0].id, messageEvents[1].id);
    assert.deepEqual(toolEvents.map((event) => event.toolCallId), ["call-0", "call-0"]);
    assert.notEqual(toolEvents[0].id, toolEvents[1].id);
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
    assert.match(source, /create them with createDynamicStep/);
    assert.match(source, /parseDynamicStep or compileDynamicStep/);
    assert.doesNotMatch(source, /GeneratedLiveStepDraftSchema/);
    assert.doesNotMatch(source, /confidence: z\.enum\(\["low", "medium", "high"\]\)/);
  });
});

function streamFromChunks(chunks: unknown[]) {
  let index = 0;
  return {
    getReader() {
      return {
        async read() {
          if (index >= chunks.length) {
            return { done: true };
          }
          return { done: false, value: chunks[index++] };
        },
        releaseLock() {}
      };
    }
  };
}

function uniqueCompletedEvents(traces: ConstructAgentTraceEntry[]): ConstructAgentRunEvent[] {
  const byId = new Map<string, ConstructAgentRunEvent>();
  for (const event of traces.map((trace) => trace.event).filter((event): event is ConstructAgentRunEvent => Boolean(event))) {
    if (event.status === "completed") {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}
