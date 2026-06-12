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
  Notebook,
  Trash
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
  SettingsChoice,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSidebar,
  SettingsToggle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  useShellHistory
} from "@opaline/ui";
import type { SettingsNavItem, SettingsNavSection, ShellHistoryEntry } from "@opaline/ui";

import { Dashboard } from "./components/Dashboard";
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
  deleteProject,
  getSettings,
  listAiFeatures,
  listModels,
  selectWorkspaceDirectory,
  setThemeSource,
  setWorkspaceRoot,
  updateAiSettings,
  updateProject
} from "./lib/bridge";
import type { AiFeatureSettings, AiSettings, DeleteProjectCheck, ModelCatalogEntry, ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";
import { currentBlock, currentBlockNumber, totalBlocks, nextPosition } from "./lib/runtime";

type ThemeMode = "light" | "dark" | "system";
type ConstructHistoryEntry = ShellHistoryEntry<
  "bottom-tab" | "dashboard" | "file" | "knowledge-base" | "project" | "project-settings" | "right-slot" | "settings",
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

const defaultAiSettings: AiSettings = {
  provider: "openai",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openRouterApiKey: "",
  openRouterModel: "openai/gpt-5-mini",
  featureModels: {}
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
  root.dataset.opalineTheme = active;
  root.dataset.theme = active;
  root.classList.toggle("dark", active === "dark");
  root.style.colorScheme = active;

  if (document.body) {
    document.body.dataset.constructTheme = active;
    document.body.dataset.opalineTheme = active;
    document.body.dataset.theme = active;
    document.body.classList.toggle("dark", active === "dark");
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
  const [sidebarKnowledgePanel, setSidebarKnowledgePanel] = useState<ReactNode | null>(null);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
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

  useEffect(() => {
    logStore.addLog("lsp-server", "Language server log channel attached.", "debug");
    logStore.addLog("lsp-protocol", "LSP protocol log channel attached.", "debug");

    const unsubscribeLsp = window.constructProjects.onLspStderr((payload) => {
      const text = typeof payload === "string" ? payload : payload.text;
      const level = typeof payload === "string" ? "info" : payload.level;
      logStore.addLog("lsp-server", text, level);
    });

    const unsubscribeMain = window.constructProjects.onMainLog((payload) => {
      const level = payload.level === "error" || payload.level === "warn" || payload.level === "debug"
        ? payload.level
        : "info";
      logStore.addLog("main", payload.message, level);
    });

    return () => {
      unsubscribeLsp();
      unsubscribeMain();
    };
  }, []);

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
    setKnowledgeBaseOpen(false);
    setRightPanel(null);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
    pushHistory({ id: "dashboard", title: "Projects", type: "dashboard" });
    void refresh();
  }, [pushHistory]);

  const openSettingsSurface = useCallback((itemId: string, projectId?: string) => {
    setKnowledgeBaseOpen(false);
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
    setKnowledgeBaseOpen(true);
    pushHistory({ id: "knowledge-base", title: "Knowledge Base", type: "knowledge-base" });
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
        void window.constructProjects.lspStart(activeProject.id).then((result) => {
          if (result.languages.length > 0) {
            void lspClient.initialize(activeProject.workspacePath, { languages: result.languages });
          } else {
            console.log("[LSP Client] No supported language servers were started for this project.");
          }
        });
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
    if (!activeProject) {
      return;
    }

    let refreshTimer: number | null = null;
    let lastRefreshAt = 0;

    const refreshLsp = () => {
      const enabled = localStorage.getItem("construct.lsp.enabled") !== "false";
      if (!enabled || document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAt < 10_000) {
        return;
      }
      lastRefreshAt = now;

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        logStore.addLog("lsp-server", "Refreshing language server after app focus.", "info");
        void restartProjectLsp(activeProject.id).then((result) => {
          if (result.languages.length > 0) {
            void lspClient.initialize(activeProject.workspacePath, {
              force: true,
              languages: result.languages
            });
          }
        });
      }, 250);
    };

    window.addEventListener("focus", refreshLsp);
    document.addEventListener("visibilitychange", refreshLsp);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener("focus", refreshLsp);
      document.removeEventListener("visibilitychange", refreshLsp);
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
      setRightPanel(null);
      setActiveProject(null);
      setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null });
      finish();
      return;
    }

    if (entry.type === "knowledge-base") {
      setSettingsSurface(null);
      setActiveProject(null);
      setKnowledgeBaseOpen(true);
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
                  <circle cx="16.5" cy="4.5" r="2.5" fill="#007aff" stroke="var(--opaline-bg-primary)" strokeWidth="1.5" />
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
                    icon: <Plus size={18} weight="bold" />,
                    label: "New project",
                    onClick: () => setIsNewProjectOpen(true)
                  },
                  {
                    id: "knowledge-base",
                    icon: <Notebook size={18} weight="duotone" />,
                    label: "Knowledge Base",
                    onClick: openKnowledgeBase
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
          bottomPanel={activeProject && !settingsSurface ? (shellState) => (
              <BottomPanel
                activeTabId={activeBottomTabId}
                syncTabs
                keepMounted
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

type LspLanguageId = "typescript" | "python";
type LspServerStatus = "not-installed" | "running" | "stopped" | "installing";
type LspStatusReport = Record<LspLanguageId, {
  command: string;
  installCommand: string;
  installed: boolean;
  label: string;
  resolvedPath: string | null;
  status: LspServerStatus;
}>;

const lspLanguageOrder: LspLanguageId[] = ["typescript", "python"];

function createEmptyLspStatusReport(): LspStatusReport {
  return {
    typescript: {
      command: "typescript-language-server --stdio",
      installCommand: "npm install --save-dev typescript-language-server typescript",
      installed: false,
      label: "TypeScript / JavaScript",
      resolvedPath: null,
      status: "not-installed"
    },
    python: {
      command: "pyright-langserver --stdio",
      installCommand: "npm install --save-dev pyright",
      installed: false,
      label: "Python",
      resolvedPath: null,
      status: "not-installed"
    }
  };
}

function aggregateLspStatus(report: LspStatusReport): LspServerStatus {
  const statuses = lspLanguageOrder.map((language) => report[language].status);
  if (statuses.includes("installing")) return "installing";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("stopped")) return "stopped";
  return "not-installed";
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
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const [aiFeatures, setAiFeatures] = useState<AiFeatureSettings[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState(project?.title ?? "");
  const [projectDescription, setProjectDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteCheck, setDeleteCheck] = useState<DeleteProjectCheck | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [lspEnabled, setLspEnabled] = useState(() => {
    return window.localStorage.getItem("construct.lsp.enabled") !== "false";
  });
  const [lspStatus, setLspStatus] = useState<LspStatusReport>(() => createEmptyLspStatusReport());
  const [lspLogs, setLspLogs] = useState<string[]>([]);
  const [installBusy, setInstallBusy] = useState(false);
  const aggregateStatus = aggregateLspStatus(lspStatus);

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
    if (aggregateStatus === "installing" || installBusy) {
      setLspLogs(logStore.getLogs("lsp-server").map((l: LogEntry) => l.message));

      const unsubscribe = logStore.subscribe((channel: LogChannel, entry: LogEntry) => {
        if (channel === "lsp-server") {
          setLspLogs((prev) => [...prev, entry.message]);
        }
      });
      return unsubscribe;
    }
  }, [aggregateStatus, installBusy]);

  async function handleToggleLsp(enabled: boolean) {
    setLspEnabled(enabled);
    window.localStorage.setItem("construct.lsp.enabled", String(enabled));

    try {
      if (enabled) {
        if (projectId) {
          const status = await window.constructProjects.lspGetStatus(projectId);
          setLspStatus(status);
          if (aggregateLspStatus(status) !== "not-installed") {
            const startResult = await restartProjectLsp(projectId);
            setLspStatus(await window.constructProjects.lspGetStatus(projectId));
            if (startResult.languages.length > 0) {
              void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
            }
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
    setLspStatus((current) => {
      const next = { ...current };
      for (const language of lspLanguageOrder) {
        next[language] = { ...next[language], status: "installing" };
      }
      return next;
    });
    setLspLogs([]);

    try {
      const success = await window.constructProjects.lspInstall(projectId);
      if (success) {
        const startResult = await restartProjectLsp(projectId);
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
        if (startResult.languages.length > 0) {
          void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
        }
      } else {
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      }
    } catch (err) {
      console.error("LSP installation error:", err);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleStartLsp() {
    if (!projectId) return;
    try {
      const startResult = await restartProjectLsp(projectId);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      if (startResult.languages.length > 0) {
        void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
      }
    } catch {}
  }

  async function handleStopLsp() {
    try {
      await window.constructProjects.lspStop();
      if (projectId) {
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      }
      lspClient.dispose();
    } catch {}
  }

  async function handleRestartLsp() {
    if (!projectId) return;
    try {
      const startResult = await restartProjectLsp(projectId);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      if (startResult.languages.length > 0) {
        void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
      }
    } catch {}
  }


  useEffect(() => {
    void getSettings()
      .then((settings) => {
        setWorkspaceRootValue(settings.workspaceRoot);
        setAiSettings({
          ...defaultAiSettings,
          ...(settings.ai ?? {})
        });
        return listAiFeatures();
      })
      .then((features) => setAiFeatures(features))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    const apiKey = aiSettings.provider === "openrouter"
      ? aiSettings.openRouterApiKey.trim()
      : aiSettings.openAiApiKey.trim();

    if (!apiKey) {
      setModelOptions([]);
      return;
    }

    void refreshModels(aiSettings.provider, apiKey);
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

  async function refreshModels(provider = aiSettings.provider, apiKey?: string) {
    const resolvedKey = (apiKey ?? (provider === "openrouter" ? aiSettings.openRouterApiKey : aiSettings.openAiApiKey)).trim();
    if (!resolvedKey) {
      setModelsError(`Enter your ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key first.`);
      setModelOptions([]);
      return;
    }

    try {
      setModelsBusy(true);
      setModelsError(null);
      const models = await listModels({ provider, apiKey: resolvedKey });
      setModelOptions(models);
      setAiSettings((current) => {
        if (provider === "openrouter") {
          const nextModel = current.openRouterModel && models.some((model) => model.id === current.openRouterModel)
            ? current.openRouterModel
            : (models[0]?.id ?? current.openRouterModel);
          return { ...current, openRouterModel: nextModel };
        }

        const nextModel = current.openAiModel && models.some((model) => model.id === current.openAiModel)
          ? current.openAiModel
          : (models[0]?.id ?? current.openAiModel);
        return { ...current, openAiModel: nextModel };
      });
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : String(caught));
      setModelOptions([]);
    } finally {
      setModelsBusy(false);
    }
  }

  async function saveAiConfiguration() {
    try {
      setAiBusy(true);
      setModelsError(null);
      const settings = await updateAiSettings({ ai: aiSettings });
      setAiSettings({
        ...defaultAiSettings,
        ...(settings.ai ?? {})
      });
      setAiFeatures(await listAiFeatures());
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiBusy(false);
    }
  }

  function updateFeatureModel(featureId: string, model: string) {
    setAiSettings((current) => ({
      ...current,
      featureModels: {
        ...current.featureModels,
        [featureId]: model
      }
    }));
    setAiFeatures((current) => current.map((feature) => (
      feature.id === featureId ? { ...feature, model } : feature
    )));
  }

  async function handleDeleteClick() {
    if (!projectId) return;
    setDeleteError(null);
    try {
      const result = await deleteProject({ projectId });
      if ("deleted" in result) return;
      setDeleteCheck(result);
      setDeleteConfirmOpen(true);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleConfirmDelete() {
    if (!projectId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject({ projectId, force: true });
      setDeleteConfirmOpen(false);
      onActiveProjectChange(null);
      onProjectsChange(projects.filter((p) => p.id !== projectId));
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(false);
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
                <SettingsChoice
                  value={theme}
                  onValueChange={(value) => onThemeChange(value as ThemeMode)}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" }
                  ]}
                />
              }
            />
          </SettingsCard>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  if (activeItemId === "lsp-settings") {
    return (
      <SettingsPanel title="Language Server" subtitle="Manage editor intelligence, diagnostics, and code navigation for this workspace.">
        <SettingsSection title="Configuration">
          <SettingsCard>
            <SettingsRow
              title="Enable Language Server"
              description="Enable diagnostics, autocomplete, hover cards, references, go to definition, type definition, and implementation lookup."
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
          <SettingsSection title="Installed servers">
            <SettingsCard>
              {lspLanguageOrder.map((language) => {
                const server = lspStatus[language];
                const statusClass =
                  server.status === "running" ? "is-running" :
                  server.status === "stopped" ? "is-stopped" :
                  server.status === "installing" ? "is-installing" : "is-missing";

                return (
                  <SettingsRow
                    key={language}
                    title={server.label}
                    description={
                      <div className="construct-lsp-server-meta">
                        <span className={`construct-lsp-status ${statusClass}`}>
                          <span />
                          {server.status.replace("-", " ")}
                        </span>
                        <code>{server.command}</code>
                        <small>{server.resolvedPath ?? server.installCommand}</small>
                      </div>
                    }
                  />
                );
              })}
            </SettingsCard>
          </SettingsSection>
        )}

        {lspEnabled && (
          <SettingsSection title="Controls">
            <SettingsCard>
              <SettingsRow
                title="Server lifecycle"
                description="Starts every installed language server for the active workspace. Install adds TypeScript language server, TypeScript, and Pyright when missing."
                control={
                  <div className="flex items-center gap-2">
                    {aggregateStatus === "running" ? (
                      <>
                        <Button variant="secondary" size="small" onClick={() => void handleRestartLsp()}>
                          Restart
                        </Button>
                        <Button variant="danger" size="small" onClick={() => void handleStopLsp()}>
                          Stop
                        </Button>
                      </>
                    ) : (
                      <Button size="small" disabled={aggregateStatus === "not-installed"} onClick={() => void handleStartLsp()}>
                        Start
                      </Button>
                    )}
                    <Button variant="secondary" size="small" disabled={installBusy} onClick={() => void handleInstallLsp()}>
                      {aggregateStatus === "not-installed" ? "Download & Install" : "Reinstall / Update"}
                    </Button>
                  </div>
                }
              />
              
              {/* Installer Logs Box */}
              {(aggregateStatus === "installing" || lspLogs.length > 0) && (
                <div className="construct-lsp-install-log">
                  <div className="construct-lsp-install-log__header">
                    <span>Installation output</span>
                    {installBusy && <span>Running npm install...</span>}
                  </div>
                  <div className="construct-lsp-install-log__body">
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

        {activeItemId === "project-overview" ? (
          <SettingsSection title="Danger Zone">
            <SettingsCard>
              <SettingsRow
                title="Delete project"
                description="Permanently removes the project and its workspace folder. This action cannot be undone."
                control={
                  <Button variant="danger" size="small" onClick={() => void handleDeleteClick()}>
                    <Trash size={14} weight="duotone" style={{ marginRight: 4 }} />
                    Delete
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
        {deleteError ? <div className="construct-dialog-error">{deleteError}</div> : null}

        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent size="narrow">
            <DialogHeader
              icon={<Trash size={20} weight="duotone" />}
              title="Delete project"
              subtitle={project?.workspacePath ?? ""}
            />
            <DialogBody>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ margin: 0, fontWeight: 500 }}>Are you sure you want to delete this project?</p>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted, #888)" }}>This will permanently delete the workspace folder and all its contents. This action cannot be undone.</p>
              </div>

              {deleteCheck?.hasGit ? (
                <div className="construct-settings-warning-box" style={{ marginTop: 16, padding: "12px 16px", background: "var(--danger-bg, rgba(220,38,38,0.08))", borderRadius: 8, border: "1px solid var(--danger-border, rgba(220,38,38,0.2))" }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>Git repository detected</p>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
                    <li>Branch: <strong>{deleteCheck.branch}</strong></li>
                    {deleteCheck.hasUncommittedChanges ? (
                      <li>You have <strong>uncommitted changes</strong> that will be lost.</li>
                    ) : null}
                    {deleteCheck.unpushedCommits > 0 ? (
                      <li>You have <strong>{deleteCheck.unpushedCommits} unpushed commit{deleteCheck.unpushedCommits === 1 ? "" : "s"}</strong> that will be lost.</li>
                    ) : null}
                    {!deleteCheck.hasUncommittedChanges && deleteCheck.unpushedCommits === 0 ? (
                      <li>All changes are committed and pushed. No data loss expected.</li>
                    ) : null}
                  </ul>
                  {deleteCheck.hasUncommittedChanges || deleteCheck.unpushedCommits > 0 ? (
                    <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--danger-fg, #dc2626)" }}>
                      Push your commits to a remote repository before deleting to avoid losing work.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!deleteCheck?.hasGit && deleteCheck ? (
                <div className="construct-settings-warning-box" style={{ marginTop: 16, padding: "12px 16px", background: "var(--warning-bg, rgba(234,179,8,0.08))", borderRadius: 8, border: "1px solid var(--warning-border, rgba(234,179,8,0.2))" }}>
                  <p style={{ margin: 0, fontSize: 13 }}>No git repository found. The workspace will be permanently deleted.</p>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" size="small" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" size="small" onClick={() => void handleConfirmDelete()} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
      <SettingsSection title="AI">
        <SettingsCard>
          <SettingsRow title="AI Provider" description="Choose the account Construct uses for AI-assisted features.">
            <SettingsChoice
              value={aiSettings.provider}
              onValueChange={(value) => {
                const provider = value === "openrouter" ? "openrouter" : "openai";
                setAiSettings((current) => ({ ...current, provider }));
                setModelOptions([]);
                setModelsError(null);
              }}
              options={[
                { value: "openai", label: "OpenAI" },
                { value: "openrouter", label: "OpenRouter" }
              ]}
            />
          </SettingsRow>

          {aiSettings.provider === "openai" ? (
            <SettingsRow title="OpenAI API Key" description="Stored locally by Construct and used by packaged releases.">
              <input
                className="construct-settings-input"
                type="password"
                value={aiSettings.openAiApiKey}
                placeholder="sk-..."
                onChange={(event) => setAiSettings((current) => ({ ...current, openAiApiKey: event.currentTarget.value }))}
              />
            </SettingsRow>
          ) : (
            <SettingsRow title="OpenRouter API Key" description="Stored locally by Construct and used by packaged releases.">
              <input
                className="construct-settings-input"
                type="password"
                value={aiSettings.openRouterApiKey}
                placeholder="sk-or-..."
                onChange={(event) => setAiSettings((current) => ({ ...current, openRouterApiKey: event.currentTarget.value }))}
              />
            </SettingsRow>
          )}

          <SettingsRow
            title="Available models"
            description={modelOptions.length > 0 ? `${modelOptions.length} models loaded` : "Load models from the selected provider before assigning feature models."}
            control={
              <Button
                variant="secondary"
                size="small"
                disabled={modelsBusy}
                onClick={() => void refreshModels(aiSettings.provider)}
              >
                {modelsBusy ? "Loading..." : "Refresh"}
              </Button>
            }
          />

          {aiFeatures.map((feature) => (
            <SettingsRow
              key={feature.id}
              title={feature.title}
              description={feature.description}
              control={
                <SettingsChoice
                  value={feature.model}
                  disabled={modelsBusy}
                  placeholder={feature.model || "Select model"}
                  onValueChange={(model) => updateFeatureModel(feature.id, model)}
                  options={
                    modelOptions.length > 0
                      ? modelOptions.map((model) => ({
                          value: model.id,
                          label: model.name,
                          description: model.id
                        }))
                      : [{ value: feature.model, label: feature.model || "No models loaded yet" }]
                  }
                />
              }
            />
          ))}

          <SettingsRow
            title="Save AI settings"
            description={modelsError ?? "Feature model choices are saved locally and used by packaged builds."}
            control={
              <Button size="small" disabled={aiBusy} onClick={() => void saveAiConfiguration()}>
                {aiBusy ? "Saving..." : "Save"}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsCard>
          <SettingsRow title="Tape Spec" description="Current Construct tape format supported by the editor." control={<code>0.3.1</code>} />
        </SettingsCard>
      </SettingsSection>
      {error ? <div className="construct-dialog-error">{error}</div> : null}
    </SettingsPanel>
  );
}

function buildSettingsSections(projects: ProjectSummary[], projectId?: string): SettingsNavSection[] {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const sections: SettingsNavSection[] = [
    {
      id: "app",
      label: "Construct",
      items: [
        { id: "workspace", label: "Workspace", icon: <Folder size={18} weight="duotone" /> },
        { id: "appearance", label: "Appearance", icon: <GearSix size={18} weight="duotone" /> },
        { id: "lsp-settings", label: "Language Server", icon: <Notebook size={18} weight="duotone" /> }
      ]
    }
  ];

  if (project) {
    sections.push({
      id: "project",
      label: "Project",
      items: [
        {
          id: "project-overview",
          label: project.title,
          icon: <Folder size={18} weight="duotone" />
        },
        {
          id: "project-runtime",
          label: "Runtime",
          icon: <TerminalWindow size={18} weight="duotone" />
        },
        {
          id: "project-slots",
          label: "Slots",
          icon: <PanelRight size={18} />,
          badge: `${project.progress}%`
        }
      ]
    });
  }

  return sections;
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

async function restartProjectLsp(projectId: string) {
  await window.constructProjects.lspStop();
  lspClient.dispose();
  return window.constructProjects.lspStart(projectId);
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
