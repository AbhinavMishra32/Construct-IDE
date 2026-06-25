import { AppErrorBoundary } from "./AppErrorBoundary";
import { ConstructSettingsSurface, buildSettingsSections, settingsTitle } from "./ConstructSettingsSurface";
import { LearningContextSurface } from "./LearningContextSurface";
import { HeaderBottomPanelIcon, HeaderGuidePanelIcon, SavingIndicator, SidebarConceptsButton, SidebarLearningButton, SidebarSettingsButton } from "./ShellControls";
import { applyDocumentTheme, getInitialTheme, resolveActiveTheme, type ThemeMode } from "./theme";
import { useConstructLogBridge } from "./lib/useConstructLogBridge";
import { useProjectLspLifecycle } from "./lib/useProjectLspLifecycle";
import { StatusBar } from "./components/StatusBar";
import { apiTracker } from "./lib/apiTracker";
import { useSession } from "@better-auth-ui/react";
import { createAuthClient } from "better-auth/react";
import { Auth } from "../components/auth/auth";
import { AuthProvider } from "../components/auth/auth-provider";
import type { AuthView } from "@better-auth-ui/core";
import type { AiSettings } from "./types";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type ComponentPropsWithoutRef, type PropsWithChildren } from "react";
import {
  BookOpen,
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  FileTerminalIcon,
  FileTextIcon,
  FolderOpenIcon,
  HomeIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  MessageCircleIcon,
  MessageCircleOff as MessageCircleOffIcon,
  Maximize2 as Maximize2Icon,
  PanelRightIcon,
  Plus as PlusIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  TerminalSquareIcon
} from "lucide-react";

import {
  AppShell,
  AppShellChromeButton,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  Badge,
  BottomPanel,
  Button,
  Sidebar,
  SettingsSidebar,
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuSeparator,
  ShadcnDropdownMenuTrigger,
  useShellHistory
} from "@opaline/ui";
import type { SettingsNavItem, ShellHistoryEntry } from "@opaline/ui";
import type { AppShellState } from "@opaline/ui";

import { Dashboard } from "./components/Dashboard";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { FileTree } from "./components/FileTree";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import { FlowWorkspace, type FlowLayoutRequest } from "./components/FlowWorkspace";
import { LogsPanel } from "./components/LogsPanel";
import { KnowledgeBaseSurface } from "./components/KnowledgeBaseSurface";
import { SelectionExplanationController } from "./components/SelectionExplanationController";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import {
  setThemeSource,
  getUiState,
  setUiState,
  getSettings,
  updateAiSettings,
  updateProject,
  closeProject
} from "./lib/bridge";
import type { AnyProjectRecord, FlowProjectRecord, ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";
import { isFlowProjectRecord } from "./types";
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

type ConstructShellUiState = {
  version: 1;
  activeProjectId: string | null;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  inspectorExpanded: boolean;
  knowledgeBaseOpen: boolean;
  learningContextOpen: boolean;
  settingsSurface: SettingsSurfaceState | null;
  flowPanelView: "chat" | "project";
  activeRightSlotId: string;
  activeBottomTabId: string | null;
  openBottomTabIds: string[];
  bottomPanelOpen: boolean;
  bottomPanelExpanded: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  theme: ThemeMode;
  showStatusBar: boolean;
};

const SHELL_UI_STATE_KEY = "shell";

function rightSlotTitle(slotId: string): string {
  if (slotId === "steps") return "Steps";
  if (slotId === "interact") return "Interact";
  if (slotId === "git") return "Git";
  return "Guide";
}

function normalizeShellUiState(value: unknown): ConstructShellUiState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ConstructShellUiState>;
  return {
    version: 1,
    activeProjectId: typeof input.activeProjectId === "string" ? input.activeProjectId : null,
    sidebarOpen: typeof input.sidebarOpen === "boolean" ? input.sidebarOpen : true,
    rightPanelOpen: typeof input.rightPanelOpen === "boolean" ? input.rightPanelOpen : false,
    inspectorExpanded: typeof input.inspectorExpanded === "boolean" ? input.inspectorExpanded : false,
    knowledgeBaseOpen: typeof input.knowledgeBaseOpen === "boolean" ? input.knowledgeBaseOpen : false,
    learningContextOpen: typeof input.learningContextOpen === "boolean" ? input.learningContextOpen : false,
    settingsSurface: normalizeSettingsSurfaceState(input.settingsSurface),
    flowPanelView: input.flowPanelView === "project" ? "project" : "chat",
    activeRightSlotId: typeof input.activeRightSlotId === "string" && input.activeRightSlotId.trim() ? input.activeRightSlotId : "guide",
    activeBottomTabId: typeof input.activeBottomTabId === "string" ? input.activeBottomTabId : null,
    openBottomTabIds: Array.isArray(input.openBottomTabIds)
      ? input.openBottomTabIds.filter((id): id is string => typeof id === "string")
      : [],
    bottomPanelOpen: typeof input.bottomPanelOpen === "boolean" ? input.bottomPanelOpen : false,
    bottomPanelExpanded: typeof input.bottomPanelExpanded === "boolean" ? input.bottomPanelExpanded : false,
    sidebarWidth: normalizePanelWidth(input.sidebarWidth, 300, 240, 520),
    inspectorWidth: normalizePanelWidth(input.inspectorWidth, 320, 260, 760),
    theme: input.theme === "light" || input.theme === "dark" || input.theme === "system" ? input.theme : getInitialTheme(),
    showStatusBar: input.showStatusBar !== false
  };
}

function normalizeSettingsSurfaceState(value: unknown): SettingsSurfaceState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<SettingsSurfaceState>;
  if (typeof input.itemId !== "string" || !input.itemId.trim()) return null;
  return {
    itemId: input.itemId,
    projectId: typeof input.projectId === "string" ? input.projectId : undefined
  };
}

function normalizePanelWidth(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function authViewFromPath(path: string): AuthView {
  if (path.includes("sign-up")) return "signUp";
  if (path.includes("forgot-password")) return "forgotPassword";
  if (path.includes("reset-password")) return "resetPassword";
  if (path.includes("verify-email")) return "verifyEmail";
  if (path.includes("sign-out")) return "signOut";
  return "signIn";
}

function AuthGateContent({
  children,
  authClient,
  authView,
  baseUrl,
  aiSettings,
}: {
  children: React.ReactNode;
  authClient: any;
  authView: AuthView;
  baseUrl: string;
  aiSettings: AiSettings;
}) {
  const hasDesktopToken = !!aiSettings.constructCloudAccessToken?.trim();
  const { data: session, isPending, isError } = useSession(authClient);
  const [timedOut, setTimedOut] = useState(false);
  const [customUrl, setCustomUrl] = useState(baseUrl);

  useEffect(() => {
    console.log("[auth] Checking account status...", { isPending, hasSession: !!session, hasDesktopToken, isError });
  }, [isPending, session, hasDesktopToken, isError]);

  useEffect(() => {
    if (hasDesktopToken) {
      setTimedOut(false);
      return;
    }

    if (!isPending) {
      setTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      if (isPending && !session) {
        setTimedOut(true);
        console.warn(`[auth] Connection to auth server ${baseUrl} timed out.`);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [isPending, session, baseUrl, hasDesktopToken]);

  const connectFailed = !hasDesktopToken && (isError || (timedOut && !session));

  if (hasDesktopToken) {
    return <>{children}</>;
  }

  if (connectFailed) {
    const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans">
        <div className="w-[420px] p-8 rounded-2xl border bg-card/45 backdrop-blur-lg shadow-2xl flex flex-col gap-5 text-center items-center">
          <div className="size-12 rounded-xl bg-destructive/15 flex items-center justify-center text-destructive">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="size-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-tight">Authentication Server Unreachable</h2>

          {isDev ? (
            <>
              <p className="text-xs text-muted-foreground max-w-[320px]">
                Construct is unable to connect to the authentication server. You can edit the URL below to target your local server:
              </p>
              <div className="w-full flex flex-col gap-2">
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border bg-background/50 text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  placeholder="http://localhost:8787"
                />
                <button
                  onClick={() => {
                    const cleanedUrl = cleanAndNormalizeUrl(customUrl);
                    void getSettings().then((settings) => {
                      settings.ai.constructCloudBaseUrl = cleanedUrl;
                      return updateAiSettings({ ai: settings.ai });
                    }).then(() => {
                      window.location.reload();
                    }).catch(err => {
                      console.error("Failed to update base URL", err);
                    });
                  }}
                  className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-colors"
                >
                  Save & Connect
                </button>
              </div>
              <div className="w-full border-t border-muted/30 my-1"></div>
              <div className="flex w-full gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border hover:bg-muted transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    void getSettings().then((settings) => {
                      settings.ai.constructCloudBaseUrl = "https://cloud.tryconstruct.cc";
                      return updateAiSettings({ ai: settings.ai });
                    }).then(() => {
                      window.location.reload();
                    }).catch(err => {
                      console.error("Failed to reset base URL", err);
                    });
                  }}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border hover:bg-muted transition-colors"
                >
                  Reset to Default
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground max-w-[320px]">
                Construct is unable to connect to the authentication server at:
                <code className="block mt-2 p-1.5 rounded bg-muted text-foreground select-all break-all">{baseUrl}</code>
              </p>
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-colors"
              >
                Retry Connection
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Checking account status...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans">
        <div className="w-[420px] p-8 rounded-2xl border bg-card/45 backdrop-blur-lg shadow-2xl flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="size-12 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/25">
              <span className="text-xl font-bold text-primary-foreground tracking-wider">C</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-2">Construct</h1>
            <p className="text-xs text-muted-foreground max-w-[280px]">
              Please sign in to your cloud account to access Construct.
            </p>
          </div>

          <Auth view={authView} socialLayout="vertical" className="w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AuthGate({ children, aiSettings }: { children: React.ReactNode; aiSettings: AiSettings }) {
  const normalizedBaseUrl = cleanAndNormalizeUrl(aiSettings.constructCloudBaseUrl);
  const authClient = useMemo(() => createAuthClient({
    baseURL: normalizedBaseUrl,
    fetchOptions: {
      auth: {
        type: "Bearer",
        token: () => localStorage.getItem("bearer_token") || "",
      },
      onSuccess: (ctx) => {
        const authToken = ctx.response.headers.get("set-auth-token");
        if (authToken) {
          localStorage.setItem("bearer_token", authToken);
        }
      }
    }
  }), [normalizedBaseUrl]);

  const [authPath, setAuthPath] = useState("/auth/sign-in");
  const authView = authViewFromPath(authPath);

  const navigate = useCallback((options: { to: string }) => {
    setAuthPath(options.to);
  }, []);

  const Link = useMemo(() => {
    return function ConstructCloudAuthLink({
      href,
      to,
      onClick,
      children,
      ...props
    }: PropsWithChildren<
      { className?: string; href: string; to?: string } & Pick<
        ComponentPropsWithoutRef<"a">,
        "aria-disabled" | "tabIndex" | "onClick"
      >
    >) {
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onClick?.(event);
            setAuthPath(to ?? href);
          }}
        >
          {children}
        </a>
      );
    };
  }, []);

  return (
    <AuthProvider
      authClient={authClient}
      baseURL={normalizedBaseUrl}
      redirectTo="/settings/account"
      socialProviders={["google", "github"]}
      emailAndPassword={{ enabled: true, forgotPassword: true, name: true, rememberMe: true }}
      navigate={navigate}
      Link={Link}
    >
      <AuthGateContent authClient={authClient} authView={authView} baseUrl={normalizedBaseUrl} aiSettings={aiSettings}>
        {children}
      </AuthGateContent>
    </AuthProvider>
  );
}

export default function ConstructApp() {
  const history = useShellHistory<ConstructHistoryEntry>([
    { id: "dashboard", title: "Projects", type: "dashboard" }
  ]);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<AnyProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [sidebarKnowledgePanel, setSidebarKnowledgePanel] = useState<ReactNode | null>(null);
  const [flowPanelView, setFlowPanelView] = useState<"chat" | "project">("chat");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
  const [learningContextOpen, setLearningContextOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [settingsSurface, setSettingsSurface] = useState<SettingsSurfaceState | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeRightSlotId, setActiveRightSlotId] = useState("guide");
  const [activeBottomTabId, setActiveBottomTabId] = useState<string | null>("terminal");
  const [openBottomTabIds, setOpenBottomTabIds] = useState<string[]>(["terminal", "logs"]);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelExpanded, setBottomPanelExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const applyingHistoryRef = useRef(false);
  const restoringUiStateRef = useRef(false);
  const pendingImmersiveFlowProjectIdsRef = useRef<Set<string>>(new Set());
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);

  useEffect(() => {
    const initial = apiTracker.getSettings();
    if (initial) {
      setAiSettings(initial.ai);
    } else {
      void apiTracker.refreshSettings().then(() => {
        const current = apiTracker.getSettings();
        if (current) {
          setAiSettings(current.ai);
        }
      });
    }

    const unsubscribe = apiTracker.subscribe(() => {
      const current = apiTracker.getSettings();
      if (current) {
        setAiSettings(current.ai);
      }
    });
    return unsubscribe;
  }, []);
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
    refreshTree: (() => Promise<void>) | null;
  }>({
    tree: [],
    activePath: null,
    relevantPath: null,
    openFile: null,
    createFile: null,
    deleteFile: null,
    renameFile: null,
    createFolder: null,
    duplicateFile: null,
    refreshTree: null
  });

  useConstructLogBridge();
  useProjectLspLifecycle(activeProject);

  useEffect(() => {
    let cancelled = false;

    void getSettings()
      .then((settings) => {
        if (!cancelled) {
          setShowStatusBar(settings.app?.showStatusBar !== false);
        }
      })
      .catch(() => {
        // The Vite renderer can be opened without Electron preload during local smoke checks.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { furthestUnlockedStepIndex, furthestUnlockedBlockIndex } = useMemo(() => {
    if (!activeProject) return { furthestUnlockedStepIndex: 0, furthestUnlockedBlockIndex: 0 };
    if (isFlowProjectRecord(activeProject)) return { furthestUnlockedStepIndex: 0, furthestUnlockedBlockIndex: 0 };
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
    if (isFlowProjectRecord(activeProject)) return false;
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
    if (isFlowProjectRecord(activeProject)) return true;
    const steps = activeProject.program.steps;
    const lastStepIdx = steps.length - 1;
    const lastStep = steps[lastStepIdx];
    return (
      activeProject.currentStepIndex === lastStepIdx &&
      activeProject.currentBlockIndex === Math.max(0, (lastStep?.blocks.length ?? 1) - 1)
    );
  }, [activeProject]);

  async function persistProjectState(patch: Partial<ProjectRecord>) {
    if (!activeProject || isFlowProjectRecord(activeProject)) return;
    try {
      const updated = await updateProject({
        id: activeProject.id,
        patch
      });
      if (!isFlowProjectRecord(updated)) {
        setActiveProject(updated);
      }
    } catch (caught) {
      console.error("[construct] update project failed", { id: activeProject.id, patch, caught });
    }
  }

  async function handlePrevBlock() {
    if (!activeProject || isFlowProjectRecord(activeProject)) return;
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
    if (!activeProject || isFlowProjectRecord(activeProject)) return;
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
    if (activeProject && !isFlowProjectRecord(activeProject)) {
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

  const handleFlowProjectChange = useCallback((project: FlowProjectRecord) => {
    setActiveProject(project);
  }, []);

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
    duplicateFileFn: (path: string, destPath: string) => Promise<void>,
    refreshTreeFn: () => Promise<void>
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
      duplicateFile: duplicateFileFn,
      refreshTree: refreshTreeFn
    });
  }, []);

  const handleBack = useCallback(() => {
    setSettingsSurface(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setRightPanel(null);
    setActiveProject(null);
    setBottomPanelOpen(false);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null, refreshTree: null });
    pushHistory({ id: "dashboard", title: "Projects", type: "dashboard" });
    void refresh();
    void closeProject().catch(() => {});
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
    setLearningContextOpen(false);
    setKnowledgeBaseOpen(true);
    pushHistory({ id: "knowledge-base", title: "Concepts", type: "knowledge-base" });
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
    if (!uiStateHydrated) {
      return;
    }
    void Promise.resolve().then(() => setThemeSource(theme)).catch(() => {
      // The Vite renderer can be opened without Electron preload during local smoke checks.
    });
  }, [theme, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated || restoringUiStateRef.current) {
      return;
    }

    const state: ConstructShellUiState = {
      version: 1,
      activeProjectId: activeProject?.id ?? null,
      sidebarOpen,
      rightPanelOpen,
      inspectorExpanded,
      knowledgeBaseOpen,
      learningContextOpen,
      settingsSurface,
      flowPanelView,
      activeRightSlotId,
      activeBottomTabId,
      openBottomTabIds,
      bottomPanelOpen,
      bottomPanelExpanded,
      sidebarWidth,
      inspectorWidth,
      theme,
      showStatusBar
    };
    const timeout = window.setTimeout(() => {
      void setUiState({ key: SHELL_UI_STATE_KEY, value: state }).catch(() => {
        // Browser-only smoke checks run without Electron storage.
      });
    }, 1_500);

    return () => window.clearTimeout(timeout);
  }, [
    activeBottomTabId,
    activeProject?.id,
    activeRightSlotId,
    bottomPanelExpanded,
    bottomPanelOpen,
    flowPanelView,
    inspectorExpanded,
    inspectorWidth,
    knowledgeBaseOpen,
    learningContextOpen,
    openBottomTabIds,
    rightPanelOpen,
    settingsSurface,
    showStatusBar,
    sidebarOpen,
    sidebarWidth,
    theme,
    uiStateHydrated
  ]);

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
      setOpenBottomTabIds((current) => current.length > 0 ? current : ["terminal", "logs"]);
      setActiveBottomTabId((current) => current ?? "terminal");
    } else {
      setOpenBottomTabIds([]);
      setBottomPanelOpen(false);
    }
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject) {
      apiTracker.setGit(null, 0);
      apiTracker.setLspStatus(null);
    }
  }, [activeProject]);

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
    const runtimeInfo = window.construct?.getRuntimeInfo?.();
    document.documentElement.dataset.opalineWindowType = "electron";
    document.documentElement.dataset.windowType = "electron";
    document.documentElement.dataset.opalineOs = runtimeInfo?.platform ?? "unknown";
    console.log("[construct] renderer boot", {
      platform: runtimeInfo?.platform ?? "unknown",
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
    void restoreUiStateAndProjects();

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function restoreUiStateAndProjects() {
    restoringUiStateRef.current = true;
    try {
      const [saved] = await Promise.all([
        getUiState<ConstructShellUiState | null>({ key: SHELL_UI_STATE_KEY, fallback: null }).catch(() => null),
        refresh()
      ]);
      const shellState = normalizeShellUiState(saved);
      if (shellState) {
        applyShellUiState(shellState);
        if (shellState.activeProjectId) {
          await openProject(shellState.activeProjectId, { recordHistory: true });
          applyShellUiState(shellState);
        }
      }
    } finally {
      restoringUiStateRef.current = false;
      setUiStateHydrated(true);
    }
  }

  function applyShellUiState(state: ConstructShellUiState): void {
    setSidebarOpen(state.sidebarOpen);
    setRightPanelOpen(state.rightPanelOpen);
    setInspectorExpanded(state.inspectorExpanded);
    setKnowledgeBaseOpen(state.knowledgeBaseOpen);
    setLearningContextOpen(state.learningContextOpen);
    setSettingsSurface(state.settingsSurface);
    setFlowPanelView(state.flowPanelView);
    setActiveRightSlotId(state.activeRightSlotId);
    setActiveBottomTabId(state.activeBottomTabId);
    setOpenBottomTabIds(state.openBottomTabIds);
    setBottomPanelOpen(state.bottomPanelOpen);
    setBottomPanelExpanded(state.bottomPanelExpanded);
    setSidebarWidth(state.sidebarWidth);
    setInspectorWidth(state.inspectorWidth);
    setTheme(state.theme);
    setShowStatusBar(state.showStatusBar);
  }

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
        kind: project.kind ?? "tape",
        stepCount: isFlowProjectRecord(project) ? null : project.program.steps.length,
        fileCount: isFlowProjectRecord(project) ? null : project.program.files.length,
        activeFilePath: nextProject.activeFilePath,
        currentStepIndex: isFlowProjectRecord(project) ? null : project.currentStepIndex,
        currentBlockIndex: isFlowProjectRecord(project) ? null : project.currentBlockIndex
      });
      setSettingsSurface(null);
      setFlowPanelView("chat");
      if (!restoringUiStateRef.current) {
        setRightPanelOpen(true);
        setBottomPanelOpen(true);
      }
      const shouldStartImmersive = isFlowProjectRecord(nextProject) && pendingImmersiveFlowProjectIdsRef.current.delete(nextProject.id);
      setInspectorExpanded(shouldStartImmersive);
      if (shouldStartImmersive) {
        setSidebarOpen(false);
      }
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

  async function refreshActiveProjectSnapshot(projectId: string): Promise<AnyProjectRecord | null> {
    try {
      console.log("[construct] refresh active project snapshot", { projectId });
      setIsSaving(true);
      setError(null);
      const [project, nextProjects] = await Promise.all([
        openSavedProject(projectId),
        bootstrapProjects()
      ]);
      setActiveProject((current) => current?.id === projectId ? project : current);
      setProjects(nextProjects);
      return project;
    } catch (caught) {
      console.error("[construct] refresh active project snapshot failed", { projectId, caught });
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  const handleFlowLayoutRequest = useCallback((request: FlowLayoutRequest) => {
    setFlowPanelView("chat");
    setRightPanelOpen(true);
    if (request.kind === "maximized-chat") {
      setInspectorExpanded(true);
      setSidebarOpen(request.reason !== "project-created");
      return;
    }
    setInspectorExpanded(false);
    setSidebarOpen(true);
  }, []);

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
      setInspectorExpanded(false);
      setRightPanelOpen(false);
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(false);
      setRightPanel(null);
      setActiveProject(null);
      setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null, refreshTree: null });
      finish();
      return;
    }

    if (entry.type === "knowledge-base") {
      setSettingsSurface(null);
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
        showStatusBar={showStatusBar}
        onThemeChange={setTheme}
        onShowStatusBarChange={setShowStatusBar}
        onProjectsChange={setProjects}
        onActiveProjectChange={setActiveProject}
      />
  ) : learningContextOpen ? (
    <LearningContextSurface />
  ) : knowledgeBaseOpen ? (
    <KnowledgeBaseSurface activeProject={activeProject} theme={theme} onOpenProject={(projectId) => {
      setKnowledgeBaseOpen(false);
      void openProject(projectId);
    }} />
  ) : activeProject && isFlowProjectRecord(activeProject) ? (
      <FlowWorkspace
        project={activeProject}
        activePanelView={flowPanelView}
        chatMode={rightPanelOpen && inspectorExpanded && flowPanelView === "chat" ? "maximized" : "panel"}
        theme={theme}
        onGuidePanelChange={setRightPanel}
        onKnowledgePanelChange={setSidebarKnowledgePanel}
        onPanelViewChange={setFlowPanelView}
        onLayoutRequest={handleFlowLayoutRequest}
        onProjectChange={handleFlowProjectChange}
        onRunCommand={runCommand}
        onFileOpened={handleFileOpened}
        onTreeChange={handleWorkspaceTreeChange}
        onSavingChange={setIsSaving}
      />
  ) : activeProject ? (
      <Workspace
        project={activeProject as ProjectRecord}
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

  const headerTitle = settingsSurface
    ? settingsTitle(settingsSurface.itemId, settingsSurface.projectId, projects)
    : knowledgeBaseOpen
      ? "Concepts"
      : learningContextOpen
        ? "Context"
        : activeProject?.title ?? "Projects";

  const copyText = useCallback((text: string | undefined) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard is unavailable in browser-only smoke checks.
    });
  }, []);

  const openBottomTerminal = useCallback((shellState: AppShellState) => {
    setOpenBottomTabIds((current) => current.includes("terminal") ? current : [...current, "terminal"]);
    setActiveBottomTabId("terminal");
    shellState.setBottomPanelOpen(true);
  }, []);

  const openRightWorkspacePanel = useCallback((shellState: AppShellState) => {
    if (!activeProject) return;
    if (isFlowProjectRecord(activeProject)) {
      setFlowPanelView("chat");
    } else {
      handleRightSlotChange("guide");
    }
    shellState.setRightPanelOpen(true);
  }, [activeProject, handleRightSlotChange]);

  if (!aiSettings) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <AuthGate aiSettings={aiSettings}>
        <div className="flex h-screen flex-col overflow-hidden bg-transparent">
        <div className="flex-1 min-h-0 relative">
          <AppShell
            className="h-full"
          key={activeProject?.id ?? "dashboard"}
          history={history}
          showSidebarChrome
          sidebarChrome={(state) => (
            <ConstructShellNavigationControls state={state} variant="sidebar" />
          )}
          collapsedSidebarTrigger={(state) => (
            <ConstructShellNavigationControls state={state} variant="collapsed" />
          )}
          defaultBottomPanelOpen={Boolean(activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen)}
          defaultRightPanelOpen={Boolean(activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen)}
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          inspectorOpen={rightPanelOpen}
          onInspectorOpenChange={setRightPanelOpen}
          inspectorExpanded={inspectorExpanded}
          onInspectorExpandedChange={setInspectorExpanded}
          bottomPanelOpen={Boolean(activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen && bottomPanelOpen)}
          onBottomPanelOpenChange={setBottomPanelOpen}
          bottomPanelExpanded={bottomPanelExpanded}
          onBottomPanelExpandedChange={setBottomPanelExpanded}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          inspectorWidth={inspectorWidth}
          onInspectorWidthChange={setInspectorWidth}
          headerTabs={[
            {
              id: settingsSurface
                ? `settings-${settingsSurface.itemId}`
                : knowledgeBaseOpen
                  ? "concepts"
                  : learningContextOpen
                    ? "learner-context"
                    : activeProject?.id ?? "dashboard",
              title: headerTitle,
              active: true
            }
          ]}
          renderHeaderTab={(tab, shellState) => (
            <ConstructProjectTitleMenu
              activeProject={activeProject}
              isSettingsSurface={settingsSurface != null}
              onBack={handleBack}
              onCopyProjectId={() => copyText(activeProject?.id)}
              onCopyWorkspacePath={() => copyText(activeProject?.workspacePath)}
              onNewProject={() => setIsNewProjectOpen(true)}
              onOpenProjectSettings={() => {
                if (activeProject) {
                  openSettingsSurface("project-overview", activeProject.id);
                }
              }}
              onOpenRightPanel={() => openRightWorkspacePanel(shellState)}
              onOpenTerminal={() => openBottomTerminal(shellState)}
              onOpenWorkspaceSettings={() => openSettingsSurface("workspace")}
              title={String(tab.title)}
            />
          )}
          onNavigateHome={handleBack}
          headerActions={
            activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen
              ? (state) => {
                  if (isFlowProjectRecord(activeProject)) {
                    return (
                      <>
                        <SavingIndicator isSaving={isSaving} />
                        <div className="flex items-center gap-1" aria-label="Flow controls">
                          <Tabs
                            value={!state.isRightPanelOpen || flowPanelView !== "chat" ? "hidden" : state.inspectorExpanded ? "expanded" : "normal"}
                            onValueChange={(val) => {
                              if (val === "hidden") {
                                state.setRightPanelOpen(false);
                                state.setInspectorExpanded(false);
                              } else if (val === "normal") {
                                setFlowPanelView("chat");
                                state.setRightPanelOpen(true);
                                state.setInspectorExpanded(false);
                              } else if (val === "expanded") {
                                setFlowPanelView("chat");
                                state.setRightPanelOpen(true);
                                state.setInspectorExpanded(true);
                              }
                            }}
                            className="h-7"
                          >
                            <TabsList className="h-7 gap-1 p-[2px] bg-muted/40">
                              <TabsTrigger value="expanded" className="h-[22px] w-[26px] p-0" title="Expand chat">
                                <Maximize2Icon size={13} />
                              </TabsTrigger>
                              <TabsTrigger value="normal" className="h-[22px] w-[26px] p-0" title="Normal chat">
                                <MessageCircleIcon size={13} />
                              </TabsTrigger>
                              <TabsTrigger value="hidden" className="h-[22px] w-[26px] p-0" title="Hide chat">
                                <MessageCircleOffIcon size={13} />
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                          <AppShellHeaderToolButton
                            data-active={state.isRightPanelOpen && flowPanelView === "project" ? "true" : "false"}
                            onClick={() => {
                              if (state.isRightPanelOpen && flowPanelView === "project") {
                                state.toggleRightPanel();
                                return;
                              }
                              void (async () => {
                                setFlowPanelView("project");
                                const refreshed = await refreshActiveProjectSnapshot(activeProject.id);
                                if (refreshed && !isFlowProjectRecord(refreshed)) return;
                                if (!refreshed) return;
                                state.setRightPanelOpen(true);
                              })();
                            }}
                            aria-label="Open Flow project map"
                            title="Project map"
                          >
                            <ListChecksIcon size={15} />
                          </AppShellHeaderToolButton>
                          <AppShellHeaderToolButton
                            data-active={state.isBottomPanelOpen ? "true" : "false"}
                            onClick={state.toggleBottomPanel}
                            aria-label="Toggle terminal"
                            title="Terminal"
                          >
                            <HeaderBottomPanelIcon open={state.isBottomPanelOpen} />
                          </AppShellHeaderToolButton>
                        </div>
                      </>
                    );
                  }
                  const tapeProject = activeProject;
                  const isAtFrontier =
                    tapeProject.currentStepIndex === furthestUnlockedStepIndex &&
                    tapeProject.currentBlockIndex === furthestUnlockedBlockIndex;
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
                          disabled={tapeProject.currentStepIndex === 0 && tapeProject.currentBlockIndex === 0}
                          title="Previous Panel"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                          </svg>
                        </AppShellChromeButton>

                        <Badge variant="secondary">
                          {currentBlockNumber(tapeProject)}/{totalBlocks(tapeProject.program)}
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
                      {isFlowProjectRecord(activeProject) ? (
                        <SidebarConceptsButton onClick={openKnowledgeBase} />
                      ) : (
                        <SidebarLearningButton onClick={openLearningContext} />
                      )}
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
                        onRefresh={treeData.refreshTree ?? undefined}
                      />
                    ) : null}
                  </div>
                  {sidebarKnowledgePanel && !isFlowProjectRecord(activeProject) ? (
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
                    label: "Concepts",
                    onClick: openKnowledgeBase
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
          rightPanel={activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen ? rightPanel : null}
          bottomPanel={activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen ? (shellState) => (
              <BottomPanel
                expanded={shellState.bottomPanelExpanded}
                onExpandChange={shellState.setBottomPanelExpanded}
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
        {activeProject && !settingsSurface && !isFlowProjectRecord(activeProject) ? (
          <SelectionExplanationController
            project={activeProject}
            theme={theme}
            onOpenFile={treeData.openFile ?? undefined}
          />
        ) : null}
        </div>
        {showStatusBar ? <StatusBar theme={theme} onThemeChange={setTheme} /> : null}
      </div>
      <NewProjectDialog
        open={isNewProjectOpen}
        onOpenChange={setIsNewProjectOpen}
        onProjectCreated={(project) => {
          setActiveProject(project);
          if (isFlowProjectRecord(project)) {
            pendingImmersiveFlowProjectIdsRef.current.add(project.id);
            handleFlowLayoutRequest({ kind: "maximized-chat", reason: "project-created" });
          } else {
            setRightPanelOpen(true);
            setInspectorExpanded(false);
          }
          setBottomPanelOpen(true);
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
                kind: project.kind ?? "tape",
                id: project.id,
                title: project.title,
                description: project.description,
                progress: project.progress,
                lastOpenedAt: project.lastOpenedAt,
                sourcePath: project.sourcePath,
                workspacePath: project.workspacePath,
                flowGoal: isFlowProjectRecord(project) ? project.flow.goal : undefined,
                flowSessionCount: isFlowProjectRecord(project) ? project.flow.sessions.length : undefined,
                flowLastActivityAt: isFlowProjectRecord(project) ? project.flow.updatedAt : undefined
              },
              ...withoutProject
            ];
          });
        }}
      />
      </AuthGate>
    </AppErrorBoundary>
  );
}

function ConstructShellNavigationControls({
  state,
  variant,
}: {
  state: AppShellState;
  variant: "collapsed" | "sidebar";
}) {
  const Control = variant === "collapsed" ? AppShellCollapsedSidebarTrigger : AppShellChromeButton;
  const active = variant === "collapsed";

  return (
    <div className="flex items-center gap-1">
      <Control
        aria-label={state.sidebarOpen ? "Close sidebar" : "Open sidebar"}
        className="rounded-[12px]"
        onClick={state.toggleSidebar}
      >
        <SidebarIcon size={15} strokeWidth={1.8} />
      </Control>
      <Control
        aria-label="Projects"
        className="rounded-[12px]"
        data-active={active ? "true" : undefined}
        disabled={!state.canNavigateHome}
        onClick={state.navigateHome}
      >
        <HomeIcon size={15} strokeWidth={1.8} />
      </Control>
      <Control
        aria-label="Back"
        className="rounded-[12px]"
        disabled={!state.canNavigateBack}
        onClick={state.navigateBack}
      >
        <ArrowLeftIcon size={15} strokeWidth={1.8} />
      </Control>
      <Control
        aria-label="Forward"
        className="rounded-[12px]"
        disabled={!state.canNavigateForward}
        onClick={state.navigateForward}
      >
        <ArrowRightIcon size={15} strokeWidth={1.8} />
      </Control>
    </div>
  );
}

function ConstructProjectTitleMenu({
  activeProject,
  isSettingsSurface,
  onBack,
  onCopyProjectId,
  onCopyWorkspacePath,
  onNewProject,
  onOpenProjectSettings,
  onOpenRightPanel,
  onOpenTerminal,
  onOpenWorkspaceSettings,
  title,
}: {
  activeProject: AnyProjectRecord | null;
  isSettingsSurface: boolean;
  onBack: () => void;
  onCopyProjectId: () => void;
  onCopyWorkspacePath: () => void;
  onNewProject: () => void;
  onOpenProjectSettings: () => void;
  onOpenRightPanel: () => void;
  onOpenTerminal: () => void;
  onOpenWorkspaceSettings: () => void;
  title: string;
}) {
  const isFlow = activeProject != null && isFlowProjectRecord(activeProject);

  return (
    <div className="inline-flex max-w-[min(24rem,48vw)] items-center gap-1.5 [-webkit-app-region:no-drag]">
      <span className="min-w-0 max-w-80 truncate px-1 text-sm font-medium" title={title}>
        {title}
      </span>
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          render={
            <Button
              aria-label="Project actions"
              className="size-8 shrink-0 rounded-[14px] text-muted-foreground hover:text-foreground"
              size="icon"
              type="button"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon size={15} strokeWidth={2} />
        </ShadcnDropdownMenuTrigger>
        <ShadcnDropdownMenuContent align="start" className="w-64 rounded-[18px] p-1.5">
          {activeProject != null ? (
            <>
              <ShadcnDropdownMenuItem onClick={onOpenRightPanel}>
                <PanelRightIcon size={14} />
                {isFlow ? "Open Flow agent" : "Open guide panel"}
              </ShadcnDropdownMenuItem>
              <ShadcnDropdownMenuItem onClick={onOpenTerminal}>
                <TerminalSquareIcon size={14} />
                Open terminal
              </ShadcnDropdownMenuItem>
              <ShadcnDropdownMenuItem onClick={onOpenProjectSettings}>
                <SettingsIcon size={14} />
                Project settings
              </ShadcnDropdownMenuItem>
              <ShadcnDropdownMenuSeparator />
              <ShadcnDropdownMenuItem onClick={onCopyWorkspacePath}>
                <FolderOpenIcon size={14} />
                Copy workspace path
              </ShadcnDropdownMenuItem>
              <ShadcnDropdownMenuItem onClick={onCopyProjectId}>
                <CopyIcon size={14} />
                Copy project ID
              </ShadcnDropdownMenuItem>
              <ShadcnDropdownMenuSeparator />
            </>
          ) : null}
          <ShadcnDropdownMenuItem onClick={onNewProject}>
            <PlusIcon size={14} />
            New project
          </ShadcnDropdownMenuItem>
          <ShadcnDropdownMenuItem onClick={onOpenWorkspaceSettings}>
            <SettingsIcon size={14} />
            Workspace settings
          </ShadcnDropdownMenuItem>
          {(activeProject != null || isSettingsSurface) ? (
            <>
              <ShadcnDropdownMenuSeparator />
              <ShadcnDropdownMenuItem onClick={onBack}>
                <HomeIcon size={14} />
                Back to projects
              </ShadcnDropdownMenuItem>
            </>
          ) : null}
        </ShadcnDropdownMenuContent>
      </ShadcnDropdownMenu>
    </div>
  );
}

export function cleanAndNormalizeUrl(url: string | null | undefined, fallback: string = "https://cloud.tryconstruct.cc"): string {
  if (!url || typeof url !== "string") return fallback;
  
  let cleaned = url.trim().replace(/\/$/, "");
  if (cleaned.length === 0) return fallback;

  // Replace spaces/colons before port with standard colon (e.g. "localhost 8787" -> "localhost:8787")
  cleaned = cleaned.replace(/^(https?:\/\/)?([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])\s*:?\s*(\d+)$/, (_, protocol, host, port) => {
    const proto = protocol || '';
    return `${proto}${host}:${port}`;
  });

  // Prepend protocol if missing
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(cleaned);
    cleaned = (isLocal ? "http://" : "https://") + cleaned;
  }

  // Auto-append path suffixes for known official endpoints if missing:
  if (cleaned.includes("openrouter.ai") && !cleaned.endsWith("/api/v1") && !cleaned.endsWith("/v1")) {
    cleaned = cleaned.endsWith("/api") ? `${cleaned}/v1` : `${cleaned}/api/v1`;
  } else if (cleaned.includes("api.openai.com") && !cleaned.endsWith("/v1")) {
    cleaned = `${cleaned}/v1`;
  } else if (cleaned.includes("opencode.ai") && !cleaned.endsWith("/zen/v1") && !cleaned.endsWith("/v1")) {
    cleaned = cleaned.endsWith("/zen") ? `${cleaned}/v1` : `${cleaned}/zen/v1`;
  }

  return cleaned;
}
