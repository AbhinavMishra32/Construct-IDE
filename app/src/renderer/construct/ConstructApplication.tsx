import { AppErrorBoundary } from "./AppErrorBoundary";
import { ConstructSettingsSurface, buildSettingsSections, settingsTitle } from "./ConstructSettingsSurface";
import { LearningContextSurface } from "./LearningContextSurface";
import { HeaderBottomPanelIcon, HeaderGuidePanelIcon, SavingIndicator, SidebarLearningButton, SidebarSettingsButton } from "./ShellControls";
import { applyDocumentTheme, getInitialTheme, resolveActiveTheme, type ThemeMode } from "./theme";
import { useConstructLogBridge } from "./lib/useConstructLogBridge";
import { useProjectLspLifecycle } from "./lib/useProjectLspLifecycle";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  FileTerminalIcon,
  FileTextIcon,
  MessageCircleIcon,
  Plus as PlusIcon
} from "lucide-react";
import { Notebook } from "@phosphor-icons/react";

import {
  AppShell,
  AppShellChromeButton,
  AppShellHeaderToolButton,
  Badge,
  BottomPanel,
  Button,
  Sidebar,
  SettingsSidebar,
  useShellHistory
} from "@opaline/ui";
import type { SettingsNavItem, ShellHistoryEntry } from "@opaline/ui";

import { Dashboard } from "./components/Dashboard";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { FileTree } from "./components/FileTree";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import { LogsPanel } from "./components/LogsPanel";
import { KnowledgeBaseSurface } from "./components/KnowledgeBaseSurface";
import { SelectionExplanationController } from "./components/SelectionExplanationController";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import {
  setThemeSource,
  updateProject
} from "./lib/bridge";
import type { ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";
import { currentBlock, currentBlockNumber, totalBlocks, nextPosition } from "./lib/runtime";

type ConstructHistoryEntry = ShellHistoryEntry<
  "bottom-tab" | "dashboard" | "file" | "knowledge-base" | "learner-context" | "project" | "project-settings" | "right-slot" | "settings",
  {
    filePath?: string;
    projectId?: string;
    settingsItemId?: string;
    slotId?: string;
    tabId?: string;
  }
>;

type SettingsSurfaceState = {
  itemId: string;
  projectId?: string;
};

function rightSlotTitle(slotId: string): string {
  if (slotId === "steps") return "Steps";
  if (slotId === "interact") return "Interact";
  if (slotId === "git") return "Git";
  return "Guide";
}

export default function ConstructApp() {
  const history = useShellHistory<ConstructHistoryEntry>([
    { id: "dashboard", title: "Projects", type: "dashboard" }
  ]);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [sidebarKnowledgePanel, setSidebarKnowledgePanel] = useState<ReactNode | null>(null);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
  const [learningContextOpen, setLearningContextOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [settingsSurface, setSettingsSurface] = useState<SettingsSurfaceState | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeRightSlotId, setActiveRightSlotId] = useState("guide");
  const [activeBottomTabId, setActiveBottomTabId] = useState("terminal");
  const [openBottomTabIds, setOpenBottomTabIds] = useState<string[]>(["terminal", "logs"]);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const applyingHistoryRef = useRef(false);
  const [treeData, setTreeData] = useState<{
    tree: WorkspaceTreeNode[];
    activePath: string | null;
    relevantPath: string | null;
    openFile: ((path: string) => void) | null;
    createFile: ((path: string) => void) | null;
    deleteFile: ((path: string) => Promise<void>) | null;
    renameFile: ((oldPath: string, newPath: string) => Promise<void>) | null;
    createFolder: ((path: string) => Promise<void>) | null;
    duplicateFile: ((path: string, destPath: string) => Promise<void>) | null;
  }>({
    tree: [],
    activePath: null,
    relevantPath: null,
    openFile: null,
    createFile: null,
    deleteFile: null,
    renameFile: null,
    createFolder: null,
    duplicateFile: null
  });

  useConstructLogBridge();
  useProjectLspLifecycle(activeProject);

  const { furthestUnlockedStepIndex, furthestUnlockedBlockIndex } = useMemo(() => {
    if (!activeProject) return { furthestUnlockedStepIndex: 0, furthestUnlockedBlockIndex: 0 };
    const completedBlocks = activeProject.completedBlocks ?? {};
    const steps = activeProject.program.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      for (let j = 0; j < step.blocks.length; j++) {
        if (!completedBlocks[step.blocks[j].id]) {
          return { furthestUnlockedStepIndex: i, furthestUnlockedBlockIndex: j };
        }
      }
    }
    const lastStepIdx = steps.length - 1;
    const lastBlockIdx = Math.max(0, (steps[lastStepIdx]?.blocks.length ?? 1) - 1);
    return { furthestUnlockedStepIndex: lastStepIdx, furthestUnlockedBlockIndex: lastBlockIdx };
  }, [activeProject]);

  const canContinue = useMemo(() => {
    if (!activeProject) return false;
    const block = currentBlock(activeProject);
    if (!block) return false;

    const typingProgress = activeProject.typingProgress ?? {};
    const verificationResults = activeProject.verificationResults ?? {};

    const activeEdit = block.kind === "edit" ? block : null;
    const editProgress = activeEdit ? typingProgress[activeEdit.id] ?? 0 : 0;
    const editComplete = activeEdit ? editProgress >= activeEdit.content.length : false;

    const verification = block.kind === "recall" && block.verify
      ? verificationResults[block.verify.id]
      : undefined;

    return (
      (block.kind !== "edit" || editComplete) &&
      (block.kind !== "recall" || !block.verify || verification?.passed === true)
    );
  }, [activeProject]);

  const isAtEnd = useMemo(() => {
    if (!activeProject) return true;
    const steps = activeProject.program.steps;
    const lastStepIdx = steps.length - 1;
    const lastStep = steps[lastStepIdx];
    return (
      activeProject.currentStepIndex === lastStepIdx &&
      activeProject.currentBlockIndex === Math.max(0, (lastStep?.blocks.length ?? 1) - 1)
    );
  }, [activeProject]);

  async function persistProjectState(patch: Partial<ProjectRecord>) {
    if (!activeProject) return;
    try {
      const updated = await updateProject({
        id: activeProject.id,
        patch
      });
      setActiveProject(updated);
    } catch (caught) {
      console.error("[construct] update project failed", { id: activeProject.id, patch, caught });
    }
  }

  async function handlePrevBlock() {
    if (!activeProject) return;
    if (activeProject.currentBlockIndex > 0) {
      await persistProjectState({
        currentStepIndex: activeProject.currentStepIndex,
        currentBlockIndex: activeProject.currentBlockIndex - 1,
        activeFilePath: null
      });
    } else if (activeProject.currentStepIndex > 0) {
      const prevStepIndex = activeProject.currentStepIndex - 1;
      const prevStepBlocksCount = activeProject.program.steps[prevStepIndex].blocks.length;
      await persistProjectState({
        currentStepIndex: prevStepIndex,
        currentBlockIndex: Math.max(0, prevStepBlocksCount - 1),
        activeFilePath: null
      });
    }
  }

  async function handleNextBlock() {
    if (!activeProject) return;
    const currentStep = activeProject.program.steps[activeProject.currentStepIndex];
    const isAtFrontier =
      activeProject.currentStepIndex === furthestUnlockedStepIndex &&
      activeProject.currentBlockIndex === furthestUnlockedBlockIndex;

    if (isAtFrontier) {
      if (canContinue) {
        const block = currentBlock(activeProject);
        if (block) {
          const position = nextPosition(activeProject);
          await persistProjectState({
            ...position,
            completedBlocks: {
              ...(activeProject.completedBlocks ?? {}),
              [block.id]: true
            },
            activeFilePath: null
          });
        }
      }
      return;
    }

    if (currentStep && activeProject.currentBlockIndex < currentStep.blocks.length - 1) {
      await persistProjectState({
        currentStepIndex: activeProject.currentStepIndex,
        currentBlockIndex: activeProject.currentBlockIndex + 1,
        activeFilePath: null
      });
    } else if (activeProject.currentStepIndex < activeProject.program.steps.length - 1) {
      await persistProjectState({
        currentStepIndex: activeProject.currentStepIndex + 1,
        currentBlockIndex: 0,
        activeFilePath: null
      });
    }
  }

  async function handleReturnToActive() {
    if (activeProject) {
      await persistProjectState({
        currentStepIndex: furthestUnlockedStepIndex,
        currentBlockIndex: furthestUnlockedBlockIndex,
        activeFilePath: null
      });
    }
  }

  const pushHistory = useCallback((entry: ConstructHistoryEntry) => {
    if (!applyingHistoryRef.current) {
      history.push(entry);
    }
  }, [history]);

  const runCommand = useCallback((command: string, cwd: string) => {
    setOpenBottomTabIds((current) => current.includes("terminal") ? current : [...current, "terminal"]);
    setActiveBottomTabId("terminal");
    if (!command.trim()) {
      return;
    }
    window.setTimeout(() => terminalRef.current?.runCommand(command, cwd), 0);
  }, []);

  const handleWorkspaceTreeChange = useCallback((
    tree: WorkspaceTreeNode[],
    activePath: string | null,
    relevantPath: string | null,
    openFile: (path: string) => void,
    createFile: (path: string) => void,
    deleteFileFn: (path: string) => Promise<void>,
    renameFileFn: (oldPath: string, newPath: string) => Promise<void>,
    createFolderFn: (path: string) => Promise<void>,
    duplicateFileFn: (path: string, destPath: string) => Promise<void>
  ) => {
    setTreeData({
      tree,
      activePath,
      relevantPath,
      openFile,
      createFile,
      deleteFile: deleteFileFn,
      renameFile: renameFileFn,
      createFolder: createFolderFn,
      duplicateFile: duplicateFileFn
    });
  }, []);

  const handleBack = useCallback(() => {
    setSettingsSurface(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setRightPanel(null);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
    pushHistory({ id: "dashboard", title: "Projects", type: "dashboard" });
    void refresh();
  }, [pushHistory]);

  const openSettingsSurface = useCallback((itemId: string, projectId?: string) => {
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setSettingsSurface({ itemId, projectId });
    setSettingsQuery("");
    pushHistory({
      id: projectId ? `project-settings:${projectId}:${itemId}` : `settings:${itemId}`,
      payload: { projectId, settingsItemId: itemId },
      title: projectId ? "Project settings" : "Settings",
      type: projectId ? "project-settings" : "settings"
    });
  }, [pushHistory]);

  const openKnowledgeBase = useCallback(() => {
    setSettingsSurface(null);
    setActiveProject(null);
    setLearningContextOpen(false);
    setKnowledgeBaseOpen(true);
    pushHistory({ id: "knowledge-base", title: "Knowledge Base", type: "knowledge-base" });
  }, [pushHistory]);

  const openLearningContext = useCallback(() => {
    setSettingsSurface(null);
    setActiveProject(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(true);
    pushHistory({ id: "learner-context", title: "Context", type: "learner-context" });
  }, [pushHistory]);

  const handleRightSlotChange = useCallback((slotId: string) => {
    if (!activeProject) {
      return;
    }

    setActiveRightSlotId(slotId);
    pushHistory({
      id: `right-slot:${activeProject.id}:${slotId}`,
      payload: { projectId: activeProject.id, slotId },
      title: rightSlotTitle(slotId),
      type: "right-slot"
    });
  }, [activeProject, pushHistory]);

  const handleFileOpened = useCallback((filePath: string) => {
    if (!activeProject) {
      return;
    }

    pushHistory({
      id: `file:${activeProject.id}:${filePath}`,
      payload: { filePath, projectId: activeProject.id },
      title: filePath,
      type: "file"
    });
  }, [activeProject, pushHistory]);

  useEffect(() => {
    const active = resolveActiveTheme(theme);
    applyDocumentTheme(active);
    localStorage.setItem("construct.theme", theme);
    void setThemeSource(theme);
  }, [theme]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const active = mql.matches ? "dark" : "light";
        applyDocumentTheme(active);
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  useEffect(() => {
    if (activeProject) {
      setOpenBottomTabIds(["terminal", "logs"]);
      setActiveBottomTabId("terminal");
    } else {
      setOpenBottomTabIds([]);
    }
  }, [activeProject?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle Terminal: Ctrl+` or Cmd+`
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setOpenBottomTabIds((prev) => {
          const isTerminalActive = activeBottomTabId === "terminal";
          if (prev.includes("terminal") && isTerminalActive) {
            const next = prev.filter((id) => id !== "terminal");
            if (next.length > 0) {
              setActiveBottomTabId(next[next.length - 1]);
            } else {
              setActiveBottomTabId(null as any);
            }
            return next;
          } else {
            setActiveBottomTabId("terminal");
            if (!prev.includes("terminal")) {
              return [...prev, "terminal"];
            }
            return prev;
          }
        });
      }

      // Toggle Output: Ctrl+Shift+U or Cmd+Shift+U
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setOpenBottomTabIds((prev) => {
          const isLogsActive = activeBottomTabId === "logs";
          if (prev.includes("logs") && isLogsActive) {
            const next = prev.filter((id) => id !== "logs");
            if (next.length > 0) {
              setActiveBottomTabId(next[next.length - 1]);
            } else {
              setActiveBottomTabId(null as any);
            }
            return next;
          } else {
            setActiveBottomTabId("logs");
            if (!prev.includes("logs")) {
              return [...prev, "logs"];
            }
            return prev;
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openBottomTabIds, activeBottomTabId]);

  useEffect(() => {
    document.documentElement.dataset.opalineWindowType = "electron";
    document.documentElement.dataset.windowType = "electron";
    document.documentElement.dataset.opalineOs = window.construct.getRuntimeInfo().platform;
    console.log("[construct] renderer boot", {
      platform: window.construct.getRuntimeInfo().platform,
      theme: getInitialTheme()
    });

    const handleWindowError = (event: ErrorEvent) => {
      console.error("[construct] window error", event.error ?? event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("[construct] unhandled rejection", event.reason);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    void refresh();

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function refresh() {
    try {
      console.log("[construct] refresh projects");
      setBusy(true);
      setError(null);
      const nextProjects = await bootstrapProjects();
      console.log("[construct] refresh projects resolved", { count: nextProjects.length });
      setProjects(nextProjects);
    } catch (caught) {
      console.error("[construct] refresh projects failed", caught);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string, options: { filePath?: string; recordHistory?: boolean } = {}) {
    try {
      console.log("[construct] open project start", { projectId, options });
      setBusy(true);
      setError(null);
      const project = await openSavedProject(projectId);
      const nextProject = options.filePath ? { ...project, activeFilePath: options.filePath } : project;
      console.log("[construct] open project loaded", {
        id: project.id,
        title: project.title,
        stepCount: project.program.steps.length,
        fileCount: project.program.files.length,
        activeFilePath: nextProject.activeFilePath,
        currentStepIndex: project.currentStepIndex,
        currentBlockIndex: project.currentBlockIndex
      });
      setSettingsSurface(null);
      setActiveProject(nextProject);
      const nextProjects = await bootstrapProjects();
      console.log("[construct] open project refreshed list", { count: nextProjects.length });
      setProjects(nextProjects);
      if (options.recordHistory !== false) {
        pushHistory({
          id: options.filePath ? `file:${projectId}:${options.filePath}` : `project:${projectId}`,
          payload: { filePath: options.filePath, projectId },
          title: options.filePath ?? project.title,
          type: options.filePath ? "file" : "project"
        });
      }
    } catch (caught) {
      console.error("[construct] open project failed", { projectId, options, caught });
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const entry = history.current;
    if (!entry) {
      return;
    }

    applyingHistoryRef.current = true;

    const finish = () => {
      window.setTimeout(() => {
        applyingHistoryRef.current = false;
      }, 0);
    };

    if (entry.type === "dashboard") {
      setSettingsSurface(null);
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(false);
      setRightPanel(null);
      setActiveProject(null);
      setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
      finish();
      return;
    }

    if (entry.type === "knowledge-base") {
      setSettingsSurface(null);
      setActiveProject(null);
      setLearningContextOpen(false);
      setKnowledgeBaseOpen(true);
      finish();
      return;
    }

    if (entry.type === "learner-context") {
      setSettingsSurface(null);
      setActiveProject(null);
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(true);
      finish();
      return;
    }

    if (entry.type === "settings" || entry.type === "project-settings") {
      setSettingsSurface({
        itemId: entry.payload?.settingsItemId ?? "workspace",
        projectId: entry.payload?.projectId
      });
      finish();
      return;
    }

    if (entry.type === "right-slot" && entry.payload?.slotId) {
      setActiveRightSlotId(entry.payload.slotId);
      finish();
      return;
    }

    if (entry.type === "bottom-tab" && entry.payload?.tabId) {
      setActiveBottomTabId(entry.payload.tabId);
      finish();
      return;
    }

    if ((entry.type === "project" || entry.type === "file") && entry.payload?.projectId) {
      void openProject(entry.payload.projectId, {
        filePath: entry.payload.filePath,
        recordHistory: false
      }).finally(finish);
      return;
    }

    finish();
  }, [history.current?.id]);

  const main = settingsSurface ? (
    <ConstructSettingsSurface
      activeItemId={settingsSurface.itemId}
      projectId={settingsSurface.projectId}
      projects={projects}
      theme={theme}
      onThemeChange={setTheme}
      onProjectsChange={setProjects}
      onActiveProjectChange={setActiveProject}
    />
  ) : learningContextOpen ? (
    <LearningContextSurface />
  ) : knowledgeBaseOpen ? (
    <KnowledgeBaseSurface onOpenProject={(projectId) => {
      setKnowledgeBaseOpen(false);
      void openProject(projectId);
    }} />
  ) : activeProject ? (
      <Workspace
        project={activeProject}
        theme={theme}
        onGuidePanelChange={setRightPanel}
        onKnowledgePanelChange={setSidebarKnowledgePanel}
        onProjectChange={setActiveProject}
        onRunCommand={runCommand}
        activeRightSlotId={activeRightSlotId}
        onRightSlotChange={handleRightSlotChange}
        onFileOpened={handleFileOpened}
        onTreeChange={handleWorkspaceTreeChange}
        onSavingChange={setIsSaving}
    />
  ) : (
    <Dashboard
      projects={projects}
      busy={busy}
      error={error}
      onRefresh={() => void refresh()}
      onCreateProject={() => setIsNewProjectOpen(true)}
      onOpenProject={(projectId) => void openProject(projectId)}
      onOpenProjectSettings={(projectId) => openSettingsSurface("project-overview", projectId)}
    />
  );

  const settingsSections = useMemo(
    () => buildSettingsSections(projects, settingsSurface?.projectId),
    [projects, settingsSurface?.projectId]
  );

  function closeSettingsSurface() {
    const projectId = settingsSurface?.projectId;
    setSettingsSurface(null);
    if (projectId) {
      void openProject(projectId);
      return;
    }

    handleBack();
  }

  const bottomPanelTabs = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    const allTabs = [
      {
        id: "terminal",
        title: "Terminal",
        active: activeBottomTabId === "terminal",
        icon: <FileTerminalIcon size={14} />,
        closable: true,
        content: (
          <TerminalPanel
            ref={terminalRef}
            projectId={activeProject.id}
            cwd={activeProject.workspacePath}
            theme={theme}
          />
        )
      },
      {
        id: "logs",
        title: "Output",
        active: activeBottomTabId === "logs",
        icon: <FileTextIcon size={14} />,
        closable: true,
        content: <LogsPanel theme={theme} />
      }
    ];

    return allTabs.filter((tab) => openBottomTabIds.includes(tab.id));
  }, [activeProject, openBottomTabIds, activeBottomTabId, theme]);

  return (
    <AppErrorBoundary>
      <div className="min-h-screen">
        <AppShell
          className="h-screen"
          key={activeProject?.id ?? "dashboard"}
          history={history}
          showSidebarChrome
          defaultBottomPanelOpen={Boolean(activeProject && !settingsSurface)}
          defaultRightPanelOpen={Boolean(activeProject && !settingsSurface)}
          headerTabs={[
            {
              id: settingsSurface
                ? `settings-${settingsSurface.itemId}`
                : activeProject?.id ?? "dashboard",
              title: settingsSurface
                ? settingsTitle(settingsSurface.itemId, settingsSurface.projectId, projects)
                : activeProject?.title ?? "Projects",
              active: true
            }
          ]}
          renderHeaderTab={(tab) => (
            <Button variant="ghost" size="small" type="button" title={String(tab.title)}>
              <span>{tab.title}</span>
            </Button>
          )}
          onNavigateHome={handleBack}
          headerActions={
            activeProject && !settingsSurface
              ? (state) => {
                  const isAtFrontier =
                    activeProject.currentStepIndex === furthestUnlockedStepIndex &&
                    activeProject.currentBlockIndex === furthestUnlockedBlockIndex;
                  return (
                    <>
                      <div
                        className="flex items-center gap-1"
                        onClick={() => {
                          if (!isAtFrontier) {
                            void handleReturnToActive();
                          }
                        }}
                        style={{ cursor: !isAtFrontier ? "pointer" : "default" }}
                      >
                        <AppShellChromeButton
                          onClick={(e) => { e.stopPropagation(); void handlePrevBlock(); }}
                          disabled={activeProject.currentStepIndex === 0 && activeProject.currentBlockIndex === 0}
                          title="Previous Panel"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                          </svg>
                        </AppShellChromeButton>

                        <Badge variant="secondary">
                          {currentBlockNumber(activeProject)}/{totalBlocks(activeProject.program)}
                        </Badge>

                        {!isAtFrontier && (
                          <AppShellChromeButton
                            onClick={(e) => { e.stopPropagation(); void handleNextBlock(); }}
                            disabled={
                              isAtEnd ||
                              (isAtFrontier && !canContinue)
                            }
                            title="Next Panel"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                              <line x1="5" y1="12" x2="19" y2="12" />
                              <polyline points="12 5 19 12 12 19" />
                            </svg>
                          </AppShellChromeButton>
                        )}

                      </div>

                      <SavingIndicator isSaving={isSaving} />
                      <div className="flex items-center gap-1" aria-label="Workspace panels">
                        <AppShellHeaderToolButton
                          data-active={state.isRightPanelOpen && activeRightSlotId === "interact" ? "true" : "false"}
                          onClick={() => {
                            handleRightSlotChange("interact");
                            if (!state.isRightPanelOpen) {
                              state.toggleRightPanel();
                            }
                          }}
                          aria-label="Open Construct Interact"
                        >
                          <MessageCircleIcon size={15} />
                        </AppShellHeaderToolButton>
                        <AppShellHeaderToolButton
                          data-active={state.isRightPanelOpen ? "true" : "false"}
                          onClick={state.toggleRightPanel}
                          aria-label="Toggle guide panel"
                        >
                          <HeaderGuidePanelIcon open={state.isRightPanelOpen} />
                        </AppShellHeaderToolButton>
                        <AppShellHeaderToolButton
                          data-active={state.isBottomPanelOpen ? "true" : "false"}
                          onClick={state.toggleBottomPanel}
                          aria-label="Toggle terminal"
                        >
                          <HeaderBottomPanelIcon open={state.isBottomPanelOpen} />
                        </AppShellHeaderToolButton>
                      </div>
                    </>
                  );
                }
              : undefined
          }
          sidebar={
            settingsSurface ? (
              <SettingsSidebar
                activeItemId={settingsSurface.itemId}
                backLabel={settingsSurface.projectId ? "Back to project" : "Back to projects"}
                footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}
                onBack={closeSettingsSurface}
                onItemSelect={(item: SettingsNavItem) => {
                  const projectId = item.id.startsWith("project-") ? settingsSurface.projectId : undefined;
                  if (item.id.startsWith("project-") && !projectId) {
                    return;
                  }
                  openSettingsSurface(item.id, projectId);
                }}
                onSearchChange={setSettingsQuery}
                query={settingsQuery}
                sections={settingsSections}
              />
            ) : activeProject ? (
              <Sidebar
                projects={[]}
                items={[]}
                footer={
                  <>
                    <div className="flex flex-col gap-1">
                      <SidebarLearningButton onClick={openLearningContext} />
                      <SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />
                    </div>
                  </>
                }
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1">
                    {treeData.openFile ? (
                      <FileTree
                        nodes={treeData.tree}
                        activePath={treeData.activePath}
                        relevantPath={treeData.relevantPath}
                        onOpenFile={treeData.openFile}
                        onCreateFile={treeData.createFile ?? undefined}
                        onDeleteFile={treeData.deleteFile ?? undefined}
                        onRenameFile={treeData.renameFile ?? undefined}
                        onCreateFolder={treeData.createFolder ?? undefined}
                        onDuplicateFile={treeData.duplicateFile ?? undefined}
                      />
                    ) : null}
                  </div>
                  {sidebarKnowledgePanel ? (
                    sidebarKnowledgePanel
                  ) : null}
                </div>
              </Sidebar>
            ) : (
              <Sidebar
                projects={[]} items={[]}
                primaryItems={[
                  {
                    id: "new-project",
                    icon: <PlusIcon size={18} />,
                    label: "New project",
                    onClick: () => setIsNewProjectOpen(true)
                  },
                  {
                    id: "knowledge-base",
                    icon: <BookOpen size={18} />,
                    label: "Knowledge Base",
                    onClick: openKnowledgeBase
                  },
                  {
                    id: "learner-context",
                    icon: <Notebook size={18} weight="duotone" />,
                    label: "Context",
                    onClick: openLearningContext
                  }
                ]}
                footer={<div className="flex flex-col gap-1"><SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} /></div>}
              >
                <DashboardSidebar
                  projects={projects}
                  onOpenProject={(projectId) => void openProject(projectId)}
                  onOpenProjectSettings={(projectId) => openSettingsSurface("project-overview", projectId)}
                />
              </Sidebar>
            )
          }
          main={main}
          rightPanel={activeProject && !settingsSurface ? rightPanel : null}
          bottomPanel={activeProject && !settingsSurface ? (shellState) => (
              <BottomPanel
                activeTabId={activeBottomTabId}
                syncTabs
                keepMounted
                height={300}
                mainContentHeight={window.innerHeight - 72}
                onClose={() => shellState.setBottomPanelOpen(false)}
                onActiveTabChange={(tabId) => {
                  if (tabId) {
                    setActiveBottomTabId(tabId);
                    pushHistory({
                      id: `bottom-tab:${activeProject.id}:${tabId}`,
                      payload: { projectId: activeProject.id, tabId },
                      title: tabId,
                      type: "bottom-tab"
                    });
                  }
                }}
                onTabClose={(tabId) => {
                  setOpenBottomTabIds((prev) => prev.filter((id) => id !== tabId));
                  if (activeBottomTabId === tabId) {
                    const remaining = openBottomTabIds.filter((id) => id !== tabId);
                    if (remaining.length > 0) {
                      setActiveBottomTabId(remaining[remaining.length - 1]);
                    } else {
                      setActiveBottomTabId(null as any);
                    }
                  }
                }}
                onTabOpen={(tab) => {
                  setOpenBottomTabIds((prev) => {
                    if (!prev.includes(tab.id)) {
                      return [...prev, tab.id];
                    }
                    return prev;
                  });
                  setActiveBottomTabId(tab.id);
                }}
                tabs={bottomPanelTabs}
                launcherItems={[
                  {
                    type: "terminal",
                    title: "Terminal",
                    description: "Open a new terminal session",
                    icon: <FileTerminalIcon size={16} />,
                    shortcut: "⌃`",
                    createTab: () => ({
                      id: `terminal-${Date.now()}`,
                      title: "Terminal",
                      icon: <FileTerminalIcon size={14} />,
                      closable: true,
                      content: (
                        <TerminalPanel
                          projectId={activeProject.id}
                          cwd={activeProject.workspacePath}
                          theme={theme}
                        />
                      )
                    })
                  },
                  {
                    type: "logs",
                    title: "Output",
                    description: "View LSP and system logs",
                    icon: <FileTextIcon size={16} />,
                    createTab: () => ({
                      id: "logs",
                      title: "Output",
                      icon: <FileTextIcon size={14} />,
                      closable: true,
                      content: <LogsPanel theme={theme} />
                    })
                  }
                ]}
              />
            ) : null}
        />
        {activeProject && !settingsSurface ? (
          <SelectionExplanationController
            project={activeProject}
            theme={theme}
            onOpenFile={treeData.openFile ?? undefined}
          />
        ) : null}
      </div>
      <NewProjectDialog
        open={isNewProjectOpen}
        onOpenChange={setIsNewProjectOpen}
        onProjectCreated={(project) => {
          setActiveProject(project);
          pushHistory({
            id: `project:${project.id}`,
            payload: { projectId: project.id },
            title: project.title,
            type: "project"
          });
          setProjects((current) => {
            const withoutProject = current.filter((item) => item.id !== project.id);
            return [
              {
                id: project.id,
                title: project.title,
                description: project.description,
                progress: project.progress,
                lastOpenedAt: project.lastOpenedAt,
                sourcePath: project.sourcePath,
                workspacePath: project.workspacePath
              },
              ...withoutProject
            ];
          });
        }}
      />
    </AppErrorBoundary>
  );
}
