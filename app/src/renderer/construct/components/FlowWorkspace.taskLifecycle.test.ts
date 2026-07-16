import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const flowWorkspaceSource = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
const asideHostSource = readFileSync(fileURLToPath(new URL("./AsideConstructThread.tsx", import.meta.url)), "utf8");
const asideProtocolSource = readFileSync(fileURLToPath(new URL("./asideThreadProtocol.ts", import.meta.url)), "utf8");
const asideEntrySource = readFileSync(
  fileURLToPath(new URL("../../../../public/aside-thread/main.html", import.meta.url)),
  "utf8",
);
const asideShimSource = readFileSync(
  fileURLToPath(new URL("../../../../public/aside-thread/construct-runtime-shim.js", import.meta.url)),
  "utf8",
);
const asideToolRendererSource = readFileSync(
  fileURLToPath(new URL("../../../../public/aside-thread/assets/tool-renderer-Bj91yJjw.js", import.meta.url)),
  "utf8",
);
const asideGlobalsSource = readFileSync(
  fileURLToPath(new URL("../../../../public/aside-thread/assets/globals-BWsjXQ4T.css", import.meta.url)),
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

    assert.match(source, /hideLearningMaterials/);
    assert.match(source, /allowSkip: typeof source\.allowSkip === "boolean" \? source\.allowSkip : false/);
    assert.match(source, /data-learning-materials-hidden=\{learningMaterialsHidden \? "true" : undefined\}/);
    assert.match(asideHostSource, /const pendingQuestion = findPendingQuestion/);
    assert.match(asideHostSource, /questionResponse:/);
    assert.match(asideProtocolSource, /questions: activeQuestion\.questions/);
  });

  it("mounts the compiled thread application while keeping Construct's domain bridge", () => {
    assert.match(flowWorkspaceSource, /<AsideConstructThread/);
    assert.match(flowWorkspaceSource, /onProviderChange=\{updateProvider\}/);
    assert.match(asideHostSource, /aside-thread\/main\.html/);
    assert.match(asideHostSource, /constructBridge/);
    assert.match(asideHostSource, /buildAsideSession/);
    assert.match(asideHostSource, /buildAsideMessages/);
    assert.match(asideHostSource, /descriptor\.kind !== "session-subscription"/);
    assert.match(asideHostSource, /\{ op: "update", session \}/);
    assert.match(asideHostSource, /op: "snapshot"/);
    assert.match(asideHostSource, /new AsideRunProjector/);
    assert.match(asideHostSource, /await latest\.onRunAgent\(message, options\)/);
    assert.match(asideEntrySource, /extension-main-BQoDRRY7\.js/);
    assert.match(asideEntrySource, /construct-runtime-shim\.js/);
    assert.match(asideGlobalsSource, /url\(\.\/geist-latin-wght-normal-Dm3htQBi\.woff2\)/);
    assert.match(asideGlobalsSource, /url\(\.\/AsideDisplay-Variable-LuohODSt\.woff2\)/);
    assert.doesNotMatch(asideGlobalsSource, /url\(\/assets\//);
    assert.match(asideShimSource, /construct-aside-bridge:v1/);
    assert.match(asideShimSource, /result: \{ data: values\[index\] \}/);
    assert.match(asideShimSource, /aria-label="Open in tab"/);
    assert.match(asideShimSource, /aria-label="Close side panel"/);
    assert.match(asideShimSource, /chat-maximize/);
    assert.match(asideShimSource, /chat-panel/);
    assert.match(asideShimSource, /chat-close/);
    assert.match(asideHostSource, /latest\.onChatMaximize\(\)/);
    assert.match(asideHostSource, /latest\.onChatPanel\(\)/);
    assert.match(asideHostSource, /latest\.onChatClose\(\)/);
    assert.match(asideToolRendererSource, /construct_concept:ConstructConceptRenderer/);
    assert.match(asideToolRendererSource, /construct_practice_task:ConstructTaskRenderer/);
    assert.match(asideToolRendererSource, /construct_concept_exercise:ConstructExerciseRenderer/);
  });
});
