import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AgentLogService } from "./ai/AgentLogService";
import { finalizeDanglingToolRunEvents, iterationDetail } from "./constructAgentRuntimeStream";
import type { ConstructAgentRunEvent } from "../shared/constructLearning";

describe("construct agent runtime stream lifecycle", () => {
  it("finalizes partial practice-task tool calls without a tool result", () => {
    const providerToolCallId = "chatcmpl-tool-practice-task";
    const event: ConstructAgentRunEvent = {
      id: "run-1:tool:1",
      type: "tool",
      status: "running",
      title: "practice-task",
      detail: "Streaming input",
      toolName: "practice-task",
      toolCallId: providerToolCallId,
      createdAt: "2026-06-21T00:00:00.000Z"
    };
    const toolEvents = new Map([
      [providerToolCallId, { providerToolCallId, event, completed: false }]
    ]);
    const pendingToolInputs = new Map([
      [providerToolCallId, JSON.stringify({
        title: "Smart Pointers and RAII Practice",
        prompt: "Practice modern C++ memory management.",
        taskFiles: ["src/smart_pointers.cpp"],
        introducedConceptIds: ["cpp.memory.raii"]
      })]
    ]);
    const traces: Array<{ event?: ConstructAgentRunEvent; payload?: unknown; level?: string; title: string }> = [];

    const finalized = finalizeDanglingToolRunEvents(
      toolEvents,
      pendingToolInputs,
      "text-start",
      (entry) => traces.push(entry)
    );

    assert.equal(finalized, 1);
    assert.equal(toolEvents.get(providerToolCallId)?.completed, true);
    assert.equal(toolEvents.get(providerToolCallId)?.event.status, "error");
    assert.equal(toolEvents.get(providerToolCallId)?.event.detail, "Tool call was interrupted before a result");
    assert.match(toolEvents.get(providerToolCallId)?.event.outputPreview ?? "", /did not receive a tool result/);
    assert.equal((toolEvents.get(providerToolCallId)?.event.input as { title?: string }).title, "Smart Pointers and RAII Practice");
    assert.equal(traces[0]?.title, "Agent tool result missing");
    assert.equal(traces[0]?.level, "warn");
  });

  it("names tripwire tool-call steps with missing results in readable traces", () => {
    const detail = iterationDetail({
      iteration: 2,
      text: "",
      toolCalls: [{
        id: "chatcmpl-tool-practice-task",
        name: "practice-task",
        args: { title: "Smart Pointers and RAII Practice" }
      }],
      toolResults: [],
      isFinal: true,
      finishReason: "tripwire"
    });

    assert.equal(detail, "1 tool call · 1 missing result · final step · finish: tripwire");
  });

  it("summarizes missing tool result logs without requiring raw JSON", () => {
    let preview = "";
    const logs = new AgentLogService((_channel, payload) => {
      preview = payload.structured?.kind === "structured" ? payload.structured.preview : "";
    });

    logs.structured("flow", "Agent tool result missing", {
      type: "missing-tool-result",
      providerToolCallId: "chatcmpl-tool-practice-task",
      toolName: "practice-task",
      finishReason: "tripwire",
      inputLength: 512
    }, "warn");

    assert.match(preview, /type: missing-tool-result/);
    assert.match(preview, /providerToolCallId: chatcmpl-tool-practice-task/);
    assert.match(preview, /finishReason: tripwire/);
  });
});
