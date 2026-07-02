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
    assert.match(source, /rounded-\[18px\]/);
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
    assert.match(source, /opaline-slot-panel-empty-watermark/);
    assert.doesNotMatch(source, /No tabs open/);
    assert.doesNotMatch(source, /Open a file from the sidebar to get started/);
  });

  it("keeps Flow projects inside the same file-tab shell without a sidebar knowledge block", () => {
    const flow = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
    const app = readFileSync(fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)), "utf8");
    const slotPanel = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/slot-panel/SlotPanel.tsx", import.meta.url)), "utf8");

    assert.match(flow, /createDocumentSession\(project\.activeFilePath\)/);
    assert.match(flow, /const editorSlotTabs: SlotTab\[\] = useMemo/);
    assert.match(flow, /<SlotPanel/);
    assert.match(flow, /ariaLabel="Editor file tabs"/);
    assert.match(flow, /onKnowledgePanelChange\?\.\(null\)/);
    assert.doesNotMatch(flow, /<SidebarBottomSlot/);
    assert.match(flow, /collectFlowConcepts/);
    assert.match(app, /onKnowledgePanelChange=\{setSidebarKnowledgePanel\}/);
    assert.match(app, /sidebarKnowledgePanel && !isFlowProjectRecord\(activeProject\)/);
    assert.match(slotPanel, /rounded-\[8px\]/);
    assert.match(slotPanel, /data-\[state=active\]:bg-muted/);
    assert.doesNotMatch(slotPanel, /after:bg-primary/);
  });

  it("uses the Opaline adaptive sidecar rewrite with deterministic collapse animation", () => {
    const sidecar = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/adaptive-sidecar/AdaptiveSidecar.tsx", import.meta.url)), "utf8");

    assert.match(sidecar, /AnimatePresence initial=\{false\}/);
    assert.match(sidecar, /className=\{cn\([\s\S]*opaline-overlay-shadow/);
    assert.match(sidecar, /aria-expanded=\{!collapsed\}/);
    assert.match(sidecar, /key="opaline-sidecar-body"/);
    assert.match(sidecar, /exit=\{\{ height: 0, opacity: 0 \}\}/);
    assert.match(sidecar, /clampSidecarWidth/);
    assert.doesNotMatch(sidecar, /flexGrow: collapsed/);
    assert.doesNotMatch(sidecar, /scale: open \? 1 : 0\.8/);
  });

  it("renders Opaline concept cards directly inside Flow chat and routes active-task messages through the main composer", () => {
    const flow = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
    const conceptCard = readFileSync(fileURLToPath(new URL("./ConceptSummaryCard.tsx", import.meta.url)), "utf8");
    const css = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");

    assert.match(conceptCard, /rounded-\[8px\] border border-border\/70 bg-card\/82/);
    assert.match(conceptCard, /if \(concept\.language === "swift"\) return "Swift";/);
    assert.match(conceptCard, /if \(concept\.language === "typescript"\) return "TypeScript";/);
    assert.match(conceptCard, /concept\.technology \? <ConceptChip label=\{concept\.technology\} \/> : null/);
    assert.match(flow, /language: readConceptLanguage/);
    assert.match(flow, /technology: readString\(conceptObj\.technology\) \?\? readString\(inputObj\.technology\) \?\? readString\(outputObj\.technology\)/);
    assert.match(flow, /<ConceptSummaryCard[\s\S]*variant="chat"/);
    assert.match(flow, /taskMessage: \{ taskId: activeTask\.id, pathNodeId: activeTask\.pathNodeId \}/);
    assert.match(flow, /placeholder=\{activeTask \? `Message Flow about: \$\{activeTask\.title\}`/);
    assert.match(flow, /<ActiveComposerItemIndicator\s+activeItem=\{activeComposerItem\}/);
    assert.match(flow, /onOpenFile=\{onOpenFile\}/);
    assert.match(flow, /function FlowFileChip/);
    assert.match(flow, /createInlineFileReference/);
    assert.match(flow, /flowMemoryFilePath/);
    assert.match(flow, /<FlowMemoryUpdateCard results=\{results\} onOpenFile=\{onOpenFile\}/);
    assert.match(flow, /<MarkdownBlock content=\{event\.text\} theme=\{theme\} sources=\{session\.citations\} onOpenConcept=\{onOpenConceptById\} onOpenFile=\{onOpenFile\}/);
    assert.match(css, /construct-concept-card-shimmer/);
    assert.match(css, /conic-gradient\(/);
    assert.match(css, /mask-composite: exclude/);
    assert.match(css, /-webkit-mask-composite: xor/);
    assert.doesNotMatch(css, /construct-concept-profile-card/);
    assert.match(css, /\.construct-floating-task-card/);
    assert.match(css, /grid-template-rows 620ms cubic-bezier/);
    assert.match(css, /\.construct-flow-accordion__content/);
  });

  it("renders a compact expandable trace with distinct thought and tool rows", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentRunTrace.tsx", import.meta.url)), "utf8");
    assert.match(source, /Working/);
    assert.match(source, /traceGroupLabel/);
    assert.match(source, /return "Read";/);
    assert.match(source, /Ran command/);
    assert.match(source, /AgentRunCommandRow/);
    assert.match(source, /readCommandRun/);
    assert.match(source, /Command failed/);
    assert.match(source, /Success/);
    assert.match(source, /max-h-72 overflow-auto/);
    assert.match(source, /animate-in fade-in-0 slide-in-from-top-1/);
    assert.match(source, /slide-in-from-left-1/);
    assert.match(source, /opaline-agent-thinking-shimmer/);
    assert.match(source, /data-slot="agent-run-trace-entry"/);
    assert.match(source, /TraceDetail label="Input"/);
    assert.match(source, /TraceDetail label="Result"/);
    const surface = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionSurface.tsx", import.meta.url)), "utf8");
    assert.match(surface, /className="pl-1 pr-1"/);
    assert.doesNotMatch(source, /Thought for/);
  });

  it("exposes compact trace rows as ordered assistant activity parts", () => {
    const types = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/types.ts", import.meta.url)), "utf8");
    const primitives = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionPrimitives.tsx", import.meta.url)), "utf8");
    const flow = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
    assert.match(types, /type: "activity"/);
    assert.match(types, /onOpenFile\?: \(path: string\) => void/);
    assert.match(primitives, /data-component="activity-part"/);
    assert.match(primitives, /<AgentRunTraceRow entry=\{part\.entry\} defaultOpen=\{part\.defaultOpen\} onOpenFile=\{part\.onOpenFile\}/);
    assert.match(types, /footerStart\?: ReactNode/);
    assert.match(flow, /<FlowComposerControls/);
    assert.match(flow, /FlowContextMeter/);
    assert.match(flow, /FlowModelDropdown/);
    assert.match(flow, /"construct-flow": model/);
    assert.match(flow, /collectAnsweredQuestionKeys/);
    assert.match(flow, /answeredQuestionKeys\.has\(questionKey\(session\.id, candidate\.id\)\)/);
    assert.match(flow, /buildFlowAgentParts/);
    assert.match(flow, /flowTimelineParts\(session\)/);
    assert.match(flow, /shouldHideFlowTimelinePart\(session, rawEvent\)/);
    assert.match(flow, /part\.kind !== "reasoning"/);
    assert.match(flow, /session\.status !== "running"/);
    assert.match(flow, /settleFlowTimelinePartForSession\(session, rawEvent\)/);
    assert.match(flow, /session\.timeline/);
    assert.match(flow, /toolCallsById/);
    assert.match(flow, /findPendingLearnerQuestion\(session\)/);
    assert.match(flow, /isDuplicateQuestionProse\(event\.text, pendingQuestion\)/);
    assert.match(flow, /questionToolCall\?\.response/);
    assert.match(flow, /return parts\.sort\(compareTimelineParts\)/);
    assert.match(flow, /type: "activity"/);
    assert.match(flow, /onOpenFile: \(path\) => onOpenFile\(createInlineFileReference\(path\)\)/);
    assert.match(flow, /findActiveFlowQuestion\(mergedSessions\)/);
    assert.match(flow, /<FlowQuestionComposer/);
    assert.match(flow, /questionResponse/);
    assert.match(flow, /markQuestionAnswered/);
    assert.match(flow, /session\.origin === "question-response"/);
    assert.match(flow, /setPending\(false\);\s*setLiveSession\(undefined\);/);
    assert.match(flow, /pending=\{pending && !activeQuestion\}/);
    assert.match(flow, /Custom answer/);
    assert.match(flow, /Type your answer/);
    assert.match(flow, /CornerDownLeftIcon/);
    assert.doesNotMatch(flow, /FlowComposerWithTransition/);
    assert.doesNotMatch(flow, /construct-flow-composer-question-accordion/);
    assert.doesNotMatch(flow, /Flow needs an answer/);
    assert.doesNotMatch(flow, /splitReasoningSegments\(fallbackText\.process\)/);
    assert.doesNotMatch(flow, /pushFallbackReasoning\(\)/);
    assert.doesNotMatch(flow, /Answer to question:/);
    assert.doesNotMatch(flow, /Skipped question:/);
    assert.doesNotMatch(flow, /payload\.reason \?/);
    assert.doesNotMatch(flow, /toolCallToFlowTraceEntry/);
    assert.doesNotMatch(flow, /seenToolNames/);
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
    assert.match(runtime, /title: "Thinking"/);
    assert.match(interact, /splitReasoningSegments\(fallbackText\.process\)/);
    assert.match(interact, /pushFallbackReasoning\(\)/);
    assert.doesNotMatch(runtime, /Model reasoning stream/);
  });
});
