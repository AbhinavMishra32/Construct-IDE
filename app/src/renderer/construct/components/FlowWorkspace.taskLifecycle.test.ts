import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const flowWorkspaceSource = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
const rendererStylesSource = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
const agentSessionSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionSurface.tsx", import.meta.url)),
  "utf8",
);

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

  it("keeps Construct task and concept state inside the source chat contract", () => {
    assert.match(flowWorkspaceSource, /data-construct-flow-chat="true"/);
    assert.match(flowWorkspaceSource, /data-flow-surface="concept-card"/);
    assert.match(flowWorkspaceSource, /data-flow-surface="concept-exercise"/);
    assert.match(flowWorkspaceSource, /id: `\$\{sessionId\}:task:\$\{eventId\}`/);
    assert.match(flowWorkspaceSource, /Full access[\s\S]*<ActiveComposerItemIndicator/);
    assert.match(flowWorkspaceSource, /onProviderChange=\{updateProvider\}/);
    assert.match(agentSessionSource, /data-chat-transcript-pane="true"/);
    assert.match(agentSessionSource, /max-w-\[46rem\]/);
    assert.match(agentSessionSource, /relative z-10 -mt-5/);
    assert.match(agentSessionSource, /chat-composer-stacked-top/);
    assert.match(agentSessionSource, /data-chat-composer-form="true"/);
    assert.match(rendererStylesSource, /background: var\(--app-user-message-background\)/);
    assert.match(rendererStylesSource, /background: var\(--color-background-elevated-secondary\)/);
  });
});
