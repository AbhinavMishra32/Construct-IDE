import { AppErrorBoundary } from "./AppErrorBoundary";
import { ConstructSettingsSurface, buildSettingsSections, settingsTitle } from "./ConstructSettingsSurface";
import { LearningContextSurface } from "./LearningContextSurface";
import { HeaderBottomPanelIcon, HeaderGuidePanelIcon, SavingIndicator, SidebarConceptsButton, SidebarLearningButton, SidebarSettingsButton } from "./ShellControls";
import { applyDocumentTheme, getInitialTheme, resolveActiveTheme, type ThemeMode } from "./theme";
import {
  applyCodeThemeToDocument,
  normalizeCodeThemeId,
  resolveCodeThemeDefinition,
  type CodeThemeId
} from "./codeThemes";
import { registerConstructThemes } from "./editorThemes";
import { useConstructLogBridge } from "./lib/useConstructLogBridge";
import { useProjectLspLifecycle } from "./lib/useProjectLspLifecycle";
import { StatusBar } from "./components/StatusBar";
import { apiTracker } from "./lib/apiTracker";
import { useAuth, useSession } from "@better-auth-ui/react";
import { createAuthClient } from "better-auth/react";
import { Auth } from "../components/auth/auth";
import { AuthProvider } from "../components/auth/auth-provider";
import { ConstructAuthLogo } from "../components/auth/construct-auth-logo";
import { UserAvatar } from "../components/auth/user/user-avatar";
import type { AuthView } from "@better-auth-ui/core";
import type { AiSettings, AppSettings } from "./types";
import { CONSTRUCT_CLOUD_PRODUCTION_BASE_URL, endpointFromRuntimeInfo } from "../../shared/constructCloud";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type ComponentPropsWithoutRef, type PropsWithChildren } from "react";
import {
  BookOpen,
  ChevronRightIcon,
  ChevronDownIcon,
  CloudIcon,
  CopyIcon,
  FileTerminalIcon,
  FileTextIcon,
  FolderOpenIcon,
  HomeIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  MessageCircleIcon,
  MessageCircleOff as MessageCircleOffIcon,
  Maximize2 as Maximize2Icon,
  PanelRightIcon,
  SearchIcon,
  SettingsIcon,
  TerminalSquareIcon,
  UserRoundIcon,
  XIcon
} from "lucide-react";

import {
  DesktopShell,
  DesktopSidebar,
  DesktopChromeButton,
  DesktopHeaderToolButton,
  Badge,
  BottomPanel,
  Button,
  Input,
  SettingsSidebar,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuSeparator,
  ShadcnDropdownMenuTrigger,
  SidebarMenuButton,
  Tabs,
  TabsList,
  TabsTrigger,
  useShellHistory
} from "@opaline/ui";
import type { SettingsNavItem, ShellHistoryEntry } from "@opaline/ui";
import type { DesktopShellState } from "@opaline/ui";
import { cn } from "../lib/utils";

import { Dashboard } from "./components/Dashboard";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { ProjectsSurface } from "./components/ProjectsSurface";
import { FileTree } from "./components/FileTree";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import { FlowWorkspace, type FlowLayoutRequest } from "./components/FlowWorkspace";
import { LogsPanel } from "./components/LogsPanel";
import { KnowledgeBaseSurface } from "./components/KnowledgeBaseSurface";
import { SelectionExplanationController } from "./components/SelectionExplanationController";
import { defaultFlowProjectSettings, inferFlowTitle } from "./components/project-create/flowProjectDefaults";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import {
  setThemeSource,
  createFlowProject,
  getUiState,
  setUiState,
  getSettings,
  updateAiSettings,
  updateProject,
  closeProject,
  flushStorage
} from "./lib/bridge";
import type { AnyProjectRecord, FlowProjectRecord, ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";
import { isFlowProjectRecord } from "./types";
import { currentBlock, currentBlockNumber, totalBlocks, nextPosition } from "./lib/runtime";

type ConstructHistoryEntry = ShellHistoryEntry<
  "bottom-tab" | "dashboard" | "file" | "knowledge-base" | "learner-context" | "project" | "project-settings" | "projects" | "right-slot" | "settings",
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

type ConstructAppUiState = {
  version: 1;
  theme: ThemeMode;
  showStatusBar: boolean;
  codeThemeId?: CodeThemeId;
  customCodeThemeJson?: string;
};

type ConstructProjectShellUiState = {
  version: 1;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  inspectorExpanded: boolean;
  flowPanelView: "chat" | "project";
  activeRightSlotId: string;
  activeBottomTabId: string | null;
  openBottomTabIds: string[];
  bottomPanelOpen: boolean;
  bottomPanelExpanded: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
};

const SHELL_UI_STATE_KEY = "shell";
const PROJECT_SHELL_UI_STATE_KEY = "project.shell";
const PRIMARY_TERMINAL_TAB_ID = "terminal";
const OUTPUT_TAB_ID = "logs";

function isTerminalBottomTabId(tabId: string): boolean {
  return tabId === PRIMARY_TERMINAL_TAB_ID || tabId.startsWith("terminal-");
}

function rightSlotTitle(slotId: string): string {
  if (slotId === "steps") return "Steps";
  if (slotId === "interact") return "Interact";
  if (slotId === "git") return "Git";
  return "Guide";
}

function normalizeAppUiState(value: unknown): ConstructAppUiState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ConstructAppUiState>;
  return {
    version: 1,
    theme: input.theme === "light" || input.theme === "dark" || input.theme === "system" ? input.theme : getInitialTheme(),
    showStatusBar: input.showStatusBar !== false,
    codeThemeId: normalizeCodeThemeId(input.codeThemeId),
    customCodeThemeJson: typeof input.customCodeThemeJson === "string" ? input.customCodeThemeJson : ""
  };
}

function normalizeProjectShellUiState(value: unknown): ConstructProjectShellUiState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ConstructProjectShellUiState>;
  return {
    version: 1,
    sidebarOpen: typeof input.sidebarOpen === "boolean" ? input.sidebarOpen : true,
    rightPanelOpen: typeof input.rightPanelOpen === "boolean" ? input.rightPanelOpen : false,
    inspectorExpanded: typeof input.inspectorExpanded === "boolean" ? input.inspectorExpanded : false,
    flowPanelView: input.flowPanelView === "project" ? "project" : "chat",
    activeRightSlotId: typeof input.activeRightSlotId === "string" && input.activeRightSlotId.trim() ? input.activeRightSlotId : "guide",
    activeBottomTabId: typeof input.activeBottomTabId === "string" ? input.activeBottomTabId : null,
    openBottomTabIds: Array.isArray(input.openBottomTabIds)
      ? input.openBottomTabIds.filter((id): id is string => typeof id === "string")
      : [],
    bottomPanelOpen: typeof input.bottomPanelOpen === "boolean" ? input.bottomPanelOpen : false,
    bottomPanelExpanded: typeof input.bottomPanelExpanded === "boolean" ? input.bottomPanelExpanded : false,
    sidebarWidth: normalizePanelWidth(input.sidebarWidth, 300, 240, 520),
    inspectorWidth: normalizePanelWidth(input.inspectorWidth, 320, 260, 760)
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

function ConstructSplashScreen() {
  return (
    <div className="construct-startup-splash" role="status" aria-label="Loading Construct">
      <div className="construct-startup-splash__logo" aria-hidden="true" />
    </div>
  );
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
  const { data: session, isPending, isError } = useSession(authClient);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    console.log("[auth] Checking account status...", { isPending, hasSession: !!session, isError });
  }, [isPending, session, isError]);

  useEffect(() => {
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
  }, [isPending, session, baseUrl]);

  const connectFailed = isError || (timedOut && !session);

  if (connectFailed) {
    const signOutAndReload = async () => {
      localStorage.removeItem("bearer_token");
      try {
        await authClient.signOut();
      } catch {
        // The cloud service may be unreachable; local token cleanup is still useful.
      }
      window.location.reload();
    };

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-foreground font-sans">
        <div className="construct-auth-card flex w-full max-w-[420px] flex-col items-center gap-5 rounded-[14px] border border-border/70 bg-card/88 p-8 text-center shadow-[0_18px_44px_color-mix(in_srgb,var(--foreground)_8%,transparent)] backdrop-blur-xl dark:shadow-none">
          <ConstructAuthLogo className="mb-1" markClassName="construct-auth-logo__mark--hero" />
          <h2 className="text-xl font-bold tracking-tight">Construct Cloud is not reachable</h2>
          <p className="text-xs text-muted-foreground max-w-[320px]">
            Construct could not reach your account service. Check your connection, retry, or sign out and use another account.
          </p>
          <div className="flex w-full gap-2">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => void signOutAndReload()}
              className="flex-1 px-4 py-2 text-xs font-semibold rounded-lg border hover:bg-muted transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isPending) {
    return <ConstructSplashScreen />;
  }

  if (!session) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans">
        <div className="flex w-[420px] max-w-[calc(100vw-3rem)] flex-col gap-7 px-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <ConstructAuthLogo className="mb-1" markClassName="construct-auth-logo__mark--hero" />
          </div>

          <Auth view={authView} socialLayout="vertical" className="construct-auth-card w-full" />
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

function configuredConstructCloudEndpoint(): string {
  return endpointFromRuntimeInfo(window.construct?.getRuntimeInfo?.());
}

function useRuntimePlatformAttribute() {
  useEffect(() => {
    const platform = window.construct?.getRuntimeInfo?.().platform;
    if (!platform) return;

    document.documentElement.dataset.constructPlatform = platform;
    return () => {
      delete document.documentElement.dataset.constructPlatform;
    };
  }, []);
}

export default function ConstructApp() {
  const history = useShellHistory<ConstructHistoryEntry>([
    { id: "dashboard", title: "Home", type: "dashboard" }
  ]);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<AnyProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [sidebarKnowledgePanel, setSidebarKnowledgePanel] = useState<ReactNode | null>(null);
  const [conceptsSidebarPanel, setConceptsSidebarPanel] = useState<ReactNode | null>(null);
  const [flowLearningMaterialsHidden, setFlowLearningMaterialsHidden] = useState(false);
  const [flowPanelView, setFlowPanelView] = useState<"chat" | "project">("chat");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
  const [learningContextOpen, setLearningContextOpen] = useState(false);
  const [projectsViewOpen, setProjectsViewOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [settingsSurface, setSettingsSurface] = useState<SettingsSurfaceState | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeRightSlotId, setActiveRightSlotId] = useState("guide");
  const [activeBottomTabId, setActiveBottomTabId] = useState<string | null>(PRIMARY_TERMINAL_TAB_ID);
  const [openBottomTabIds, setOpenBottomTabIds] = useState<string[]>([PRIMARY_TERMINAL_TAB_ID, OUTPUT_TAB_ID]);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelExpanded, setBottomPanelExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [codeThemeId, setCodeThemeId] = useState<CodeThemeId>("construct");
  const [customCodeThemeJson, setCustomCodeThemeJson] = useState("");
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const terminalTabSequenceRef = useRef(1);
  const applyingHistoryRef = useRef(false);
  const restoringUiStateRef = useRef(false);
  const restoringProjectUiStateRef = useRef(false);
  const pendingImmersiveFlowProjectIdsRef = useRef<Set<string>>(new Set());
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const projectShellUiState = useMemo<ConstructProjectShellUiState>(() => ({
    version: 1,
    sidebarOpen,
    rightPanelOpen,
    inspectorExpanded,
    flowPanelView,
    activeRightSlotId,
    activeBottomTabId,
    openBottomTabIds,
    bottomPanelOpen,
    bottomPanelExpanded,
    sidebarWidth,
    inspectorWidth
  }), [
    activeBottomTabId,
    activeRightSlotId,
    bottomPanelExpanded,
    bottomPanelOpen,
    flowPanelView,
    inspectorExpanded,
    inspectorWidth,
    openBottomTabIds,
    rightPanelOpen,
    sidebarOpen,
    sidebarWidth
  ]);
  const projectShellUiStateRef = useRef(projectShellUiState);

  useRuntimePlatformAttribute();

  useEffect(() => {
    projectShellUiStateRef.current = projectShellUiState;
  }, [projectShellUiState]);

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
          setCodeThemeId(normalizeCodeThemeId(settings.app?.codeThemeId));
          setCustomCodeThemeJson(settings.app?.customCodeThemeJson ?? "");
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

  const createTerminalTabId = useCallback(() => {
    terminalTabSequenceRef.current += 1;
    return `terminal-${Date.now()}-${terminalTabSequenceRef.current}`;
  }, []);

  const ensureBottomTerminalOpen = useCallback(() => {
    setOpenBottomTabIds((current) => current.includes(PRIMARY_TERMINAL_TAB_ID) ? current : [PRIMARY_TERMINAL_TAB_ID, ...current]);
    setActiveBottomTabId(PRIMARY_TERMINAL_TAB_ID);
    setBottomPanelOpen(true);
  }, []);

  const runCommand = useCallback((command: string, cwd: string) => {
    ensureBottomTerminalOpen();
    if (!command.trim()) {
      return;
    }
    window.setTimeout(() => terminalRef.current?.runCommand(command, cwd), 0);
  }, [ensureBottomTerminalOpen]);

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

  const handleFileTreeExpandedChange = useCallback((expandedPaths: string[]) => {
    if (!activeProject) {
      return;
    }
    const normalized = [...new Set(expandedPaths.filter((path) => path.trim()))].sort();
    const projectId = activeProject.id;
    setActiveProject((current) => current?.id === projectId
      ? ({ ...current, fileTreeExpanded: normalized } as AnyProjectRecord)
      : current);
    void updateProject({
      id: projectId,
      patch: { fileTreeExpanded: normalized }
    }).then((project) => {
      setActiveProject((current) => current?.id === projectId ? project : current);
    }).catch(() => {
      // Folder expansion is a convenience state; keep the local UI responsive if persistence fails.
    });
  }, [activeProject?.id]);

  function showDashboardSurface(options: {
    persistCurrentProject?: boolean;
    recordHistory?: boolean;
  } = {}) {
    if (options.persistCurrentProject !== false && activeProject && uiStateHydrated) {
      void persistProjectShellUiState(activeProject.id, projectShellUiStateRef.current, { flush: true }).catch(() => {
        // Best-effort layout checkpoint before leaving a project.
      });
    }
    setSettingsSurface(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setProjectsViewOpen(false);
    setRightPanel(null);
    setRightPanelOpen(false);
    setInspectorExpanded(false);
    setFlowPanelView("chat");
    setActiveRightSlotId("guide");
    setActiveBottomTabId(null);
    setOpenBottomTabIds([]);
    setBottomPanelOpen(false);
    setBottomPanelExpanded(false);
    setSidebarOpen(true);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null, createFile: null, deleteFile: null, renameFile: null, createFolder: null, duplicateFile: null, refreshTree: null });
    if (options.recordHistory !== false) {
      pushHistory({ id: "dashboard", title: "Home", type: "dashboard" });
    }
    void Promise.resolve().then(() => closeProject()).catch(() => {});
  }

  const handleBack = useCallback(() => {
    showDashboardSurface({ persistCurrentProject: true, recordHistory: true });
    void refresh();
  }, [activeProject?.id, projectShellUiState, pushHistory, uiStateHydrated]);

  const openSettingsSurface = useCallback((itemId: string, projectId?: string) => {
    const originProjectId = projectId ?? activeProject?.id;
    const isProjectItem = itemId.startsWith("project-");
    if (isProjectItem && !originProjectId) {
      return;
    }
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setSettingsSurface({ itemId, projectId: originProjectId });
    setSettingsQuery("");
    pushHistory({
      id: originProjectId ? `${isProjectItem ? "project-settings" : "settings"}:${originProjectId}:${itemId}` : `settings:${itemId}`,
      payload: { projectId: originProjectId, settingsItemId: itemId },
      title: isProjectItem ? "Project settings" : "Settings",
      type: isProjectItem ? "project-settings" : "settings"
    });
  }, [activeProject?.id, pushHistory]);

  const openKnowledgeBase = useCallback(() => {
    const originProjectId = activeProject?.id;
    setSettingsSurface(null);
    setLearningContextOpen(false);
    setKnowledgeBaseOpen(true);
    pushHistory({
      id: originProjectId ? `knowledge-base:${originProjectId}` : "knowledge-base",
      payload: { projectId: originProjectId },
      title: "Concepts",
      type: "knowledge-base"
    });
  }, [activeProject?.id, pushHistory]);

  const openLearningContext = useCallback(() => {
    setSettingsSurface(null);
    setActiveProject(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(true);
    pushHistory({ id: "learner-context", title: "Context", type: "learner-context" });
  }, [pushHistory]);

  const openProjectsView = useCallback(() => {
    const originProjectId = activeProject?.id;
    setSettingsSurface(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
    setProjectsViewOpen(true);
    pushHistory({
      id: originProjectId ? `projects:${originProjectId}` : "projects",
      payload: { projectId: originProjectId },
      title: "Projects",
      type: "projects"
    });
  }, [activeProject?.id, pushHistory]);

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
    const codeThemeDefinition = resolveCodeThemeDefinition(codeThemeId, customCodeThemeJson);
    registerConstructThemes(codeThemeDefinition);
    applyCodeThemeToDocument(codeThemeDefinition, active);
    localStorage.setItem("construct.theme", theme);
    if (!uiStateHydrated) {
      return;
    }
    void Promise.resolve().then(() => setThemeSource(theme)).catch(() => {
      // The Vite renderer can be opened without Electron preload during local smoke checks.
    });
  }, [codeThemeId, customCodeThemeJson, theme, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated || restoringUiStateRef.current) {
      return;
    }

    const state: ConstructAppUiState = {
      version: 1,
      theme,
      showStatusBar,
      codeThemeId,
      customCodeThemeJson
    };
    const timeout = window.setTimeout(() => {
      void setUiState({ key: SHELL_UI_STATE_KEY, value: state }).catch(() => {
        // Browser-only smoke checks run without Electron storage.
      });
    }, 1_500);

    return () => window.clearTimeout(timeout);
  }, [codeThemeId, customCodeThemeJson, showStatusBar, theme, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated || restoringUiStateRef.current || restoringProjectUiStateRef.current || !activeProject) {
      return;
    }

    void persistProjectShellUiState(activeProject.id, projectShellUiState).catch(() => {
      // Browser-only smoke checks run without Electron storage.
    });
  }, [activeProject?.id, projectShellUiState, uiStateHydrated]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const projectId = activeProject?.id;
      if (!projectId) {
        return;
      }
      void persistProjectShellUiState(projectId, projectShellUiStateRef.current).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeProject?.id]);

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
    if (!activeProject) {
      setOpenBottomTabIds([]);
      setActiveBottomTabId(null);
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
        if (bottomPanelOpen && activeBottomTabId === PRIMARY_TERMINAL_TAB_ID) {
          setBottomPanelOpen(false);
        } else {
          ensureBottomTerminalOpen();
        }
      }

      // Toggle Output: Ctrl+Shift+U or Cmd+Shift+U
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setOpenBottomTabIds((prev) => {
          const isLogsActive = activeBottomTabId === OUTPUT_TAB_ID;
          if (prev.includes(OUTPUT_TAB_ID) && isLogsActive) {
            const next = prev.filter((id) => id !== OUTPUT_TAB_ID);
            if (next.length > 0) {
              setActiveBottomTabId(next[next.length - 1]);
            } else {
              setActiveBottomTabId(null);
            }
            return next;
          } else {
            setActiveBottomTabId(OUTPUT_TAB_ID);
            if (!prev.includes(OUTPUT_TAB_ID)) {
              return [...prev, OUTPUT_TAB_ID];
            }
            return prev;
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBottomTabId, bottomPanelOpen, ensureBottomTerminalOpen]);

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

    const scrollTimeouts = new Map<HTMLElement, number>();
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        target.setAttribute("data-scrolling", "true");
        const existingTimeout = scrollTimeouts.get(target);
        if (existingTimeout) {
          window.clearTimeout(existingTimeout);
        }
        const timeout = window.setTimeout(() => {
          target.removeAttribute("data-scrolling");
          scrollTimeouts.delete(target);
        }, 1000);
        scrollTimeouts.set(target, timeout);
      }
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("scroll", handleScroll, true);
    void restoreUiStateAndProjects();

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("scroll", handleScroll, true);
      scrollTimeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, []);

  async function restoreUiStateAndProjects() {
    restoringUiStateRef.current = true;
    try {
      const [saved] = await Promise.all([
        getUiState<ConstructAppUiState | null>({ key: SHELL_UI_STATE_KEY, fallback: null }).catch(() => null),
        refresh()
      ]);
      const appState = normalizeAppUiState(saved);
      if (appState) {
        applyAppUiState(appState);
      }
      showDashboardSurface({ recordHistory: false });
    } finally {
      restoringUiStateRef.current = false;
      setUiStateHydrated(true);
    }
  }

  function applyAppUiState(state: ConstructAppUiState): void {
    setTheme(state.theme);
    setShowStatusBar(state.showStatusBar);
    setCodeThemeId(normalizeCodeThemeId(state.codeThemeId));
    setCustomCodeThemeJson(state.customCodeThemeJson ?? "");
  }

  function applyProjectShellUiState(state: ConstructProjectShellUiState): void {
    setSidebarOpen(state.sidebarOpen);
    setRightPanelOpen(state.rightPanelOpen);
    setInspectorExpanded(state.inspectorExpanded);
    setFlowPanelView(state.flowPanelView);
    setActiveRightSlotId(state.activeRightSlotId);
    setActiveBottomTabId(state.activeBottomTabId);
    setOpenBottomTabIds(state.openBottomTabIds);
    setBottomPanelOpen(state.bottomPanelOpen);
    setBottomPanelExpanded(state.bottomPanelExpanded);
    setSidebarWidth(state.sidebarWidth);
    setInspectorWidth(state.inspectorWidth);
  }

  function defaultProjectShellUiState(input: {
    flowProject: boolean;
    immersiveFlow?: boolean;
  }): ConstructProjectShellUiState {
    const immersiveFlow = input.flowProject && input.immersiveFlow === true;
    return {
      version: 1,
      sidebarOpen: !immersiveFlow,
      rightPanelOpen: true,
      inspectorExpanded: immersiveFlow,
      flowPanelView: "chat",
      activeRightSlotId: "guide",
      activeBottomTabId: PRIMARY_TERMINAL_TAB_ID,
      openBottomTabIds: [PRIMARY_TERMINAL_TAB_ID, OUTPUT_TAB_ID],
      bottomPanelOpen: true,
      bottomPanelExpanded: false,
      sidebarWidth: 300,
      inspectorWidth: 320
    };
  }

  async function persistProjectShellUiState(
    projectId: string,
    state: ConstructProjectShellUiState,
    options: { flush?: boolean } = {}
  ): Promise<void> {
    await setUiState({
      key: PROJECT_SHELL_UI_STATE_KEY,
      scope: "workspace",
      projectId,
      value: state
    });
    if (options.flush) {
      await flushStorage();
    }
  }

  async function readProjectShellUiState(projectId: string): Promise<ConstructProjectShellUiState | null> {
    const saved = await getUiState<ConstructProjectShellUiState | null>({
      key: PROJECT_SHELL_UI_STATE_KEY,
      scope: "workspace",
      projectId,
      fallback: null
    }).catch(() => null);
    return normalizeProjectShellUiState(saved);
  }

  const refresh = useCallback(async () => {
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
  }, []);

  async function openProject(projectId: string, options: { filePath?: string; recordHistory?: boolean } = {}) {
    try {
      console.log("[construct] open project start", { projectId, options });
      setBusy(true);
      setError(null);
      if (activeProject && activeProject.id !== projectId && uiStateHydrated && !restoringUiStateRef.current) {
        await persistProjectShellUiState(activeProject.id, projectShellUiStateRef.current).catch(() => {});
      }
      const project = await openSavedProject(projectId);
      const nextProject = options.filePath ? { ...project, activeFilePath: options.filePath } : project;
      const shouldStartImmersive = isFlowProjectRecord(nextProject) && pendingImmersiveFlowProjectIdsRef.current.delete(nextProject.id);
      const savedProjectShellState = shouldStartImmersive
        ? null
        : activeProject?.id === nextProject.id
          ? projectShellUiStateRef.current
          : await readProjectShellUiState(nextProject.id);
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
      restoringProjectUiStateRef.current = true;
      setSettingsSurface(null);
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(false);
      applyProjectShellUiState(savedProjectShellState ?? defaultProjectShellUiState({
        flowProject: isFlowProjectRecord(nextProject),
        immersiveFlow: shouldStartImmersive
      }));
      setActiveProject(nextProject);
      window.setTimeout(() => {
        restoringProjectUiStateRef.current = false;
      }, 0);
      setProjects((current) => upsertProjectSummary(current, projectSummaryFromRecord(nextProject)));
      if (!isFlowProjectRecord(nextProject)) {
        void bootstrapProjects()
          .then((nextProjects) => {
            console.log("[construct] open project refreshed list", { count: nextProjects.length });
            setProjects(nextProjects);
          })
          .catch((caught) => console.warn("[construct] background project list refresh failed", caught));
      }
      if (options.recordHistory !== false) {
        pushHistory({
          id: options.filePath ? `file:${projectId}:${options.filePath}` : `project:${projectId}`,
          payload: { filePath: options.filePath, projectId },
          title: options.filePath ?? project.title,
          type: options.filePath ? "file" : "project"
        });
      }
    } catch (caught) {
      restoringProjectUiStateRef.current = false;
      console.error("[construct] open project failed", { projectId, options, caught });
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleCreatedProject(project: AnyProjectRecord): void {
    setSettingsSurface(null);
    setKnowledgeBaseOpen(false);
    setLearningContextOpen(false);
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
      return [projectSummaryFromRecord(project), ...withoutProject].sort(compareProjectSummaryActivity);
    });
  }

  async function createProjectFromHomePrompt(prompt: string): Promise<FlowProjectRecord> {
    const goal = prompt.trim();
    if (!goal) {
      throw new Error("Describe what you want to build first.");
    }
    return createFlowProject({
      title: inferFlowTitle(goal),
      goal,
      researchFirst: true,
      autonomyPreference: "balanced",
      permissionsPreference: defaultFlowProjectSettings.agentEdits,
      projectSettings: defaultFlowProjectSettings
    });
  }

  async function openHomeCreatedFlowProject(project: FlowProjectRecord): Promise<void> {
    const saved = await openSavedProject(project.id).catch(() => null);
    const latest = isFlowProjectRecord(saved)
      ? mergeFlowProjectLiveSnapshot(saved, project)
      : project;
    handleCreatedProject(latest);
  }

  async function refreshActiveProjectSnapshot(projectId: string): Promise<AnyProjectRecord | null> {
    try {
      console.log("[construct] refresh active project snapshot", { projectId });
      setIsSaving(true);
      setError(null);
      const project = await openSavedProject(projectId);
      setActiveProject((current) => current?.id === projectId ? project : current);
      setProjects((current) => upsertProjectSummary(current, projectSummaryFromRecord(project)));
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
    const isHomeActive = !settingsSurface && !learningContextOpen && !projectsViewOpen && !knowledgeBaseOpen && !activeProject;
    if (isHomeActive) {
      void refresh();
    }
  }, [settingsSurface, learningContextOpen, projectsViewOpen, knowledgeBaseOpen, activeProject, refresh]);

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
      showDashboardSurface({ persistCurrentProject: true, recordHistory: false });
      finish();
      return;
    }

    if (entry.type === "knowledge-base") {
      const projectId = entry.payload?.projectId;
      if (projectId && activeProject?.id !== projectId) {
        void openProject(projectId, { recordHistory: false }).then(() => {
          setSettingsSurface(null);
          setLearningContextOpen(false);
          setKnowledgeBaseOpen(true);
        }).finally(finish);
        return;
      }
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

    if (entry.type === "projects") {
      setSettingsSurface(null);
      setActiveProject(null);
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(false);
      setProjectsViewOpen(true);
      finish();
      return;
    }

    if (entry.type === "settings" || entry.type === "project-settings") {
      const nextSettingsSurface = {
        itemId: entry.payload?.settingsItemId ?? "workspace",
        projectId: entry.payload?.projectId
      };
      if (nextSettingsSurface.projectId && activeProject?.id !== nextSettingsSurface.projectId) {
        void openProject(nextSettingsSurface.projectId, { recordHistory: false }).then(() => {
          setKnowledgeBaseOpen(false);
          setLearningContextOpen(false);
          setSettingsSurface(nextSettingsSurface);
        }).finally(finish);
        return;
      }
      setKnowledgeBaseOpen(false);
      setLearningContextOpen(false);
      setSettingsSurface(nextSettingsSurface);
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
        codeThemeId={codeThemeId}
        customCodeThemeJson={customCodeThemeJson}
        showStatusBar={showStatusBar}
        onThemeChange={setTheme}
        onCodeThemeChange={(nextId, nextJson) => {
          setCodeThemeId(nextId);
          setCustomCodeThemeJson(nextJson);
        }}
        onShowStatusBarChange={setShowStatusBar}
        onProjectsChange={setProjects}
        onActiveProjectChange={setActiveProject}
      />
  ) : learningContextOpen ? (
    <LearningContextSurface />
  ) : projectsViewOpen ? (
    <ProjectsSurface
      projects={projects}
      onOpenProject={(projectId) => {
        setProjectsViewOpen(false);
        void openProject(projectId);
      }}
      onOpenProjectSettings={(projectId) => {
        setProjectsViewOpen(false);
        openSettingsSurface("project-overview", projectId);
      }}
    />
  ) : knowledgeBaseOpen ? (
    <KnowledgeBaseSurface activeProject={activeProject} theme={theme} onSidebarPanelChange={setConceptsSidebarPanel} onOpenProject={(projectId) => {
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
        onLearningMaterialsHiddenChange={setFlowLearningMaterialsHidden}
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
      onCreateProjectFromPrompt={createProjectFromHomePrompt}
      onProjectReady={openHomeCreatedFlowProject}
      onOpenProject={(projectId) => void openProject(projectId)}
    />
  );

  const settingsSections = useMemo(
    () => buildSettingsSections(projects, settingsSurface?.projectId),
    [projects, settingsSurface?.projectId]
  );

  function closeSettingsSurface() {
    setSettingsSurface(null);
    showDashboardSurface({ recordHistory: false });
  }

  const bottomPanelTabs = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    return openBottomTabIds.flatMap((tabId, index) => {
      if (isTerminalBottomTabId(tabId)) {
        const isPrimaryTerminal = tabId === PRIMARY_TERMINAL_TAB_ID;
        const terminalIndex = openBottomTabIds.slice(0, index + 1).filter(isTerminalBottomTabId).length;
        return [{
          id: tabId,
          title: terminalIndex === 1 ? "Terminal" : `Terminal ${terminalIndex}`,
          active: activeBottomTabId === tabId,
          icon: <FileTerminalIcon size={14} />,
          closable: true,
          content: (
            <TerminalPanel
              ref={isPrimaryTerminal ? terminalRef : undefined}
              projectId={activeProject.id}
              cwd={activeProject.workspacePath}
              theme={theme}
              visible={bottomPanelOpen && activeBottomTabId === tabId}
            />
          )
        }];
      }

      if (tabId === OUTPUT_TAB_ID) {
        return [{
          id: OUTPUT_TAB_ID,
          title: "Output",
          active: activeBottomTabId === OUTPUT_TAB_ID,
          icon: <FileTextIcon size={14} />,
          closable: true,
          content: <LogsPanel theme={theme} />
        }];
      }

      return [];
    });
  }, [activeProject, openBottomTabIds, activeBottomTabId, bottomPanelOpen, theme]);

  const headerTitle = settingsSurface
    ? settingsTitle(settingsSurface.itemId, settingsSurface.projectId, projects)
    : projectsViewOpen
      ? "Projects"
      : knowledgeBaseOpen
        ? "Concepts"
        : learningContextOpen
          ? "Context"
          : activeProject?.title ?? "Home";
  const isDashboardHome =
    !activeProject &&
    !settingsSurface &&
    !knowledgeBaseOpen &&
    !learningContextOpen &&
    !projectsViewOpen;
  const shellHeaderTabs = isDashboardHome
    ? []
    : [
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
      ];

  const copyText = useCallback((text: string | undefined) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard is unavailable in browser-only smoke checks.
    });
  }, []);

  const openBottomTerminal = useCallback((shellState: DesktopShellState) => {
    if (shellState.isBottomPanelOpen && activeBottomTabId === PRIMARY_TERMINAL_TAB_ID) {
      shellState.setBottomPanelOpen(false);
      return;
    }
    ensureBottomTerminalOpen();
    shellState.setBottomPanelOpen(true);
  }, [activeBottomTabId, ensureBottomTerminalOpen]);

  const openRightWorkspacePanel = useCallback((shellState: DesktopShellState) => {
    if (!activeProject) return;
    if (isFlowProjectRecord(activeProject)) {
      setFlowPanelView("chat");
    } else {
      handleRightSlotChange("guide");
    }
    shellState.setRightPanelOpen(true);
  }, [activeProject, handleRightSlotChange]);

  const expandFlowChat = useCallback((shellState: DesktopShellState) => {
    setFlowPanelView("chat");
    shellState.setRightPanelOpen(true);
    shellState.setInspectorExpanded(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setFlowPanelView("chat");
        shellState.setRightPanelOpen(true);
        shellState.setInspectorExpanded(true);
      });
    });
  }, []);

  if (!aiSettings) {
    return <ConstructSplashScreen />;
  }

  return (
    <AppErrorBoundary>
      <AuthGate aiSettings={aiSettings}>
        <div className="flex h-screen flex-col overflow-hidden bg-transparent">
        <div className="flex-1 min-h-0 relative">
          <DesktopShell
            className="h-full construct-app-window"
          history={history}
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
          headerTabs={shellHeaderTabs}
          renderHeaderTab={(tab, shellState) => (
            <ConstructProjectTitleMenu
              activeProject={activeProject}
              isSettingsSurface={settingsSurface != null}
              onBack={handleBack}
              onCopyProjectId={() => copyText(activeProject?.id)}
              onCopyWorkspacePath={() => copyText(activeProject?.workspacePath)}
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
                                expandFlowChat(state);
                              }
                            }}
                            className="h-7"
                          >
                            <TabsList className="h-7 gap-1 bg-transparent p-0">
                              <TabsTrigger value="expanded" className="size-7 rounded-[8px] p-0 text-muted-foreground/85 shadow-none hover:bg-transparent hover:text-foreground data-active:bg-transparent data-active:text-foreground data-active:shadow-none" title="Expand chat">
                                <Maximize2Icon size={16} strokeWidth={1.9} />
                              </TabsTrigger>
                              <TabsTrigger value="normal" className="size-7 rounded-[8px] p-0 text-muted-foreground/85 shadow-none hover:bg-transparent hover:text-foreground data-active:bg-transparent data-active:text-foreground data-active:shadow-none" title="Normal chat">
                                <MessageCircleIcon size={16} strokeWidth={1.9} />
                              </TabsTrigger>
                              <TabsTrigger value="hidden" className="size-7 rounded-[8px] p-0 text-muted-foreground/85 shadow-none hover:bg-transparent hover:text-foreground data-active:bg-transparent data-active:text-foreground data-active:shadow-none" title="Hide chat">
                                <MessageCircleOffIcon size={16} strokeWidth={1.9} />
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                          <DesktopHeaderToolButton
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
                            <ListChecksIcon size={16} strokeWidth={1.9} />
                          </DesktopHeaderToolButton>
                          <DesktopHeaderToolButton
                            data-active={state.isBottomPanelOpen ? "true" : "false"}
                            onClick={() => openBottomTerminal(state)}
                            aria-label="Toggle terminal"
                            title="Terminal"
                          >
                            <HeaderBottomPanelIcon open={state.isBottomPanelOpen} />
                          </DesktopHeaderToolButton>
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
                        <DesktopChromeButton
                          onClick={(e) => { e.stopPropagation(); void handlePrevBlock(); }}
                          disabled={tapeProject.currentStepIndex === 0 && tapeProject.currentBlockIndex === 0}
                          title="Previous Panel"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                          </svg>
                        </DesktopChromeButton>

                        <Badge variant="secondary">
                          {currentBlockNumber(tapeProject)}/{totalBlocks(tapeProject.program)}
                        </Badge>

                        {!isAtFrontier && (
                          <DesktopChromeButton
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
                          </DesktopChromeButton>
                        )}

                      </div>

                      <SavingIndicator isSaving={isSaving} />
                      <div className="flex items-center gap-1" aria-label="Workspace panels">
                        <DesktopHeaderToolButton
                          data-active={state.isRightPanelOpen && activeRightSlotId === "interact" ? "true" : "false"}
                          onClick={() => {
                            handleRightSlotChange("interact");
                            if (!state.isRightPanelOpen) {
                              state.toggleRightPanel();
                            }
                          }}
                          aria-label="Open Construct Interact"
                        >
                          <MessageCircleIcon size={16} strokeWidth={1.9} />
                        </DesktopHeaderToolButton>
                        <DesktopHeaderToolButton
                          data-active={state.isRightPanelOpen ? "true" : "false"}
                          onClick={state.toggleRightPanel}
                          aria-label="Toggle guide panel"
                        >
                          <HeaderGuidePanelIcon open={state.isRightPanelOpen} />
                        </DesktopHeaderToolButton>
                        <DesktopHeaderToolButton
                          data-active={state.isBottomPanelOpen ? "true" : "false"}
                          onClick={() => openBottomTerminal(state)}
                          aria-label="Toggle terminal"
                        >
                          <HeaderBottomPanelIcon open={state.isBottomPanelOpen} />
                        </DesktopHeaderToolButton>
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
                backLabel="Back to projects"
                footer={
                  <ConstructSidebarFooter
                    aiSettings={aiSettings}
                    onAccountClick={() => setAccountDialogOpen(true)}
                    onOpenSettings={() => openSettingsSurface("workspace")}
                  />
                }
                onBack={closeSettingsSurface}
                onItemSelect={(item: SettingsNavItem) => {
                  const originProjectId = settingsSurface.projectId;
                  if (item.id.startsWith("project-") && !originProjectId) {
                    return;
                  }
                  openSettingsSurface(item.id, originProjectId);
                }}
                onSearchChange={setSettingsQuery}
                query={settingsQuery}
                sections={settingsSections}
              />
            ) : knowledgeBaseOpen ? (
              <DesktopSidebar
                projects={[]}
                items={[]}
                primaryItems={activeProject ? undefined : [
                  {
                    id: "home",
                    active: false,
                    icon: <HomeIcon size={15} />,
                    label: "Home",
                    onClick: handleBack
                  },
                  {
                    id: "knowledge-base",
                    active: true,
                    icon: <BookOpen size={15} />,
                    label: "Concepts",
                    onClick: openKnowledgeBase
                  },
                  {
                    id: "projects",
                    active: false,
                    icon: <FolderOpenIcon size={15} />,
                    label: "Projects",
                    onClick: openProjectsView
                  }
                ]}
                footer={
                  <ConstructSidebarFooter
                    aiSettings={aiSettings}
                    onAccountClick={() => setAccountDialogOpen(true)}
                    onOpenSettings={() => openSettingsSurface("workspace")}
                  />
                }
              >
                {conceptsSidebarPanel ?? (
                  <div className="px-3 py-2 text-[12.5px] text-muted-foreground">Loading concepts...</div>
                )}
              </DesktopSidebar>
            ) : activeProject ? (
              <DesktopSidebar
                projects={[]}
                items={[]}
                footer={
                  <ConstructSidebarFooter
                    aiSettings={aiSettings}
                    onAccountClick={() => setAccountDialogOpen(true)}
                    onOpenSettings={() => openSettingsSurface("workspace")}
                  >
                    {isFlowProjectRecord(activeProject) ? (
                      <SidebarConceptsButton
                        disabled={flowLearningMaterialsHidden}
                        disabledReason="Concepts are hidden while Flow is asking for recall."
                        onClick={openKnowledgeBase}
                      />
                    ) : (
                      <SidebarLearningButton onClick={openLearningContext} />
                    )}
                  </ConstructSidebarFooter>
                }
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1">
                    {treeData.openFile ? (
                      <FileTree
                        nodes={treeData.tree}
                        activePath={treeData.activePath}
                        relevantPath={treeData.relevantPath}
                        expandedPaths={activeProject.fileTreeExpanded}
                        onOpenFile={treeData.openFile}
                        onCreateFile={treeData.createFile ?? undefined}
                        onDeleteFile={treeData.deleteFile ?? undefined}
                        onRenameFile={treeData.renameFile ?? undefined}
                        onCreateFolder={treeData.createFolder ?? undefined}
                        onDuplicateFile={treeData.duplicateFile ?? undefined}
                        onExpandedPathsChange={handleFileTreeExpandedChange}
                        onRefresh={treeData.refreshTree ?? undefined}
                      />
                    ) : null}
                  </div>
                  {sidebarKnowledgePanel && !isFlowProjectRecord(activeProject) ? (
                    sidebarKnowledgePanel
                  ) : null}
                </div>
              </DesktopSidebar>
            ) : (
              <DesktopSidebar
                projects={[]} items={[]}
                primaryItems={[
                  {
                    id: "home",
                    active: !knowledgeBaseOpen && !learningContextOpen && !projectsViewOpen,
                    icon: <HomeIcon size={15} />,
                    label: "Home",
                    onClick: handleBack
                  },
                  {
                    id: "knowledge-base",
                    active: knowledgeBaseOpen,
                    icon: <BookOpen size={15} />,
                    label: "Concepts",
                    onClick: openKnowledgeBase
                  },
                  {
                    id: "projects",
                    active: projectsViewOpen,
                    icon: <FolderOpenIcon size={15} />,
                    label: "Projects",
                    onClick: openProjectsView
                  }
                ]}
                footer={
                  <ConstructSidebarFooter
                    aiSettings={aiSettings}
                    onAccountClick={() => setAccountDialogOpen(true)}
                    onOpenSettings={() => openSettingsSurface("workspace")}
                  />
                }
              >
                <DashboardSidebar
                  projects={projects}
                  onOpenProject={(projectId) => void openProject(projectId)}
                  onOpenProjectSettings={(projectId) => openSettingsSurface("project-overview", projectId)}
                />
              </DesktopSidebar>
            )
          }
          main={main}
          rightPanel={activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen ? rightPanel : null}
          bottomPanel={activeProject && !settingsSurface && !knowledgeBaseOpen && !learningContextOpen ? (shellState) => (
              <BottomPanel
                expanded={shellState.bottomPanelExpanded}
                onExpandChange={shellState.setBottomPanelExpanded}
                activeTabId={activeBottomTabId}
                controlledTabs
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
                  setOpenBottomTabIds((prev) => {
                    const remaining = prev.filter((id) => id !== tabId);
                    if (activeBottomTabId === tabId) {
                      if (remaining.length > 0) {
                        setActiveBottomTabId(remaining[remaining.length - 1]);
                      } else {
                        setActiveBottomTabId(null);
                      }
                    }
                    return remaining;
                  });
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
                      id: createTerminalTabId(),
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
                      id: OUTPUT_TAB_ID,
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
      <ConstructAccountDialog
        aiSettings={aiSettings}
        open={accountDialogOpen}
        onAiSettingsChange={(settings) => setAiSettings(settings)}
        onOpenChange={setAccountDialogOpen}
      />
      </AuthGate>
    </AppErrorBoundary>
  );
}

function upsertProjectSummary(projects: ProjectSummary[], summary: ProjectSummary): ProjectSummary[] {
  return [
    summary,
    ...projects.filter((project) => project.id !== summary.id)
  ].sort(compareProjectSummaryActivity);
}

type FlowSessionRecord = FlowProjectRecord["flow"]["sessions"][number];

function mergeFlowProjectLiveSnapshot(saved: FlowProjectRecord, live: FlowProjectRecord): FlowProjectRecord {
  const sessions = live.flow.sessions.reduce(upsertFlowSessionRecord, saved.flow.sessions);
  const updatedAt = latestIso(saved.flow.updatedAt, live.flow.updatedAt, sessions.at(-1)?.updatedAt);
  return {
    ...saved,
    flow: {
      ...saved.flow,
      researchEnabled: saved.flow.researchEnabled || live.flow.researchEnabled,
      researchCompletedAt: saved.flow.researchCompletedAt ?? live.flow.researchCompletedAt,
      sessions,
      updatedAt
    }
  };
}

function upsertFlowSessionRecord(sessions: FlowSessionRecord[], session: FlowSessionRecord): FlowSessionRecord[] {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index < 0) return [...sessions, session];
  return sessions.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate);
}

function latestIso(...values: Array<string | null | undefined>): string {
  return values.reduce<string>((latest, value) => {
    if (!value) return latest;
    return Date.parse(value) > Date.parse(latest) ? value : latest;
  }, new Date(0).toISOString());
}

function compareProjectSummaryActivity(left: ProjectSummary, right: ProjectSummary): number {
  return projectSummaryActivityTime(right) - projectSummaryActivityTime(left);
}

function projectSummaryActivityTime(project: ProjectSummary): number {
  const timestamp = Date.parse(project.lastOpenedAt ?? project.flowLastActivityAt ?? project.completedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function projectSummaryFromRecord(project: AnyProjectRecord): ProjectSummary {
  if (isFlowProjectRecord(project)) {
    return {
      kind: "flow",
      id: project.id,
      title: project.title,
      description: project.description,
      progress: project.progress,
      lastOpenedAt: project.lastOpenedAt,
      sourcePath: project.sourcePath,
      workspacePath: project.workspacePath,
      completedAt: project.completedAt,
      conceptCount: project.learnedConcepts?.length ?? project.conceptCount ?? 0,
      learnedConcepts: project.learnedConcepts,
      flowGoal: project.flow.goal,
      flowMemoryFileCount: project.flowMemoryFileCount,
      flowSessionCount: project.flow.sessions.length,
      flowLastActivityAt: project.flow.updatedAt
    };
  }

  const step = project.program.steps[project.currentStepIndex];
  const block = step?.blocks[project.currentBlockIndex];
  const blockCount = project.program.steps.reduce((total, item) => total + item.blocks.length, 0);
  const verificationResults = Object.values(project.verificationResults ?? {});

  return {
    kind: project.kind ?? "tape",
    id: project.id,
    title: project.title,
    description: project.description,
    progress: project.progress,
    lastOpenedAt: project.lastOpenedAt,
    sourcePath: project.sourcePath,
    workspacePath: project.workspacePath,
    currentStepIndex: project.currentStepIndex,
    currentBlockIndex: project.currentBlockIndex,
    currentStepTitle: step?.title ?? null,
    currentBlockKind: block?.kind ?? null,
    currentBlockLabel: block?.kind === "edit" ? block.path : block?.kind ?? null,
    activeFilePath: project.activeFilePath,
    stepCount: project.program.steps.length,
    blockCount,
    completedBlockCount: Object.values(project.completedBlocks ?? {}).filter(Boolean).length,
    fileCount: project.program.files.length,
    conceptCount: project.learnedConcepts?.length ?? project.program.concepts?.length ?? 0,
    learnedConcepts: project.learnedConcepts,
    referenceCount: project.program.references?.length ?? 0,
    verificationPassCount: verificationResults.filter((result) => result.passed).length,
    verificationFailCount: verificationResults.filter((result) => !result.passed).length,
    authoringFixCount: project.authoringFixes?.length ?? 0,
    completedAt: project.completedAt
  };
}

type ConstructAccountUsageWindow = {
  windowStart: string;
  windowEnd: string;
  resetAt?: string;
  usedUnits: number;
  reservedUnits: number;
  limitUnits: number;
  remainingUnits: number;
  percentage: number;
};

type ConstructAccountPayload = {
  user?: {
    email?: string | null;
    name?: string | null;
    plan?: string | null;
  };
  usage?: {
    plan: string;
    windows: {
      five_hour_all: ConstructAccountUsageWindow;
      weekly_all: ConstructAccountUsageWindow;
      weekly_expensive?: ConstructAccountUsageWindow;
    };
  };
};

type ConstructAccountUser = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

function ConstructSidebarFooter({
  aiSettings,
  children,
  onAccountClick,
  onOpenSettings
}: {
  aiSettings: AiSettings;
  children?: ReactNode;
  onAccountClick: () => void;
  onOpenSettings: () => void;
}) {
  const account = useConstructAccount(aiSettings.constructCloudBaseUrl);
  const user = account.session?.user as ConstructAccountUser | undefined;
  const name = displayAccountName(user);
  const email = user?.email ?? "Signed in";
  const plan = account.usage?.plan ?? account.account?.user?.plan ?? null;

  return (
    <div className="flex flex-col gap-0.5">
      {children}
      <SidebarSettingsButton onClick={onOpenSettings} />
      <SidebarMenuButton
        type="button"
        data-construct-control="sidebar-account"
        size="lg"
        onClick={onAccountClick}
      >
        <UserAvatar className="size-7 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold text-foreground/90">{account.isPending ? "Account" : name}</span>
            {plan ? (
              <Badge
                variant="secondary"
                className={cn(
                  "h-[15px] rounded-[3px] border-0 px-1 text-[9px] font-bold tracking-wider uppercase shrink-0 select-none",
                  plan.toLowerCase().includes("plus") || plan.toLowerCase().includes("pro")
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {formatPlan(plan)}
              </Badge>
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground/80">{email}</span>
        </span>
        <ChevronDownIcon size={14} className="shrink-0 text-muted-foreground/60" />
      </SidebarMenuButton>
    </div>
  );
}

function ConstructAccountDialog({
  aiSettings,
  onAiSettingsChange,
  onOpenChange,
  open
}: {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const account = useConstructAccount(aiSettings.constructCloudBaseUrl);
  const user = account.session?.user as ConstructAccountUser | undefined;
  const [baseUrlDraft, setBaseUrlDraft] = useState(aiSettings.constructCloudBaseUrl);
  const [tokenDraft, setTokenDraft] = useState(aiSettings.constructCloudAccessToken);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const plan = account.usage?.plan ?? account.account?.user?.plan ?? null;
  const allowEndpointEditing = false;

  useEffect(() => {
    if (!open) return;
    setBaseUrlDraft(aiSettings.constructCloudBaseUrl);
    setTokenDraft(aiSettings.constructCloudAccessToken);
    setStatus(null);
  }, [aiSettings.constructCloudAccessToken, aiSettings.constructCloudBaseUrl, open]);

  async function saveHostedSettings(next?: { baseUrl?: string; token?: string }): Promise<boolean> {
    const baseUrl = allowEndpointEditing
      ? cleanAndNormalizeUrl(next?.baseUrl ?? baseUrlDraft)
      : configuredConstructCloudEndpoint();
    const token = (next?.token ?? tokenDraft).trim();

    try {
      setBusy(true);
      setStatus(null);
      const settings = await updateAiSettings({
        ai: {
          ...aiSettings,
          constructCloudBaseUrl: baseUrl,
          constructCloudAccessToken: token
        }
      });
      const savedAiSettings = {
        ...aiSettings,
        ...(settings.ai ?? {})
      };
      onAiSettingsChange(savedAiSettings);
      setBaseUrlDraft(savedAiSettings.constructCloudBaseUrl);
      setTokenDraft(savedAiSettings.constructCloudAccessToken);
      setStatus("Account settings saved.");
      void account.refetch();
      return true;
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function mintHostedToken() {
    try {
      setBusy(true);
      setStatus(null);
      const token = localStorage.getItem("bearer_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const baseUrl = allowEndpointEditing ? cleanAndNormalizeUrl(baseUrlDraft) : configuredConstructCloudEndpoint();
      const response = await fetch(`${baseUrl}/api/cloud/tokens`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ name: "Construct Desktop" })
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `Token mint failed (${response.status}).`);
      }
      const payload = await response.json() as { token?: string };
      if (!payload.token) {
        throw new Error("Token response did not include a desktop token.");
      }
      setTokenDraft(payload.token);
      const saved = await saveHostedSettings({ baseUrl, token: payload.token });
      if (saved) {
        setStatus("Hosted compute token updated.");
      }
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      setBusy(true);
      localStorage.removeItem("bearer_token");
      await account.authClient.signOut();
      window.location.reload();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <ShadcnDialogContent className="sm:max-w-md rounded-2xl p-0 overflow-hidden gap-0">
        {/* ── Header with subtle gradient background ── */}
        <div className="relative bg-gradient-to-b from-muted/60 to-transparent px-6 pt-7 pb-5">
          <div className="flex flex-col items-center text-center">
            <UserAvatar className="size-[56px] mb-3 ring-2 ring-border/30 ring-offset-2 ring-offset-background" />
            <ShadcnDialogTitle className="text-[15px] font-semibold text-foreground tracking-[-0.01em]">{displayAccountName(user)}</ShadcnDialogTitle>
            <ShadcnDialogDescription className="text-xs text-muted-foreground/70 mt-0.5">{user?.email ?? "Signed in"}</ShadcnDialogDescription>
            {plan ? (
              <Badge variant="secondary" className="mt-2.5 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-full bg-foreground/10 text-foreground/70 border-0">
                {formatPlan(plan)}
              </Badge>
            ) : null}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col gap-0 px-6 pb-5">
          {account.usage ? (
            <div className="flex flex-col pt-1 pb-3">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                <CloudIcon size={13} className="shrink-0" />
                <span>Usage</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <ConstructAccountUsageMeter label="5-Hour Session" window={account.usage.windows.five_hour_all} />
                <ConstructAccountUsageMeter label="Weekly Limit" window={account.usage.windows.weekly_all} />
                {account.usage.windows.weekly_expensive ? (
                  <ConstructAccountUsageMeter label="Premium Models" window={account.usage.windows.weekly_expensive} />
                ) : null}
              </div>
            </div>
          ) : null}

          <ConstructAccountConnectionSection
            baseUrlDraft={baseUrlDraft}
            tokenDraft={tokenDraft}
            busy={busy}
            hasUser={!!account.session?.user}
            status={status ?? account.status ?? null}
            allowEndpointEditing={allowEndpointEditing}
            onBaseUrlChange={setBaseUrlDraft}
            onTokenChange={setTokenDraft}
            onMint={() => void mintHostedToken()}
            onSave={() => void saveHostedSettings()}
            onClear={() => void saveHostedSettings({ token: "" })}
          />

          <div className="flex justify-between items-center pt-3 mt-1 border-t border-border/30">
            <span className="text-[11px] text-muted-foreground/60">Sign out on this device</span>
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive h-7 px-3 rounded-lg text-xs"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function useConstructAccount(baseUrl: string) {
  const { authClient } = useAuth();
  const { data: session, isPending, refetch } = useSession(authClient as ReturnType<typeof createAuthClient>);
  const normalizedBaseUrl = useMemo(() => cleanAndNormalizeUrl(baseUrl), [baseUrl]);
  const [account, setAccount] = useState<ConstructAccountPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setAccount(null);
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem("bearer_token");
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    void fetch(`${normalizedBaseUrl}/api/me`, {
      credentials: "include",
      headers
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Account lookup failed (${response.status}).`);
        return await response.json() as ConstructAccountPayload;
      })
      .then((payload) => {
        if (!cancelled) {
          setAccount(payload);
          setStatus(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setAccount(null);
          setStatus(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, session]);

  return {
    account,
    authClient: authClient as ReturnType<typeof createAuthClient>,
    isPending,
    refetch,
    session,
    status,
    usage: account?.usage ?? null
  };
}

function ConstructAccountConnectionSection({
  allowEndpointEditing,
  baseUrlDraft,
  tokenDraft,
  busy,
  hasUser,
  status,
  onBaseUrlChange,
  onTokenChange,
  onMint,
  onSave,
  onClear
}: {
  allowEndpointEditing: boolean;
  baseUrlDraft: string;
  tokenDraft: string;
  busy: boolean;
  hasUser: boolean;
  status: string | null;
  onBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onMint: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const connected = !!tokenDraft.trim();

  return (
    <div className="border-t border-border/30 pt-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
        onClick={() => setExpanded((v) => !v)}
      >
        <KeyRoundIcon size={14} className="shrink-0" />
        <span className="flex-1">Connection Settings</span>
        <Badge variant={connected ? "secondary" : "outline"} className="rounded-md px-2 py-0.5 text-[10px] font-medium tracking-normal normal-case">{connected ? "Connected" : "Not connected"}</Badge>
        <ChevronRightIcon size={14} className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded ? (
        <div className="mt-3 flex flex-col gap-3 pt-2">
          <div className="text-xs text-muted-foreground/75 leading-relaxed">
            {allowEndpointEditing ? "Cloud endpoint and access token for AI compute." : "Construct Cloud uses the production endpoint managed by Construct."}
          </div>
          <div className={allowEndpointEditing ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid gap-2"}>
            {allowEndpointEditing ? (
              <Input
                value={baseUrlDraft}
                disabled={busy}
                placeholder={configuredConstructCloudEndpoint()}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                className="h-8 rounded-lg text-xs"
              />
            ) : null}
            <Input
              type="password"
              value={tokenDraft}
              disabled={busy}
              placeholder="Access token"
              onChange={(event) => onTokenChange(event.target.value)}
              className="h-8 rounded-lg text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !hasUser} onClick={onMint} className="rounded-lg h-7 text-xs px-3">
              {busy ? "Working..." : "Mint token"}
            </Button>
            {allowEndpointEditing ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onSave} className="rounded-lg h-7 text-xs px-3">
                Save
              </Button>
            ) : null}
            {tokenDraft ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={onClear} className="rounded-lg h-7 text-xs px-3">
                Clear token
              </Button>
            ) : null}
          </div>
          {status ? (
            <div className="text-xs text-muted-foreground">{status}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConstructAccountUsageMeter({ label, window }: { label: string; window: ConstructAccountUsageWindow }) {
  const resetDate = new Date(window.resetAt ?? window.windowEnd);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const diffH = Math.max(0, Math.floor(diffMs / 3_600_000));
  const diffM = Math.max(0, Math.floor((diffMs % 3_600_000) / 60_000));
  const resetLabel = diffH > 24 ? `${Math.ceil(diffH / 24)}d` : diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;

  const remainingPercent = Math.min(100, Math.max(0, 100 - window.percentage));

  const barColor = remainingPercent > 50 ? "bg-emerald-500" : remainingPercent > 20 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/30 px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/80 text-[11px]">{label}</span>
        <span className="tabular-nums font-semibold text-foreground/70 text-[11px]">{Math.round(remainingPercent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${remainingPercent}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/50">
        <span>{formatUsageUnits(window.remainingUnits)} remaining</span>
        <span>resets in {resetLabel}</span>
      </div>
    </div>
  );
}

function displayAccountName(user: ConstructAccountUser | undefined): string {
  return user?.name?.trim() || user?.email?.trim() || "Construct user";
}

function formatPlan(plan: string): string {
  return plan.trim() ? plan.trim().slice(0, 1).toUpperCase() + plan.trim().slice(1) : "Free";
}

function formatUsageUnits(units: number): string {
  if (units >= 1_000_000) return `${(units / 1_000_000).toFixed(1)}M`;
  if (units >= 1_000) return `${(units / 1_000).toFixed(units >= 10_000 ? 0 : 1)}k`;
  return String(units);
}

function ConstructProjectTitleMenu({
  activeProject,
  isSettingsSurface,
  onBack,
  onCopyProjectId,
  onCopyWorkspacePath,
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
                {isFlow ? "Open Construct agent" : "Open legacy guide panel"}
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
          <ShadcnDropdownMenuItem onClick={onOpenWorkspaceSettings}>
            <SettingsIcon size={14} />
            Workspace settings
          </ShadcnDropdownMenuItem>
          {(activeProject != null || isSettingsSurface) ? (
            <>
              <ShadcnDropdownMenuSeparator />
              <ShadcnDropdownMenuItem onClick={onBack}>
                <HomeIcon size={14} />
                Back to home
              </ShadcnDropdownMenuItem>
            </>
          ) : null}
        </ShadcnDropdownMenuContent>
      </ShadcnDropdownMenu>
    </div>
  );
}

export function cleanAndNormalizeUrl(url: string | null | undefined, fallback: string = configuredConstructCloudEndpoint()): string {
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
