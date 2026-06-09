import "@opaline/ui/styles.css";
import "./styles/construct.css";
import { lspClient } from "./lib/lspClient";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, PanelLeft, PanelRight, PanelBottom, FileTerminalIcon, FileTextIcon } from "lucide-react";
import {
  Folder,
  GearSix,
  Plus,
  TerminalWindow,
  Notebook
} from "@phosphor-icons/react";
import { logStore, type LogChannel, type LogEntry } from "./lib/logStore";

import {
  AppShell,
  AppShellChromeButton,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  BottomPanel,
  Button,
  Sidebar,
  SidebarSection,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSidebar,
  SettingsToggle,
  useShellHistory
} from "@opaline/ui";
import type { SettingsNavItem, SettingsNavSection, ShellHistoryEntry } from "@opaline/ui";

import { Dashboard } from "./components/Dashboard";
import { FileTree } from "./components/FileTree";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import { LogsPanel } from "./components/LogsPanel";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import {
  getSettings,
  selectWorkspaceDirectory,
  setThemeSource,
  setWorkspaceRoot,
  updateProject
} from "./lib/bridge";
import type { ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";
import { currentBlock, currentBlockNumber, totalBlocks, nextPosition } from "./lib/runtime";

type ThemeMode = "light" | "dark" | "system";
type ConstructHistoryEntry = ShellHistoryEntry<
  "bottom-tab" | "dashboard" | "file" | "project" | "project-settings" | "right-slot" | "settings",
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

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("construct.theme") as ThemeMode | null;
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

function resolveActiveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyDocumentTheme(active: "light" | "dark"): void {
  const root = document.documentElement;
  root.dataset.constructTheme = active;
  root.dataset.codexTheme = active;
  root.dataset.theme = active;
  root.classList.toggle("dark", active === "dark");
  root.style.colorScheme = active;

  if (document.body) {
    document.body.dataset.constructTheme = active;
    document.body.dataset.codexTheme = active;
    document.body.style.colorScheme = active;
  }
}

export default function ConstructApp() {
  const history = useShellHistory<ConstructHistoryEntry>([
    { id: "dashboard", title: "Projects", type: "dashboard" }
  ]);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
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
    terminalRef.current?.runCommand(command, cwd);
  }, []);

  const handleBack = useCallback(() => {
    setSettingsSurface(null);
    setRightPanel(null);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
    pushHistory({ id: "dashboard", title: "Projects", type: "dashboard" });
    void refresh();
  }, [pushHistory]);

  const openSettingsSurface = useCallback((itemId: string, projectId?: string) => {
    setSettingsSurface({ itemId, projectId });
    setSettingsQuery("");
    pushHistory({
      id: projectId ? `project-settings:${projectId}:${itemId}` : `settings:${itemId}`,
      payload: { projectId, settingsItemId: itemId },
      title: projectId ? "Project settings" : "Settings",
      type: projectId ? "project-settings" : "settings"
    });
  }, [pushHistory]);

  const handleRightSlotChange = useCallback((slotId: string) => {
    if (!activeProject) {
      return;
    }

    setActiveRightSlotId(slotId);
    pushHistory({
      id: `right-slot:${activeProject.id}:${slotId}`,
      payload: { projectId: activeProject.id, slotId },
      title: slotId === "steps" ? "Steps" : "Guide",
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
    if (activeProject) {
      const enabled = localStorage.getItem("construct.lsp.enabled") !== "false";
      if (enabled) {
        console.log("[LSP Client] Workspace path changed, initializing LSP for:", activeProject.workspacePath);
        void lspClient.initialize(activeProject.workspacePath);
      } else {
        console.log("[LSP Client] LSP disabled in settings, stopping server process.");
        void window.constructProjects.lspStop();
      }
    } else {
      console.log("[LSP Client] No active project, disposing LSP");
      lspClient.dispose();
    }
    return () => {
      lspClient.dispose();
    };
  }, [activeProject?.id, activeProject?.workspacePath]);

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
    document.documentElement.dataset.codexWindowType = "electron";
    document.documentElement.dataset.windowType = "electron";
    document.documentElement.dataset.codexOs = window.construct.getRuntimeInfo().platform;
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
      setRightPanel(null);
      setActiveProject(null);
      setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
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
  ) : activeProject ? (
      <Workspace
        project={activeProject}
        theme={theme}
        onGuidePanelChange={setRightPanel}
        onProjectChange={setActiveProject}
        onRunCommand={runCommand}
        activeRightSlotId={activeRightSlotId}
        onRightSlotChange={handleRightSlotChange}
        onFileOpened={handleFileOpened}
        onTreeChange={(tree, activePath, relevantPath, openFile, createFile, deleteFileFn, renameFileFn, createFolderFn, duplicateFileFn) => {
          setTreeData({ tree, activePath, relevantPath, openFile, createFile, deleteFile: deleteFileFn, renameFile: renameFileFn, createFolder: createFolderFn, duplicateFile: duplicateFileFn });
        }}
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
      <div className="construct-app">
        <AppShell
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
            <button className="construct-header-title-tab" type="button" title={String(tab.title)}>
              <span>{tab.title}</span>
            </button>
          )}
          collapsedSidebarTrigger={(state) => (
            <div className="construct-collapsed-toolbar">
              <AppShellCollapsedSidebarTrigger onClick={state.toggleSidebar} aria-label="Open sidebar">
                <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20, overflow: "visible" }}>
                  <rect x="3.5" y="4.5" width="13" height="11" rx="2" />
                  <path d="M7.5 4.5v11" />
                  <circle cx="16.5" cy="4.5" r="2.5" fill="#007aff" stroke="var(--codex-bg-primary)" strokeWidth="1.5" />
                </svg>
              </AppShellCollapsedSidebarTrigger>
              <AppShellCollapsedSidebarTrigger onClick={handleBack} aria-label="Home">
                <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <path d="M3 9.5 L10 3.5 L17 9.5" />
                  <path d="M4.25 9.5 v5.25a1 1 0 0 0 1 1 h9.5 a1 1 0 0 0 1-1 v-5.25" />
                  <path d="M8.5 15.75 v-3.75 h3 v3.75" />
                </svg>
              </AppShellCollapsedSidebarTrigger>
              <AppShellCollapsedSidebarTrigger onClick={state.navigateBack} disabled={!state.canNavigateBack} aria-label="Back">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </AppShellCollapsedSidebarTrigger>
              <AppShellCollapsedSidebarTrigger onClick={state.navigateForward} disabled={!state.canNavigateForward} aria-label="Forward">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </AppShellCollapsedSidebarTrigger>
            </div>
          )}
          sidebarChrome={
            activeProject && !settingsSurface
              ? (state) => (
                  <>
                    <AppShellChromeButton
                      aria-label={state.isSidebarOpen ? "Close sidebar" : "Open sidebar"}
                      onClick={state.toggleSidebar}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                        <rect x="3.5" y="4.5" width="13" height="11" rx="2" />
                        <path d="M7.5 4.5v11" />
                      </svg>
                    </AppShellChromeButton>
                    <AppShellChromeButton
                      aria-label="Home"
                      onClick={handleBack}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                        <path d="M3 9.5 L10 3.5 L17 9.5" />
                        <path d="M4.25 9.5 v5.25a1 1 0 0 0 1 1 h9.5 a1 1 0 0 0 1-1 v-5.25" />
                        <path d="M8.5 15.75 v-3.75 h3 v3.75" />
                      </svg>
                    </AppShellChromeButton>
                    <AppShellChromeButton
                      aria-label="Back"
                      disabled={!state.canNavigateBack}
                      onClick={state.navigateBack}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                      </svg>
                    </AppShellChromeButton>
                    <AppShellChromeButton
                      aria-label="Forward"
                      disabled={!state.canNavigateForward}
                      onClick={state.navigateForward}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </AppShellChromeButton>
                  </>
                )
              : undefined
          }
          headerActions={
            activeProject && !settingsSurface
              ? (state) => {
                  const isAtFrontier =
                    activeProject.currentStepIndex === furthestUnlockedStepIndex &&
                    activeProject.currentBlockIndex === furthestUnlockedBlockIndex;
                  return (
                    <>
                      <div
                        className={`construct-header-progress-pill ${!isAtFrontier ? "is-past" : ""}`}
                        onClick={() => {
                          if (!isAtFrontier) {
                            void handleReturnToActive();
                          }
                        }}
                        style={{ cursor: !isAtFrontier ? "pointer" : "default" }}
                      >
                        <AppShellChromeButton
                          className="construct-header-progress-arrow is-left"
                          onClick={(e) => { e.stopPropagation(); void handlePrevBlock(); }}
                          disabled={activeProject.currentStepIndex === 0 && activeProject.currentBlockIndex === 0}
                          title="Previous Panel"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                          </svg>
                        </AppShellChromeButton>

                        <span className="construct-header-progress-text">
                          {currentBlockNumber(activeProject)}/{totalBlocks(activeProject.program)}
                        </span>

                        {!isAtFrontier && (
                          <AppShellChromeButton
                            className="construct-header-progress-arrow is-right"
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

                        {!isAtFrontier && (
                          <div className="construct-header-progress-tooltip">
                            Click to return to the latest step
                          </div>
                        )}
                      </div>

                      <SavingIndicator isSaving={isSaving} />
                      <AppShellHeaderToolButton onClick={state.toggleRightPanel} aria-label="Toggle guide panel">
                        <PanelRight size={20} />
                      </AppShellHeaderToolButton>
                      <AppShellHeaderToolButton onClick={state.toggleBottomPanel} aria-label="Toggle terminal">
                        <PanelBottom size={20} />
                      </AppShellHeaderToolButton>
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
              <Sidebar projects={[]} items={[]} footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}>
                <div className="construct-sidebar-active">
                  <div className="construct-sidebar-tree-container">
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
                </div>
              </Sidebar>
            ) : (
              <Sidebar
                projects={[]} items={[]}
                primaryItems={[
                  {
                    id: "new-project",
                    icon: <Plus size={18} weight="bold" />,
                    label: "New project",
                    onClick: () => setIsNewProjectOpen(true)
                  }
                ]}
                footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}
              >
                <SidebarSection heading="Projects">
                  <div className="construct-sidebar-project-list">
                    {projects.map((project) => (
                      <button
                        className="construct-sidebar-project-row"
                        key={project.id}
                        onClick={() => void openProject(project.id)}
                        type="button"
                      >
                        <span className="construct-sidebar-project-row__icon">
                          <Folder size={16} weight="duotone" />
                        </span>
                        <span className="construct-sidebar-project-row__title">{project.title}</span>
                        <span
                          className="construct-sidebar-project-row__settings"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            openSettingsSurface("project-overview", project.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              openSettingsSurface("project-overview", project.id);
                            }
                          }}
                          aria-label={`Open settings for ${project.title}`}
                        >
                          <GearSix size={15} weight="duotone" />
                        </span>
                        <span className="construct-sidebar-project-row__meta">{project.progress}%</span>
                      </button>
                    ))}
                    {projects.length === 0 ? (
                      <div className="construct-sidebar-empty">
                        Open a .construct file to start.
                      </div>
                    ) : null}
                  </div>
                </SidebarSection>
              </Sidebar>
            )
          }
          main={main}
          rightPanel={activeProject && !settingsSurface ? rightPanel : null}
          bottomPanel={
            activeProject && !settingsSurface ? (
              <BottomPanel
                activeTabId={activeBottomTabId}
                syncTabs
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
            ) : null
          }
        />
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

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[construct] render crash", error, info);
  }

  render() {
    const { error } = this.state;

    if (error) {
      return (
        <div className="construct-app construct-render-error">
          <h1>Project view crashed</h1>
          <pre>{error.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

function ConstructSettingsSurface({
  activeItemId,
  projectId,
  projects,
  theme,
  onThemeChange,
  onProjectsChange,
  onActiveProjectChange
}: {
  activeItemId: string;
  projectId?: string;
  projects: ProjectSummary[];
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onProjectsChange: (projects: ProjectSummary[]) => void;
  onActiveProjectChange: (project: ProjectRecord | null | ((current: ProjectRecord | null) => ProjectRecord | null)) => void;
}) {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const [workspaceRoot, setWorkspaceRootValue] = useState("");
  const [projectTitle, setProjectTitle] = useState(project?.title ?? "");
  const [projectDescription, setProjectDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lspEnabled, setLspEnabled] = useState(() => {
    return window.localStorage.getItem("construct.lsp.enabled") !== "false";
  });
  const [lspStatus, setLspStatus] = useState<"not-installed" | "installed" | "running" | "stopped" | "installing">("not-installed");
  const [lspLogs, setLspLogs] = useState<string[]>([]);
  const [installBusy, setInstallBusy] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    const checkStatus = async () => {
      try {
        const status = await window.constructProjects.lspGetStatus(projectId);
        if (isMounted) {
          setLspStatus(status);
        }
      } catch (err) {
        console.error("Failed to check LSP status:", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [projectId]);

  useEffect(() => {
    if (lspStatus === "installing" || installBusy) {
      setLspLogs(logStore.getLogs("lsp-server").map((l: LogEntry) => l.message));

      const unsubscribe = logStore.subscribe((channel: LogChannel, entry: LogEntry) => {
        if (channel === "lsp-server") {
          setLspLogs((prev) => [...prev, entry.message]);
        }
      });
      return unsubscribe;
    }
  }, [lspStatus, installBusy]);

  async function handleToggleLsp(enabled: boolean) {
    setLspEnabled(enabled);
    window.localStorage.setItem("construct.lsp.enabled", String(enabled));

    try {
      if (enabled) {
        if (projectId) {
          const status = await window.constructProjects.lspGetStatus(projectId);
          if (status !== "not-installed") {
            await window.constructProjects.lspStart(projectId);
            void lspClient.initialize(project?.workspacePath || "");
          }
        }
      } else {
        await window.constructProjects.lspStop();
        lspClient.dispose();
      }
    } catch (err) {
      console.error("Failed to toggle LSP:", err);
    }
  }

  async function handleInstallLsp() {
    if (!projectId) return;
    setInstallBusy(true);
    setLspStatus("installing");
    setLspLogs([]);

    try {
      const success = await window.constructProjects.lspInstall(projectId);
      if (success) {
        setLspStatus("stopped");
        await window.constructProjects.lspStart(projectId);
        setLspStatus("running");
        void lspClient.initialize(project?.workspacePath || "");
      } else {
        setLspStatus("not-installed");
      }
    } catch (err) {
      console.error("LSP installation error:", err);
      setLspStatus("not-installed");
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleStartLsp() {
    if (!projectId) return;
    try {
      await window.constructProjects.lspStart(projectId);
      setLspStatus("running");
      void lspClient.initialize(project?.workspacePath || "");
    } catch {}
  }

  async function handleStopLsp() {
    try {
      await window.constructProjects.lspStop();
      setLspStatus("stopped");
      lspClient.dispose();
    } catch {}
  }

  async function handleRestartLsp() {
    if (!projectId) return;
    try {
      await window.constructProjects.lspStop();
      await window.constructProjects.lspStart(projectId);
      setLspStatus("running");
      void lspClient.initialize(project?.workspacePath || "");
    } catch {}
  }


  useEffect(() => {
    void getSettings()
      .then((settings) => setWorkspaceRootValue(settings.workspaceRoot))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    setProjectTitle(project?.title ?? "");
    setProjectDescription(project?.description ?? "");
  }, [project?.description, project?.title]);

  async function chooseRoot() {
    const directory = await selectWorkspaceDirectory({ defaultPath: workspaceRoot });
    if (directory) {
      setWorkspaceRootValue(directory);
    }
  }

  async function saveWorkspaceRoot() {
    if (!workspaceRoot.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const result = await setWorkspaceRoot({ workspaceRoot: workspaceRoot.trim() });
      onProjectsChange(result.projects);
      onActiveProjectChange((current) => {
        if (!current) {
          return current;
        }

        const summary = result.projects.find((item) => item.id === current.id);
        return summary ? { ...current, workspacePath: summary.workspacePath } : current;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveProjectDetails() {
    if (!projectId || !projectTitle.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await updateProject({
        id: projectId,
        patch: {
          title: projectTitle.trim(),
          description: projectDescription.trim()
        }
      });
      onActiveProjectChange((current) => current && current.id === updated.id ? updated : current);
      onProjectsChange(projects.map((item) => (
        item.id === updated.id
          ? {
              ...item,
              title: updated.title,
              description: updated.description,
              progress: updated.progress,
              workspacePath: updated.workspacePath
            }
          : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (activeItemId === "appearance") {
    return (
      <SettingsPanel title="Appearance" subtitle="Theme source for Construct and the embedded editor shell.">
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              title="Color theme"
              description="Match the system appearance or keep Construct fixed to one mode."
              control={
                <SettingsSelect value={theme} onChange={(event) => onThemeChange(event.currentTarget.value as ThemeMode)}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </SettingsSelect>
              }
            />
          </SettingsCard>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  if (activeItemId === "lsp-settings") {
    return (
      <SettingsPanel title="Language Server" subtitle="Manage TypeScript language server installation, status, and logging.">
        <SettingsSection title="Configuration">
          <SettingsCard>
            <SettingsRow
              title="Enable Language Server"
              description="Enable real-time code diagnostics, autocomplete, hover cards, and code navigation (Go to Definition)."
              control={
                <SettingsToggle
                  checked={lspEnabled}
                  onCheckedChange={(checked) => void handleToggleLsp(checked)}
                />
              }
            />
          </SettingsCard>
        </SettingsSection>
        
        {lspEnabled && (
          <SettingsSection title="Server Status">
            <SettingsCard>
              <SettingsRow
                title="Status"
                description={
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                      lspStatus === "running" ? "bg-emerald-500 animate-pulse" :
                      lspStatus === "stopped" ? "bg-amber-500" :
                      lspStatus === "installing" ? "bg-blue-500 animate-pulse" : "bg-red-500"
                    }`} />
                    <span className="text-xs font-semibold capitalize text-neutral-300">{lspStatus.replace("-", " ")}</span>
                  </div>
                }
                control={
                  <div className="flex items-center gap-2">
                    {lspStatus === "running" && (
                      <>
                        <Button variant="secondary" size="small" onClick={() => void handleRestartLsp()}>
                          Restart
                        </Button>
                        <Button variant="danger" size="small" className="text-red-400 hover:text-red-300" onClick={() => void handleStopLsp()}>
                          Stop
                        </Button>
                      </>
                    )}
                    {lspStatus === "stopped" && (
                      <Button size="small" onClick={() => void handleStartLsp()}>
                        Start
                      </Button>
                    )}
                    {(lspStatus === "not-installed" || lspStatus === "stopped") && (
                      <Button variant="secondary" size="small" disabled={installBusy} onClick={() => void handleInstallLsp()}>
                        {lspStatus === "not-installed" ? "Download & Install" : "Reinstall / Update"}
                      </Button>
                    )}
                  </div>
                }
              />
              
              {/* Installer Logs Box */}
              {(lspStatus === "installing" || lspLogs.length > 0) && (
                <div className="mt-4 border border-[#2d2e30] rounded bg-[#101112] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-neutral-400 font-sans">Installation Console Output</span>
                    {installBusy && <span className="text-xs text-blue-400 animate-pulse font-sans">Running npm install...</span>}
                  </div>
                  <div className="h-48 overflow-y-auto font-mono text-[10px] text-neutral-300 leading-normal whitespace-pre-wrap select-text border border-neutral-800 p-2 rounded bg-black/40">
                    {lspLogs.length === 0 ? "Starting installer..." : lspLogs.join("\n")}
                  </div>
                </div>
              )}
            </SettingsCard>
          </SettingsSection>
        )}
        {error ? <div className="construct-dialog-error">{error}</div> : null}
      </SettingsPanel>
    );
  }

  if (activeItemId.startsWith("project-") && project) {
    return (
      <SettingsPanel title={project.title} subtitle={project.workspacePath}>
        {activeItemId === "project-overview" ? (
          <SettingsSection title="Project details">
            <SettingsCard>
              <SettingsRow title="Title" description="Shown in the sidebar, dashboard, and shell history.">
                <input
                  className="construct-settings-input"
                  value={projectTitle}
                  onChange={(event) => setProjectTitle(event.currentTarget.value)}
                />
              </SettingsRow>
              <SettingsRow title="Description" description="Used for local project summaries.">
                <textarea
                  className="construct-settings-input construct-settings-input--textarea"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.currentTarget.value)}
                />
              </SettingsRow>
              <SettingsRow
                title="Save project metadata"
                control={
                  <Button size="small" disabled={busy || !projectTitle.trim()} onClick={() => void saveProjectDetails()}>
                    Save
                  </Button>
                }
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-runtime" ? (
          <SettingsSection title="Runtime">
            <SettingsCard>
              <SettingsRow title="Workspace path" description={project.workspacePath} />
              <SettingsRow title="Source file" description={project.sourcePath ?? "Local generated project"} />
              <SettingsRow title="Progress" description={`${project.progress}% complete`} />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-slots" ? (
          <SettingsSection title="Slots">
            <SettingsCard>
              <SettingsRow
                title="Guide and steps"
                description="Available in the right slot through the plus menu."
                control={<SettingsToggle checked disabled />}
              />
              <SettingsRow
                title="Persistent terminals"
                description="Terminal tabs keep their PTY until the tab is closed."
                control={<SettingsToggle checked disabled />}
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {error ? <div className="construct-dialog-error">{error}</div> : null}
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="Workspace" subtitle="Local project storage and app-wide Construct defaults.">
      <SettingsSection title="Storage">
        <SettingsCard>
          <SettingsRow title="Workspace root" description="New and imported projects are kept under this folder.">
            <div className="construct-settings-path-row">
              <input
                className="construct-settings-input"
                value={workspaceRoot}
                onChange={(event) => setWorkspaceRootValue(event.currentTarget.value)}
              />
              <Button variant="secondary" size="small" onClick={() => void chooseRoot()}>
                Browse
              </Button>
              <Button size="small" disabled={busy || !workspaceRoot.trim()} onClick={() => void saveWorkspaceRoot()}>
                Save
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {error ? <div className="construct-dialog-error">{error}</div> : null}
    </SettingsPanel>
  );
}

function buildSettingsSections(projects: ProjectSummary[], projectId?: string): SettingsNavSection[] {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  return [
    {
      id: "app",
      label: "Construct",
      items: [
        { id: "workspace", label: "Workspace", icon: <Folder size={18} weight="duotone" /> },
        { id: "appearance", label: "Appearance", icon: <GearSix size={18} weight="duotone" /> },
        { id: "lsp-settings", label: "Language Server", icon: <Notebook size={18} weight="duotone" /> }
      ]
    },
    {
      id: "project",
      label: "Project",
      items: [
        {
          id: "project-overview",
          label: project?.title ?? "Project overview",
          icon: <Folder size={18} weight="duotone" />,
          muted: !project
        },
        {
          id: "project-runtime",
          label: "Runtime",
          icon: <TerminalWindow size={18} weight="duotone" />,
          muted: !project
        },
        {
          id: "project-slots",
          label: "Slots",
          icon: <PanelRight size={18} />,
          badge: project ? `${project.progress}%` : undefined,
          muted: !project
        }
      ]
    }
  ];
}

function settingsTitle(itemId: string, projectId: string | undefined, projects: ProjectSummary[]) {
  if (itemId === "appearance") {
    return "Appearance";
  }
  if (itemId === "lsp-settings") {
    return "Language Server";
  }
  if (itemId.startsWith("project-") && projectId) {
    return projects.find((project) => project.id === projectId)?.title ?? "Project settings";
  }
  return "Settings";
}

function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="construct-sidebar-settings" onClick={onClick} type="button">
      <GearSix size={19} weight="duotone" />
      <span>Settings</span>
    </button>
  );
}

function SavingIndicator({ isSaving }: { isSaving: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const saveStartRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isSaving) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      if (!isVisible) {
        saveStartRef.current = Date.now();
        setIsVisible(true);
      }
    } else {
      if (isVisible && saveStartRef.current) {
        const elapsed = Date.now() - saveStartRef.current;
        const remainingTime = Math.max(0, 1000 - elapsed);

        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }

        hideTimeoutRef.current = setTimeout(() => {
          setIsVisible(false);
          hideTimeoutRef.current = null;
        }, remainingTime);
      }
    }
  }, [isSaving, isVisible]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`construct-saving-indicator ${isVisible ? "is-visible" : ""}`}>
      <div className="construct-saving-spinner" />
      <span>Saving...</span>
    </div>
  );
}
