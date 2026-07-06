import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const workspaceSource = readFileSync(fileURLToPath(new URL("./Workspace.tsx", import.meta.url)), "utf8");
const flowWorkspaceSource = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
const fileTreeSource = readFileSync(fileURLToPath(new URL("./FileTree.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)), "utf8");
const slotPanelSource = readFileSync(fileURLToPath(new URL("../../../../../opaline/packages/ui/src/slot-panel/SlotPanel.tsx", import.meta.url)), "utf8");
const projectIpcSource = readFileSync(fileURLToPath(new URL("../../../main/ipc/ConstructProjectIpcController.ts", import.meta.url)), "utf8");
const bridgeSource = readFileSync(fileURLToPath(new URL("../lib/tauriBridge.ts", import.meta.url)), "utf8");
const flowMemorySource = readFileSync(fileURLToPath(new URL("../../../main/flow/ConstructFlowMemoryService.ts", import.meta.url)), "utf8");

describe("Workspace render stability", () => {
  it("uses stable empty arrays for optional project data read during render", () => {
    assert.match(workspaceSource, /const EMPTY_CONCEPTS: ConceptCard\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_GENERATED_LIVE_STEPS: GeneratedLiveStep\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_GIT_MILESTONES: GitMilestone\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_REFERENCE_CARDS: ReferenceCardData\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_TARGETS: ConstructTarget\[\] = \[\];/);

    assert.doesNotMatch(workspaceSource, /project\.program\.(?:concepts|gitMilestones|references|targets)\s*\?\?\s*\[\]/);
    assert.doesNotMatch(workspaceSource, /projectLearningState\?\.generatedLiveSteps\s*\?\?\s*\[\]/);
  });

  it("keeps parent callback effects from retriggering on every project render", () => {
    assert.match(appSource, /const handleWorkspaceTreeChange = useCallback/);
    assert.match(appSource, /onTreeChange=\{handleWorkspaceTreeChange\}/);
    assert.doesNotMatch(appSource, /onTreeChange=\{\(tree, activePath, relevantPath/);
    assert.match(workspaceSource, /\[tree, activeFilePath, relevantPath, onTreeChange\]/);

    const guideMemo = workspaceSource.match(/const guideTabContent = useMemo\([\s\S]*?\n  \), \[([^\]]*)\]\);/);
    assert.ok(guideMemo, "expected guide tab content memo dependency list");
    assert.doesNotMatch(guideMemo[1], /generatedLiveSteps/);
  });

  it("keeps controlled file tabs from correcting to stale tab state", () => {
    assert.match(slotPanelSource, /const incomingTabIds = useMemo/);
    assert.match(slotPanelSource, /if \(syncTabs && incomingTabIds\.has\(activeTabId\)\)/);
    assert.match(slotPanelSource, /if \(id === activeTabId\)/);

    assert.match(flowWorkspaceSource, /const openFileSequenceRef = useRef\(0\)/);
    assert.match(flowWorkspaceSource, /projectActiveFilePathRef/);
    assert.match(flowWorkspaceSource, /openFileSequenceRef\.current === sequence/);
    assert.doesNotMatch(flowWorkspaceSource, /\[project\.activeFilePath, refreshTree\]/);
  });

  it("does not auto-advance after an agent response", () => {
    assert.doesNotMatch(workspaceSource, /if \(result\.shouldAdvance[^}]+await handleNext\(\)/s);
  });

  it("opens generated live-step actions in the visible Guide tab", () => {
    const source = readFileSync(fileURLToPath(new URL("./Workspace.tsx", import.meta.url)), "utf8");
    assert.match(source, /function openGeneratedLiveStep\(stepId: string\)/);
    assert.match(source, /setActiveLiveStepId\(stepId\);\s*onRightSlotChange\("guide"\);/);
    assert.match(source, /onSelectLiveStep=\{openGeneratedLiveStep\}/);
    assert.match(source, /openGeneratedLiveStep\(firstStepId\)/);
  });

  it("refreshes the active Flow project map without a broad project list refresh", () => {
    assert.match(appSource, /async function refreshActiveProjectSnapshot\(projectId: string\)/);
    assert.match(appSource, /const project = await openSavedProject\(projectId\);/);
    assert.match(appSource, /setActiveProject\(\(current\) => current\?\.id === projectId \? project : current\);/);
    assert.match(appSource, /setProjects\(\(current\) => upsertProjectSummary\(current, projectSummaryFromRecord\(project\)\)\);/);
    assert.doesNotMatch(appSource, /openSavedProject\(projectId\),\s*bootstrapProjects\(\)/s);
    assert.match(appSource, /const refreshed = await refreshActiveProjectSnapshot\(activeProject\.id\);/);
    assert.match(appSource, /if \(!refreshed\) return;\s*state\.setRightPanelOpen\(true\);/);
  });

  it("drives Flow chat layout from project, file, and task state changes", () => {
    assert.match(appSource, /const \[rightPanelOpen, setRightPanelOpen\] = useState\(false\);/);
    assert.match(appSource, /const \[sidebarOpen, setSidebarOpen\] = useState\(true\);/);
    assert.match(appSource, /const pendingImmersiveFlowProjectIdsRef = useRef<Set<string>>\(new Set\(\)\);/);
    assert.match(appSource, /pendingImmersiveFlowProjectIdsRef\.current\.delete\(nextProject\.id\)/);
    assert.match(appSource, /const PROJECT_SHELL_UI_STATE_KEY = "project\.shell";/);
    assert.match(appSource, /const savedProjectShellState = shouldStartImmersive[\s\S]*await readProjectShellUiState\(nextProject\.id\);/);
    assert.match(appSource, /applyProjectShellUiState\(savedProjectShellState \?\? defaultProjectShellUiState\(\{/);
    assert.match(appSource, /const handleFlowLayoutRequest = useCallback\(\(request: FlowLayoutRequest\)/);
    assert.match(appSource, /if \(request\.kind === "maximized-chat"\)[\s\S]*setInspectorExpanded\(true\);[\s\S]*setSidebarOpen\(request\.reason !== "project-created"\);/);
    assert.match(appSource, /setInspectorExpanded\(false\);\s*setSidebarOpen\(true\);/);
    assert.match(appSource, /const expandFlowChat = useCallback\(\(shellState: AppShellState\)/);
    assert.match(appSource, /window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame/s);
    assert.match(appSource, /expandFlowChat\(state\);/);
    assert.match(appSource, /chatMode=\{rightPanelOpen && inspectorExpanded && flowPanelView === "chat" \? "maximized" : "panel"\}/);
    assert.match(appSource, /onLayoutRequest=\{handleFlowLayoutRequest\}/);
    assert.match(appSource, /if \(isFlowProjectRecord\(project\)\) \{\s*pendingImmersiveFlowProjectIdsRef\.current\.add\(project\.id\);\s*handleFlowLayoutRequest\(\{ kind: "maximized-chat", reason: "project-created" \}\);/);

    assert.match(flowWorkspaceSource, /export type FlowLayoutRequest/);
    assert.match(flowWorkspaceSource, /requestWorkbenchLayout\("file-system-change"\)/);
    assert.match(flowWorkspaceSource, /requestWorkbenchLayout\("task-created"\)/);
    assert.match(flowWorkspaceSource, /construct-flow-chat-concept-dock/);
    assert.match(flowWorkspaceSource, /chatOwnsConceptCard = activePanelView === "chat" && chatMode === "maximized"/);
  });

  it("starts on the dashboard while restoring project layout only when a project opens", () => {
    assert.doesNotMatch(appSource, /activeProjectId/);
    assert.doesNotMatch(appSource, /await openProject\(shellState\.activeProjectId/);
    assert.match(appSource, /showDashboardSurface\(\{ recordHistory: false \}\);/);
    assert.match(appSource, /scope: "workspace",\s*projectId,\s*value: state/s);
    assert.match(appSource, /key: PROJECT_SHELL_UI_STATE_KEY,\s*scope: "workspace",\s*projectId,\s*fallback: null/s);
  });

  it("keeps home prompt creation and shell history project-aware", () => {
    assert.match(appSource, /async function createProjectFromHomePrompt\(prompt: string\)/);
    assert.match(appSource, /researchFirst: true/);
    assert.match(appSource, /onCreateProjectFromPrompt=\{createProjectFromHomePrompt\}/);
    assert.doesNotMatch(appSource, /NewProjectDialog/);
    assert.match(appSource, /const originProjectId = projectId \?\? activeProject\?\.id/);
    assert.match(appSource, /payload: \{ projectId: originProjectId, settingsItemId: itemId \}/);
    assert.match(appSource, /payload: \{ projectId: originProjectId \}/);
    assert.match(appSource, /setSettingsSurface\(null\);\s*showDashboardSurface\(\{ recordHistory: false \}\);/s);
    assert.match(appSource, /void openProject\(projectId, \{ recordHistory: false \}\)\.then\(\(\) => \{/);
  });

  it("persists expanded project sidebar folders", () => {
    assert.match(fileTreeSource, /expandedPaths: persistedExpandedPaths/);
    assert.match(fileTreeSource, /onExpandedPathsChange\?: \(paths: string\[\]\) => void/);
    assert.match(fileTreeSource, /onExpandedPathsChange\?\.\(expandedPathList\(next\)\)/);
    assert.match(appSource, /const handleFileTreeExpandedChange = useCallback/);
    assert.match(appSource, /patch: \{ fileTreeExpanded: normalized \}/);
    assert.match(appSource, /expandedPaths=\{activeProject\.fileTreeExpanded\}/);
    assert.match(appSource, /onExpandedPathsChange=\{handleFileTreeExpandedChange\}/);
  });

  it("keeps Flow Memory writes from collapsing immersive chat", () => {
    assert.match(projectIpcSource, /const relativePath = typeof filename === "string" \? filename\.replace/);
    assert.match(projectIpcSource, /webContents\.send\("construct:project:file-changed", \{/);
    assert.match(projectIpcSource, /paths/);
    assert.match(bridgeSource, /callback\(payload \?\? \{\}\)/);

    assert.match(flowWorkspaceSource, /function isOnlyFlowMemoryChange\(payload: ProjectFileChangePayload\)/);
    assert.match(flowWorkspaceSource, /if \(!isOnlyFlowMemoryChange\(payload\)\) \{\s*requestWorkbenchLayout\("file-system-change"\);/);
    assert.match(flowWorkspaceSource, /FLOW_MEMORY_FILE_NAMES = new Set\(\["research\.md", "project\.md", "path\.md", "learner\.md"\]\)/);

    assert.match(flowMemorySource, /export const FLOW_MEMORY_DIRECTORY = "\.construct" as const;/);
    assert.match(flowMemorySource, /export const LEGACY_FLOW_MEMORY_DIRECTORY = "\.construct\/flow-memory" as const;/);
    assert.match(flowMemorySource, /legacyMemoryFilePath/);
    assert.match(flowWorkspaceSource, /return `\.construct\/\$\{file\}`;/);
    assert.doesNotMatch(flowWorkspaceSource, /return `\.construct\/flow-memory\/\$\{file\}`;/);
  });
});
