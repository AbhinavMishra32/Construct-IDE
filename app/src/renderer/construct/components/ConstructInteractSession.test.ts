import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct Interact Codex-style UI", () => {
  it("uses an unboxed conversation surface with ordered agent message parts", () => {
    const source = readFileSync(fileURLToPath(new URL("./guide/ConstructInteractSession.tsx", import.meta.url)), "utf8");
    assert.match(source, /const recentSessions = mergeSessions\(sessions, liveSession\);/);
    assert.match(source, /className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"/);
    assert.match(source, /emptyState=\{null\}/);
    assert.match(source, /session\.agentEvents/);
    assert.match(source, /const completedEvents = isLatestResult/);
    assert.match(source, /result\?\.agentEvents/);
    assert.match(source, /const events = isLiveSession \? \(session\.agentEvents \?\? \[\]\) : completedEvents;/);
    assert.match(source, /buildAgentEventParts\(\{/);
    assert.match(source, /if \(event\.type === "message"\)/);
    assert.match(source, /content=\{event\.text\}/);
    assert.match(source, /if \(event\.type === "reasoning"\)/);
    assert.match(source, /type: "activity"/);
    assert.match(source, /entry: runEventToTraceEntry\(event\)/);
    assert.match(source, /toolCallToTraceEntry\(toolCall\)/);
    assert.match(source, /seenToolNames/);
    assert.match(source, /!hasMessageEvent && fallbackText\.answer/);
    assert.match(source, /title: "Continuing"/);
    assert.match(source, /liveSession\?: ConstructInteractSessionRecord/);
    assert.doesNotMatch(source, /<AgentRunTrace/);
    assert.doesNotMatch(source, /entries=\{\[\]\}/);
    assert.match(source, /construct-interact-streaming-reply/);
    assert.match(source, /assessmentMeta: !isLiveSession && session\.assessment/);
    assert.match(source, /title: "Dynamic Steps"/);
    assert.match(source, /output: event\.outputPreview/);
    assert.doesNotMatch(source, /if \(tracePart\)[\s\S]*assistantParts\.push\(tracePart\);[\s\S]*if \(session\.reply\.trim\(\)\)/);
    assert.doesNotMatch(source, /event\.text \?\? event\.detail/);
    assert.doesNotMatch(source, /LogEntry/);
    assert.doesNotMatch(source, /progressLogs/);
    assert.doesNotMatch(source, /buildPendingAgentRunTraceEntries/);
    assert.doesNotMatch(source, /parseLegacyToolCallName/);
    assert.doesNotMatch(source, /AgentThinkingSteps/);
    assert.doesNotMatch(source, /ExploringToolList/);
    assert.doesNotMatch(source, /Preparing to inspect/);
    assert.doesNotMatch(source, /Choosing what to inspect/);
    assert.doesNotMatch(source, /meta: "Your answer"/);
    assert.doesNotMatch(source, /activeLabel: "Steps taken"/);
    assert.doesNotMatch(source, /activeLabel: "Tool activity"/);
    assert.doesNotMatch(source, /Queued answer.*Saving your response/);
    assert.doesNotMatch(source, /Waiting for model.*provider hangs/);
  });

  it("uses Codex message geometry and a real icon-only composer", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionSurface.tsx", import.meta.url)), "utf8");
    assert.match(source, /max-w-\[77%\]/);
    assert.match(source, /rounded-2xl/);
    assert.match(source, /rounded-3xl/);
    assert.match(source, /ArrowUpIcon/);
    assert.match(source, /event\.key === "Enter"/);
    assert.match(source, /aria-label=\{pending \? "Construct Interact is thinking"/);
    assert.doesNotMatch(source, /SendHorizontal/);
    assert.doesNotMatch(source, /Enter to send<\/span>/);
  });

  it("keeps slot tab bodies as real scrollable flex viewports", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/slot-panel/SlotPanel.tsx", import.meta.url)), "utf8");
    assert.match(source, /className="flex min-h-0 flex-1 flex-col overflow-hidden"/);
    assert.match(source, /className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"/);
  });

  it("renders a compact expandable trace with distinct thought and tool rows", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentRunTrace.tsx", import.meta.url)), "utf8");
    assert.match(source, /Working/);
    assert.match(source, /Worked for/);
    assert.match(source, /animate-in fade-in-0 slide-in-from-top-1/);
    assert.match(source, /slide-in-from-left-1/);
    assert.match(source, /opaline-agent-thinking-shimmer/);
    assert.match(source, /data-slot="agent-run-trace-entry"/);
    assert.match(source, /TraceDetail label="Input"/);
    assert.match(source, /TraceDetail label="Result"/);
    assert.match(source, /border-l border-border/);
    assert.doesNotMatch(source, /Thought for/);
  });

  it("exposes compact trace rows as ordered assistant activity parts", () => {
    const types = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/types.ts", import.meta.url)), "utf8");
    const primitives = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionPrimitives.tsx", import.meta.url)), "utf8");
    const flow = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
    assert.match(types, /type: "activity"/);
    assert.match(primitives, /data-component="activity-part"/);
    assert.match(primitives, /<AgentRunTraceRow entry=\{part\.entry\}/);
    assert.match(flow, /buildFlowAgentParts/);
    assert.match(flow, /type: "activity"/);
    assert.match(flow, /buildAskUserPart\(session\.id, event\.id, event\.input, event\.outputPreview, theme\)/);
    assert.match(flow, /splitReasoningSegments\(fallbackText\.process\)/);
    assert.match(flow, /pushFallbackReasoning\(\)/);
    assert.doesNotMatch(flow, /<AgentRunTrace/);
  });

  it("shows reasoning as an expandable thinking row inside the natural trace", () => {
    const trace = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentRunTrace.tsx", import.meta.url)), "utf8");
    const runtime = readFileSync(fileURLToPath(new URL("../../../main/constructAgentRuntime.ts", import.meta.url)), "utf8");
    const interact = readFileSync(fileURLToPath(new URL("./guide/ConstructInteractSession.tsx", import.meta.url)), "utf8");
    assert.match(trace, /data-slot="agent-run-trace-reasoning-text"/);
    assert.match(trace, /if \(entry\.kind === "thought"\) return "Thinking"/);
    assert.match(trace, /reasoningText \? \(/);
    assert.match(trace, /data-slot="agent-run-trace-row-label"/);
    assert.match(trace, /inline-flex w-fit max-w-full min-w-0/);
    assert.match(trace, /label === entry\.title/);
    assert.match(runtime, /state\.event\.text = state\.text/);
    assert.match(runtime, /title: "Reasoning"/);
    assert.match(interact, /splitReasoningSegments\(fallbackText\.process\)/);
    assert.match(interact, /pushFallbackReasoning\(\)/);
    assert.doesNotMatch(runtime, /Model reasoning stream/);
  });
});
