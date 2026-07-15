import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const flowWorkspaceSource = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
const rendererStylesSource = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
const asideThreadSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AsideThreadSurface.tsx", import.meta.url)),
  "utf8",
);
const flowChatStylesSource = readFileSync(fileURLToPath(new URL("./flowChatStyles.ts", import.meta.url)), "utf8");

describe("FlowWorkspace task lifecycle rendering", () => {
  it("renders failed practice-task drafts without a persistent creating spinner", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /const failed = !ready && status === "error"/);
    assert.match(source, /Task failed/);
    assert.match(source, /failed \?\s*\(?\s*<CircleAlertIcon size=\{isPanel \? 13 : 14\} \/>\s*\)?\s*:\s*status === "running" \?\s*\(?\s*<Loader2Icon size=\{isPanel \? 13 : 14\} className="animate-spin" \/>\s*\)?\s*:\s*\(?\s*<TerminalIcon size=\{isPanel \? 13 : 14\} \/>\s*\)?/);
  });

  it("keeps terminal sessions authoritative over stale live thinking snapshots", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /const existingSession = sessionsRef\.current\.find\(\(session\) => session\.id === event\.session\.id\);/);
    assert.match(source, /if \(existingSession && isTerminalFlowSession\(existingSession\)\) \{\s*setLiveSession\(\(current\) => current\?\.id === event\.session\.id \? undefined : current\);\s*return;\s*\}/);
    assert.match(source, /if \(existingSession && isTerminalFlowSession\(existingSession\) && !isTerminalFlowSession\(liveSession\)\) \{\s*return sessions;\s*\}/);
  });

  it("keeps task submission review clean and subtask-scoped", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /Please review subtask \$\{subtaskIndex \+ 1\}\/\$\{subtaskCount\}: \$\{subtask\.title\}\./);
    assert.match(source, /Submit \{index \+ 1\}\/\{task\.subtasks\?\.length \?\? 1\}/);
    assert.match(source, /The Construct agent will inspect the workspace, run validation when useful, and review the requested task evidence\./);
    assert.doesNotMatch(source, /<span className="mb-1 block font-medium">Changes<\/span>/);
  });

  it("uses semantic question payload flags for code defaults, skipping, and hidden materials", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /setDraft\(activeQuestion\?\.payload\.initialAnswer \?\? ""\)/);
    assert.match(source, /hideLearningMaterials/);
    assert.match(source, /allowSkip: typeof source\.allowSkip === "boolean" \? source\.allowSkip : false/);
    assert.match(source, /data-learning-materials-hidden=\{learningMaterialsHidden \? "true" : undefined\}/);
  });

  it("keeps Construct task and concept state inside the Aside thread contract", () => {
    assert.match(flowWorkspaceSource, /data-construct-flow-chat="true"/);
    assert.match(flowWorkspaceSource, /data-flow-surface="concept-card"/);
    assert.match(flowWorkspaceSource, /data-flow-surface="concept-exercise"/);
    assert.match(flowWorkspaceSource, /id: `\$\{sessionId\}:task:\$\{eventId\}`/);
    assert.match(flowWorkspaceSource, /<AsideThreadSurface/);
    assert.match(flowWorkspaceSource, /activePanel=\{activeComposerItem[\s\S]*<ActiveComposerItemIndicator[\s\S]*isHeader/);
    assert.match(flowWorkspaceSource, /<AsideThreadComposer/);
    assert.match(flowWorkspaceSource, /leadingAction=\{[\s\S]*aria-label="Open project map"/);
    assert.match(flowWorkspaceSource, /Full access/);
    assert.match(flowWorkspaceSource, /onProviderChange=\{updateProvider\}/);
    assert.doesNotMatch(flowWorkspaceSource, /<AgentSessionSurface/);
    assert.doesNotMatch(flowWorkspaceSource, /<AgentSessionComposer/);
    assert.match(asideThreadSource, /data-agent-session-ui="aside-thread"/);
    assert.match(asideThreadSource, /data-component="aside-agent-session-panel"/);
    assert.match(asideThreadSource, /data-chat-input-form="true"/);
    assert.match(asideThreadSource, /max-w-\[95%\]/);
    assert.match(asideThreadSource, /rounded-xl bg-secondary px-3 py-1\.5/);
    assert.match(asideThreadSource, /function AsideProcessItem/);
    assert.match(asideThreadSource, /--agent-session-panel-overlay-height/);
    assert.match(flowChatStylesSource, /max-w-full/);
    assert.match(flowChatStylesSource, /bg-secondary\/55/);
    assert.match(rendererStylesSource, /\.construct-flow-chat-stage/);
    assert.match(rendererStylesSource, /\.construct-flow-session:not\(\[data-aside-thread-ui="true"\]\) textarea/);
  });
});
