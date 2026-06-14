import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct Interact Codex-style UI", () => {
  it("uses an unboxed conversation surface with durable, genuine agent traces", () => {
    const source = readFileSync(fileURLToPath(new URL("./guide/ConstructInteractSession.tsx", import.meta.url)), "utf8");
    assert.match(source, /const recentSessions = sessions;/);
    assert.match(source, /emptyState=\{null\}/);
    assert.match(source, /session\.agentEvents/);
    assert.match(source, /result\?\.agentEvents/);
    assert.match(source, /<AgentRunTrace/);
    assert.match(source, /buildPendingAgentRunTraceEntries/);
    assert.match(source, /output: event\.outputPreview/);
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

  it("renders a compact expandable trace with distinct thought and tool rows", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentRunTrace.tsx", import.meta.url)), "utf8");
    assert.match(source, /Thought for/);
    assert.match(source, /opaline-agent-thinking-shimmer/);
    assert.match(source, /data-slot="agent-run-trace-entry"/);
    assert.match(source, /TraceDetail label="Input"/);
    assert.match(source, /TraceDetail label="Result"/);
    assert.match(source, /border-l border-border/);
  });
});
