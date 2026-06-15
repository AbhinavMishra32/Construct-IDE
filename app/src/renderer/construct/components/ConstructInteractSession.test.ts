import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct Interact Codex-style UI", () => {
  it("uses an unboxed conversation surface with live-only agent activity", () => {
    const source = readFileSync(fileURLToPath(new URL("./guide/ConstructInteractSession.tsx", import.meta.url)), "utf8");
    assert.match(source, /const recentSessions = mergeSessions\(sessions, liveSession\);/);
    assert.match(source, /className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"/);
    assert.match(source, /emptyState=\{null\}/);
    assert.match(source, /session\.agentEvents/);
    assert.match(source, /const completedEvents = isLatestResult/);
    assert.match(source, /result\?\.agentEvents/);
    assert.match(source, /\(isLiveSession \? \(session\.agentEvents \?\? \[\]\) : completedEvents\)/);
    assert.match(source, /\.filter\(\(event\) => event\.type !== "message" && event\.type !== "iteration"\)/);
    assert.match(source, /if \(tracePart\)[\s\S]*assistantParts\.push\(tracePart\);[\s\S]*if \(session\.reply\.trim\(\)\)/);
    assert.match(source, /title: event\.type === "reasoning" \? "Analyzing request" : event\.title/);
    assert.match(source, /event\.status === "completed" \? undefined : event\.detail/);
    assert.match(source, /events\.filter\(\(event\) => event\.type !== "iteration"\)/);
    assert.match(source, /liveSession\?: ConstructInteractSessionRecord/);
    assert.match(source, /<AgentRunTrace/);
    assert.match(source, /entries=\{\[\]\}/);
    assert.match(source, /buildAgentRunTraceEntries\(events, toolCalls, isLiveSession\)/);
    assert.match(source, /title: "Continuing"/);
    assert.match(source, /construct-interact-streaming-reply/);
    assert.match(source, /meta: !isLiveSession && session\.assessment/);
    assert.match(source, /title: "Dynamic Steps"/);
    assert.match(source, /output: event\.outputPreview/);
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
});
