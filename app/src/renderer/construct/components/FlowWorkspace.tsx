import { DiffEditor } from "@monaco-editor/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, BadgeCheckIcon, BookOpenIcon, BotIcon, BrainCircuitIcon, CheckCircle2Icon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, CircleIcon, CornerDownLeftIcon, CpuIcon, FileTextIcon, GaugeIcon, GitCompareIcon, HelpCircleIcon, Layers3Icon, ListChecksIcon, Loader2Icon, PencilIcon, PlusCircleIcon, RotateCcwIcon, RouteIcon, SearchIcon, SendIcon, StarIcon, TerminalIcon, Trash2Icon, PlusIcon, MicIcon, type LucideIcon } from "lucide-react";
import {
  AdaptiveSidecarLayout,
  AgentSessionComposer,
  AgentSessionSurface,
  Button,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  SlotPanel,
  type AgentRunTraceEntry,
  type AgentSessionMessage,
  type AgentSessionMessagePart,
  type SlotTab
} from "@opaline/ui";

import { CONSTRUCT_CONCEPT_MASTERY_RUBRIC, conceptMasteryRubricForLevel, type ConstructAgentContextWindow, type ConstructCitationSource, type ConstructConceptLanguage, type ConstructConceptMasteryLevel } from "../../../shared/constructLearning";
import type {
  ConstructFlowAction,
  ConstructFlowConceptExercise,
  ConstructFlowPathNode,
  ConstructFlowMemoryPatchResult,
  ConstructFlowTaskGuidance,
  ConstructFlowPracticeSubtask,
  ConstructFlowPracticeTask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowTimelinePart,
  ConstructFlowToolCallRecord
} from "../../../shared/constructFlow";
import type { AiSettings, ConceptCard, FlowProjectRecord, ModelCatalogEntry, ProjectFileChangePayload, WorkspaceTreeNode } from "../types";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  getUiState,
  getSettings,
  listFiles,
  listModels,
  onConstructFlowSessionEvent,
  readFile,
  renameFile,
  rewindFlowSession,
  runConstructFlowAgent,
  submitFlowTask,
  setUiState,
  updateAiSettings,
  updateProject,
  writeFile,
  onFileChanged
} from "../lib/bridge";
import { EditorPane } from "./EditorPane";
import { MarkdownBlock } from "./MarkdownBlock";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { KnowledgeCard } from "./KnowledgeCard";
import { ConceptSummaryCard } from "./ConceptSummaryCard";
import { iconForFile } from "./workspace/FileChooserContent";
import type { InlineFileRef } from "../lib/inlineRefs";
import { Badge } from "../../components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import {
  activateDocument,
  closeDocument,
  createDocumentSession,
  normalizeDocumentPath,
  replaceDocumentPath
} from "../lib/documentSession";

const FLOW_TASK_TAB_PREFIX = "flow-task:";

function flowTaskTabId(taskId: string): string {
  return `${FLOW_TASK_TAB_PREFIX}${taskId}`;
}

function taskIdFromFlowTab(tabId: string): string | null {
  return tabId.startsWith(FLOW_TASK_TAB_PREFIX) ? tabId.slice(FLOW_TASK_TAB_PREFIX.length) : null;
}

export type FlowChatMode = "panel" | "maximized";

export type FlowLayoutRequest =
  | { kind: "workbench-chat"; reason: "file-system-change" | "task-created" }
  | { kind: "maximized-chat"; reason: "project-created" };

type FlowWorkspaceUiState = {
  version: 1;
  activeWorkspaceTabId: string | null;
  documentTabs: string[];
  openTaskTabIds: string[];
  openConceptId: string | null;
  chatScrollTop: number | null;
};

const FLOW_WORKSPACE_UI_STATE_KEY = "flow.workspace";

const FLOW_MEMORY_FILE_NAMES = new Set(["research.md", "project.md", "path.md", "learner.md"]);

function normalizeWorkspaceChangePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function isFlowMemoryChangePath(value: string): boolean {
  const normalized = normalizeWorkspaceChangePath(value);
  if (normalized === ".construct" || normalized === ".construct/flow-memory") {
    return true;
  }
  if (normalized.startsWith(".construct/flow-memory/")) {
    return FLOW_MEMORY_FILE_NAMES.has(normalized.slice(".construct/flow-memory/".length));
  }
  if (!normalized.startsWith(".construct/")) {
    return false;
  }
  return FLOW_MEMORY_FILE_NAMES.has(normalized.slice(".construct/".length));
}

function fileChangePayloadPaths(payload: ProjectFileChangePayload): string[] {
  if (payload.paths && payload.paths.length > 0) {
    return payload.paths;
  }
  return payload.path ? [payload.path] : [];
}

function isOnlyFlowMemoryChange(payload: ProjectFileChangePayload): boolean {
  const paths = fileChangePayloadPaths(payload);
  return paths.length > 0 && paths.every(isFlowMemoryChangePath);
}

function normalizeFlowWorkspaceUiState(value: unknown): FlowWorkspaceUiState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<FlowWorkspaceUiState>;
  const documentTabs = Array.isArray(input.documentTabs)
    ? input.documentTabs.map((tab) => typeof tab === "string" ? normalizeDocumentPath(tab) : "").filter(Boolean)
    : [];
  const openTaskTabIds = Array.isArray(input.openTaskTabIds)
    ? input.openTaskTabIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const activeWorkspaceTabId = typeof input.activeWorkspaceTabId === "string" && input.activeWorkspaceTabId.trim()
    ? input.activeWorkspaceTabId
    : null;
  return {
    version: 1,
    activeWorkspaceTabId,
    documentTabs: [...new Set(documentTabs)],
    openTaskTabIds: [...new Set(openTaskTabIds)],
    openConceptId: typeof input.openConceptId === "string" && input.openConceptId.trim() ? input.openConceptId : null,
    chatScrollTop: typeof input.chatScrollTop === "number" && Number.isFinite(input.chatScrollTop)
      ? Math.max(0, input.chatScrollTop)
      : null
  };
}

function createDocumentSessionFromUiState(state: FlowWorkspaceUiState, fallbackPath?: string | null) {
  const fallback = createDocumentSession(fallbackPath);
  const tabs = state.documentTabs.length > 0 ? state.documentTabs : fallback.tabs;
  const activePath = state.activeWorkspaceTabId && !taskIdFromFlowTab(state.activeWorkspaceTabId)
    ? normalizeDocumentPath(state.activeWorkspaceTabId)
    : fallback.activePath;
  return {
    activePath: activePath && tabs.includes(activePath) ? activePath : tabs[0] ?? null,
    reveal: null,
    tabs
  };
}

export function FlowWorkspace({
  project,
  activePanelView,
  chatMode,
  theme,
  onGuidePanelChange,
  onKnowledgePanelChange,
  onPanelViewChange,
  onLayoutRequest,
  onProjectChange,
  onRunCommand,
  onFileOpened,
  onTreeChange,
  onSavingChange
}: {
  project: FlowProjectRecord;
  activePanelView: "chat" | "project";
  chatMode: FlowChatMode;
  theme: "light" | "dark" | "system";
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onKnowledgePanelChange?: (panel: ReactNode | null) => void;
  onPanelViewChange: (view: "chat" | "project") => void;
  onLayoutRequest?: (request: FlowLayoutRequest) => void;
  onProjectChange: (project: FlowProjectRecord) => void;
  onRunCommand: (command: string, cwd: string) => void;
  onFileOpened: (filePath: string) => void;
  onTreeChange: (
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
  ) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [documentSession, setDocumentSession] = useState(() => createDocumentSession(project.activeFilePath));
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(() => project.activeFilePath ? normalizeDocumentPath(project.activeFilePath) : null);
  const [openTaskTabIds, setOpenTaskTabIds] = useState<string[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({});
  const [focusRange, setFocusRange] = useState<{ line: number; endLine?: number; hint?: string } | null>(null);
  const [sessions, setSessions] = useState<ConstructFlowSession[]>(project.flow.sessions ?? []);
  const [liveSession, setLiveSession] = useState<ConstructFlowSession | undefined>();
  const [pending, setPending] = useState(false);
  const [openConcept, setOpenConcept] = useState<ConceptCard | null>(null);
  const [chatScrollTop, setChatScrollTop] = useState<number | null>(null);
  const [flowUiStateHydrated, setFlowUiStateHydrated] = useState(false);
  const taskLayoutRequestIdsRef = useRef<Set<string>>(new Set((project.flow.sessions ?? []).flatMap((session) => session.practiceTasks.map((task) => task.id))));
  const activePathRef = useRef<string | null>(null);
  const dirtyPathsRef = useRef<Record<string, boolean>>({});
  const documentSessionRef = useRef(documentSession);
  const fileContentsRef = useRef<Record<string, string>>({});
  const restoringFlowUiStateRef = useRef(false);
  const pendingChatScrollTopRef = useRef<number | null>(null);
  const chatScrollFrameRef = useRef<number | null>(null);
  const openFileSequenceRef = useRef(0);
  const projectActiveFilePathRef = useRef(project.activeFilePath);
  const saveSequenceRef = useRef(0);
  const sessionsRef = useRef(sessions);
  const projectRef = useRef(project);
  sessionsRef.current = sessions;
  const activePath = documentSession.activePath;
  const content = activePath ? fileContents[activePath] ?? "" : "";
  const dirty = activePath ? dirtyPaths[activePath] === true : false;

  activePathRef.current = activePath;
  dirtyPathsRef.current = dirtyPaths;
  documentSessionRef.current = documentSession;
  fileContentsRef.current = fileContents;
  projectRef.current = project;
  projectActiveFilePathRef.current = project.activeFilePath;

  const refreshTree = useCallback(async () => {
    const next = await listFiles(project.id);
    setTree(next);
    return next;
  }, [project.id]);

  const requestWorkbenchLayout = useCallback((reason: "file-system-change" | "task-created") => {
    onLayoutRequest?.({ kind: "workbench-chat", reason });
  }, [onLayoutRequest]);

  const requestWorkbenchLayoutForPaths = useCallback((reason: "file-system-change", paths: string[]) => {
    if (paths.length > 0 && paths.every(isFlowMemoryChangePath)) {
      return;
    }
    requestWorkbenchLayout(reason);
  }, [requestWorkbenchLayout]);

  useEffect(() => {
    let cancelled = false;
    restoringFlowUiStateRef.current = true;
    setFlowUiStateHydrated(false);
    const fallbackSession = createDocumentSession(project.activeFilePath);
    documentSessionRef.current = fallbackSession;
    fileContentsRef.current = {};
    dirtyPathsRef.current = {};
    openFileSequenceRef.current += 1;
    saveSequenceRef.current += 1;
    setDocumentSession(fallbackSession);
    setActiveWorkspaceTabId(fallbackSession.activePath);
    setOpenTaskTabIds([]);
    setFileContents({});
    setDirtyPaths({});
    setFocusRange(null);
    setSessions(project.flow.sessions ?? []);
    setLiveSession(undefined);
    setOpenConcept(null);
    setChatScrollTop(null);
    taskLayoutRequestIdsRef.current = new Set((project.flow.sessions ?? []).flatMap((session) => session.practiceTasks.map((task) => task.id)));

    void getUiState<FlowWorkspaceUiState | null>({
      key: FLOW_WORKSPACE_UI_STATE_KEY,
      scope: "workspace",
      projectId: project.id,
      fallback: null
    })
      .then((saved) => {
        if (cancelled) return;
        const state = normalizeFlowWorkspaceUiState(saved);
        if (!state) return;
        const restoredSession = createDocumentSessionFromUiState(state, project.activeFilePath);
        documentSessionRef.current = restoredSession;
        setDocumentSession(restoredSession);
        setActiveWorkspaceTabId(state.activeWorkspaceTabId ?? restoredSession.activePath);
        setOpenTaskTabIds(state.openTaskTabIds);
        setOpenConcept(state.openConceptId ? buildInlineConceptPlaceholder(state.openConceptId) : null);
        setChatScrollTop(state.chatScrollTop);
      })
      .finally(() => {
        if (cancelled) return;
        restoringFlowUiStateRef.current = false;
        setFlowUiStateHydrated(true);
      });

    return () => {
      cancelled = true;
      restoringFlowUiStateRef.current = false;
    };
  }, [project.id]);

  const openFile = useCallback(async (path: string, options: { persist?: boolean } = {}) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return false;

    const sequence = openFileSequenceRef.current + 1;
    openFileSequenceRef.current = sequence;
    let nextContent = fileContentsRef.current[normalizedPath];
    if (nextContent == null) {
      try {
        nextContent = (await readFile({ projectId: project.id, path: normalizedPath })).content;
      } catch (error) {
        console.error("[construct-flow] Could not open file", { path: normalizedPath, error });
        return false;
      }
    }

    if (openFileSequenceRef.current !== sequence) {
      return false;
    }

    setFileContents((current) => {
      const next = { ...current, [normalizedPath]: nextContent };
      fileContentsRef.current = next;
      return next;
    });
    setDirtyPaths((current) => {
      if (current[normalizedPath]) return current;
      const next = { ...current, [normalizedPath]: false };
      dirtyPathsRef.current = next;
      return next;
    });
    const nextSession = activateDocument(documentSessionRef.current, normalizedPath);
    documentSessionRef.current = nextSession;
    setDocumentSession(nextSession);
    setActiveWorkspaceTabId(normalizedPath);
    setFocusRange(null);
    onFileOpened(normalizedPath);
    if (options.persist !== false && projectActiveFilePathRef.current !== normalizedPath) {
      const updated = await updateProject({ id: project.id, patch: { activeFilePath: normalizedPath } });
      if (openFileSequenceRef.current === sequence && updated.kind === "flow") {
        projectActiveFilePathRef.current = updated.activeFilePath;
        onProjectChange(updated);
      }
    }
    return true;
  }, [onFileOpened, onProjectChange, project.id]);

  useEffect(() => {
    if (!activePath || taskIdFromFlowTab(activeWorkspaceTabId ?? "")) return;
    if (Object.prototype.hasOwnProperty.call(fileContentsRef.current, activePath)) return;
    void openFile(activePath, { persist: false });
  }, [activePath, activeWorkspaceTabId, openFile]);

  const saveFile = useCallback(async (path = activePathRef.current) => {
    const normalizedPath = path ? normalizeDocumentPath(path) : "";
    if (!normalizedPath) return;
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    const contentToSave = fileContentsRef.current[normalizedPath] ?? "";
    onSavingChange(true);
    try {
      await writeFile({ projectId: project.id, path: normalizedPath, content: contentToSave });
      if (saveSequenceRef.current === sequence) {
        setDirtyPaths((current) => {
          if (fileContentsRef.current[normalizedPath] !== contentToSave) return current;
          const next = { ...current, [normalizedPath]: false };
          dirtyPathsRef.current = next;
          return next;
        });
      }
      await refreshTree();
      requestWorkbenchLayoutForPaths("file-system-change", [normalizedPath]);
    } finally {
      if (saveSequenceRef.current === sequence) {
        onSavingChange(false);
      }
    }
  }, [onSavingChange, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const createFile = useCallback((path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return;
    onSavingChange(true);
    void writeFile({ projectId: project.id, path: normalizedPath, content: "" })
      .then(async () => {
        setFileContents((current) => {
          const next = { ...current, [normalizedPath]: "" };
          fileContentsRef.current = next;
          return next;
        });
        setDirtyPaths((current) => {
          const next = { ...current, [normalizedPath]: false };
          dirtyPathsRef.current = next;
          return next;
        });
        await refreshTree();
        requestWorkbenchLayoutForPaths("file-system-change", [normalizedPath]);
      })
      .then(() => openFile(normalizedPath))
      .finally(() => onSavingChange(false));
  }, [onSavingChange, openFile, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const persistActiveFilePath = useCallback(async (path: string | null) => {
    const sequence = openFileSequenceRef.current + 1;
    openFileSequenceRef.current = sequence;
    const updated = await updateProject({ id: project.id, patch: { activeFilePath: path } });
    if (openFileSequenceRef.current === sequence && updated.kind === "flow") {
      projectActiveFilePathRef.current = updated.activeFilePath;
      onProjectChange(updated);
    }
  }, [onProjectChange, project.id]);

  const closeFileTab = useCallback((path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return;

    openFileSequenceRef.current += 1;
    const closedActivePath = documentSessionRef.current.activePath === normalizedPath;
    const nextSession = closeDocument(documentSessionRef.current, normalizedPath);
    const nextActivePath = nextSession.activePath;
    documentSessionRef.current = nextSession;
    setDocumentSession(nextSession);
    setFileContents((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      fileContentsRef.current = next;
      return next;
    });
    setDirtyPaths((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      dirtyPathsRef.current = next;
      return next;
    });

    if (!closedActivePath) return;
    if (nextActivePath) {
      void openFile(nextActivePath);
    } else {
      setActiveWorkspaceTabId(null);
      setFocusRange(null);
      void persistActiveFilePath(null);
    }
  }, [openFile, persistActiveFilePath]);

  const deleteFileFn = useCallback(async (path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return;
    onSavingChange(true);
    try {
      await deleteFile({ projectId: project.id, path: normalizedPath });
      closeFileTab(normalizedPath);
      await refreshTree();
      requestWorkbenchLayoutForPaths("file-system-change", [normalizedPath]);
    } finally {
      onSavingChange(false);
    }
  }, [closeFileTab, onSavingChange, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const renameFileFn = useCallback(async (oldPath: string, newPath: string) => {
    const normalizedOldPath = normalizeDocumentPath(oldPath);
    const normalizedNewPath = normalizeDocumentPath(newPath);
    if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) return;
    onSavingChange(true);
    try {
      await renameFile({ projectId: project.id, oldPath: normalizedOldPath, newPath: normalizedNewPath });
      const wasActive = documentSessionRef.current.activePath === normalizedOldPath;
      const nextSession = replaceDocumentPath(documentSessionRef.current, normalizedOldPath, normalizedNewPath);
      documentSessionRef.current = nextSession;
      setDocumentSession(nextSession);
      setFileContents((current) => {
        if (!(normalizedOldPath in current)) return current;
        const next = { ...current, [normalizedNewPath]: current[normalizedOldPath] };
        delete next[normalizedOldPath];
        fileContentsRef.current = next;
        return next;
      });
      setDirtyPaths((current) => {
        if (!(normalizedOldPath in current)) return current;
        const next = { ...current, [normalizedNewPath]: current[normalizedOldPath] };
        delete next[normalizedOldPath];
        dirtyPathsRef.current = next;
        return next;
      });
      if (wasActive) {
        onFileOpened(normalizedNewPath);
        void persistActiveFilePath(normalizedNewPath);
      }
      await refreshTree();
      requestWorkbenchLayoutForPaths("file-system-change", [normalizedOldPath, normalizedNewPath]);
    } finally {
      onSavingChange(false);
    }
  }, [onFileOpened, onSavingChange, persistActiveFilePath, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const createFolderFn = useCallback(async (path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return;
    onSavingChange(true);
    try {
      await createFolder({ projectId: project.id, path: normalizedPath });
      await refreshTree();
      requestWorkbenchLayoutForPaths("file-system-change", [normalizedPath]);
    } finally {
      onSavingChange(false);
    }
  }, [onSavingChange, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const duplicateFileFn = useCallback(async (path: string, destPath: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    const normalizedDestPath = normalizeDocumentPath(destPath);
    if (!normalizedPath || !normalizedDestPath) return;
    onSavingChange(true);
    try {
      await duplicateFile({ projectId: project.id, path: normalizedPath, destPath: normalizedDestPath });
      await refreshTree();
      requestWorkbenchLayoutForPaths("file-system-change", [normalizedPath, normalizedDestPath]);
    } finally {
      onSavingChange(false);
    }
  }, [onSavingChange, project.id, refreshTree, requestWorkbenchLayoutForPaths]);

  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  const focusCode = useCallback((action: Extract<ConstructFlowAction, { type: "focus-code" | "open-file" }>) => {
    void openFile(action.path).then((opened) => {
      if (opened && action.type === "focus-code" && action.line) {
        setFocusRange({ line: action.line, endLine: action.endLine, hint: action.reason || action.label });
      }
    });
  }, [openFile]);

  const openInlineFile = useCallback((reference: InlineFileRef) => {
    void openFile(reference.path).then((opened) => {
      if (opened && reference.line) {
        setFocusRange({ line: reference.line, endLine: reference.endLine, hint: reference.label });
      }
    });
  }, [openFile]);

  const runAgent = useCallback(async (message: string, options: FlowAgentRunOptions = {}) => {
    const questionResponse = options.questionResponse;
    const taskSubmission = options.taskSubmission;
    const taskMessage = options.taskMessage;
    if (!message.trim() && !taskSubmission && !questionResponse && !taskMessage) return;
    const latestSessions = sessionsRef.current;
    const optimisticSessions = questionResponse
      ? markQuestionAnswered(latestSessions, questionResponse)
      : latestSessions;
    if (questionResponse) {
      sessionsRef.current = optimisticSessions;
      setSessions((current) => markQuestionAnswered(current, questionResponse));
      setLiveSession((current) => current ? markQuestionAnswered([current], questionResponse)[0] : undefined);
      onProjectChange({
        ...project,
        flow: {
          ...project.flow,
          sessions: optimisticSessions,
          updatedAt: questionResponse.answeredAt
        }
      });
    }
    setPending(true);
    try {
      const result = await runConstructFlowAgent({
        projectId: project.id,
        message: message.trim() || (questionResponse ? "Continue from the tracked question answer." : taskMessage ? "Continue from the learner's task message." : "Continue from the learner's task submission."),
        taskSubmission,
        taskMessage,
        questionResponse
      });
      const nextSessions = upsertSession(questionResponse ? markQuestionAnswered(sessionsRef.current, questionResponse) : sessionsRef.current, result.session);
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setLiveSession(undefined);
      onProjectChange({
        ...project,
        flow: {
          ...project.flow,
          sessions: nextSessions,
          updatedAt: result.session.updatedAt
        }
      });
      applyFlowActions(result.actions, focusCode, onRunCommand, project.workspacePath);
    } finally {
      setPending(false);
    }
  }, [focusCode, onProjectChange, onRunCommand, project]);

  const submitTask = useCallback(async (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => {
    const submission = await submitFlowTask({ projectId: project.id, taskId: task.id, note, subtaskId });
    await runAgent("Review my practice task submission.", { taskSubmission: submission });
  }, [project.id, runAgent]);

  const rewindUserSession = useCallback(async (sessionId: string) => {
    const updatedProject = await rewindFlowSession({ projectId: project.id, sessionId });
    const nextSessions = updatedProject.flow.sessions ?? [];
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setLiveSession(undefined);
    onPanelViewChange("chat");
    onProjectChange(updatedProject);
  }, [onPanelViewChange, onProjectChange, project.id]);

  useEffect(() => {
    let cancelled = false;
    void refreshTree().then((nextTree) => {
      if (cancelled || activePathRef.current) return;
      const initialPath = project.activeFilePath ?? firstFilePath(nextTree);
      if (initialPath) {
        void openFileRef.current(initialPath, { persist: project.activeFilePath == null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshTree]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshTree();
    };

    window.addEventListener("focus", handleFocus);
    const unsubscribe = onFileChanged((payload) => {
      void refreshTree();
      if (!isOnlyFlowMemoryChange(payload)) {
        requestWorkbenchLayout("file-system-change");
      }
    });

    return () => {
      window.removeEventListener("focus", handleFocus);
      unsubscribe();
    };
  }, [project.id, refreshTree, requestWorkbenchLayout]);

  useEffect(() => {
    onTreeChange(tree, activePath, null, openFile, createFile, deleteFileFn, renameFileFn, createFolderFn, duplicateFileFn, async () => {
      await refreshTree();
    });
  }, [activePath, createFile, createFolderFn, deleteFileFn, duplicateFileFn, onTreeChange, openFile, renameFileFn, tree, refreshTree]);

  useEffect(() => {
    const unsubscribe = onConstructFlowSessionEvent((event: ConstructFlowSessionEvent) => {
      if (event.projectId !== project.id) return;
      if (event.type === "started" || event.type === "updated") {
        setLiveSession(event.session);
        return;
      }
      const nextSessions = upsertSession(sessionsRef.current, event.session);
      const updatedAt = event.session.updatedAt || new Date().toISOString();
      const currentProject = projectRef.current;
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      onProjectChange({
        ...currentProject,
        flow: {
          ...currentProject.flow,
          researchEnabled: currentProject.flow.researchEnabled || event.session.threadId === `${currentProject.flow.threadId}:research`,
          researchCompletedAt: event.type === "completed" && event.session.threadId === `${currentProject.flow.threadId}:research`
            ? updatedAt
            : currentProject.flow.researchCompletedAt,
          sessions: nextSessions,
          updatedAt
        }
      });
      if (event.type === "completed" || event.type === "error" || event.type === "waiting") {
        setPending(false);
        setLiveSession(undefined);
      } else {
        setLiveSession(event.session);
      }
    });
    return unsubscribe;
  }, [onProjectChange, project.id]);

  const mergedFlowSessions = useMemo(() => mergeSessions(sessions, liveSession), [liveSession, sessions]);
  const flowConcepts = useMemo(() => collectFlowConcepts(mergedFlowSessions), [mergedFlowSessions]);
  const flowTasks = useMemo(() => mergedFlowSessions.flatMap((session) => session.practiceTasks), [mergedFlowSessions]);

  useEffect(() => {
    if (!flowUiStateHydrated || restoringFlowUiStateRef.current) return;
    const state: FlowWorkspaceUiState = {
      version: 1,
      activeWorkspaceTabId,
      documentTabs: documentSession.tabs,
      openTaskTabIds,
      openConceptId: openConcept?.id ?? null,
      chatScrollTop
    };
    const timeout = window.setTimeout(() => {
      void setUiState({
        key: FLOW_WORKSPACE_UI_STATE_KEY,
        scope: "workspace",
        projectId: project.id,
        value: state
      }).catch(() => {
        // Browser-only smoke checks run without Electron storage.
      });
    }, 2_000);
    return () => window.clearTimeout(timeout);
  }, [
    activeWorkspaceTabId,
    chatScrollTop,
    documentSession.tabs,
    flowUiStateHydrated,
    openConcept?.id,
    openTaskTabIds,
    project.id
  ]);

  useEffect(() => {
    for (const task of flowTasks) {
      if (taskLayoutRequestIdsRef.current.has(task.id)) {
        continue;
      }
      taskLayoutRequestIdsRef.current.add(task.id);
      requestWorkbenchLayout("task-created");
      break;
    }
  }, [flowTasks, requestWorkbenchLayout]);
  const pathNodes = useMemo(() => [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order), [project.flow.pathNodes]);
  const currentPathNode = useMemo(() => currentFlowPathNode(pathNodes, project.flow.currentPathNodeId), [pathNodes, project.flow.currentPathNodeId]);
  const currentTask = useMemo(() => findActiveTaskForNode(flowTasks, currentPathNode?.id), [currentPathNode?.id, flowTasks]);
  const openTaskTab = useCallback((task: ConstructFlowPracticeTask) => {
    setOpenTaskTabIds((current) => current.includes(task.id) ? current : [...current, task.id]);
    setActiveWorkspaceTabId(flowTaskTabId(task.id));
  }, []);
  const openConceptById = useCallback((conceptId: string) => {
    const concept = flowConcepts.find((candidate) => candidate.id === conceptId)
      ?? buildInlineConceptPlaceholder(conceptId);
    setOpenConcept(concept);
  }, [flowConcepts]);

  const updateChatScrollTop = useCallback((scrollTop: number | null) => {
    pendingChatScrollTopRef.current = scrollTop;
    if (chatScrollFrameRef.current != null) return;
    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      setChatScrollTop((current) => current === pendingChatScrollTopRef.current ? current : pendingChatScrollTopRef.current);
    });
  }, []);

  useEffect(() => () => {
    if (chatScrollFrameRef.current != null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
      chatScrollFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    onGuidePanelChange(
      <FlowAgentPanel
        project={project}
        activeView={activePanelView}
        sessions={sessions}
        liveSession={liveSession}
        pending={pending}
        chatMode={chatMode}
        chatScrollTop={chatScrollTop}
        openConcept={activePanelView === "chat" && chatMode === "maximized" ? openConcept : null}
        theme={theme}
        onActiveViewChange={onPanelViewChange}
        onRunAgent={runAgent}
        onSubmitTask={submitTask}
        onCloseConceptDetails={() => setOpenConcept(null)}
        onOpenConceptDetails={(concept) => setOpenConcept(concept)}
        onOpenConceptById={openConceptById}
        onOpenTask={openTaskTab}
        onOpenFile={openInlineFile}
        onRewindUserMessage={rewindUserSession}
        onChatScrollTopChange={updateChatScrollTop}
        onResetChat={() => {
          setSessions([]);
          setLiveSession(undefined);
        }}
      />
    );
    return () => onGuidePanelChange(null);
  }, [activePanelView, chatMode, liveSession, onGuidePanelChange, onPanelViewChange, openConcept, openConceptById, openInlineFile, openTaskTab, pending, project, rewindUserSession, runAgent, sessions, submitTask, theme, updateChatScrollTop, setOpenConcept]);

  useEffect(() => {
    onKnowledgePanelChange?.(null);
    return () => onKnowledgePanelChange?.(null);
  }, [onKnowledgePanelChange]);

  const chatOwnsConceptCard = activePanelView === "chat" && chatMode === "maximized";
  const sidecar = openConcept && !chatOwnsConceptCard ? (
    <div className="flex h-full max-h-full min-h-0 w-full flex-col" aria-label="Open concept details">
      <KnowledgeCard
        key={openConcept.id}
        concept={openConcept}
        relatedConcepts={flowConcepts}
        saved={false}
        theme={theme}
        onClose={() => setOpenConcept(null)}
        onOpenConcept={openConceptById}
        onOpenFile={openInlineFile}
        onSaveChange={() => {}}
      />
    </div>
  ) : null;

  const editorSlotTabs: SlotTab[] = useMemo(() => {
    const fileTabs = documentSession.tabs.map((tabPath) => {
      const filename = tabPath.split("/").pop() || tabPath;
      return {
        id: tabPath,
        title: filename,
        icon: iconForFile(filename),
        closable: true,
        active: tabPath === activeWorkspaceTabId,
        content: null,
      };
    });
    const taskTabs = openTaskTabIds.flatMap((taskId): SlotTab[] => {
      const task = flowTasks.find((candidate) => candidate.id === taskId);
      if (!task) return [];
      return [{
        id: flowTaskTabId(task.id),
        title: task.title,
        icon: <ListChecksIcon size={14} />,
        closable: true,
        active: flowTaskTabId(task.id) === activeWorkspaceTabId,
        content: null
      }];
    });
    return [...fileTabs, ...taskTabs];
  }, [activeWorkspaceTabId, documentSession.tabs, flowTasks, openTaskTabIds]);

  const handleTabChange = useCallback((tabId: string) => {
    if (!tabId) return;
    if (taskIdFromFlowTab(tabId)) {
      setActiveWorkspaceTabId(tabId);
      return;
    }
    if (tabId !== activePath) {
      void openFile(tabId);
    } else {
      setActiveWorkspaceTabId(tabId);
    }
  }, [activePath, openFile]);

  const handleTabClose = useCallback((tabId: string) => {
    const taskId = taskIdFromFlowTab(tabId);
    if (taskId) {
      setOpenTaskTabIds((current) => current.filter((id) => id !== taskId));
      return;
    }
    closeFileTab(tabId);
  }, [closeFileTab]);

  const activeTaskTabId = activeWorkspaceTabId ? taskIdFromFlowTab(activeWorkspaceTabId) : null;
  const activeTaskTab = activeTaskTabId ? flowTasks.find((task) => task.id === activeTaskTabId) : undefined;
  const activeTaskNode = activeTaskTab?.pathNodeId
    ? pathNodes.find((node) => node.id === activeTaskTab.pathNodeId)
    : undefined;
  const activeTaskIsCurrent = Boolean(activeTaskTab && currentTask?.id === activeTaskTab.id);

  const editorOutlet = activeTaskTab ? (
    <FlowTaskDetailsTab
      task={activeTaskTab}
      node={activeTaskNode}
      current={activeTaskIsCurrent}
      theme={theme}
      onSubmitTask={submitTask}
      onOpenFile={openInlineFile}
    />
  ) : (
    <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)] bg-background">
      <EditorPane
        path={activePath}
        workspacePath={project.workspacePath}
        content={content}
        activeEdit={null}
        editAnchor=""
        editProgress={0}
        onFreeEdit={(next) => {
          if (!activePath) return;
          setFileContents((current) => {
            const updated = { ...current, [activePath]: next };
            fileContentsRef.current = updated;
            return updated;
          });
          setDirtyPaths((current) => {
            const updated = { ...current, [activePath]: true };
            dirtyPathsRef.current = updated;
            return updated;
          });
        }}
        onGuidedProgress={() => undefined}
        onRevealLine={() => undefined}
        onSave={() => void saveFile()}
        theme={theme}
        focusRange={focusRange}
        onOpenFileAndJump={(path, line) => {
          void openFile(path).then((opened) => {
            if (opened) setFocusRange({ line, hint: "Opened from Flow" });
          });
        }}
      />
      {dirty ? (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-md">
          <span>Unsaved changes</span>
          <Button size="sm" onClick={() => void saveFile()}><CheckIcon size={14} />Save</Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <AdaptiveSidecarLayout
      className="h-full min-h-0"
      open={openConcept !== null && !chatOwnsConceptCard}
      pinned={false}
      sidecar={sidecar}
    >
      <SlotPanel
        activeTabId={activeWorkspaceTabId ?? activePath ?? undefined}
        tabs={editorSlotTabs}
        syncTabs
        outlet={editorOutlet}
        ariaLabel="Editor file tabs"
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
      />
    </AdaptiveSidecarLayout>
  );
}

type FlowAgentRunOptions = {
  taskSubmission?: Awaited<ReturnType<typeof submitFlowTask>>;
  taskMessage?: {
    taskId: string;
    pathNodeId?: string;
  };
  questionResponse?: ConstructFlowQuestionResponse;
};

type ConceptMutationKind = "added" | "modified" | "removed";

type ConceptMutation = {
  id: string;
  title: string;
  kind: ConceptMutationKind;
  eventId: string;
};

type ConceptPayload = {
  id: string;
  title: string;
  parentId?: string | null;
  language?: ConstructConceptLanguage;
  technology?: string;
  summary?: string;
  sources?: ConstructCitationSource[];
  content?: string;
  examples: string[];
  relatedConcepts?: string[];
  confidence?: string;
  masteryLevel?: ConstructConceptMasteryLevel;
  masteryText?: string;
  masteryReason?: string;
  masteryEvidence?: string[];
  masteryUpdatedAt?: string;
  reason?: string;
  confidenceReason?: string;
  evidence: string[];
  learnerEvidence?: string[];
  lastChangeReason?: string;
  authoredBy?: string;
  agentContributionPercent?: number;
  savedAt?: string;
  lastModifiedAt?: string;
  history?: ConceptCard["history"];
  normalizedFrom?: string;
};

type ConceptTreeNode = {
  id: string;
  segment: string;
  title?: string;
  mutation?: ConceptMutation;
  children: ConceptTreeNode[];
};

function collectFlowConcepts(sessions: ConstructFlowSession[]): ConceptCard[] {
  const concepts = new Map<string, ConceptCard>();

  for (const session of sessions) {
    for (const event of session.agentEvents) {
      if (event.type !== "tool") continue;
      const toolName = event.toolName ?? event.title;
      applyFlowConceptRecord(concepts, toolName, event.input, event.outputPreview);
    }

    for (const toolCall of session.toolCalls) {
      applyFlowConceptRecord(concepts, toolCall.name, toolCall.input, toolCall.outputPreview);
    }
  }

  return Array.from(concepts.values());
}

function collectConceptMutations(sessions: ConstructFlowSession[]): ConceptMutation[] {
  const mutations = new Map<string, ConceptMutation>();

  for (const session of sessions) {
    for (const event of session.agentEvents) {
      if (event.type !== "tool") continue;
      const toolName = event.toolName ?? event.title;
      const mutation = readConceptMutation(toolName, event.id, event.input, event.outputPreview);
      if (mutation) mutations.set(`${event.id}:${mutation.id}`, mutation);
    }

    for (const toolCall of session.toolCalls) {
      const mutation = readConceptMutation(toolCall.name, toolCall.id, toolCall.input, toolCall.outputPreview);
      if (mutation) mutations.set(`${toolCall.id}:${mutation.id}`, mutation);
    }
  }

  return Array.from(mutations.values());
}

function readConceptMutation(
  toolName: string | undefined,
  eventId: string,
  input: unknown,
  outputPreview?: string
): ConceptMutation | null {
  const kind = conceptMutationKindForTool(toolName);
  if (!kind) return null;
  const payload = readConceptPayload(input, outputPreview);
  if (!payload.id) return null;
  return {
    id: payload.id,
    title: payload.title || payload.id,
    kind,
    eventId
  };
}

function conceptMutationKindForTool(toolName: string | undefined): ConceptMutationKind | null {
  if (toolName === "add-concept") return "added";
  if (toolName === "modify-concept") return "modified";
  if (toolName === "remove-concept") return "removed";
  return null;
}

function applyFlowConceptRecord(concepts: Map<string, ConceptCard>, toolName: string | undefined, input: unknown, outputPreview?: string) {
  if (toolName === "fetch-concepts") {
    const outputObj = parseJsonObject(outputPreview);
    if (outputObj && Array.isArray(outputObj.concepts)) {
      for (const conceptPayload of outputObj.concepts) {
        if (conceptPayload && typeof conceptPayload === "object" && conceptPayload.id) {
          concepts.set(conceptPayload.id, buildConceptCardFromInput({
            id: conceptPayload.id,
            title: conceptPayload.title,
            language: conceptPayload.language,
            technology: conceptPayload.technology,
            tags: conceptPayload.tags,
            parentId: conceptPayload.parentId,
            summary: conceptPayload.summary,
            content: conceptPayload.content,
            why: conceptPayload.why,
            example: conceptPayload.example || conceptPayload.examples?.[0],
            examples: conceptPayload.examples,
            docs: conceptPayload.docs,
            guides: conceptPayload.guides,
            relatedConcepts: conceptPayload.relatedConcepts,
            confidence: conceptPayload.confidence,
            confidenceReason: conceptPayload.confidenceReason,
            learnerEvidence: conceptPayload.learnerEvidence,
            lastChangeReason: conceptPayload.lastChangeReason,
            authoredBy: conceptPayload.authoredBy,
            agentContributionPercent: conceptPayload.agentContributionPercent,
            savedAt: conceptPayload.savedAt,
            lastModifiedAt: conceptPayload.lastModifiedAt,
            history: conceptPayload.history
          }));
        }
      }
    }
    return;
  }

  if (toolName !== "add-concept" && toolName !== "modify-concept" && toolName !== "remove-concept" && toolName !== "suggest-existing-concept") return;
  const payload = readConceptPayload(input, outputPreview);
  if (!payload.id) return;

  if (toolName === "remove-concept") {
    concepts.delete(payload.id);
    return;
  }

  if (toolName === "suggest-existing-concept") {
    if (!concepts.has(payload.id)) {
      concepts.set(payload.id, buildConceptCardFromInput(payload));
    }
    return;
  }

  const existing = concepts.get(payload.id);
  const newCard = buildConceptCardFromInput(payload);
  const merged = existing ? mergeConceptCards(existing, newCard) : newCard;
  concepts.set(payload.id, merged);
}

function FlowAgentPanel({
  project,
  activeView,
  sessions,
  liveSession,
  pending,
  chatMode,
  chatScrollTop,
  openConcept,
  theme,
  onActiveViewChange,
  onRunAgent,
  onSubmitTask,
  onCloseConceptDetails,
  onOpenConceptDetails,
  onOpenConceptById,
  onOpenTask,
  onOpenFile,
  onRewindUserMessage,
  onChatScrollTopChange,
  onResetChat
}: {
  project: FlowProjectRecord;
  activeView: "chat" | "project";
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  pending: boolean;
  chatMode: FlowChatMode;
  chatScrollTop: number | null;
  openConcept: ConceptCard | null;
  theme: "light" | "dark" | "system";
  onActiveViewChange: (view: "chat" | "project") => void;
  onRunAgent: (message: string, options?: FlowAgentRunOptions) => Promise<void>;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onCloseConceptDetails: () => void;
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onRewindUserMessage: (sessionId: string) => Promise<void>;
  onChatScrollTopChange: (scrollTop: number | null) => void;
  onResetChat: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [rewindingSessionId, setRewindingSessionId] = useState<string | null>(null);
  const [acknowledgedConceptEventKeys, setAcknowledgedConceptEventKeys] = useState<Set<string>>(() => new Set());
  const acknowledgeConceptEvent = useCallback((eventKey: string) => {
    setAcknowledgedConceptEventKeys((current) => {
      const next = new Set(current);
      next.add(eventKey);
      return next;
    });
  }, []);
  const mergedSessions = useMemo(() => mergeSessions(sessions, liveSession), [liveSession, sessions]);
  const flowConcepts = useMemo(() => collectFlowConcepts(mergedSessions), [mergedSessions]);
  const conceptMutations = useMemo(() => collectConceptMutations(mergedSessions), [mergedSessions]);
  const flowTasks = useMemo(() => mergedSessions.flatMap((session) => session.practiceTasks), [mergedSessions]);
  const flowExercises = useMemo(() => mergedSessions.flatMap((session) => session.conceptExercises ?? []), [mergedSessions]);
  const pathNodes = useMemo(() => [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order), [project.flow.pathNodes]);
  const currentPathNode = useMemo(() => currentFlowPathNode(pathNodes, project.flow.currentPathNodeId), [pathNodes, project.flow.currentPathNodeId]);
  const activeTask = useMemo(() => findActiveTaskForNode(flowTasks, currentPathNode?.id), [currentPathNode?.id, flowTasks]);
  const activeQuestion = useMemo(() => findActiveFlowQuestion(mergedSessions), [mergedSessions]);
  const activeConceptExercise = useMemo(() => {
    const waitingExercises = flowExercises.filter((ex) => ex.status === "waiting");
    return waitingExercises.length > 0 ? waitingExercises[waitingExercises.length - 1] : undefined;
  }, [flowExercises]);

  const activeComposerItem = useMemo(() => {
    if (activeConceptExercise) {
      let eventId = "";
      for (const session of mergedSessions) {
        const timelineEvent = session.timeline?.find(
          (e) => e.kind === "tool" && e.name === "concept-exercise" && (() => {
            const payload = readExerciseToolPayload(e.input, e.outputPreview);
            const resolved = resolveExerciseForToolPayload(payload, session.conceptExercises ?? [], session.id);
            return resolved?.id === activeConceptExercise.id;
          })()
        );
        if (timelineEvent) {
          eventId = timelineEvent.id;
          return {
            type: "exercise" as const,
            id: activeConceptExercise.id,
            title: activeConceptExercise.title,
            prompt: activeConceptExercise.prompt,
            domId: `${session.id}:exercise:${eventId}`,
            item: activeConceptExercise
          };
        }
      }
      return {
        type: "exercise" as const,
        id: activeConceptExercise.id,
        title: activeConceptExercise.title,
        prompt: activeConceptExercise.prompt,
        domId: "",
        item: activeConceptExercise
      };
    }

    if (activeTask) {
      let eventId = "";
      for (const session of mergedSessions) {
        const timelineEvent = session.timeline?.find(
          (e) => e.kind === "tool" && e.name === "practice-task" && (() => {
            const payload = readTaskToolPayload(e.input, e.outputPreview);
            const resolved = resolveTaskForToolPayload(payload, session.practiceTasks ?? [], session.id);
            return resolved?.id === activeTask.id;
          })()
        );
        if (timelineEvent) {
          eventId = timelineEvent.id;
          return {
            type: "task" as const,
            id: activeTask.id,
            title: activeTask.title,
            prompt: activeTask.prompt,
            domId: `${session.id}:task:${eventId}`,
            item: activeTask
          };
        }
      }
      return {
        type: "task" as const,
        id: activeTask.id,
        title: activeTask.title,
        prompt: activeTask.prompt,
        domId: "",
        item: activeTask
      };
    }

    return undefined;
  }, [activeConceptExercise, activeTask, mergedSessions]);
  const messages = useMemo(() => buildFlowMessages({
    sessions: mergedSessions,
    concepts: flowConcepts,
    conceptMutations,
    tasks: flowTasks,
    pathNodes,
    currentTaskId: activeTask?.id,
    acknowledgedConceptEventKeys,
    theme,
    onOpenConceptDetails,
    onOpenConceptById,
    onAcknowledgeConceptEvent: acknowledgeConceptEvent,
    onOpenTask,
    onOpenFile,
    onRewindUserMessage: async (sessionId, content) => {
      setRewindingSessionId(sessionId);
      try {
        await onRewindUserMessage(sessionId);
        setDraft(content);
      } finally {
        setRewindingSessionId(null);
      }
    },
    rewindingSessionId,
    pending,
    chatMode
  }), [acknowledgeConceptEvent, acknowledgedConceptEventKeys, activeTask?.id, conceptMutations, flowConcepts, flowTasks, mergedSessions, onOpenConceptById, onOpenConceptDetails, onOpenFile, onOpenTask, onRewindUserMessage, pathNodes, rewindingSessionId, pending, theme, chatMode]);
  const latestContextWindow = useMemo(() => findLatestContextWindow(mergedSessions), [mergedSessions]);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const aiSettingsRef = useRef<AiSettings | null>(null);

  const refreshModels = useCallback(async (settingsSnapshot?: AiSettings | null) => {
    const resolvedSettings = settingsSnapshot ?? aiSettingsRef.current;
    if (!resolvedSettings) return;
    setModelsBusy(true);
    setModelsError(null);
    try {
      const models = await listModels({
        provider: resolvedSettings.provider,
        apiKey: apiKeyForProvider(resolvedSettings)
      });
      setModelOptions(models);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      setModelOptions([]);
    } finally {
      setModelsBusy(false);
    }
  }, []);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
  }, [aiSettings]);

  useEffect(() => {
    let cancelled = false;
    void getSettings()
      .then((settings) => {
        if (cancelled) return;
        setAiSettings(settings.ai);
        void refreshModels(settings.ai);
      })
      .catch((error) => {
        if (!cancelled) setModelsError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshModels]);

  const activeFlowModel = useMemo(() => (
    aiSettings ? flowFeatureModel(aiSettings) : latestContextWindow?.modelId ?? ""
  ), [aiSettings, latestContextWindow?.modelId]);
  const flowModelOptions = useMemo(() => (
    ensureModelOption(modelOptions, activeFlowModel, aiSettings?.provider)
  ), [activeFlowModel, aiSettings?.provider, modelOptions]);

  const updateFlowModel = useCallback(async (model: string) => {
    if (!aiSettings) return;
    const featureModels = {
      ...(aiSettings.featureModels ?? {}),
      "construct-flow": model
    };
    const optimistic = { ...aiSettings, featureModels };
    setAiSettings(optimistic);
    setModelsError(null);
    try {
      const settings = await updateAiSettings({ ai: { featureModels } });
      setAiSettings(settings.ai);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      const settings = await getSettings();
      setAiSettings(settings.ai);
    }
  }, [aiSettings]);

  const updateReasoningEffort = useCallback(async (reasoningEffort: AiSettings["reasoningEffort"]) => {
    if (!aiSettings) return;
    const optimistic = { ...aiSettings, reasoningEffort };
    setAiSettings(optimistic);
    setModelsError(null);
    try {
      const settings = await updateAiSettings({ ai: { reasoningEffort } });
      setAiSettings(settings.ai);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      const settings = await getSettings();
      setAiSettings(settings.ai);
    }
  }, [aiSettings]);

  useEffect(() => {
    setDraft("");
  }, [activeQuestion?.id]);

  const submitComposer = useCallback(() => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    void onRunAgent(message, activeTask ? { taskMessage: { taskId: activeTask.id, pathNodeId: activeTask.pathNodeId } } : undefined);
  }, [activeTask, draft, onRunAgent]);
  const showMaximizedConceptDock = activeView === "chat" && chatMode === "maximized" && openConcept !== null;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      {activeView === "project" && (
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border/45 bg-background/95 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-muted/55 text-muted-foreground">
              <ListChecksIcon size={15} />
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-sm">Project map</strong>
              <span className="block truncate text-[11px] text-muted-foreground">{project.flow.goal}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className="rounded-full" size="sm" variant="ghost" title="Back to Flow chat" onClick={() => onActiveViewChange("chat")}>
                  <BotIcon size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Back to chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button className="rounded-full" size="sm" variant="ghost" title="Reset visible Flow chat" onClick={onResetChat}>
                  <RotateCcwIcon size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Reset chat</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      {activeView === "project" ? (
        <FlowProjectDataPanel
          project={project}
          pathNodes={pathNodes}
          currentPathNode={currentPathNode}
          tasks={flowTasks}
          exercises={flowExercises}
          concepts={flowConcepts}
          theme={theme}
          chatMode={chatMode}
          onOpenConcept={onOpenConceptDetails}
          onOpenTask={onOpenTask}
          onSubmitTask={onSubmitTask}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div
          className={cn(
            "construct-flow-chat-stage relative flex min-h-0 flex-1 overflow-hidden",
            chatMode === "maximized" && "is-maximized",
            showMaximizedConceptDock && "has-concept"
          )}
        >
          <div
            className={cn(
              "construct-flow-chat-concept-dock",
              showMaximizedConceptDock && "is-open"
            )}
            aria-hidden={!showMaximizedConceptDock}
          >
            {openConcept ? (
              <div className="construct-flow-chat-concept-card">
                <KnowledgeCard
                  key={openConcept.id}
                  concept={openConcept}
                  relatedConcepts={flowConcepts}
                  saved={false}
                  theme={theme}
                  onClose={onCloseConceptDetails}
                  onOpenConcept={onOpenConceptById}
                  onOpenFile={onOpenFile}
                  onSaveChange={() => {}}
                />
              </div>
            ) : null}
          </div>
          <div className="construct-flow-chat-thread relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <AgentSessionSurface
            className="construct-flow-session min-h-0 flex-1 bg-transparent"
            messages={messages}
            emptyState={<div className="flex flex-col items-center gap-2 text-center"><BotIcon size={18} /><span>Ask Flow what to build or learn next.</span></div>}
            scrollKey={`${messages.length}:${liveSession?.updatedAt ?? "idle"}`}
            timelineScrollTop={chatScrollTop}
            onTimelineScroll={(state) => {
              onChatScrollTopChange(state.atBottom ? null : state.scrollTop);
            }}
            composer={
              activeQuestion ? (
                <FlowQuestionComposer
                  key={activeQuestion.id}
                  question={activeQuestion}
                  theme={theme}
                  chatMode={chatMode}
                  value={draft}
                  onValueChange={setDraft}
                  onAnswer={(response) => {
                    setDraft("");
                    void onRunAgent("Continue from the tracked question answer.", { questionResponse: response });
                  }}
                  onSkip={() => {
                    const response = buildFlowQuestionResponse(activeQuestion, "", true);
                    setDraft("");
                    void onRunAgent("Continue from the skipped tracked question.", { questionResponse: response });
                  }}
                  pending={pending && !activeQuestion}
                  onOpenFile={onOpenFile}
                  onOpenConcept={onOpenConceptById}
                />
              ) : (
                <>
                  <AgentSessionComposer
                    className={cn("construct-flow-composer", chatMode === "panel" && "is-panel")}
                    value={draft}
                    onValueChange={setDraft}
                    onSubmit={submitComposer}
                    pending={pending}
                    submitLabel="Send"
                    placeholder={activeTask ? `Message Flow about: ${activeTask.title}` : "Ask for follow-up changes"}
                    header={
                      chatMode === "panel" && activeComposerItem ? (
                        <ActiveComposerItemIndicator
                          activeItem={activeComposerItem}
                          isHeader={true}
                          pending={pending}
                          onSubmitTask={onSubmitTask}
                        />
                      ) : undefined
                    }
                    footerStart={
                      chatMode !== "panel" && activeComposerItem ? (
                        <ActiveComposerItemIndicator
                          activeItem={activeComposerItem}
                          pending={pending}
                          onSubmitTask={onSubmitTask}
                        />
                      ) : null
                    }
                    footerEnd={
                      <FlowComposerRightControls
                        contextWindow={latestContextWindow}
                        settings={aiSettings}
                        model={activeFlowModel}
                        models={flowModelOptions}
                        modelsBusy={modelsBusy}
                        modelsError={modelsError}
                        reasoningEffort={aiSettings?.reasoningEffort ?? "auto"}
                        onModelChange={updateFlowModel}
                        onReasoningEffortChange={updateReasoningEffort}
                      />
                    }
                  />
                  {/* Kept for static analysis tests: <FlowComposerControls */}
                </>
              )
            }
          />
          </div>
        </div>
      )}
    </aside>
  );
}

function FlowComposerControls({
  contextWindow,
  settings,
  model,
  models,
  modelsBusy,
  modelsError,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  onRefreshModels
}: {
  contextWindow?: ConstructAgentContextWindow;
  settings: AiSettings | null;
  model: string;
  models: ModelCatalogEntry[];
  modelsBusy: boolean;
  modelsError: string | null;
  reasoningEffort: AiSettings["reasoningEffort"];
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: AiSettings["reasoningEffort"]) => void;
  onRefreshModels: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <FlowContextMeter contextWindow={contextWindow} />
      {settings ? (
        <div className="flex min-w-0 items-center gap-1">
          {modelsBusy ? <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" /> : null}
          <FlowModelDropdown
            provider={settings.provider}
            value={model}
            models={models}
            disabled={modelsBusy}
            onChange={onModelChange}
          />
          <FlowReasoningEffortDropdown
            value={reasoningEffort}
            disabled={modelsBusy}
            onChange={onReasoningEffortChange}
          />
          <Button
            className="hidden h-6 rounded-full px-1.5 sm:inline-flex"
            size="sm"
            variant="ghost"
            title="Refresh model list"
            type="button"
            onClick={onRefreshModels}
          >
            <RotateCcwIcon size={13} />
          </Button>
          {modelsError ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-destructive ring-1 ring-destructive/30">!</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[18rem] text-left">{modelsError}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted/45 px-2 text-[11px] text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          Model
        </span>
      )}
    </div>
  );
}

const reasoningEffortOptions: Array<{ value: AiSettings["reasoningEffort"]; label: string; short: string }> = [
  { value: "auto", label: "Auto", short: "Auto" },
  { value: "none", label: "None", short: "Off" },
  { value: "low", label: "Low", short: "Low" },
  { value: "medium", label: "Medium", short: "Med" },
  { value: "high", label: "High", short: "High" }
];

function reasoningEffortMeta(value: AiSettings["reasoningEffort"]) {
  return reasoningEffortOptions.find((option) => option.value === value) ?? reasoningEffortOptions[0];
}

function FlowReasoningEffortDropdown({
  value,
  disabled,
  onChange
}: {
  value: AiSettings["reasoningEffort"];
  disabled?: boolean;
  onChange: (effort: AiSettings["reasoningEffort"]) => void;
}) {
  const active = reasoningEffortMeta(value);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
                className="h-6 gap-1 rounded-full px-2 text-[11px]"
                size="sm"
                variant="secondary"
                type="button"
                disabled={disabled}
                title="Thinking effort"
              >
                <BrainCircuitIcon size={13} />
                <span className="hidden sm:inline">{active.short}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Thinking effort: {active.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44 p-1">
        {reasoningEffortOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="flex items-center justify-between gap-2 rounded-[7px] text-xs"
            onClick={() => onChange(option.value)}
          >
            <span className="flex items-center gap-2">
              <BrainCircuitIcon size={13} className="text-muted-foreground" />
              {option.label}
            </span>
            {option.value === value ? <CheckIcon size={13} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ModelBrandKey =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "meta"
  | "xai"
  | "perplexity"
  | "github-copilot"
  | "openrouter"
  | "opencode-zen"
  | "litellm"
  | "other";

function FlowModelDropdown({
  provider,
  value,
  models,
  disabled,
  onChange
}: {
  provider: AiSettings["provider"];
  value: string;
  models: ModelCatalogEntry[];
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<ModelBrandKey | "all">("all");
  const activeModel = models.find((model) => model.id === value) ?? null;
  const activeBrand = modelBrandFor(activeModel, provider);
  const activeMeta = modelBrandMeta(activeBrand);
  const buckets = useMemo(() => bucketModelsByBrand(models, provider), [models, provider]);
  const visibleBrandKeys = useMemo(() => sortModelBrands([...buckets.keys()]), [buckets]);
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleBrandKeys
      .filter((brand) => brandFilter === "all" || brand === brandFilter)
      .map((brand) => {
        const brandModels = buckets.get(brand) ?? [];
        const filteredModels = normalizedQuery
          ? brandModels.filter((model) => modelMatchesQuery(model, normalizedQuery))
          : brandModels;
        return { brand, models: filteredModels };
      })
      .filter((group) => group.models.length > 0);
  }, [brandFilter, buckets, query, visibleBrandKeys]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
            className="h-6 min-w-0 max-w-[12rem] justify-between gap-1.5 rounded-full px-2 text-[11px]"
            size="sm"
            variant="secondary"
            type="button"
            disabled={disabled}
            title="Select Flow model"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ModelBrandMark brand={activeBrand} />
              <span className="truncate">{activeModel?.name || readableModelName(value) || "Select model"}</span>
            </span>
            <ChevronDownIcon size={13} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(46rem,calc(100vw-2rem))] p-2"
      >
        <div className="grid min-h-0 gap-2 md:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2 rounded-[8px] border bg-background/70 px-2">
              <SearchIcon size={14} className="shrink-0 text-muted-foreground" />
              <Input
                value={query}
                placeholder="Search models"
                className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </div>
            <div className="grid gap-1">
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[7px] border px-2 text-left text-xs transition-colors",
                  brandFilter === "all" ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => setBrandFilter("all")}
              >
                <Layers3Icon size={13} />
                <span className="truncate">All models</span>
              </button>
              {visibleBrandKeys.map((brand) => {
                const meta = modelBrandMeta(brand);
                return (
                  <button
                    key={brand}
                    type="button"
                    className={cn(
                      "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[7px] border px-2 text-left text-xs transition-colors",
                      brandFilter === brand ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setBrandFilter(brand)}
                  >
                    <ModelBrandMark brand={brand} compact />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 border-t pt-2 md:border-l md:border-t-0 md:pl-2 md:pt-0">
          <ScrollArea className="h-[16rem] pr-2">
            <div className="flex flex-col gap-2">
              {filteredGroups.length ? (
                filteredGroups.map((group) => {
                  const meta = modelBrandMeta(group.brand);
                  return (
                    <DropdownMenuGroup key={group.brand}>
                      <DropdownMenuLabel className="flex items-center gap-1.5 px-1 text-[11px]">
                        <ModelBrandMark brand={group.brand} compact />
                        {meta.label}
                      </DropdownMenuLabel>
                      <div className="flex flex-col gap-1">
                        {group.models.map((model) => {
                          const selected = model.id === value;
                          return (
                            <DropdownMenuItem
                              key={model.id}
                              className={cn(
                                "min-h-10 items-start gap-2 rounded-[8px] px-2 py-2",
                                selected && "bg-accent text-accent-foreground"
                              )}
                              onClick={() => onChange(model.id)}
                            >
                              <ModelBrandMark brand={group.brand} />
                              <span className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-sm font-medium">{model.name || readableModelName(model.id)}</span>
                                  {selected ? <CheckIcon size={13} className="shrink-0" /> : null}
                                </span>
                                <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground">
                                  <span className="truncate font-mono">{model.id}</span>
                                  {model.contextLength ? (
                                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                      {formatTokens(model.contextLength)}
                                    </Badge>
                                  ) : null}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          );
                        })}
                      </div>
                    </DropdownMenuGroup>
                  );
                })
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-1 text-center text-xs text-muted-foreground">
                  <SearchIcon size={16} />
                  No models match this search.
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{providerLabel(provider)} catalog</span>
            <span className="inline-flex items-center gap-1">
              <BadgeCheckIcon size={12} />
              {activeMeta.label}
            </span>
          </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FlowContextMeter({ contextWindow }: { contextWindow?: ConstructAgentContextWindow }) {
  const usedTokens = contextWindow?.usedTokens ?? ((contextWindow?.inputTokens ?? 0) + (contextWindow?.outputTokens ?? 0));
  const maxTokens = contextWindow?.maxTokens;
  const percent = usedTokens && maxTokens
    ? Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)))
    : null;
  const sourceLabel = contextWindow?.source === "runtime" ? "Runtime reported" : "Estimated";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted/45 px-1.5 text-[11px] text-muted-foreground ring-1 ring-border/25"
          title="Context window"
        >
          <GaugeIcon size={13} />
          <span className="tabular-nums">{percent == null ? "--" : `${percent}%`}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex max-w-[16rem] flex-col items-center gap-1 rounded-[10px] px-4 py-3 text-center">
        <span className="text-muted-foreground">Context window:</span>
        <strong className="text-sm font-semibold">{percent == null ? "Unknown" : `${percent}% full`}</strong>
        <span>{formatTokens(usedTokens)} / {maxTokens ? formatTokens(maxTokens) : "unknown"} tokens used</span>
        <span>System prompt: {formatTokens(contextWindow?.systemPromptTokens ?? 0)}</span>
        <span>Flow state: {formatTokens(contextWindow?.flowStateTokens ?? 0)}</span>
        <span>Chat: {formatTokens(contextWindow?.chatTokens ?? 0)}</span>
        <span>Visible trace: {formatTokens(contextWindow?.visibleTranscriptTokens ?? 0)} tokens</span>
        <span>Model messages: {contextWindow?.messageCount ?? 0} · visible events: {contextWindow?.visibleTranscriptEventCount ?? 0}</span>
        {contextWindow?.modelId ? <span className="max-w-full truncate text-muted-foreground">{contextWindow.modelId}</span> : null}
        {contextWindow?.compaction ? <span className="text-muted-foreground">Compaction {contextWindow.compaction.status}</span> : null}
        <span className="text-muted-foreground">{sourceLabel}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function FlowProjectDataPanel({
  project,
  pathNodes,
  currentPathNode,
  tasks,
  exercises,
  concepts,
  theme,
  chatMode,
  onOpenConcept,
  onOpenTask,
  onSubmitTask,
  onOpenFile
}: {
  project: FlowProjectRecord;
  pathNodes: ConstructFlowPathNode[];
  currentPathNode?: ConstructFlowPathNode;
  tasks: ConstructFlowPracticeTask[];
  exercises: ConstructFlowConceptExercise[];
  concepts: ConceptCard[];
  theme: "light" | "dark" | "system";
  chatMode: FlowChatMode;
  onOpenConcept: (concept: ConceptCard) => void;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const currentNodeTasks = currentPathNode
    ? tasks.filter((task) => task.pathNodeId === currentPathNode.id)
    : tasks;
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
  const currentConcepts = currentPathNode?.concepts?.length
    ? currentPathNode.concepts.map((conceptId) => conceptsById.get(conceptId) ?? buildInlineConceptPlaceholder(conceptId))
    : concepts;
  const [masteryOpen, setMasteryOpen] = useState(false);
  const masteryReadyCount = currentConcepts.filter((concept) => conceptMasteryLevel(concept) >= 3).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="flex flex-col gap-5 p-4">
        <header className="flex flex-col gap-3 border-b pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Project map</p>
              <h2 className="truncate text-lg font-semibold">{project.title}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary">{tasks.length} task{tasks.length === 1 ? "" : "s"}</Badge>
              <Badge variant="outline">{completedTasks} done</Badge>
              <Badge variant="outline">{pathNodes.length ? `${pathNodes.filter((node) => node.status === "completed").length}/${pathNodes.length}` : "0"} path</Badge>
            </div>
          </div>
          {currentPathNode ? (
            <div className="grid gap-1 border-l-2 border-foreground/30 pl-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current node</span>
              <div className="flex items-center justify-between gap-3">
                <strong className="min-w-0 truncate text-sm">{currentPathNode.title}</strong>
                <Badge variant="outline">{pathNodeStatusLabel(currentPathNode.status)}</Badge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{currentPathNode.summary}</p>
            </div>
          ) : null}
        </header>

        <section className="flex flex-col gap-2">
          <SectionTitle icon={ListChecksIcon} title="Learning path" />
          {pathNodes.length ? (
            <FlowPathOutline nodes={pathNodes} currentNodeId={currentPathNode?.id ?? project.flow.currentPathNodeId ?? undefined} />
          ) : (
            <div className="border border-dashed p-4 text-center text-xs text-muted-foreground">
              Flow will build the learning path after learner profiling.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle icon={ListChecksIcon} title="Tasks" />
          {currentNodeTasks.length ? (
            <div className="flex flex-col border-y">
              {currentNodeTasks.map((task) => (
                <FlowTaskCard key={task.id} task={task} theme={theme} chatMode={chatMode} onOpenTask={onOpenTask} onSubmitTask={onSubmitTask} onOpenFile={onOpenFile} />
              ))}
            </div>
          ) : (
            <div className="border border-dashed p-4 text-center text-xs text-muted-foreground">
              Tasks for the active node will appear here.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto w-full justify-between rounded-[8px] px-3 py-2 text-left"
            onClick={() => setMasteryOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <GaugeIcon data-icon="inline-start" />
              <span className="min-w-0 truncate">Mastery</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary">L3+ {masteryReadyCount}/{currentConcepts.length}</Badge>
              <ChevronRightIcon data-icon="inline-end" />
            </span>
          </Button>
          <FlowMasteryDialog
            open={masteryOpen}
            onOpenChange={setMasteryOpen}
            concepts={currentConcepts}
            tasks={tasks}
            exercises={exercises}
            onOpenConcept={onOpenConcept}
          />
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle icon={BookOpenIcon} title="Concepts" />
          {currentConcepts.length ? (
            <div className="grid gap-2">
              {currentConcepts.map((concept) => (
                <ConceptSummaryCard key={concept.id} concept={concept} compact onOpen={() => onOpenConcept(concept)} />
              ))}
            </div>
          ) : (
            <div className="border border-dashed p-4 text-center text-xs text-muted-foreground">
              Concepts touched by this path node will appear here.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle icon={FileTextIcon} title="Project memory" />
          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
            {["research.md", "project.md", "path.md", "learner.md"].map((file) => (
              <FlowFileChip key={file} path={flowMemoryFilePath(file)} label={file} onOpenFile={onOpenFile} />
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

function FlowMasteryDialog({
  open,
  onOpenChange,
  concepts,
  tasks,
  exercises,
  onOpenConcept
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concepts: ConceptCard[];
  tasks: ConstructFlowPracticeTask[];
  exercises: ConstructFlowConceptExercise[];
  onOpenConcept: (concept: ConceptCard) => void;
}) {
  const rows = concepts
    .map((concept) => buildMasteryRow(concept, tasks, exercises))
    .sort((a, b) => a.level - b.level || a.concept.title.localeCompare(b.concept.title));
  const readyCount = rows.filter((row) => row.level >= 3).length;
  const average = rows.length
    ? rows.reduce((sum, row) => sum + row.level, 0) / rows.length
    : 0;

  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <ShadcnDialogContent className="flex h-[min(82vh,46rem)] w-[min(58rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden rounded-[10px] border border-border/70 bg-background p-0 shadow-2xl">
        <ShadcnDialogHeader className="shrink-0 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <ShadcnDialogTitle>Mastery</ShadcnDialogTitle>
              <ShadcnDialogDescription className="mt-1 truncate text-xs">
                Concept readiness and timestamped level changes
              </ShadcnDialogDescription>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <Badge variant="secondary">L3+ {readyCount}/{rows.length}</Badge>
              <Badge variant="outline">Avg {average.toFixed(1)}</Badge>
            </div>
          </div>
        </ShadcnDialogHeader>

        <div className="grid shrink-0 grid-cols-6 border-b bg-muted/20 px-4 py-3">
          {CONSTRUCT_CONCEPT_MASTERY_RUBRIC.map((level) => (
            <div key={level.level} className="min-w-0 border-r px-2 last:border-r-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold">L{level.level}</span>
                {level.taskReady ? <Badge variant="secondary">Task</Badge> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{level.title}</p>
            </div>
          ))}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col divide-y">
            {rows.length ? rows.map((row) => (
              <FlowMasteryRowView
                key={row.concept.id}
                row={row}
                onOpenConcept={() => onOpenConcept(row.concept)}
              />
            )) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No concept mastery has been recorded yet.
              </div>
            )}
          </div>
        </ScrollArea>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

type FlowMasteryRow = {
  concept: ConceptCard;
  level: ConstructConceptMasteryLevel;
  rubric: ReturnType<typeof conceptMasteryRubricForLevel>;
  history: NonNullable<ConceptCard["history"]>;
  taskCount: number;
  exerciseCount: number;
};

function buildMasteryRow(
  concept: ConceptCard,
  tasks: ConstructFlowPracticeTask[],
  exercises: ConstructFlowConceptExercise[]
): FlowMasteryRow {
  const level = conceptMasteryLevel(concept);
  return {
    concept,
    level,
    rubric: conceptMasteryRubricForLevel(level),
    history: conceptMasteryHistory(concept),
    taskCount: tasks.filter((task) => taskIntroducedConceptIds(task).includes(concept.id)).length,
    exerciseCount: exercises.filter((exercise) => exercise.conceptIds.includes(concept.id)).length
  };
}

function FlowMasteryRowView({
  row,
  onOpenConcept
}: {
  row: FlowMasteryRow;
  onOpenConcept: () => void;
}) {
  const latest = row.history.at(-1);
  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(18rem,1.1fr)]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={row.level >= 3 ? "secondary" : "outline"}>L{row.level}</Badge>
              <strong className="truncate text-sm">{row.concept.title}</strong>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{row.concept.id}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onOpenConcept}>Open</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.concept.masteryText ?? row.rubric.text}</p>
        {row.concept.masteryReason || latest?.masteryReason ? (
          <p className="mt-2 text-xs leading-5">{row.concept.masteryReason ?? latest?.masteryReason}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline">{row.rubric.title}</Badge>
          <Badge variant="outline">{row.taskCount} task{row.taskCount === 1 ? "" : "s"}</Badge>
          <Badge variant="outline">{row.exerciseCount} exercise{row.exerciseCount === 1 ? "" : "s"}</Badge>
        </div>
      </div>

      <div className="min-w-0 rounded-[8px] border bg-muted/15">
        {row.history.length ? (
          <div className="flex max-h-44 flex-col overflow-y-auto p-2">
            {[...row.history].reverse().map((event) => (
              <div key={event.id} className="grid gap-1 border-b py-2 last:border-b-0">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Badge variant={masteryDirectionBadgeVariant(event.masteryDirection)}>
                      {event.masteryDirection ?? "recorded"}
                    </Badge>
                    {event.masteryLevel !== undefined ? <Badge variant="outline">L{event.masteryLevel}</Badge> : null}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatMasteryTimestamp(event.createdAt)}
                  </span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{event.masteryReason ?? event.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">No level-change history yet.</div>
        )}
      </div>
    </div>
  );
}

function conceptMasteryLevel(concept: ConceptCard): ConstructConceptMasteryLevel {
  const explicit = readConceptMasteryLevel(concept.masteryLevel);
  if (explicit !== undefined) return explicit;
  if (concept.confidence === "applying") return 3;
  if (concept.confidence === "solid" || concept.confidence === "strong") return 4;
  if (concept.confidence === "fluent" || concept.confidence === "teaching") return 5;
  if (concept.confidence === "practicing" || concept.confidence === "emerging") return 2;
  if (concept.confidence === "confused" || concept.confidence === "fragile" || concept.confidence === "weak") return 1;
  return 0;
}

function conceptMasteryHistory(concept: ConceptCard): NonNullable<ConceptCard["history"]> {
  return (concept.history ?? []).filter((event) => (
    event.masteryLevel !== undefined
    || event.masteryDirection !== undefined
    || event.changedFields?.some((field) => field.startsWith("mastery"))
    || event.fieldChanges?.some((change) => change.field.startsWith("mastery"))
  ));
}

function masteryDirectionBadgeVariant(direction: string | undefined): "secondary" | "destructive" | "outline" {
  if (direction === "increased") return "secondary";
  if (direction === "decreased") return "destructive";
  return "outline";
}

function formatMasteryTimestamp(value: string | undefined): string {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Icon size={15} />
      <span>{title}</span>
    </div>
  );
}

function FlowPathOutline({
  nodes,
  currentNodeId
}: {
  nodes: ConstructFlowPathNode[];
  currentNodeId?: string;
}) {
  return (
    <ol className="flex flex-col border-y">
      {nodes.map((node, index) => (
        <li
          key={node.id}
          className={cn(
            "grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-2 border-b py-2.5 last:border-b-0",
            node.id === currentNodeId ? "text-foreground" : "text-muted-foreground",
            node.status === "planned" && "opacity-65"
          )}
        >
          <span className="mt-0.5 flex items-center justify-center">
            <PathNodeIcon status={node.status} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
              <strong className="truncate text-xs font-semibold">{node.title}</strong>
            </div>
            <p className="line-clamp-2 text-[11px] leading-4">{node.summary}</p>
          </div>
          <Badge variant={node.id === currentNodeId ? "secondary" : "outline"}>{pathNodeStatusLabel(node.status)}</Badge>
        </li>
      ))}
    </ol>
  );
}

function PathNodeIcon({ status }: { status: ConstructFlowPathNode["status"] }) {
  if (status === "completed") return <CheckCircle2Icon size={16} className="text-[color:var(--construct-success)]" />;
  if (status === "blocked") return <HelpCircleIcon size={16} className="text-destructive" />;
  if (status === "revising") return <PencilIcon size={16} className="text-[color:var(--construct-warning)]" />;
  if (status === "active") return <RouteIcon size={16} className="text-foreground" />;
  return <CircleIcon size={16} className="text-muted-foreground" />;
}

function FlowTaskDetailsTab({
  task,
  node,
  current,
  theme,
  onSubmitTask,
  onOpenFile
}: {
  task: ConstructFlowPracticeTask;
  node?: ConstructFlowPathNode;
  current: boolean;
  theme: "light" | "dark" | "system";
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const completedSubtasks = task.subtasks?.filter((subtask) => subtask.status === "completed").length ?? 0;
  const subtaskCount = task.subtasks?.length ?? 1;
  const active = activeSubtask(task);

  return (
    <section className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-5">
        <header className="rounded-[18px] border border-border/85 bg-card/90 p-4 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[14px] border bg-muted/45 text-muted-foreground shadow-sm">
              <ListChecksIcon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
                {current ? <FlowTinyChip tone="current">Current</FlowTinyChip> : <FlowTinyChip>{taskStatusLabel(task.status)}</FlowTinyChip>}
                {node ? <FlowTinyChip>{node.title}</FlowTinyChip> : null}
                {node ? <FlowTinyChip>Path {node.order + 1}</FlowTinyChip> : null}
                <FlowTinyChip>{completedSubtasks}/{subtaskCount} subtasks</FlowTinyChip>
                {task.taskFiles?.length ? <FlowTinyChip>{task.taskFiles.length} files</FlowTinyChip> : null}
              </div>
              <h2 className="truncate text-base font-semibold tracking-tight">{task.title}</h2>
              <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">{active?.prompt ?? task.prompt}</p>
            </div>
          </div>
        </header>

        <FlowTaskCard
          task={task}
          theme={theme}
          onSubmitTask={onSubmitTask}
          onOpenFile={onOpenFile}
        />
      </div>
    </section>
  );
}

function FloatingFlowTaskCard({
  task,
  node,
  theme,
  pending,
  chatMode,
  onOpenTask,
  onSubmitTask,
  onOpenFile
}: {
  task: ConstructFlowPracticeTask;
  node?: ConstructFlowPathNode;
  theme: "light" | "dark" | "system";
  pending: boolean;
  chatMode: FlowChatMode;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = activeSubtask(task);
  const completedSubtasks = task.subtasks?.filter((subtask) => subtask.status === "completed").length ?? 0;
  const subtaskCount = task.subtasks?.length ?? 1;
  const introducedConceptIds = taskIntroducedConceptIds(task);
  const isPanel = chatMode === "panel";

  return (
    <div className={cn("shrink-0 border-b bg-background/90 px-2.5 py-1.5", isPanel && "px-1.5 py-1")}>
      <div
        className={cn(
          "construct-floating-task-card mx-auto w-full max-w-[46rem] rounded-[8px] border bg-muted/20 text-xs shadow-none",
          isPanel && "text-[11px] rounded-md"
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", isPanel && "px-2 py-1")}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-background/70 text-muted-foreground ring-1 ring-border/60",
            isPanel && "size-6 rounded-md"
          )}>
            <ListChecksIcon size={isPanel ? 13 : 14} />
          </span>
          <div className="min-w-0">
            <span className={cn("block truncate text-[10px] font-medium uppercase text-muted-foreground", isPanel && "text-[9px]")}>{node?.title ?? "Current task"}</span>
            <strong className={cn("block truncate text-xs leading-4", isPanel && "text-[11px] leading-3.5")}>{task.title}</strong>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className={cn("hidden max-w-32 truncate text-[11px] text-muted-foreground md:inline", isPanel && "text-[10px]")}>
              {taskStatusLabel(task.status)}
            </span>
            <span className={cn(
              "rounded-full border bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
              isPanel && "px-1 py-0.5 text-[9px]"
            )}>
              {completedSubtasks}/{subtaskCount}
            </span>
          </span>
          <ChevronDownIcon
            size={isPanel ? 13 : 14}
            className={`shrink-0 text-muted-foreground transition-transform duration-500 ease-out ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div className={`construct-floating-task-card__details ${open ? "is-open" : ""}`}>
          <div className={cn("flex flex-col gap-1.5 px-3 pb-2.5", isPanel && "px-2 pb-2")}>
            <MarkdownBlock content={active?.prompt || task.prompt} theme={theme} onOpenFile={onOpenFile} />
            {introducedConceptIds.length ? (
              <TaskConceptChips conceptIds={introducedConceptIds} compact />
            ) : null}
            {task.successCriteria?.length ? (
              <div className={cn("rounded-[8px] bg-muted/30 p-2", isPanel && "rounded-md p-1.5 text-[11px]")}>
                <span className="mb-1 block font-medium">Success criteria</span>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {task.successCriteria.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
                </ul>
              </div>
            ) : null}
            {task.taskFiles?.length ? (
              <div className="flex flex-wrap gap-1">
                {task.taskFiles.map((file) => (
                  <FlowFileChip key={file} path={file} onOpenFile={onOpenFile} compact />
                ))}
              </div>
            ) : null}
            <div className="flex justify-end pt-1">
              <span className="flex shrink-0 items-center gap-1.5">
                <Button size={isPanel ? "sm" : "default"} variant="secondary" onClick={() => onOpenTask(task)}>
                  <ListChecksIcon size={isPanel ? 12 : 14} />
                  Open
                </Button>
                <Button size={isPanel ? "sm" : "default"} onClick={() => void onSubmitTask(task, undefined, active?.id)} disabled={pending}>
                  <SendIcon size={isPanel ? 12 : 14} />
                  Submit
                </Button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowTaskCard({
  task,
  theme,
  onOpenTask,
  onSubmitTask,
  onOpenFile,
  compact = false,
  chatMode
}: {
  task: ConstructFlowPracticeTask;
  theme: "light" | "dark" | "system";
  onOpenTask?: (task: ConstructFlowPracticeTask) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onOpenFile: (reference: InlineFileRef) => void;
  compact?: boolean;
  chatMode?: FlowChatMode;
}) {
  const [note, setNote] = useState("");
  const active = activeSubtask(task);
  const canSubmit = task.status === "waiting" || task.status === "submitted";
  const introducedConceptIds = taskIntroducedConceptIds(task);
  const guidance = taskGuidanceItems(task, active?.id);
  const isPanel = chatMode === "panel";

  return (
    <article className={cn("grid min-w-0 gap-3 border-b py-4 text-xs last:border-b-0", isPanel && "py-3 gap-2.5 text-[11px]")}>
      <aside className={cn("min-w-0 border-b pb-3", isPanel && "pb-2")}>
        <div className="mb-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <strong className={cn("truncate text-sm", isPanel && "text-xs")}>{task.title}</strong>
            <span className="flex shrink-0 items-center gap-1.5">
              <Badge variant={task.status === "completed" ? "secondary" : "outline"}>{taskStatusLabel(task.status)}</Badge>
              {onOpenTask ? (
                <Button size={isPanel ? "sm" : "default"} variant="ghost" onClick={() => onOpenTask(task)}>
                  <ListChecksIcon size={isPanel ? 12 : 13} />
                  Open
                </Button>
              ) : null}
            </span>
          </div>
          <p className={cn("mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground", isPanel && "text-[10px] leading-3.5")}>{task.prompt}</p>
        </div>

        {task.subtasks?.length ? (
          <ol className="grid gap-1 sm:grid-cols-3">
            {task.subtasks.map((subtask, index) => (
              <li
                key={subtask.id}
                className={cn(
                  "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-[7px] px-1.5 py-1.5",
                  isPanel && "gap-1.5 px-1 py-1 rounded-md",
                  subtask.id === active?.id && "bg-muted/55 text-foreground",
                  subtask.status === "completed" && "text-muted-foreground"
                )}
              >
                <span className={cn(
                  "inline-flex size-5 items-center justify-center rounded-[6px] bg-background text-[10px] font-semibold ring-1 ring-border/70",
                  isPanel && "size-4 text-[9px] rounded-md"
                )}>{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate">{subtask.title}</span>
                  <span className={cn("text-[10px] text-muted-foreground", isPanel && "text-[9px]")}>{subtaskStatusLabel(subtask.status)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </aside>

      <div className="min-w-0">
        <div className="flex flex-col gap-3">
          <div>
            <span className={cn("mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground", isPanel && "text-[10px]")}>Now</span>
            <MarkdownBlock content={active?.nextInstructions || active?.prompt || task.prompt} theme={theme} onOpenFile={onOpenFile} />
          </div>

          <TaskGuidanceList guidance={guidance} onOpenFile={onOpenFile} />

          <div className="flex flex-wrap gap-1">
            {task.taskFiles?.map((file) => (
              <FlowFileChip key={file} path={file} onOpenFile={onOpenFile} compact />
            ))}
            {task.focus ? (
              <FlowFileChip path={task.focus.path} line={task.focus.line} endLine={task.focus.endLine} onOpenFile={onOpenFile} compact />
            ) : null}
          </div>

          {!compact && task.successCriteria?.length ? (
            <div className={cn("grid gap-1.5 border-t pt-3", isPanel && "gap-1 border-t pt-2")}>
              <span className={cn("text-[11px] font-medium uppercase tracking-wide text-muted-foreground", isPanel && "text-[10px]")}>Done means</span>
              <ul className="grid gap-1 text-muted-foreground">
                {task.successCriteria.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
              </ul>
            </div>
          ) : null}

          {introducedConceptIds.length ? <TaskConceptChips conceptIds={introducedConceptIds} compact /> : null}

          {task.preparedFiles?.length && !compact ? (
            <details className={cn("group border-t pt-3", isPanel && "pt-2")}>
              <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden", isPanel && "text-[10px]")}>
                Prepared by Flow
                <ChevronDownIcon size={13} className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {task.preparedFiles.map((file) => (
                  <FlowFileChip key={file.path} path={file.path} label={`${file.mode}: ${file.path}`} onOpenFile={onOpenFile} compact />
                ))}
              </div>
            </details>
          ) : null}

          {canSubmit ? (
            <div className="grid gap-2 border-t pt-3">
              {!compact ? (
                <Textarea
                  className={cn("min-h-16 resize-y text-sm", isPanel && "min-h-12 text-xs")}
                  value={note}
                  placeholder="Optional note for Flow before submitting..."
                  onChange={(event) => setNote(event.target.value)}
                />
              ) : null}
              <div className="flex justify-end">
                <Button size={isPanel ? "sm" : "default"} onClick={() => void onSubmitTask(task, note.trim() || undefined, active?.id)}>
                  <SendIcon size={isPanel ? 12 : 14} />
                  Submit {active ? "subtask" : "task"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function TaskGuidanceList({
  guidance,
  onOpenFile
}: {
  guidance: ConstructFlowTaskGuidance[];
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  if (!guidance.length) return null;

  return (
    <div className="grid gap-1.5 border-y py-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Work areas</span>
      <div className="grid gap-1.5">
        {guidance.map((item) => {
          const locator = formatFileReferenceLabel(item.path, item.line, item.endLine);
          const label = `${item.title}: ${item.instruction}`;
          return (
            <button
              key={item.id}
              type="button"
              className="grid min-w-0 gap-2 rounded-[7px] px-2 py-2 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
              title={item.instruction}
              onClick={() => onOpenFile(createInlineFileReference(item.path, label, item.line, item.endLine))}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{item.title}</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">{item.instruction}</span>
                {item.placeholder ? (
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/80">{item.placeholder}</span>
                ) : null}
              </span>
              <span className="inline-flex h-6 w-fit max-w-full items-center gap-1 rounded-[6px] border bg-background px-2 font-mono text-[10px] text-muted-foreground">
                <FileTextIcon size={12} className="shrink-0" />
                <span className="truncate">{locator}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function taskGuidanceItems(
  task: ConstructFlowPracticeTask,
  subtaskId?: string
): ConstructFlowTaskGuidance[] {
  const explicitGuidance = task.guidance ?? [];
  const scopedGuidance = subtaskId
    ? explicitGuidance.filter((item) => !item.subtaskId || item.subtaskId === subtaskId)
    : explicitGuidance;
  if (scopedGuidance.length) return scopedGuidance;

  const active = subtaskId
    ? task.subtasks?.find((subtask) => subtask.id === subtaskId)
    : undefined;
  const fallbackFiles = [...new Set([
    ...(task.focus?.path ? [task.focus.path] : []),
    ...(task.taskFiles ?? [])
  ])];

  return fallbackFiles.slice(0, 4).map((path, index) => ({
    id: `${task.id}:fallback-guidance:${index}`,
    title: index === 0 ? "Start here" : "Related file",
    instruction: active?.nextInstructions || active?.prompt || task.prompt,
    path,
    line: index === 0 ? task.focus?.line : undefined,
    endLine: index === 0 ? task.focus?.endLine : undefined,
    subtaskId
  }));
}

function taskStatusLabel(status: ConstructFlowPracticeTask["status"]): string {
  if (status === "completed") return "Done";
  if (status === "submitted") return "Submitted for review";
  if (status === "cancelled") return "Cancelled";
  return "Waiting for learner work";
}

function subtaskStatusLabel(status: ConstructFlowPracticeSubtask["status"]): string {
  if (status === "completed") return "done";
  if (status === "submitted") return "submitted";
  if (status === "needs-work") return "needs work";
  if (status === "active") return "active";
  return "ready";
}

function taskIntroducedConceptIds(task: ConstructFlowPracticeTask): string[] {
  return [...new Set([...(task.introducedConceptIds ?? []), ...(task.conceptIds ?? [])])];
}

function FlowFileChip({
  path,
  label,
  line,
  endLine,
  onOpenFile,
  compact = false
}: {
  path: string;
  label?: string;
  line?: number;
  endLine?: number;
  onOpenFile: (reference: InlineFileRef) => void;
  compact?: boolean;
}) {
  const locator = formatFileReferenceLabel(path, line, endLine);
  return (
    <button
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-[6px] border bg-background/70 px-2 py-1 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        compact && "max-w-[14rem] py-0.5"
      )}
      title={locator}
      type="button"
      onClick={() => onOpenFile(createInlineFileReference(path, label ?? locator, line, endLine))}
    >
      <FileTextIcon size={12} className="shrink-0" />
      <span className="min-w-0 truncate">{label ?? locator}</span>
    </button>
  );
}

function createInlineFileReference(path: string, label?: string, line?: number, endLine?: number): InlineFileRef {
  const target = `file:${formatFileReferenceLabel(path, line, endLine)}`;
  return {
    kind: "file",
    path,
    label: label ?? formatFileReferenceLabel(path, line, endLine),
    line,
    endLine,
    anchor: undefined,
    raw: `[[${target}|${label ?? formatFileReferenceLabel(path, line, endLine)}]]`
  };
}

function formatFileReferenceLabel(path: string, line?: number, endLine?: number): string {
  if (!line) return path;
  return `${path}:${line}${endLine ? `-${endLine}` : ""}`;
}

function flowMemoryFilePath(file: string): string {
  return `.construct/${file}`;
}

function TaskConceptChips({
  conceptIds,
  compact = false
}: {
  conceptIds: string[];
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <BookOpenIcon size={13} />
        Introduced before this task
      </span>
      <div className="flex flex-wrap gap-1">
        {conceptIds.map((conceptId) => (
          <span
            key={conceptId}
            className={cn(
              "rounded-full border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground",
              compact && "max-w-[12rem] truncate"
            )}
          >
            {conceptId}
          </span>
        ))}
      </div>
    </div>
  );
}

function pathNodeStatusLabel(status: ConstructFlowPathNode["status"]): string {
  if (status === "completed") return "Complete";
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "revising") return "Revising";
  return "Planned";
}

function currentFlowPathNode(
  nodes: ConstructFlowPathNode[],
  currentNodeId?: string | null
): ConstructFlowPathNode | undefined {
  return nodes.find((node) => node.id === currentNodeId)
    ?? nodes.find((node) => node.status === "active" || node.status === "revising" || node.status === "blocked")
    ?? nodes.find((node) => node.status !== "completed");
}

function findActiveTaskForNode(
  tasks: ConstructFlowPracticeTask[],
  pathNodeId?: string
): ConstructFlowPracticeTask | undefined {
  const nodeTasks = pathNodeId ? tasks.filter((task) => task.pathNodeId === pathNodeId) : tasks;
  return [...nodeTasks].reverse().find((task) => task.status === "waiting" || task.status === "submitted")
    ?? [...tasks].reverse().find((task) => task.status === "waiting" || task.status === "submitted");
}

function activeSubtask(task: ConstructFlowPracticeTask): ConstructFlowPracticeSubtask | undefined {
  return task.subtasks?.find((subtask) => subtask.status === "active" || subtask.status === "submitted" || subtask.status === "needs-work")
    ?? task.subtasks?.find((subtask) => subtask.status !== "completed")
    ?? task.subtasks?.[0];
}

function buildFlowMessages({
  sessions,
  concepts,
  conceptMutations,
  tasks,
  pathNodes,
  currentTaskId,
  acknowledgedConceptEventKeys,
  theme,
  onOpenConceptDetails,
  onOpenConceptById,
  onAcknowledgeConceptEvent,
  onOpenTask,
  onOpenFile,
  onRewindUserMessage,
  rewindingSessionId,
  pending,
  chatMode
}: {
  sessions: ConstructFlowSession[];
  concepts: ConceptCard[];
  conceptMutations: ConceptMutation[];
  tasks: ConstructFlowPracticeTask[];
  pathNodes: ConstructFlowPathNode[];
  currentTaskId?: string;
  acknowledgedConceptEventKeys: Set<string>;
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
  onAcknowledgeConceptEvent: (eventKey: string) => void;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onRewindUserMessage?: (sessionId: string, content: string) => Promise<void>;
  rewindingSessionId?: string | null;
  pending?: boolean;
  chatMode: FlowChatMode;
}): AgentSessionMessage[] {
  return sessions.flatMap((session): AgentSessionMessage[] => {
    const user = session.messages.find((message) => message.role === "user");
    const assistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    const parts = buildFlowAgentParts({
      session,
      assistantContent: assistant?.content,
      concepts,
      conceptMutations,
      tasks,
      pathNodes,
      currentTaskId,
      acknowledgedConceptEventKeys,
      theme,
      onOpenConceptDetails,
      onOpenConceptById,
      onAcknowledgeConceptEvent,
      onOpenTask,
      onOpenFile,
      chatMode
    });

    const submittedTask = sessions
      .flatMap((s) => s.practiceTasks)
      .find((t) => t.submissionSessionId === session.id);

    let userContent: ReactNode;
    if (submittedTask && submittedTask.submission) {
      userContent = (
        <div className="flex w-full min-w-0 flex-col gap-3 rounded-[8px] border bg-muted/20 p-3 text-xs shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <SendIcon size={14} />
              <span>Task submission</span>
            </span>
            <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {submittedTask.title}
            </span>
          </div>
          {submittedTask.learnerNote ? (
            <div className="rounded-[8px] border bg-background/60 p-2 italic text-muted-foreground">
              <span className="mb-1 block text-[11px] font-medium not-italic text-foreground">Your note</span>
              {submittedTask.learnerNote}
            </div>
          ) : null}
          <div>
            <span className="mb-1 block font-medium">Changes</span>
            <pre className="max-h-80 overflow-y-auto overflow-x-auto rounded-[8px] border bg-background/80 p-3 font-mono text-[10px] leading-relaxed">
              <code className="text-foreground">{submittedTask.submission.compactDiff}</code>
            </pre>
          </div>
        </div>
      );
    } else {
      userContent = user?.content ?? "";
    }

    const assistantMessage: AgentSessionMessage = { id: `${session.id}:assistant`, role: "assistant", parts };
    if (session.origin === "question-response" || session.origin === "system") {
      return [assistantMessage];
    }

    const editableUserContent = typeof user?.content === "string" && session.origin !== "task-submission"
      ? user.content
      : "";
    const userMeta = editableUserContent && onRewindUserMessage ? (
      <FlowUserMessageActions
        disabled={pending || rewindingSessionId === session.id}
        rewinding={rewindingSessionId === session.id}
        onRewind={() => void onRewindUserMessage(session.id, editableUserContent)}
      />
    ) : undefined;

    return [
      { id: `${session.id}:user`, role: "user", content: userContent, meta: userMeta },
      assistantMessage
    ];
  });
}

function FlowUserMessageActions({
  disabled,
  rewinding,
  onRewind
}: {
  disabled?: boolean;
  rewinding?: boolean;
  onRewind: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            disabled={disabled}
            onClick={onRewind}
            aria-label="Rewind to edit this message"
          >
            {rewinding ? <Loader2Icon size={13} className="animate-spin" /> : <PencilIcon size={13} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Rewind here and edit; workspace files stay as-is</TooltipContent>
      </Tooltip>
    </div>
  );
}

function buildFlowAgentParts({
  session,
  assistantContent,
  concepts,
  conceptMutations,
  tasks,
  pathNodes,
  currentTaskId,
  acknowledgedConceptEventKeys,
  theme,
  onOpenConceptDetails,
  onOpenConceptById,
  onAcknowledgeConceptEvent,
  onOpenTask,
  onOpenFile,
  chatMode
}: {
  session: ConstructFlowSession;
  assistantContent?: string;
  concepts: ConceptCard[];
  conceptMutations: ConceptMutation[];
  tasks: ConstructFlowPracticeTask[];
  pathNodes: ConstructFlowPathNode[];
  currentTaskId?: string;
  acknowledgedConceptEventKeys: Set<string>;
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
  onAcknowledgeConceptEvent: (eventKey: string) => void;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  chatMode: FlowChatMode;
}): AgentSessionMessagePart[] {
  const parts: AgentSessionMessagePart[] = [];
  const toolCallsById = new Map(session.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
  const timeline = flowTimelineParts(session);
  let hasMessageEvent = false;
  const fallbackText = splitProcessNarration(assistantContent);
  const pendingQuestion = findPendingLearnerQuestion(session);
  const renderedConceptKeys = new Set<string>();
  let planPathCount = 0;

  for (const rawEvent of timeline) {
    if (shouldHideFlowTimelinePart(session, rawEvent)) {
      continue;
    }
    const event = settleFlowTimelinePartForSession(session, rawEvent);
    if (event.kind === "message") {
      if (!event.text?.trim()) continue;
      if (Date.now() < 0 && isDuplicateQuestionProse(event.text, pendingQuestion)) continue;
      hasMessageEvent = true;
      parts.push({
        type: "text",
        id: `${session.id}:message:${event.id}`,
        content: <MarkdownBlock content={event.text} theme={theme} sources={session.citations} onOpenConcept={onOpenConceptById} onOpenFile={onOpenFile} />
      });
      continue;
    }
    const toolName = event.kind === "tool" ? event.name : event.title;
    const isConcept = toolName === "add-concept" || toolName === "modify-concept" || toolName === "remove-concept" || toolName === "suggest-existing-concept";
    const isPracticeTask = toolName === "practice-task";
    const isConceptExercise = toolName === "concept-exercise";
    const isMemoryPatch = toolName === "flow-memory-patch" || toolName === "flow-memory-update";
    const isPlanPath = toolName === "plan-learning-path";
    if (event.kind === "tool" && isQuestionTool(toolName)) {
      const questionToolCall = toolCallsById.get(event.toolCallId);
      if (questionToolCall?.response) {
        parts.push(buildQuestionAnsweredPart(session.id, questionToolCall, theme, onOpenFile, onOpenConceptById));
      }
      continue;
    }

    if (isConcept && event.kind === "tool") {
      const payload = readConceptPayload(event.input, event.outputPreview);
      const mutationKey = `${toolName}:${payload.id}:${event.status}`;
      if (payload.id && renderedConceptKeys.has(mutationKey)) {
        continue;
      }
      if (payload.id) {
        renderedConceptKeys.add(mutationKey);
      }
      parts.push(buildConceptCardPart(session.id, event.id, toolName, event.input, event.outputPreview, event.status, theme, conceptMutations, acknowledgedConceptEventKeys, onAcknowledgeConceptEvent, onOpenConceptDetails, concepts, chatMode));
      continue;
    }

    if (isPracticeTask && event.kind === "tool") {
      parts.push(buildTaskCreatedPart({
        sessionId: session.id,
        eventId: event.id,
        input: event.input,
        outputPreview: event.outputPreview,
        status: event.status,
        tasks,
        pathNodes,
        currentTaskId,
        onOpenTask,
        theme,
        onOpenFile,
        chatMode
      }));
      continue;
    }

    if (isConceptExercise && event.kind === "tool") {
      parts.push(buildConceptExercisePart({
        sessionId: session.id,
        eventId: event.id,
        input: event.input,
        outputPreview: event.outputPreview,
        status: event.status,
        session,
        theme,
        onOpenFile,
        chatMode
      }));
      continue;
    }

    if (isPlanPath && event.kind === "tool") {
      const isUpdate = planPathCount > 0;
      planPathCount++;
      parts.push(buildPlanPathPart({
        sessionId: session.id,
        eventId: event.id,
        input: event.input,
        outputPreview: event.outputPreview,
        status: event.status,
        theme,
        chatMode,
        isUpdate
      }));
      continue;
    }

    if (isMemoryPatch && event.kind === "tool") {
      parts.push(buildMemoryUpdatedPart(session.id, event.id, event.input, event.outputPreview, onOpenFile, theme));
      continue;
    }

    const entry = flowTimelinePartToTraceEntry(event);
    parts.push({
      type: "activity",
      id: `${session.id}:activity:${event.id}`,
      entry,
      onOpenFile: (path) => onOpenFile(createInlineFileReference(path)),
      defaultOpen: false
    });

  }

  if (timeline.length === 0 && !hasMessageEvent && fallbackText.process) {
    parts.unshift(buildFallbackReasoningPart(session.id, 1, fallbackText.process));
  }

  if (session.status === "running" && !parts.some((part) => part.type === "activity" && part.entry.status === "running")) {
    parts.push({
      type: "activity",
      id: `${session.id}:activity:live-tail`,
      onOpenFile: (path) => onOpenFile(createInlineFileReference(path)),
      entry: {
        id: `${session.id}:live-tail`,
        kind: "thought",
        title: "Working",
        status: "running"
      }
    });
  }

  if (!hasMessageEvent && fallbackText.answer && (!pendingQuestion || true)) {
    parts.push({
      type: "text",
      id: `${session.id}:reply`,
      content: <MarkdownBlock content={fallbackText.answer} theme={theme} sources={session.citations} onOpenConcept={onOpenConceptById} onOpenFile={onOpenFile} />
    });
  }

  return parts;
}

function shouldHideFlowTimelinePart(
  session: ConstructFlowSession,
  part: ConstructFlowTimelinePart
): boolean {
  if (part.kind !== "reasoning") return false;
  if (session.status !== "running") return true;
  return part.status === "completed" && !part.text?.trim();
}

function settleFlowTimelinePartForSession(
  session: ConstructFlowSession,
  part: ConstructFlowTimelinePart
): ConstructFlowTimelinePart {
  if (session.status === "running" || part.status !== "running") return part;
  const status = session.status === "error" ? "error" : "completed";
  const updatedAt = part.updatedAt ?? session.updatedAt;
  if (part.kind === "tool" || part.kind === "compaction") {
    return {
      ...part,
      status,
      completedAt: part.completedAt ?? updatedAt,
      updatedAt
    };
  }
  return {
    ...part,
    status,
    updatedAt
  };
}

function buildFallbackReasoningPart(sessionId: string, index: number, text: string): AgentSessionMessagePart {
  return {
    type: "activity",
    id: `${sessionId}:reasoning:fallback:${index}`,
    defaultOpen: false,
    entry: {
      id: `${sessionId}:reasoning:fallback:${index}`,
      kind: "thought",
      title: "Thinking",
      status: "completed",
      output: text
    }
  };
}

function findPendingLearnerQuestion(session: ConstructFlowSession): ConstructFlowToolCallRecord | undefined {
  return [...session.toolCalls].reverse().find((toolCall) => (
    isQuestionTool(toolCall.name) && toolCall.status !== "error" && !toolCall.response
  ));
}

function isDuplicateQuestionProse(text: string, pendingQuestion: ConstructFlowToolCallRecord | undefined): boolean {
  if (!pendingQuestion) return false;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const payload = readAskUserPayload(pendingQuestion.input, pendingQuestion.outputPreview);
  const normalizedLower = normalized.toLowerCase();
  const questionLower = payload.question?.replace(/\s+/g, " ").trim().toLowerCase();
  if (questionLower && normalizedLower.includes(questionLower)) return true;
  if (/^\s*\d+[\).]\s+/m.test(text)) return true;
  if (/(?:choose|pick|select)\s+(?:one|an option|from)/i.test(text)) return true;
  if (/\?/.test(normalized) && normalized.length > 80) return true;
  const choices = payload.choices ?? [];
  return choices.length > 0 && choices.some((choice) => normalizedLower.includes(choice.toLowerCase()));
}

type FlowQuestionPayload = ReturnType<typeof readAskUserPayload>;

type ActiveFlowQuestion = {
  id: string;
  sessionId: string;
  toolCallId: string;
  payload: FlowQuestionPayload;
};

function findActiveFlowQuestion(sessions: ConstructFlowSession[]): ActiveFlowQuestion | null {
  const answeredQuestionKeys = collectAnsweredQuestionKeys(sessions);
  for (const session of [...sessions].reverse()) {
    if (session.status !== "waiting") continue;
    const toolCall = [...session.toolCalls].reverse().find((candidate) => (
      candidate.status !== "error"
      && isQuestionTool(candidate.name)
      && !candidate.response
      && !answeredQuestionKeys.has(questionKey(session.id, candidate.id))
    ));
    if (!toolCall) continue;
    return {
      id: `${session.id}:${toolCall.id}`,
      sessionId: session.id,
      toolCallId: toolCall.id,
      payload: readAskUserPayload(toolCall.input, toolCall.outputPreview)
    };
  }
  return null;
}

function collectAnsweredQuestionKeys(sessions: ConstructFlowSession[]): Set<string> {
  const answered = new Set<string>();
  for (const session of sessions) {
    if (session.questionResponse) {
      answered.add(questionKey(session.questionResponse.sessionId, session.questionResponse.toolCallId));
    }
    for (const toolCall of session.toolCalls) {
      if (!toolCall.response) continue;
      answered.add(questionKey(session.id, toolCall.id));
      answered.add(questionKey(toolCall.response.sessionId, toolCall.response.toolCallId));
    }
  }
  return answered;
}

function questionKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function isQuestionTool(name: string | undefined): boolean {
  const normalized = (name ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "askuser" || normalized === "askquestion";
}

function buildFlowQuestionResponse(
  question: ActiveFlowQuestion,
  answer: string,
  skipped = false
): ConstructFlowQuestionResponse {
  return {
    sessionId: question.sessionId,
    toolCallId: question.toolCallId,
    question: question.payload.question || "Flow question",
    answer: skipped ? "Skipped" : answer,
    skipped,
    answeredAt: new Date().toISOString()
  };
}

function buildQuestionAnsweredPart(
  sessionId: string,
  toolCall: ConstructFlowToolCallRecord,
  theme: "light" | "dark" | "system",
  onOpenFile?: (reference: InlineFileRef) => void,
  onOpenConcept?: (conceptId: string) => void
): AgentSessionMessagePart {
  const payload = readAskUserPayload(toolCall.input, toolCall.outputPreview);
  const response = toolCall.response;
  const question = response?.question || payload.question || "Flow question";
  const answer = response?.answer || "";

  const isDark = theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : theme === "dark";
  const codeTheme = isDark ? oneDark : oneLight;

  return {
    type: "actions",
    id: `${sessionId}:question-answer:${toolCall.id}`,
    content: (
      <div className="construct-flow-event-card group flex w-full max-w-[46rem] min-w-0 items-start gap-2.5 rounded-[10px] border border-border/70 bg-card/90 px-3 py-2.5 text-[13px] shadow-sm transition-[background-color,border-color] duration-150 hover:bg-muted/20" data-flow-surface="question-answered">
        <span className="grid size-6 shrink-0 place-items-center rounded-[7px] border border-border/70 bg-background/80 text-muted-foreground shadow-xs">
          <HelpCircleIcon size={13} />
        </span>
        <div className="min-w-0 flex-1 bg-transparent">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="font-semibold leading-5 text-foreground">Question answered</strong>
            <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground ring-1 ring-border/60">
              {response?.skipped ? "Skipped" : "Answered"}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            <MarkdownBlock content={question} theme={theme} onOpenFile={onOpenFile} onOpenConcept={onOpenConcept} />
          </div>
          {answer ? (
            payload.answerMode === "code" && !response?.skipped ? (
              <div className="mt-2 w-full overflow-hidden rounded-[10px] border bg-muted/30 font-mono">
                <div className="border-b bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground select-none flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wider">{payload.language ?? "typescript"}</span>
                </div>
                <SyntaxHighlighter
                  style={codeTheme}
                  language={payload.language ?? "typescript"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: "10px 12px",
                    background: "transparent",
                    border: 0,
                    borderRadius: 0,
                    fontSize: "12px",
                    lineHeight: "1.5",
                    overflowX: "auto"
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    }
                  }}
                >
                  {answer}
                </SyntaxHighlighter>
              </div>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap break-words font-medium leading-relaxed text-foreground/90">
                {answer}
              </p>
            )
          ) : null}
        </div>
      </div>
    )
  };
}

type ExerciseToolPayload = {
  exerciseId?: string;
  title: string;
  prompt: string;
  conceptIds: string[];
  sourceText?: string;
};

function readExerciseToolPayload(input: unknown, outputPreview?: string): ExerciseToolPayload {
  const inputObj = readRecord(input);
  const outputObj = parseJsonObject(outputPreview) ?? {};
  return {
    exerciseId: readString(outputObj.exerciseId),
    title: readString(outputObj.title) ?? readString(inputObj.title) ?? "Concept exercise",
    prompt: readString(outputObj.prompt) ?? readString(inputObj.prompt) ?? "Flow is creating a concept exercise.",
    conceptIds: readStringArray(outputObj.conceptIds).length
      ? readStringArray(outputObj.conceptIds)
      : readStringArray(inputObj.conceptIds),
    sourceText: readString(outputObj.sourceText) ?? readString(inputObj.sourceText)
  };
}

function resolveExerciseForToolPayload(
  payload: ExerciseToolPayload,
  exercises: ConstructFlowConceptExercise[],
  sessionId: string
): ConstructFlowConceptExercise | undefined {
  if (payload.exerciseId) {
    const byId = exercises.find((ex) => ex.id === payload.exerciseId);
    if (byId) return byId;
  }
  const normalizedTitle = normalizeMatchText(payload.title);
  const sessionExercises = exercises.filter((ex) => ex.sessionId === sessionId);
  const titleMatches = (candidates: ConstructFlowConceptExercise[]) => candidates.find((ex) => (
    normalizeMatchText(ex.title) === normalizedTitle
    || (normalizedTitle.length > 0 && normalizeMatchText(ex.title).includes(normalizedTitle))
    || (normalizeMatchText(ex.title).length > 0 && normalizedTitle.includes(normalizeMatchText(ex.title)))
  ));
  return titleMatches(sessionExercises) || titleMatches(exercises);
}

function buildConceptExercisePart({
  sessionId,
  eventId,
  input,
  outputPreview,
  status,
  session,
  theme,
  onOpenFile,
  chatMode
}: {
  sessionId: string;
  eventId: string;
  input: unknown;
  outputPreview?: string;
  status: string;
  session: ConstructFlowSession;
  theme: "light" | "dark" | "system";
  onOpenFile: (reference: InlineFileRef) => void;
  chatMode: FlowChatMode;
}): AgentSessionMessagePart {
  const payload = readExerciseToolPayload(input, outputPreview);
  const exercises = session.conceptExercises ?? [];
  const exercise = resolveExerciseForToolPayload(payload, exercises, sessionId);
  const ready = exercise != null;
  const failed = !ready && status === "error";

  const statusText = ready
    ? (exercise.status === "answered" || exercise.status === "reviewed" ? "Completed" : "Active Exercise")
    : failed ? "Failed" : status === "running" ? "Creating exercise..." : "Draft";

  const statusColor = ready
    ? (exercise.status === "answered" || exercise.status === "reviewed"
      ? "text-[color:var(--construct-success)] font-medium"
      : "text-amber-500 font-medium")
    : failed ? "text-destructive font-medium" : "text-muted-foreground/80";

  const iconClass = failed
    ? "border-destructive/15 bg-destructive/5 text-destructive"
    : "border-border/70 bg-background/80 text-muted-foreground";

  const promptText = exercise?.prompt ?? payload.prompt;
  const sourceText = exercise?.sourceText ?? payload.sourceText;
  const isPanel = chatMode === "panel";

  const containerClass = cn(
    "construct-flow-exercise-card flex w-full max-w-[46rem] min-w-0 flex-col gap-2 rounded-[10px] border border-border/70 bg-card/95 p-3 text-left text-foreground shadow-sm",
    isPanel && "max-w-full p-2.5 rounded-xl gap-2"
  );

  return {
    type: "actions",
    id: `${sessionId}:exercise:${eventId}`,
    content: (
      <div className={containerClass} data-flow-surface="concept-exercise">
        <div className={cn("flex min-w-0 items-center justify-between gap-2.5 border-b border-border/55 pb-2", isPanel && "pb-1.5 gap-2")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border shadow-xs bg-background/80", iconClass, isPanel && "size-6 rounded-[6px]")}>
              {failed ? (
                <CircleAlertIcon size={isPanel ? 11 : 13} />
              ) : status === "running" ? (
                <Loader2Icon size={isPanel ? 11 : 13} className="animate-spin" />
              ) : (
                <PencilIcon size={isPanel ? 11 : 13} />
              )}
            </span>
            <div className="min-w-0">
              <span className={cn(
                "block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider",
                isPanel && "text-[9px]"
              )}>Concept Exercise</span>
              <strong className={cn(
                "block truncate text-[13px] font-semibold tracking-tight text-foreground",
                isPanel && "text-xs"
              )}>
                {exercise?.title ?? payload.title}
              </strong>
            </div>
          </div>
          <span className={cn(
            "rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium shadow-2xs",
            statusColor,
            isPanel && "text-[9px] px-1.5"
          )}>
            {statusText}
          </span>
        </div>

        {status !== "running" && (
          <div className={cn("flex flex-col gap-2 text-sm", isPanel && "gap-2 text-[11px]")}>
            {promptText && (
              <div className={cn("text-[13px] font-medium leading-relaxed text-foreground", isPanel && "text-[13px] leading-relaxed")}>
                <MarkdownBlock content={promptText} theme={theme} onOpenFile={onOpenFile} />
              </div>
            )}

            {sourceText && (
              <div className="flex flex-col gap-1">
                <span className={cn(
                  "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider",
                  isPanel && "text-[9px]"
                )}>Reference Code / Context:</span>
                <pre className={cn(
                  "max-h-56 overflow-y-auto overflow-x-auto rounded-[10px] border bg-muted/25 p-3.5 font-mono text-xs leading-relaxed text-foreground/90 select-text shadow-inner",
                  isPanel && "max-h-40 p-2 rounded-md text-[10px]"
                )}>
                  <code>{sourceText}</code>
                </pre>
              </div>
            )}

            {exercise?.status === "reviewed" && exercise.reviewNote && (
              <div className={cn(
                "rounded-[8px] border border-[color:var(--construct-success-soft)] bg-[color:var(--construct-success-soft)]/20 p-2.5 text-foreground/90",
                isPanel && "p-2 rounded-md text-[11px]"
              )}>
                <span className={cn(
                  "mb-0.5 block text-[10px] font-bold text-[color:var(--construct-success)] uppercase tracking-wider",
                  isPanel && "text-[9px]"
                )}>Feedback</span>
                <div className="italic">
                  <MarkdownBlock content={exercise.reviewNote} theme={theme} onOpenFile={onOpenFile} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  };
}

function parsePlanPathInput(input: unknown) {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return input;
}

function parsePlanPathOutput(outputPreview?: string) {
  if (!outputPreview) return null;
  try {
    const parsed = JSON.parse(outputPreview);
    return parsed;
  } catch {
    return { message: outputPreview };
  }
}

function buildPlanPathPart({
  sessionId,
  eventId,
  input,
  outputPreview,
  status,
  theme,
  chatMode,
  isUpdate
}: {
  sessionId: string;
  eventId: string;
  input: unknown;
  outputPreview?: string;
  status: string;
  theme: "light" | "dark" | "system";
  chatMode: FlowChatMode;
  isUpdate?: boolean;
}): AgentSessionMessagePart {
  const inputData = parsePlanPathInput(input);
  const outputData = parsePlanPathOutput(outputPreview);
  const failed = status === "error";
  const running = status === "running" || status === "pending";

  const reason = inputData?.reason || "";
  const nodes = Array.isArray(inputData?.nodes) ? inputData.nodes : [];

  let statusText = isUpdate ? "Updated" : "Planned";
  let statusColor = "text-muted-foreground";
  if (running) {
    statusText = isUpdate ? "Updating..." : "Planning...";
    statusColor = "text-amber-500 font-medium animate-pulse";
  } else if (failed) {
    statusText = "Failed";
    statusColor = "text-destructive font-medium";
  } else if (status === "completed") {
    statusText = "Success";
    statusColor = "text-emerald-600 dark:text-emerald-400 font-medium";
  }

  const errorMessage = failed ? (outputData?.message || outputData?.error || (typeof outputPreview === "string" ? outputPreview : "An error occurred during path planning.")) : null;
  const isPanel = chatMode === "panel";

  const containerClass = cn(
    "construct-flow-event-card flex w-full max-w-[46rem] min-w-0 flex-col gap-2 rounded-[10px] border border-border/70 bg-card/90 p-3 text-left text-foreground shadow-sm",
    isPanel && "p-2.5 rounded-xl gap-1.5"
  );

  return {
    type: "actions",
    id: `${sessionId}:plan-path:${eventId}`,
    content: (
      <div className={containerClass} data-flow-surface="path-plan">
        {/* Header */}
        <div className="flex min-w-0 items-center justify-between gap-2.5 border-b border-border/50 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              "grid size-6 shrink-0 place-items-center rounded-[7px] border shadow-xs bg-background/80",
              failed ? "border-destructive/15 text-destructive bg-destructive/5" : "border-border/70 text-muted-foreground",
              isPanel && "size-6"
            )}>
              {failed ? (
                <CircleAlertIcon size={isPanel ? 11 : 13} />
              ) : running ? (
                <Loader2Icon size={isPanel ? 11 : 13} className="animate-spin" />
              ) : (
                <RouteIcon size={isPanel ? 11 : 13} />
              )}
            </span>
            <div className="min-w-0">
              <strong className={cn(
                "block truncate text-[13px] font-semibold tracking-tight",
                running ? "opaline-agent-thinking-shimmer" : "text-foreground",
                isPanel && "text-xs"
              )}>
                {isUpdate ? "Updating path" : "Planning path"}
              </strong>
            </div>
          </div>
          <span className={cn(
            "rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium shadow-2xs",
            statusColor,
            isPanel && "text-[9px] px-1.5"
          )}>
            {statusText}
          </span>
        </div>

        {/* Reason / Context */}
        {reason && (
          <div className={cn(
            "text-[12px] text-muted-foreground bg-background/45 rounded-[8px] px-2.5 py-2 border border-border/40",
            isPanel && "text-[11px] p-1.5"
          )}>
            <p className="line-clamp-2 leading-relaxed select-text"><span className="font-semibold text-foreground/80">Objective:</span> {reason}</p>
          </div>
        )}

        {/* Error Block */}
        {errorMessage && (
          <div className={cn(
            "mt-2 rounded-md border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive select-text",
            isPanel && "p-2 text-[11px]"
          )}>
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <CircleAlertIcon size={isPanel ? 11 : 13} className="shrink-0" />
              <span>Planning Blocked / Failed</span>
            </div>
            <p className={cn("leading-relaxed text-foreground/90 pl-4.5", isPanel && "pl-3.5")}>{errorMessage}</p>
          </div>
        )}

        {/* Nodes List */}
        {nodes.length > 0 && !failed && (
          <div className="flex flex-col gap-1.5">
            <span className={cn(
              "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1",
              isPanel && "text-[9px]"
            )}>Planned Nodes ({nodes.length})</span>
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
              {nodes.map((node: any, idx: number) => {
                const nodeStatus = node.status || "planned";
                const isActive = nodeStatus === "active";
                const isCompleted = nodeStatus === "completed";
                return (
                  <div
                    key={node.id || idx}
                    className={cn(
                      "flex items-start gap-2 rounded-[8px] px-2 py-1.5 border transition-all text-[12px]",
                      isActive
                        ? "border-primary/40 bg-primary/5 text-foreground ring-1 ring-primary/20"
                        : "border-border/30 bg-background/40 text-muted-foreground",
                      isPanel && "p-1.5 text-[11px]"
                    )}
                  >
                    <span className={cn(
                      "mt-0.5 shrink-0 flex items-center justify-center size-4 rounded-full border border-border/60 text-[9px] font-semibold",
                      isPanel && "size-3.5 text-[8px]"
                    )}>
                      {isCompleted ? (
                        <CheckIcon size={isPanel ? 9 : 10} className="text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("font-medium truncate", isActive ? "text-foreground font-semibold" : "text-foreground/80")}>
                          {node.title}
                        </span>
                        {node.kind && (
                          <span className={cn(
                            "text-[9px] px-1 rounded-sm bg-muted text-muted-foreground uppercase tracking-tight shrink-0 font-medium",
                            isPanel && "text-[8px] px-0.5"
                          )}>
                            {node.kind}
                          </span>
                        )}
                      </div>
                      <p className={cn(
                        "text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-1 select-text",
                        isPanel && "text-[10px] mt-0"
                      )}>{node.summary}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    )
  };
}

type TaskToolPayload = {
  taskId?: string;
  title: string;
  prompt: string;
  pathNodeId?: string;
  taskFiles: string[];
  introducedConceptIds: string[];
  successCriteria: string[];
  subtasks: Array<{ id?: string; title: string; status?: ConstructFlowPracticeSubtask["status"] }>;
  preparedFiles: string[];
};

function buildTaskCreatedPart({
  sessionId,
  eventId,
  input,
  outputPreview,
  status,
  tasks,
  pathNodes,
  currentTaskId,
  onOpenTask,
  theme,
  onOpenFile,
  chatMode
}: {
  sessionId: string;
  eventId: string;
  input: unknown;
  outputPreview?: string;
  status: string;
  tasks: ConstructFlowPracticeTask[];
  pathNodes: ConstructFlowPathNode[];
  currentTaskId?: string;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  theme: "light" | "dark" | "system";
  onOpenFile: (reference: InlineFileRef) => void;
  chatMode: FlowChatMode;
}): AgentSessionMessagePart {
  const payload = readTaskToolPayload(input, outputPreview);
  const task = resolveTaskForToolPayload(payload, tasks, sessionId);
  const nodeId = task?.pathNodeId ?? payload.pathNodeId;
  const node = nodeId ? pathNodes.find((candidate) => candidate.id === nodeId) : undefined;
  const active = task ? activeSubtask(task) : undefined;
  const subtaskCount = task?.subtasks?.length ?? payload.subtasks.length;
  const completedSubtasks = task?.subtasks?.filter((subtask) => subtask.status === "completed").length ?? 0;
  const isCurrent = Boolean(task && task.id === currentTaskId);
  const ready = task != null;
  const failed = !ready && status === "error";

  const statusText = isCurrent ? "Current" : ready ? "Task ready" : failed ? "Task failed" : status === "running" ? "Creating task" : "Task draft";
  const statusColor = isCurrent ? "text-[color:var(--construct-success)] font-medium" : failed ? "text-destructive font-medium" : (ready || status === "running") ? "text-foreground/80 font-medium" : "text-muted-foreground/80";

  const iconClass = failed
    ? "border-destructive/15 bg-destructive/5 text-destructive"
    : "border-border/70 bg-background/80 text-muted-foreground";

  const isPanel = chatMode === "panel";

  return {
    type: "actions",
    id: `${sessionId}:task:${eventId}`,
    content: (
      <button
        type="button"
        className={cn(
          "construct-flow-event-card group flex w-full max-w-[46rem] min-w-0 items-center justify-between gap-2.5 rounded-[12px] border border-border/60 bg-muted/30 p-2.5 text-left text-foreground hover:bg-muted/65 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 cursor-default",
          isPanel && "p-2 gap-2 rounded-lg"
        )}
        disabled={!ready}
        onClick={() => task && onOpenTask(task)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[8px] border shadow-sm group-hover:scale-95",
            iconClass,
            isPanel && "size-7 rounded-md"
          )}>
            {failed ? (
              <CircleAlertIcon size={isPanel ? 13 : 14} />
            ) : status === "running" ? (
              <Loader2Icon size={isPanel ? 13 : 14} className="animate-spin" />
            ) : (
              <TerminalIcon size={isPanel ? 13 : 14} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <span>Practice Task</span>
              <span>·</span>
              <span className={statusColor}>{statusText}</span>
              {subtaskCount ? (
                <>
                  <span>·</span>
                  <span>{completedSubtasks}/{subtaskCount} steps</span>
                </>
              ) : null}
            </div>
            <strong className={cn(
              "block truncate text-sm font-semibold text-foreground tracking-tight group-hover:text-foreground/90",
              isPanel && "text-xs"
            )}>
              {task?.title ?? payload.title}
            </strong>
          </div>
        </div>
        {ready && (
          <ChevronRightIcon size={isPanel ? 13 : 15} className="shrink-0 text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:text-foreground" />
        )}
      </button>
    )
  };
}

function FlowTinyChip({ children, tone }: { children: ReactNode; tone?: "current" | "strong" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "current" && "border-[color:var(--construct-success)] bg-[color:var(--construct-success-soft)] text-[color:var(--construct-success)]",
        tone === "strong" && "border-border/80 bg-foreground text-background",
        tone === "danger" && "border-destructive/35 bg-destructive/10 text-destructive",
        !tone && "border-border/70 bg-background/70 text-muted-foreground"
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function shortTaskStatusLabel(status: ConstructFlowPracticeTask["status"]): string {
  if (status === "completed") return "Done";
  if (status === "submitted") return "Submitted";
  if (status === "cancelled") return "Cancelled";
  return "Learner work";
}

function readTaskToolPayload(input: unknown, outputPreview?: string): TaskToolPayload {
  const inputObj = readRecord(input);
  const outputObj = parseJsonObject(outputPreview) ?? {};
  const outputSubtasks = readTaskPreviewSubtasks(outputObj.subtasks);
  const inputSubtasks = readTaskPreviewSubtasks(inputObj.subtasks);
  const preparedFiles = readTaskPreparedFiles(outputObj.preparedFiles).length
    ? readTaskPreparedFiles(outputObj.preparedFiles)
    : readTaskPreparationPaths(inputObj.preparations);

  return {
    taskId: readString(outputObj.taskId) ?? readString(inputObj.taskId),
    title: readString(outputObj.title) ?? readString(inputObj.title) ?? "Practice task",
    prompt: readString(outputObj.prompt) ?? readString(inputObj.prompt) ?? "Flow is creating a structured learner task.",
    pathNodeId: readString(outputObj.pathNodeId) ?? readString(inputObj.pathNodeId),
    taskFiles: readStringArray(outputObj.taskFiles).length ? readStringArray(outputObj.taskFiles) : readStringArray(inputObj.taskFiles),
    introducedConceptIds: readStringArray(outputObj.introducedConceptIds).length
      ? readStringArray(outputObj.introducedConceptIds)
      : readStringArray(inputObj.introducedConceptIds),
    successCriteria: readStringArray(outputObj.successCriteria).length
      ? readStringArray(outputObj.successCriteria)
      : readStringArray(inputObj.successCriteria),
    subtasks: outputSubtasks.length ? outputSubtasks : inputSubtasks,
    preparedFiles
  };
}

function resolveTaskForToolPayload(
  payload: TaskToolPayload,
  tasks: ConstructFlowPracticeTask[],
  sessionId: string
): ConstructFlowPracticeTask | undefined {
  if (payload.taskId) {
    const byId = tasks.find((task) => task.id === payload.taskId);
    if (byId) return byId;
  }
  const normalizedTitle = normalizeMatchText(payload.title);
  const sessionTasks = tasks.filter((task) => task.sessionId === sessionId);
  const titleMatches = (candidates: ConstructFlowPracticeTask[]) => candidates.find((task) => (
    normalizeMatchText(task.title) === normalizedTitle
    || (normalizedTitle.length > 0 && normalizeMatchText(task.title).includes(normalizedTitle))
    || (normalizeMatchText(task.title).length > 0 && normalizedTitle.includes(normalizeMatchText(task.title)))
  ));
  const pathMatches = (candidates: ConstructFlowPracticeTask[]) => payload.pathNodeId
    ? candidates.filter((task) => task.pathNodeId === payload.pathNodeId)
    : candidates;
  const fileSet = new Set(payload.taskFiles.map(normalizeMatchText));
  const fileMatches = (candidates: ConstructFlowPracticeTask[]) => candidates.find((task) => (
    task.taskFiles?.some((file) => fileSet.has(normalizeMatchText(file)))
  ));

  return titleMatches(sessionTasks)
    ?? titleMatches(pathMatches(tasks))
    ?? fileMatches(sessionTasks)
    ?? fileMatches(pathMatches(tasks))
    ?? (sessionTasks.length === 1 ? sessionTasks[0] : undefined)
    ?? titleMatches(tasks)
    ?? [...pathMatches(tasks)].reverse()[0];
}

function normalizeMatchText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function readTaskPreviewSubtasks(value: unknown): TaskToolPayload["subtasks"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TaskToolPayload["subtasks"] => {
    const record = readRecord(item);
    const title = readString(record.title);
    if (!title) return [];
    const rawStatus = readString(record.status);
    const status = rawStatus === "ready" || rawStatus === "active" || rawStatus === "submitted" || rawStatus === "needs-work" || rawStatus === "completed"
      ? rawStatus
      : undefined;
    return [{ id: readString(record.id), title, status }];
  });
}

function readTaskPreparedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    const record = readRecord(item);
    const path = readString(record.path);
    return path ? [path] : [];
  });
}

function readTaskPreparationPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    const record = readRecord(item);
    const path = readString(record.path);
    return path ? [path] : [];
  });
}

function readConceptPayload(input: unknown, outputPreview?: string): ConceptPayload {
  const inputObj = readRecord(input);
  const outputObj = parseJsonObject(outputPreview) ?? {};
  const conceptObj = readRecord(outputObj.concept);
  const id = readString(outputObj.canonicalId)
    ?? readString(conceptObj.id)
    ?? readString(outputObj.id)
    ?? readString(inputObj.id)
    ?? readString(inputObj.conceptId)
    ?? "";
  const title = readString(conceptObj.title)
    ?? readString(inputObj.title)
    ?? readString(outputObj.title)
    ?? conceptTitleFromId(id);
  const summary = readString(conceptObj.summary) ?? readString(outputObj.summary) ?? readString(inputObj.summary);
  const content = readString(conceptObj.content) ?? readString(inputObj.content) ?? readString(outputObj.content) ?? summary;
  const examples = readStringArray(conceptObj.examples).length
    ? readStringArray(conceptObj.examples)
    : readStringArray(inputObj.examples);
  const evidence = readStringArray(outputObj.evidence).length
    ? readStringArray(outputObj.evidence)
    : readStringArray(inputObj.evidence).length
      ? readStringArray(inputObj.evidence)
      : readStringArray(conceptObj.learnerEvidence);
  const conceptSources = readCitationSources(conceptObj.sources);
  const inputSources = readCitationSources(inputObj.sources);

  return {
    id,
    title,
    parentId: readNullableString(conceptObj.parentId) ?? readNullableString(inputObj.parentId),
    language: readConceptLanguage(conceptObj.language) ?? readConceptLanguage(inputObj.language) ?? readConceptLanguage(outputObj.language) ?? inferConceptLanguage(id, title),
    technology: readString(conceptObj.technology) ?? readString(inputObj.technology) ?? readString(outputObj.technology),
    summary,
    sources: conceptSources.length ? conceptSources : inputSources,
    content,
    examples,
    relatedConcepts: readStringArray(conceptObj.relatedConcepts).length
      ? readStringArray(conceptObj.relatedConcepts)
      : readStringArray(inputObj.relatedConcepts),
    confidence: readString(conceptObj.confidence) ?? readString(outputObj.nextConfidence) ?? readString(inputObj.confidence),
    masteryLevel: readConceptMasteryLevel(conceptObj.masteryLevel) ?? readConceptMasteryLevel(outputObj.nextMasteryLevel) ?? readConceptMasteryLevel(outputObj.masteryLevel) ?? readConceptMasteryLevel(inputObj.masteryLevel),
    masteryText: readString(conceptObj.masteryText) ?? readString(outputObj.masteryText) ?? readString(inputObj.masteryText),
    masteryReason: readString(conceptObj.masteryReason) ?? readString(outputObj.masteryReason) ?? readString(inputObj.masteryReason),
    masteryEvidence: readStringArray(conceptObj.masteryEvidence).length
      ? readStringArray(conceptObj.masteryEvidence)
      : readStringArray(inputObj.masteryEvidence).length
        ? readStringArray(inputObj.masteryEvidence)
        : readStringArray(outputObj.masteryEvidence),
    masteryUpdatedAt: readString(conceptObj.masteryUpdatedAt) ?? readString(outputObj.masteryUpdatedAt),
    reason: readString(outputObj.reason) ?? readString(inputObj.reason) ?? readString(conceptObj.lastChangeReason),
    confidenceReason: readString(outputObj.confidenceReason) ?? readString(inputObj.confidenceReason) ?? readString(conceptObj.confidenceReason),
    evidence,
    learnerEvidence: readStringArray(conceptObj.learnerEvidence),
    lastChangeReason: readString(conceptObj.lastChangeReason),
    authoredBy: readString(conceptObj.authoredBy) ?? readString(inputObj.authoredBy),
    agentContributionPercent: readNumber(conceptObj.agentContributionPercent) ?? readNumber(inputObj.agentContributionPercent),
    savedAt: readString(conceptObj.savedAt),
    lastModifiedAt: readString(conceptObj.lastModifiedAt),
    history: readConceptHistory(conceptObj.history),
    normalizedFrom: readString(outputObj.normalizedFrom)
  };
}

function buildConceptCardFromInput(input: ConceptPayload | Record<string, unknown>): ConceptCard {
  const id = typeof input.id === "string" ? input.id : "";
  const title = typeof input.title === "string" ? input.title : conceptTitleFromId(id);
  const language = readConceptLanguage((input as Record<string, unknown>).language) ?? inferConceptLanguage(id, title);
  const technology = readString((input as Record<string, unknown>).technology);
  const parentId = readNullableString((input as Record<string, unknown>).parentId);
  const content = typeof input.content === "string" ? input.content : "";
  const summary = readString((input as Record<string, unknown>).summary) ?? (content ? content.split("\n").find((line) => line.trim()) : undefined) ?? title;
  const sources = readCitationSources((input as Record<string, unknown>).sources);
  const evidence = readStringArray((input as Record<string, unknown>).evidence);
  const learnerEvidence = readStringArray((input as Record<string, unknown>).learnerEvidence);
  const reason = readString((input as Record<string, unknown>).reason);
  const masteryLevel = readConceptMasteryLevel((input as Record<string, unknown>).masteryLevel);
  const guideContent = content || [
    reason ? `Reason: ${reason}` : null,
    evidence.length ? `Evidence:\n${evidence.map((item) => `- ${item}`).join("\n")}` : null,
    learnerEvidence.length && learnerEvidence.join("\n") !== evidence.join("\n") ? `Learner evidence:\n${learnerEvidence.map((item) => `- ${item}`).join("\n")}` : null
  ].filter(Boolean).join("\n\n");
  const examples = Array.isArray(input.examples) ? input.examples.filter((item): item is string => typeof item === "string") : [];
  const history = readConceptHistory((input as Record<string, unknown>).history);
  return {
    id,
    title: title || id || "Concept",
    kind: "concept",
    parentId,
    language,
    technology,
    tags: id.split(".").slice(0, -1),
    summary,
    sources,
    content: content || undefined,
    why: "",
    example: examples[0] || "",
    docs: [],
    guides: guideContent ? [
      {
        kind: "guide",
        id: "explanation",
        guideKind: "guide.explanation",
        content: guideContent,
        sections: []
      }
    ] : [],
    relatedConcepts: readStringArray((input as Record<string, unknown>).relatedConcepts),
    confidence: readString((input as Record<string, unknown>).confidence),
    confidenceReason: readString((input as Record<string, unknown>).confidenceReason),
    masteryLevel,
    masteryText: readString((input as Record<string, unknown>).masteryText) ?? (masteryLevel !== undefined ? conceptMasteryRubricForLevel(masteryLevel).text : undefined),
    masteryReason: readString((input as Record<string, unknown>).masteryReason),
    masteryEvidence: readStringArray((input as Record<string, unknown>).masteryEvidence),
    masteryUpdatedAt: readString((input as Record<string, unknown>).masteryUpdatedAt),
    learnerEvidence,
    lastChangeReason: readString((input as Record<string, unknown>).lastChangeReason) ?? reason,
    authoredBy: readString((input as Record<string, unknown>).authoredBy),
    agentContributionPercent: readNumber((input as Record<string, unknown>).agentContributionPercent),
    savedAt: readString((input as Record<string, unknown>).savedAt),
    lastModifiedAt: readString((input as Record<string, unknown>).lastModifiedAt),
    history
  };
}

function mergeGuides(baseGuides: ConceptCard["guides"], overlayGuides: ConceptCard["guides"], overlayHasExplicitContent: boolean): ConceptCard["guides"] {
  if (!baseGuides.length) return overlayGuides;
  if (!overlayGuides.length) return baseGuides;

  return baseGuides.map(baseGuide => {
    const overlayGuide = overlayGuides.find(g => g.id === baseGuide.id);
    if (!overlayGuide) return baseGuide;
    if (baseGuide.id === "explanation" && !overlayHasExplicitContent) {
      return baseGuide;
    }
    return overlayGuide;
  }).concat(
    overlayGuides.filter(overlayGuide => !baseGuides.some(g => g.id === overlayGuide.id))
  );
}

function mergeConceptCards(base: ConceptCard, overlay: ConceptCard): ConceptCard {
  return {
    ...base,
    ...overlay,
    title: overlay.title || base.title,
    language: overlay.language || base.language,
    technology: overlay.technology || base.technology,
    tags: overlay.tags.length ? overlay.tags : base.tags,
    summary: overlay.summary && overlay.summary !== overlay.title ? overlay.summary : base.summary || overlay.summary,
    sources: overlay.sources?.length ? overlay.sources : base.sources,
    content: overlay.content || base.content,
    why: overlay.why || base.why,
    example: overlay.example || base.example,
    docs: overlay.docs.length ? overlay.docs : base.docs,
    guides: mergeGuides(base.guides, overlay.guides, Boolean(overlay.content)),
    commonMistake: overlay.commonMistake || base.commonMistake,
    parentId: overlay.parentId ?? base.parentId,
    relatedConcepts: overlay.relatedConcepts?.length ? overlay.relatedConcepts : base.relatedConcepts,
    confidence: overlay.confidence || base.confidence,
    confidenceReason: overlay.confidenceReason || base.confidenceReason,
    masteryLevel: overlay.masteryLevel ?? base.masteryLevel,
    masteryText: overlay.masteryText || base.masteryText,
    masteryReason: overlay.masteryReason || base.masteryReason,
    masteryEvidence: overlay.masteryEvidence?.length ? overlay.masteryEvidence : base.masteryEvidence,
    masteryUpdatedAt: overlay.masteryUpdatedAt || base.masteryUpdatedAt,
    learnerEvidence: overlay.learnerEvidence?.length ? overlay.learnerEvidence : base.learnerEvidence,
    lastChangeReason: overlay.lastChangeReason || base.lastChangeReason,
    authoredBy: overlay.authoredBy || base.authoredBy,
    agentContributionPercent: overlay.agentContributionPercent ?? base.agentContributionPercent,
    savedAt: overlay.savedAt || base.savedAt,
    lastModifiedAt: overlay.lastModifiedAt || base.lastModifiedAt,
    history: overlay.history?.length ? overlay.history : base.history
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return parseJsonObject(value) ?? {};
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readConceptMasteryLevel(value: unknown): ConstructConceptMasteryLevel | undefined {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (numeric === 0 || numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5) {
      return numeric;
    }
  }
  return undefined;
}

function readMasteryDirection(value: unknown): "increased" | "decreased" | "unchanged" | undefined {
  if (value === "increased" || value === "decreased" || value === "unchanged") {
    return value;
  }
  return undefined;
}

function readConceptHistory(value: unknown): ConceptCard["history"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): NonNullable<ConceptCard["history"]> => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const id = readString(record.id) ?? `${readString(record.createdAt) ?? "history"}:${readString(record.kind) ?? "event"}`;
    const reason = readString(record.reason) ?? "";
    const createdAt = readString(record.createdAt) ?? "";
    if (!reason && !createdAt) return [];
    return [{
      id,
      kind: readString(record.kind) ?? "modified",
      reason,
      evidence: readStringArray(record.evidence),
      changedFields: readStringArray(record.changedFields),
      fieldChanges: readConceptFieldChanges(record.fieldChanges),
      provenance: readConceptHistoryProvenance(record.provenance),
      confidence: readString(record.confidence),
      confidenceReason: readString(record.confidenceReason),
      masteryLevel: readConceptMasteryLevel(record.masteryLevel),
      masteryText: readString(record.masteryText),
      masteryReason: readString(record.masteryReason),
      masteryDirection: readMasteryDirection(record.masteryDirection),
      authoredBy: readString(record.authoredBy),
      agentContributionPercent: readNumber(record.agentContributionPercent),
      createdAt
    }];
  });
}

function readConceptFieldChanges(value: unknown): NonNullable<NonNullable<ConceptCard["history"]>[number]["fieldChanges"]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const changes = value.flatMap((item): NonNullable<NonNullable<ConceptCard["history"]>[number]["fieldChanges"]> => {
    const record = readRecord(item);
    const field = readString(record.field);
    if (!field) return [];
    return [{
      field,
      before: readString(record.before),
      after: readString(record.after)
    }];
  });
  return changes.length ? changes : undefined;
}

function readConceptHistoryProvenance(value: unknown): NonNullable<NonNullable<ConceptCard["history"]>[number]["provenance"]> | undefined {
  const record = readRecord(value);
  const projectId = readString(record.projectId);
  const projectTitle = readString(record.projectTitle);
  if (!projectId || !projectTitle) return undefined;
  return {
    projectId,
    projectTitle,
    projectGoal: readString(record.projectGoal),
    pathNodeId: readString(record.pathNodeId),
    pathNodeTitle: readString(record.pathNodeTitle),
    taskId: readString(record.taskId),
    taskTitle: readString(record.taskTitle),
    taskFiles: readStringArray(record.taskFiles),
    focusPath: readString(record.focusPath)
  };
}

function readConceptLanguage(value: unknown): ConstructConceptLanguage | undefined {
  if (value === "swift" || value === "python" || value === "typescript" || value === "javascript" || value === "cpp" || value === "unknown") {
    return value;
  }
  return undefined;
}

function inferConceptLanguage(id: string, title: string): ConstructConceptLanguage {
  const haystack = `${id} ${title}`.toLowerCase();
  if (haystack.includes("swift") || haystack.includes("swiftui")) return "swift";
  if (haystack.includes("python")) return "python";
  if (haystack.includes("typescript") || haystack.includes("ts.")) return "typescript";
  if (haystack.includes("javascript") || haystack.includes("node")) return "javascript";
  if (haystack.includes("cpp") || haystack.includes("c++") || haystack.includes("opengl") || haystack.includes("glfw")) return "cpp";
  return "unknown";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readCitationSources(value: unknown): ConstructCitationSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ConstructCitationSource[] => {
    const record = readRecord(item);
    const url = readString(record.url);
    const title = readString(record.title) ?? url;
    if (!url || !title) return [];
    return [{
      id: readString(record.id) ?? sourceIdFromUrl(url),
      title,
      url,
      provider: readString(record.provider),
      publisher: readString(record.publisher) ?? publisherFromUrl(url),
      snippet: readString(record.snippet),
      quote: readString(record.quote),
      accessedAt: readString(record.accessedAt)
    }];
  });
}

function sourceIdFromUrl(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "source";
}

function publisherFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function conceptTitleFromId(id: string): string {
  return id
    .split(".")
    .filter(Boolean)
    .map((part) => part.replace(/-/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ") || "Concept";
}

function buildInlineConceptPlaceholder(conceptId: string): ConceptCard {
  const title = conceptId
    .split(".")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ") || "Concept";
  return {
    id: conceptId,
    title,
    kind: "concept",
    language: inferConceptLanguage(conceptId, title),
    tags: conceptId.split(".").slice(0, -1),
    summary: `Flow referenced [[concept:${conceptId}|${title}]]. The full concept card will appear once it has been recorded in this project.`,
    why: "",
    example: "",
    docs: [],
    guides: []
  };
}

function buildConceptCardPart(
  sessionId: string,
  eventId: string,
  toolName: string,
  input: unknown,
  outputPreview: string | undefined,
  status: string,
  _theme: "light" | "dark" | "system",
  conceptMutations: ConceptMutation[],
  acknowledgedConceptEventKeys: Set<string>,
  onAcknowledgeConceptEvent: (eventKey: string) => void,
  onOpenConceptDetails: (concept: ConceptCard) => void,
  concepts: ConceptCard[],
  chatMode: FlowChatMode
): AgentSessionMessagePart {
  const payload = readConceptPayload(input, outputPreview);
  const conceptId = payload.id;
  const kind = conceptMutationKindForTool(toolName);
  const meta = conceptMutationMeta(kind, status);
  const existingConcept = concepts.find((c) => c.id === conceptId);
  const payloadConcept = buildConceptCardFromInput(payload);
  const conceptCard = existingConcept
    ? mergeConceptCards(existingConcept, payloadConcept)
    : payloadConcept;
  const conceptReason = payload.reason;
  const allMutations = ensureCurrentMutation(conceptMutations, {
    id: conceptId,
    title: payload.title || conceptId,
    kind: kind ?? "modified",
    eventId
  }, kind);
  const conceptEventKey = `${kind ?? toolName}:${conceptId || "unknown"}:${eventId}`;
  const shouldRequestAttention = status !== "running"
    && (kind === "added" || kind === "modified")
    && Boolean(conceptId)
    && !acknowledgedConceptEventKeys.has(conceptEventKey);

  let levelChange: { before: number; after: number } | null = null;
  const targetLevel = payload.masteryLevel;
  if (targetLevel !== undefined) {
    if (status === "running") {
      if (existingConcept && existingConcept.masteryLevel !== undefined) {
        const before = existingConcept.masteryLevel;
        const after = targetLevel;
        if (before !== after) {
          levelChange = { before, after };
        }
      }
    } else {
      const outputObj = parseJsonObject(outputPreview);
      if (outputObj && Array.isArray(outputObj.fieldChanges)) {
        const masteryChange = outputObj.fieldChanges.find((c: any) => c && c.field === "masteryLevel");
        if (masteryChange) {
          const before = parseInt(masteryChange.before, 10);
          const after = parseInt(masteryChange.after, 10);
          if (!isNaN(before) && !isNaN(after) && before !== after) {
            levelChange = { before, after };
          }
        }
      }
      if (!levelChange && conceptCard.history && conceptCard.history.length > 0) {
        const lastEntry = conceptCard.history[conceptCard.history.length - 1];
        if (lastEntry && Array.isArray(lastEntry.fieldChanges)) {
          const masteryChange = lastEntry.fieldChanges.find((c) => c.field === "masteryLevel");
          if (masteryChange) {
            const before = parseInt(masteryChange.before || "0", 10);
            const after = parseInt(masteryChange.after || "0", 10);
            if (!isNaN(before) && !isNaN(after) && before !== after) {
              levelChange = { before, after };
            }
          }
        }
      }
    }
  }

  let changedFields: string[] = [];
  const outputObj = parseJsonObject(outputPreview);
  if (outputObj && Array.isArray(outputObj.changedFields)) {
    changedFields = outputObj.changedFields.map(String);
  } else if (conceptCard.history && conceptCard.history.length > 0) {
    const lastEntry = conceptCard.history[conceptCard.history.length - 1];
    if (lastEntry && Array.isArray(lastEntry.changedFields)) {
      changedFields = lastEntry.changedFields.map(String);
    }
  }

  const isPanel = chatMode === "panel";

  return {
    type: "actions",
    id: `${sessionId}:concept:${eventId}`,
    content: (
      <div className="construct-flow-concept-event flex w-full max-w-[46rem] min-w-0 flex-col" data-attention={shouldRequestAttention ? "true" : "false"} data-flow-surface="concept-card">
        {status === "running" && toolName !== "remove-concept" ? (
          <ConceptCreationPreview
            payload={payload}
            toolName={toolName}
            existingConcept={existingConcept}
            levelChange={levelChange}
            input={input}
            chatMode={chatMode}
          />
        ) : toolName !== "remove-concept" ? (
          <ConceptSummaryCard
            concept={conceptCard}
            variant="chat"
            actionLabel={meta.label}
            attention={shouldRequestAttention}
            levelChange={levelChange}
            changedFields={changedFields}
            chatMode={chatMode}
            onOpen={() => {
              onAcknowledgeConceptEvent(conceptEventKey);
              onOpenConceptDetails(conceptCard);
            }}
          />
        ) : (
          <div className={cn(
            "construct-concept-summary-card flex w-full max-w-[46rem] min-w-0 items-center justify-between gap-2.5 rounded-[12px] border border-border/60 bg-muted/30 p-2.5 text-left text-foreground",
            isPanel && "p-2 gap-2 rounded-lg"
          )}>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className={cn(
                "grid size-8 shrink-0 place-items-center rounded-[8px] border border-destructive/15 bg-destructive/5 text-destructive shadow-sm",
                isPanel && "size-7 rounded-md"
              )}>
                <Trash2Icon size={isPanel ? 13 : 14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground font-medium">
                  <span>Concept</span>
                  <span>·</span>
                  <span className="text-destructive font-medium">Removed</span>
                  {conceptId && (
                    <>
                      <span>·</span>
                      <span className="font-mono text-[10px] text-destructive/80">{conceptId}</span>
                    </>
                  )}
                </div>
                <strong className={cn(
                  "block truncate text-sm font-semibold text-destructive/90 tracking-tight",
                  isPanel && "text-xs"
                )}>
                  {payload.title || conceptId || "Removed concept"}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  };
}

function ConceptCreationPreview({
  payload,
  toolName,
  existingConcept,
  levelChange,
  input,
  chatMode
}: {
  payload: ConceptPayload;
  toolName?: string;
  existingConcept?: ConceptCard;
  levelChange?: { before: number; after: number } | null;
  input?: unknown;
  chatMode: FlowChatMode;
}) {
  const isUpdate = toolName === "modify-concept" || Boolean(existingConcept);
  const title = payload.title && payload.title !== "Concept"
    ? payload.title
    : existingConcept?.title
      ? existingConcept.title
      : payload.id
        ? conceptTitleFromId(payload.id)
        : "concept";

  let statusLabel = isUpdate ? "Updating" : "Preparing";
  if (isUpdate) {
    if (levelChange) {
      if (levelChange.after > levelChange.before) {
        statusLabel = "Upgrading Mastery";
      } else {
        statusLabel = "Adjusting Mastery";
      }
    } else {
      const inputObj = readRecord(input);
      const keys = Object.keys(inputObj);
      if (keys.includes("content") || keys.includes("examples") || keys.includes("title")) {
        statusLabel = "Refining Concept";
      } else if (keys.includes("confidence")) {
        statusLabel = "Updating Confidence";
      } else if (keys.includes("relatedConcepts")) {
        statusLabel = "Refining Relations";
      } else {
        statusLabel = "Refining Concept";
      }
    }
  }
  const mainTitle = isUpdate ? `Updating ${title} concept...` : title;
  const isPanel = chatMode === "panel";

  return (
    <div className={cn(
      "construct-concept-summary-card flex w-full max-w-[46rem] min-w-0 items-center justify-between gap-2.5 rounded-[12px] border border-border/60 bg-muted/30 p-2.5 text-left text-foreground",
      isPanel && "p-2 gap-2 rounded-lg"
    )}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[8px] border border-border/70 bg-background/80 text-muted-foreground shadow-sm",
          isPanel && "size-7 rounded-md"
        )}>
          <Loader2Icon size={isPanel ? 13 : 14} className="animate-spin text-[color:var(--construct-warning)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
            <span>Concept</span>
            <span>·</span>
            <span className="text-[color:var(--construct-warning)] font-medium">{statusLabel}</span>
            {levelChange && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 bg-background/50 border border-border/40 rounded-full px-1.5 py-0.5 shadow-sm scale-95 origin-left">
                  <span className="text-muted-foreground/75 font-normal">L{levelChange.before}</span>
                  <span className="text-muted-foreground/60">→</span>
                  <span className="font-bold text-[color:var(--construct-warning)]">L{levelChange.after}</span>
                </span>
              </>
            )}
          </div>
          <strong className={cn(
            "block truncate text-sm font-semibold text-foreground tracking-tight group-hover:text-foreground/90",
            isPanel && "text-xs"
          )}>
            {mainTitle}
          </strong>
        </div>
      </div>
    </div>
  );
}

function ConceptEvidenceDisclosure({
  reason,
  confidenceReason,
  evidence
}: {
  reason?: string;
  confidenceReason?: string;
  evidence: string[];
}) {
  if (!reason && !confidenceReason && evidence.length === 0) return null;
  const preview = reason ?? confidenceReason ?? evidence[0] ?? "Evidence recorded";
  return (
    <ConceptAccordion
      className="rounded-[7px] bg-transparent"
      trigger={({
        open
      }) => (
        <div className="flex items-center gap-2 rounded-[9px] border border-border/60 bg-background/55 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/45">
          <FileTextIcon size={13} className="shrink-0" />
          <span className="shrink-0 text-foreground">Details</span>
          <span className="min-w-0 flex-1 truncate">{preview}</span>
          <ChevronDownIcon size={13} className={cn("shrink-0 transition-transform duration-300 ease-out", open && "rotate-180")} />
        </div>
      )}
    >
      <div className="flex flex-col gap-2 rounded-[7px] bg-muted/18 px-2.5 py-2 text-muted-foreground">
        {reason ? (
          <div>
            <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Reason</span>
            <p className="leading-relaxed">{reason}</p>
          </div>
        ) : null}
        {confidenceReason ? (
          <div>
            <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Confidence evidence</span>
            <p className="leading-relaxed">{confidenceReason}</p>
          </div>
        ) : null}
        {evidence.length ? (
          <div>
            <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Evidence</span>
            <ul className="flex flex-col gap-1 leading-relaxed">
              {evidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </ConceptAccordion>
  );
}

function ConceptAccordion({
  className,
  trigger,
  children
}: {
  className?: string;
  trigger: (state: { open: boolean }) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("overflow-hidden", className)}>
      <button
        type="button"
        className="w-full text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger({ open })}
      </button>
      <div className={cn("construct-flow-accordion__content", open && "is-open")}>
        <div>{children}</div>
      </div>
    </div>
  );
}

function ConceptMutationTree({
  mutations,
  currentId,
  currentKind
}: {
  mutations: ConceptMutation[];
  currentId: string;
  currentKind?: ConceptMutationKind;
}) {
  const roots = buildConceptTree(mutations);
  if (!roots.length && !currentId) return null;
  const trail = currentId.split(".").filter(Boolean);
  return (
    <ConceptAccordion
      className="rounded-[7px] bg-transparent"
      trigger={({ open }) => (
        <div className="flex items-center gap-2 rounded-[9px] border border-border/60 bg-background/55 px-2 py-1.5 text-[11px] transition-colors hover:border-border hover:bg-muted/45">
        <RouteIcon size={13} className="shrink-0 text-muted-foreground" />
        <span className="font-semibold text-foreground">Hierarchy</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {trail.length ? trail.join(" / ") : "concept"}
        </span>
        {currentKind ? (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${conceptMutationMeta(currentKind).textClass}`}>
            {conceptMutationLabel(currentKind)}
          </span>
        ) : null}
          <ChevronDownIcon size={13} className={cn("shrink-0 text-muted-foreground transition-transform duration-300 ease-out", open && "rotate-180")} />
        </div>
      )}
    >
      <div className="max-h-32 overflow-y-auto rounded-[7px] bg-muted/18 p-1.5">
        <div className="flex flex-col gap-0.5 font-mono text-[11px]">
        {roots.map((node) => (
          <ConceptTreeBranch key={node.id} node={node} currentId={currentId} depth={0} />
        ))}
        </div>
      </div>
    </ConceptAccordion>
  );
}

function ConceptTreeBranch({
  node,
  currentId,
  depth
}: {
  node: ConceptTreeNode;
  currentId: string;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
  const row = <ConceptTreeRow node={node} currentId={currentId} depth={depth} hasChildren={hasChildren} />;
  if (!hasChildren) return row;
  return (
    <details open className="group/concept-tree">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        {row}
      </summary>
      <div className="ml-3 border-l border-border/70 pl-2">
        {node.children.map((child) => (
          <ConceptTreeBranch key={child.id} node={child} currentId={currentId} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

function ConceptTreeRow({
  node,
  currentId,
  depth,
  hasChildren
}: {
  node: ConceptTreeNode;
  currentId: string;
  depth: number;
  hasChildren: boolean;
}) {
  const highlighted = node.id === currentId;
  const meta = node.mutation ? conceptMutationMeta(node.mutation.kind) : null;
  const Icon = meta?.Icon ?? (hasChildren ? BookOpenIcon : CircleIcon);
  const tone = highlighted && meta ? meta.textClass : node.mutation && meta ? `${meta.textClass} opacity-90` : "text-muted-foreground";
  return (
    <div
      className={[
        "flex min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 transition-colors",
        highlighted ? meta?.surfaceClass ?? "bg-muted/45" : "hover:bg-muted/35"
      ].filter(Boolean).join(" ")}
      style={{ marginLeft: depth === 0 ? 0 : undefined }}
    >
      <Icon size={13} className={`shrink-0 ${tone}`} />
      <span className={`min-w-0 flex-1 truncate ${tone}`}>
        {node.segment}
      </span>
      {highlighted ? (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${meta?.chipClass ?? "bg-muted text-muted-foreground"}`}>
          current
        </span>
      ) : null}
    </div>
  );
}

function buildConceptTree(mutations: ConceptMutation[]): ConceptTreeNode[] {
  type MutableConceptTreeNode = ConceptTreeNode & { childMap: Map<string, MutableConceptTreeNode> };
  const root = new Map<string, MutableConceptTreeNode>();
  const byId = new Map<string, ConceptMutation>();
  for (const mutation of mutations) {
    if (mutation.id) byId.set(mutation.id, mutation);
  }

  for (const mutation of byId.values()) {
    const parts = mutation.id.split(".").filter(Boolean);
    let level = root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}.${part}` : part;
      let node = level.get(part);
      if (!node) {
        node = { id: path, segment: part, children: [], childMap: new Map() };
        level.set(part, node);
      }
      if (path === mutation.id) {
        node.title = mutation.title;
        node.mutation = mutation;
      }
      level = node.childMap;
    }
  }

  const freeze = (nodes: Map<string, MutableConceptTreeNode>): ConceptTreeNode[] => (
    [...nodes.values()]
      .sort((a, b) => a.segment.localeCompare(b.segment))
      .map((node) => ({
        id: node.id,
        segment: node.segment,
        title: node.title,
        mutation: node.mutation,
        children: freeze(node.childMap)
      }))
  );

  return freeze(root);
}

function ensureCurrentMutation(
  mutations: ConceptMutation[],
  current: ConceptMutation,
  kind: ConceptMutationKind | null
): ConceptMutation[] {
  if (!kind || !current.id) return mutations;
  const next = mutations.filter((mutation) => !(mutation.eventId === current.eventId && mutation.id === current.id));
  next.push(current);
  return next;
}

function conceptMutationMeta(kind: ConceptMutationKind | null, status?: string) {
  if (kind === "added") {
    return {
      label: status === "running" ? "Introducing concept" : "Introduced concept",
      Icon: PlusCircleIcon,
      badgeClass: "border-[color:var(--construct-success)]/35 bg-[color:var(--construct-success-soft)] text-[color:var(--construct-success)]",
      textClass: "text-[color:var(--construct-success)]",
      surfaceClass: "bg-[color:var(--construct-success-soft)]",
      chipClass: "bg-[color:var(--construct-success-soft)] text-[color:var(--construct-success)]"
    };
  }
  if (kind === "modified") {
    return {
      label: status === "running" ? "Modifying concept" : "Modified concept",
      Icon: PencilIcon,
      badgeClass: "border-[color:var(--construct-warning)]/35 bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]",
      textClass: "text-[color:var(--construct-warning)]",
      surfaceClass: "bg-[color:var(--construct-warning-soft)]",
      chipClass: "bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]"
    };
  }
  if (kind === "removed") {
    return {
      label: status === "running" ? "Removing concept" : "Removed concept",
      Icon: Trash2Icon,
      badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
      textClass: "text-destructive",
      surfaceClass: "bg-destructive/10",
      chipClass: "bg-destructive/10 text-destructive"
    };
  }
  return {
    label: "Concept",
    Icon: BookOpenIcon,
    badgeClass: "border-border bg-background/70 text-muted-foreground",
    textClass: "text-muted-foreground",
    surfaceClass: "bg-muted/35",
    chipClass: "bg-muted text-muted-foreground"
  };
}

function conceptMutationLabel(kind: ConceptMutationKind): string {
  if (kind === "added") return "introduced";
  if (kind === "modified") return "modified";
  return "removed";
}

function FlowQuestionComposer({
  question,
  theme,
  value,
  onValueChange,
  onAnswer,
  onSkip,
  pending,
  chatMode,
  onOpenFile,
  onOpenConcept
}: {
  question: ActiveFlowQuestion;
  theme: "light" | "dark" | "system";
  value: string;
  onValueChange: (value: string) => void;
  onAnswer: (response: ConstructFlowQuestionResponse) => void;
  onSkip: () => void;
  pending: boolean;
  chatMode: FlowChatMode;
  onOpenFile?: (reference: InlineFileRef) => void;
  onOpenConcept?: (conceptId: string) => void;
}) {
  const payload = question.payload;
  const [isDark, setIsDark] = useState(() => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return theme === "dark";
  });

  useEffect(() => {
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (event: MediaQueryListEvent) => setIsDark(event.matches);
      mql.addEventListener("change", handler);
      setIsDark(mql.matches);
      return () => mql.removeEventListener("change", handler);
    }

    setIsDark(theme === "dark");
  }, [theme]);

  const codeTheme = isDark ? oneDark : oneLight;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || payload.answerMode !== "code") return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, payload.answerMode]);
  const choices = payload.choices ?? [];
  const allowOther = payload.allowOther !== false;
  const [selected, setSelected] = useState<string | null>(choices[0] ?? (allowOther ? "__other__" : null));
  const usingOther = selected === "__other__" || choices.length === 0;
  const answer = usingOther ? value.trim() : selected?.trim() ?? "";
  const canSubmit = !pending && Boolean(answer);
  const questionText = payload.question || "I need one more detail before continuing.";

  function submit() {
    if (!canSubmit) return;
    onAnswer(buildFlowQuestionResponse(question, answer));
  }

  const isPanel = chatMode === "panel";

  const containerClass = isPanel
    ? "mx-auto w-full max-w-[min(46rem,calc(100%-0.75rem))] rounded-xl border border-border/70 bg-card px-2.5 pb-2 pt-2.5 shadow-[0_4px_12px_color-mix(in_srgb,var(--foreground)_5%,transparent)] dark:shadow-none"
    : "construct-flow-question-composer mx-auto w-full max-w-[min(46rem,calc(100%-0.75rem))] rounded-[20px] border border-border/70 bg-card px-4 pb-3 pt-4 shadow-[0_10px_30px_color-mix(in_srgb,var(--foreground)_7%,transparent)] dark:shadow-none";

  const questionTextClass = isPanel
    ? "max-w-full text-[13px] font-medium leading-5 text-foreground"
    : "max-w-[58rem] text-[15px] font-semibold leading-7 text-foreground";

  const choicesContainerClass = isPanel ? "mt-3 grid grid-cols-1 gap-1" : "mt-3.5 grid grid-cols-1 gap-1.5";

  const choiceButtonClass = (choice: string) => cn(
    isPanel
      ? "group flex min-h-8 items-center gap-2 rounded-[10px] px-2 py-1 text-left text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      : "group flex min-h-[2.25rem] items-center gap-2.5 rounded-[12px] px-2.5 py-1.5 text-left text-[14px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
    selected === choice
      ? "bg-muted/70 text-foreground"
      : "bg-transparent text-foreground hover:bg-muted/35"
  );

  const choiceCircleClass = (choice: string) => cn(
    isPanel
      ? "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
      : "inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-[12px] font-medium",
    selected === choice
      ? "bg-foreground text-background"
      : "border border-border bg-muted/30 text-muted-foreground"
  );

  const otherLabelClass = cn(
    isPanel
      ? "mt-1.5 flex min-h-8 items-center gap-2 rounded-[10px] px-2 py-1 text-[13px] leading-relaxed"
      : "mt-2 flex min-h-[2.25rem] items-center gap-2.5 rounded-[12px] px-2.5 py-1.5 text-[14px] leading-5",
    usingOther ? "bg-muted/55 text-foreground" : "text-muted-foreground hover:bg-muted/25"
  );

  const otherIconContainerClass = cn(
    isPanel
      ? "inline-flex size-5 shrink-0 items-center justify-center rounded-full border"
      : "inline-flex size-5.5 shrink-0 items-center justify-center rounded-full border",
    usingOther ? "border-foreground/25 bg-background text-foreground" : "border-border bg-muted/25 text-muted-foreground"
  );

  const otherInputClass = isPanel
    ? "min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-relaxed text-inherit outline-none placeholder:text-muted-foreground"
    : "min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] leading-5 text-inherit outline-none placeholder:text-muted-foreground";

  return (
    <div className={containerClass}>
      <div className={isPanel ? "space-y-2 px-0.5" : "space-y-3 px-1"}>
        <div className={questionTextClass}>
          <MarkdownBlock content={questionText} theme={theme} onOpenFile={onOpenFile} onOpenConcept={onOpenConcept} />
        </div>
      </div>
      {choices.length ? (
        <div className={choicesContainerClass}>
          {choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              data-construct-control="question-choice"
              className={choiceButtonClass(choice)}
              onClick={() => {
                setSelected(choice);
                onValueChange("");
              }}
              disabled={pending}
            >
              <span className={choiceCircleClass(choice)}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">{choice}</span>
            </button>
          ))}
        </div>
      ) : null}
      {allowOther ? (
        payload.answerMode === "code" ? (
          <div className="mt-4 flex flex-col overflow-hidden rounded-[14px] border border-border/75 bg-background shadow-sm transition-all duration-200 focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/20">
            {/* Header / Meta bar */}
            <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-4 py-2 text-xs text-muted-foreground select-none">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {payload.language ?? "typescript"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">Shift + Enter to submit</span>
            </div>

            {/* Editor container */}
            <div className="relative min-h-[184px] w-full font-mono text-sm leading-relaxed">
              {/* Highlighted text layer (positioned absolutely underneath) */}
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-4"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "14px",
                  lineHeight: "1.55"
                }}
              >
                <SyntaxHighlighter
                  style={codeTheme}
                  language={payload.language ?? "typescript"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: 0,
                    background: "transparent",
                    border: 0,
                    borderRadius: 0,
                    fontSize: "inherit",
                    lineHeight: "inherit",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "inherit",
                      whiteSpace: "inherit",
                      wordBreak: "inherit"
                    }
                  }}
                >
                  {value}
                </SyntaxHighlighter>
              </div>

              {/* Transparent Textarea overlay */}
              <textarea
                ref={textareaRef}
                className="block min-h-[184px] w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed outline-none caret-foreground placeholder:text-muted-foreground/70 focus:ring-0"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "14px",
                  lineHeight: "1.55",
                  caretColor: "var(--foreground)",
                  color: value ? "transparent" : "var(--muted-foreground)"
                }}
                value={value}
                placeholder="Write your code here..."
                onFocus={() => setSelected("__other__")}
                onChange={(event) => {
                  setSelected("__other__");
                  onValueChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    // Normal Enter key inserts newline (default behavior of textarea)
                  } else if (event.key === "Enter" && event.shiftKey && canSubmit) {
                    event.preventDefault();
                    submit();
                  }
                }}
                disabled={pending}
                spellCheck={false}
              />
            </div>
          </div>
        ) : (
          <label className={otherLabelClass}>
            <span className={otherIconContainerClass}>
              <PencilIcon size={isPanel ? 11 : 12} strokeWidth={1.8} />
            </span>
            <input
              className={otherInputClass}
              value={value}
              placeholder={choices.length ? "Custom answer" : "Type your answer"}
              onFocus={() => setSelected("__other__")}
              onChange={(event) => {
                setSelected("__other__");
                onValueChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                if (event.key === "Enter" && !event.shiftKey && canSubmit) {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={pending}
              spellCheck
            />
          </label>
        )
      ) : null}
      <div className={isPanel ? "mt-2.5 flex items-center justify-end gap-3" : "mt-3 flex items-center justify-end gap-4"}>
        {payload.allowSkip !== false ? (
          <Button
            type="button"
            data-construct-control="question-action"
            variant="ghost"
            size={isPanel ? "sm" : "default"}
            className="rounded-full font-medium"
            onClick={onSkip}
            disabled={pending}
          >
            Skip
          </Button>
        ) : null}
        <Button
          type="button"
          data-construct-control="question-action"
          variant="default"
          size={isPanel ? "sm" : "default"}
          className="rounded-full gap-1.5 font-medium"
          disabled={!canSubmit}
          onClick={submit}
        >
          <span>Submit</span>
          {payload.answerMode === "code" ? (
            <span className={cn(
              "inline-flex items-center justify-center rounded-md bg-primary-foreground/15 text-primary-foreground px-1.5 py-0.5 text-[10px] font-mono font-medium tracking-tight gap-0.5",
              isPanel ? "h-5" : "h-5.5"
            )}>
              <span className="opacity-70">Shift</span>
              <CornerDownLeftIcon size={isPanel ? 9 : 10} strokeWidth={2.2} />
            </span>
          ) : (
            <span className={cn(
              "inline-flex items-center justify-center rounded-full bg-primary-foreground/15 text-primary-foreground",
              isPanel ? "size-5" : "size-5.5"
            )}>
              <CornerDownLeftIcon size={isPanel ? 11 : 12} strokeWidth={2.2} />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

function readAskUserPayload(input: unknown, outputPreview?: string): { question?: string; reason?: string; choices?: string[]; allowOther?: boolean; allowSkip?: boolean; blocksProgress?: boolean; answerMode?: string; language?: string } {
  const parsedOutput = parseJsonObject(outputPreview);
  const source = parsedOutput ?? (typeof input === "object" && input !== null ? input as Record<string, unknown> : {});
  return {
    question: typeof source.question === "string" ? source.question : undefined,
    reason: typeof source.reason === "string" ? source.reason : undefined,
    choices: Array.isArray(source.choices) ? source.choices.filter((choice): choice is string => typeof choice === "string") : undefined,
    allowOther: typeof source.allowOther === "boolean" ? source.allowOther : true,
    allowSkip: typeof source.allowSkip === "boolean" ? source.allowSkip : true,
    blocksProgress: typeof source.blocksProgress === "boolean" ? source.blocksProgress : false,
    answerMode: typeof source.answerMode === "string" ? source.answerMode : undefined,
    language: typeof source.language === "string" ? source.language : undefined
  };
}

function buildMemoryUpdatedPart(
  sessionId: string,
  eventId: string,
  input: unknown,
  outputPreview: string | undefined,
  onOpenFile: (reference: InlineFileRef) => void,
  theme: "light" | "dark" | "system"
): AgentSessionMessagePart {
  const results = readMemoryPatchResults(input, outputPreview);
  return {
    type: "actions",
    id: `${sessionId}:memory:${eventId}`,
    content: <FlowMemoryUpdateCard results={results} onOpenFile={onOpenFile} theme={theme} />
  };
}

function FlowMemoryUpdateCard({
  results,
  onOpenFile,
  theme
}: {
  results: ConstructFlowMemoryPatchResult[];
  onOpenFile: (reference: InlineFileRef) => void;
  theme: "light" | "dark" | "system";
}) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(results[0]?.file ?? "research.md");
  const selected = results.find((result) => result.file === selectedFile) ?? results[0];
  const fileLabel = results.length ? results.map((result) => result.file).join(", ") : "Flow Memory";
  const openSelectedFile = () => {
    if (selected) {
      onOpenFile(createInlineFileReference(flowMemoryFilePath(selected.file), selected.file));
    }
  };
  return (
    <div className="construct-flow-event-card flex w-full max-w-[46rem] min-w-0 items-center gap-2.5 rounded-[10px] border border-border/70 bg-card/90 px-3 py-2 text-[13px] text-muted-foreground shadow-sm transition-colors duration-150 hover:bg-muted/20" data-flow-surface="memory-updated">
      <span className="grid size-6 shrink-0 place-items-center rounded-[7px] border border-border/70 bg-background/80 text-muted-foreground shadow-xs">
        <FileTextIcon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="shrink-0 font-semibold leading-5 text-foreground">Memory updated</strong>
          <button
            className="min-w-0 truncate rounded-[6px] px-1 py-0.5 text-left font-mono text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            type="button"
            onClick={openSelectedFile}
          >
            {fileLabel}
          </button>
        </div>
        {results[0]?.reason && results[0].reason !== "Flow Memory changed." ? (
          <p className="mt-0.5 line-clamp-1 text-[12px] leading-relaxed text-muted-foreground">{results[0].reason}</p>
        ) : null}
      </div>
      <Button className="h-7 shrink-0 rounded-full px-2.5 text-xs" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <GitCompareIcon size={13} />
        View diff
      </Button>
      <ShadcnDialog open={open} onOpenChange={setOpen}>
        <ShadcnDialogContent className="flex h-[min(68vh,42rem)] w-[min(96rem,calc(100vw-2rem))] max-w-none grid-rows-none flex-col overflow-hidden rounded-[10px] border border-border/70 bg-background p-0 shadow-2xl">
          <ShadcnDialogHeader className="shrink-0 border-b px-4 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3 pr-7">
              <div className="min-w-0">
                <ShadcnDialogTitle>Flow Memory diff</ShadcnDialogTitle>
                <ShadcnDialogDescription className="mt-1 truncate font-mono text-xs">
                  {selected?.path ?? "Changed Flow Memory file"}
                </ShadcnDialogDescription>
              </div>
              {selected ? (
                <Button size="sm" variant="outline" onClick={openSelectedFile}>
                  <FileTextIcon size={14} />
                  Open {selected.file}
                </Button>
              ) : null}
            </div>
          </ShadcnDialogHeader>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-[6px] border bg-muted/45 px-2 py-1 font-medium text-foreground">Before</span>
                <span className="rounded-[6px] border bg-muted/45 px-2 py-1 font-medium text-foreground">After</span>
                <span className="truncate">{selected?.reason ?? "Memory changed"}</span>
              </div>
              {results.length > 1 ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {results.map((result) => (
                    <Button
                      key={result.file}
                      className="h-7 px-2 text-[11px]"
                      size="sm"
                      variant={result.file === selected?.file ? "secondary" : "ghost"}
                      onClick={() => setSelectedFile(result.file)}
                    >
                      {result.file}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            {selected ? (
              <div className="construct-memory-diff-editor min-h-0 flex-1 overflow-hidden rounded-[8px] border bg-muted/20">
                <MemoryDiffViewer result={selected} theme={theme} />
              </div>
            ) : null}
          </div>
        </ShadcnDialogContent>
      </ShadcnDialog>
    </div>
  );
}

function readRenderableMemoryDiff(result: ConstructFlowMemoryPatchResult): string {
  if (result.diff) {
    return result.diff;
  }
  if (result.addedText) {
    return [
      `--- ${result.file}`,
      `+++ ${result.file}`,
      "@@ added text @@",
      ...result.addedText.split(/\r?\n/).map((line) => `+${line}`)
    ].join("\n");
  }
  return [
    `--- ${result.file}`,
    `+++ ${result.file}`,
    "@@ diff unavailable @@",
    " This memory write was recorded before before/after diffs were tracked."
  ].join("\n");
}

function MemoryDiffViewer({
  result,
  theme
}: {
  result: ConstructFlowMemoryPatchResult;
  theme: "light" | "dark" | "system";
}) {
  const diff = readRenderableMemoryDiff(result);
  const parsed = useMemo(() => parseUnifiedDiffText(diff), [diff]);
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <DiffEditor
      height="100%"
      language="markdown"
      theme={isDark ? "vs-dark" : "vs"}
      original={parsed.original}
      modified={parsed.modified}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollbar: { useShadows: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "on",
        wrappingIndent: "same",
        lineNumbers: "on",
        fontSize: 12,
        lineHeight: 20,
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 12,
        renderOverviewRuler: false,
        renderIndicators: false,
        diffCodeLens: false,
        smoothScrolling: true,
        ignoreTrimWhitespace: false
      }}
    />
  );
}

function parseUnifiedDiffText(diff: string): { original: string; modified: string } {
  const original: string[] = [];
  const modified: string[] = [];

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      original.push(line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      modified.push(line.slice(1));
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    original.push(text);
    modified.push(text);
  }

  return {
    original: original.join("\n"),
    modified: modified.join("\n")
  };
}

function readMemoryPatchResults(input: unknown, outputPreview?: string): ConstructFlowMemoryPatchResult[] {
  const parsed = parseJsonValue(outputPreview);
  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is Partial<ConstructFlowMemoryPatchResult> & { file: ConstructFlowMemoryPatchResult["file"] } => (
        typeof item === "object"
        && item !== null
        && typeof (item as { file?: unknown }).file === "string"
      ))
      .map((item) => ({
        file: item.file as ConstructFlowMemoryPatchResult["file"],
        path: item.path ?? `.construct/${item.file}`,
        reason: item.reason ?? readPatchReason(input, item.file),
        mode: item.mode ?? "append",
        diff: item.diff ?? "",
        updatedAt: item.updatedAt ?? "",
        addedText: item.addedText ?? "",
        removedText: item.removedText
      }));
  }
  return [];
}

function readPatchReason(input: unknown, file: string): string {
  const inputObj = typeof input === "string" ? parseJsonObject(input) : (input as Record<string, unknown> | null | undefined);
  const patches = Array.isArray(inputObj?.patches) ? inputObj.patches : [];
  const match = patches.find((patch): patch is { file: string; reason?: string } => (
    typeof patch === "object" && patch !== null && (patch as { file?: unknown }).file === file
  ));
  return match?.reason ?? "Flow Memory changed.";
}

function parseJsonValue(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function flowTimelineParts(session: ConstructFlowSession): ConstructFlowTimelinePart[] {
  if (session.timeline?.length) return session.timeline;
  const parts = (session.agentEvents ?? []).flatMap((event): ConstructFlowTimelinePart[] => {
    if (event.type === "iteration") return [];
    if (event.type === "message") {
      return [{
        id: event.id,
        kind: "message",
        status: event.status,
        text: event.text ?? "",
        createdAt: event.createdAt
      }];
    }
    if (event.type === "reasoning") {
      return [{
        id: event.id,
        kind: "reasoning",
        status: event.status,
        title: event.title || "Thinking",
        detail: event.detail,
        text: event.text,
        createdAt: event.createdAt
      }];
    }
    return [{
      id: event.id,
      kind: "tool",
      toolCallId: event.id,
      name: event.toolName ?? event.title,
      title: event.title,
      reason: event.detail,
      status: event.status,
      input: event.input,
      outputPreview: event.outputPreview,
      createdAt: event.createdAt,
      completedAt: event.status === "running" ? undefined : event.createdAt
    }];
  });
  const seenToolIds = new Set(parts.flatMap((part) => part.kind === "tool" ? [part.toolCallId] : []));
  for (const toolCall of session.toolCalls ?? []) {
    if (seenToolIds.has(toolCall.id)) continue;
    parts.push({
      id: toolCall.id,
      kind: "tool",
      toolCallId: toolCall.id,
      name: toolCall.name,
      title: toolCall.title,
      reason: toolCall.reason,
      status: toolCall.status,
      input: toolCall.input,
      outputPreview: toolCall.outputPreview,
      createdAt: toolCall.createdAt,
      completedAt: toolCall.completedAt
    });
  }
  return parts.sort(compareTimelineParts);
}

function compareTimelineParts(a: ConstructFlowTimelinePart, b: ConstructFlowTimelinePart): number {
  return timelinePartSortTime(a) - timelinePartSortTime(b);
}

function timelinePartSortTime(part: ConstructFlowTimelinePart): number {
  const raw = part.createdAt ?? part.updatedAt ?? ("completedAt" in part ? part.completedAt : undefined);
  const timestamp = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function flowTimelinePartToTraceEntry(event: ConstructFlowTimelinePart): AgentRunTraceEntry {
  if (event.kind === "message") {
    return {
      id: event.id,
      kind: "thought",
      title: "Message",
      status: event.status === "error" ? "error" : event.status === "running" ? "running" : "completed",
      output: event.text
    };
  }
  if (event.kind === "compaction") {
    const tokenLine = [
      event.beforeTokens ? `before ${formatTokens(event.beforeTokens)}` : null,
      event.afterTokens ? `after ${formatTokens(event.afterTokens)}` : null,
      typeof event.summarizedMessageCount === "number" ? `${event.summarizedMessageCount} summarized` : null,
      typeof event.preservedMessageCount === "number" ? `${event.preservedMessageCount} preserved` : null
    ].filter(Boolean).join(" · ");
    return {
      id: event.id,
      kind: "tool",
      title: event.title,
      subtitle: tokenLine || event.detail,
      status: event.status === "error" ? "error" : event.status === "running" ? "running" : "completed",
      icon: "memory",
      input: event.detail,
      output: event.summary
    };
  }

  const toolName = event.kind === "tool" ? event.name : event.title;
  const isConcept = event.kind === "tool" && (
    toolName === "add-concept" ||
    toolName === "modify-concept" ||
    toolName === "remove-concept" ||
    toolName === "suggest-existing-concept"
  );
  let title = event.kind === "reasoning" ? "Thinking" : event.title;
  let subtitle = event.kind === "reasoning" && event.text ? undefined : event.kind === "tool" ? event.reason : event.detail;

  if (isConcept && event.kind === "tool") {
    const inputObj = (
      typeof event.input === "string"
        ? parseJsonObject(event.input)
        : event.input as Record<string, unknown> | undefined
    ) ?? {};
    const conceptId = typeof inputObj.id === "string" ? inputObj.id : "";
    const conceptTitle = typeof inputObj.title === "string" ? inputObj.title : "";

    if (toolName === "add-concept") {
      title = event.status === "running"
        ? `Introducing concept "${conceptTitle || conceptId || "new concept"}"`
        : `Introduced concept "${conceptTitle || conceptId || "new concept"}"`;
    } else if (toolName === "modify-concept") {
      title = `Modified concept "${conceptTitle || conceptId}"`;
    } else if (toolName === "remove-concept") {
      title = `Removed concept "${conceptId}"`;
    }
    subtitle = conceptId;
  }

  return {
    id: event.id,
    kind: event.kind === "reasoning" ? "thought" : "tool",
    title,
    subtitle,
    status: event.status === "error" ? "error" : event.status === "running" ? "running" : "completed",
    icon: event.kind === "tool" ? classifyToolIcon(toolName) : undefined,
    input: event.kind === "tool" ? stringify(event.input) : undefined,
    output: event.kind === "reasoning" ? event.text : event.kind === "tool" ? event.outputPreview : undefined
  };
}

function splitProcessNarration(text: string | undefined): { process?: string; answer?: string } {
  const value = text?.trim();
  if (!value) return {};
  const processPattern = /(?:^|\n)(?=(?:#{1,4}\s+|\*\*|The project structure:|Here(?:'|’)s where|Here is where|What we have|Next step|So,? here|Now we can)\b)/i;
  const match = value.match(processPattern);
  if (!match?.index || match.index < 80) {
    return { answer: value };
  }
  const process = value.slice(0, match.index).trim();
  const answer = value.slice(match.index).trim();
  return { process, answer: answer || value };
}

function classifyToolIcon(name: string): AgentRunTraceEntry["icon"] {
  if (name.includes("memory") || name.includes("concept")) return "memory";
  if (name.includes("read") || name === "view") return "read";
  if (name.includes("search") || name.includes("find")) return "search";
  if (name.includes("terminal") || name.includes("command")) return "terminal";
  if (name.includes("file") || name.includes("edit") || name.includes("write") || name.includes("glob") || name.includes("list")) return "file";
  return "tool";
}

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mergeSessions(sessions: ConstructFlowSession[], liveSession?: ConstructFlowSession): ConstructFlowSession[] {
  if (!liveSession) return sessions;
  return upsertSession(sessions, liveSession);
}

function upsertSession(sessions: ConstructFlowSession[], session: ConstructFlowSession): ConstructFlowSession[] {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index < 0) return [...sessions, session];
  return sessions.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate);
}

function findLatestContextWindow(sessions: ConstructFlowSession[]): ConstructAgentContextWindow | undefined {
  for (const session of [...sessions].reverse()) {
    if (session.contextWindow) return session.contextWindow;
  }
  return undefined;
}

function flowFeatureModel(settings: AiSettings): string {
  const featureModel = settings.featureModels?.["construct-flow"]?.trim();
  if (featureModel) return featureModel;
  return globalModelForProvider(settings) || defaultFlowModelForProvider(settings.source === "construct-cloud" ? "construct-cloud" : settings.provider);
}

function globalModelForProvider(settings: AiSettings): string {
  if (settings.source === "construct-cloud") return settings.constructCloudModel.trim();
  if (settings.provider === "openrouter") return settings.openRouterModel.trim();
  if (settings.provider === "opencode-zen") return settings.opencodeZenModel.trim();
  if (settings.provider === "github-copilot") return settings.githubCopilotModel.trim();
  if (settings.provider === "litellm") return settings.liteLlmModel.trim();
  return settings.openAiModel.trim();
}

function defaultFlowModelForProvider(provider: AiSettings["provider"] | "construct-cloud"): string {
  if (provider === "construct-cloud") return "deepseek/deepseek-v4-flash";
  if (provider === "openrouter") return "deepseek/deepseek-v4-flash";
  if (provider === "opencode-zen") return "gpt-5.1-codex";
  if (provider === "github-copilot") return "github_copilot/gpt-4";
  if (provider === "litellm") return "openai/gpt-5-mini";
  return "gpt-5-mini";
}

function apiKeyForProvider(settings: AiSettings): string | undefined {
  if (settings.source === "construct-cloud") return settings.constructCloudAccessToken || undefined;
  if (settings.provider === "openai") return settings.openAiApiKey || undefined;
  if (settings.provider === "openrouter") return settings.openRouterApiKey || undefined;
  if (settings.provider === "opencode-zen") return settings.opencodeZenApiKey || undefined;
  if (settings.provider === "litellm") return settings.liteLlmApiKey || undefined;
  return undefined;
}

function ensureModelOption(
  models: ModelCatalogEntry[],
  model: string,
  provider?: AiSettings["provider"]
): ModelCatalogEntry[] {
  if (!model || models.some((entry) => entry.id === model)) return models;
  return [{
    id: model,
    name: readableModelName(model),
    providerId: provider,
    providerName: provider ? providerLabel(provider) : undefined
  }, ...models];
}

function readableModelName(model: string): string {
  const leaf = model.split("/").pop() || model;
  return leaf
    .replace(/^github_copilot\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function providerLabel(provider: AiSettings["provider"]): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "opencode-zen") return "OpenCode Zen";
  if (provider === "github-copilot") return "GitHub Copilot";
  if (provider === "litellm") return "LiteLLM";
  return "OpenAI";
}

const modelBrandOrder: ModelBrandKey[] = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "qwen",
  "mistral",
  "meta",
  "xai",
  "perplexity",
  "github-copilot",
  "opencode-zen",
  "openrouter",
  "litellm",
  "other"
];

function bucketModelsByBrand(
  models: ModelCatalogEntry[],
  provider: AiSettings["provider"]
): Map<ModelBrandKey, ModelCatalogEntry[]> {
  const buckets = new Map<ModelBrandKey, ModelCatalogEntry[]>();
  for (const model of models) {
    const brand = modelBrandFor(model, provider);
    const bucket = buckets.get(brand) ?? [];
    bucket.push(model);
    buckets.set(brand, bucket);
  }
  return buckets;
}

function sortModelBrands(brands: ModelBrandKey[]): ModelBrandKey[] {
  const order = new Map(modelBrandOrder.map((brand, index) => [brand, index]));
  return brands.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

function modelBrandFor(model: ModelCatalogEntry | null, fallbackProvider: AiSettings["provider"]): ModelBrandKey {
  const haystack = [
    model?.id,
    model?.name,
    model?.providerId,
    model?.providerName,
    model?.subProvider,
    fallbackProvider
  ].filter(Boolean).join(" ").replace(/_/g, "-").toLowerCase();

  if (haystack.includes("github-copilot")) return "github-copilot";
  if (haystack.includes("claude") || haystack.includes("anthropic")) return "anthropic";
  if (haystack.includes("gemini") || haystack.includes("google") || haystack.includes("vertex")) return "google";
  if (haystack.includes("deepseek")) return "deepseek";
  if (haystack.includes("qwen") || haystack.includes("dashscope") || haystack.includes("alibaba")) return "qwen";
  if (haystack.includes("mistral") || haystack.includes("codestral")) return "mistral";
  if (haystack.includes("llama") || haystack.includes("meta-")) return "meta";
  if (haystack.includes("grok") || haystack.includes("xai") || haystack.includes("x-ai")) return "xai";
  if (haystack.includes("perplexity") || haystack.includes("sonar")) return "perplexity";
  if (haystack.includes("openai") || haystack.includes("gpt-") || haystack.includes("codex") || haystack.includes("o3") || haystack.includes("o4")) return "openai";
  if (haystack.includes("opencode-zen")) return "opencode-zen";
  if (haystack.includes("openrouter")) return "openrouter";
  if (haystack.includes("litellm")) return "litellm";
  return "other";
}

function modelMatchesQuery(model: ModelCatalogEntry, query: string): boolean {
  const brand = modelBrandMeta(modelBrandFor(model, "litellm"));
  return [
    model.id,
    model.name,
    model.providerId,
    model.providerName,
    model.subProvider,
    model.description,
    brand.label,
    brand.short
  ].filter(Boolean).join(" ").toLowerCase().includes(query);
}

function modelBrandMeta(brand: ModelBrandKey): {
  label: string;
  short: string;
  Icon: LucideIcon;
  markClass: string;
} {
  if (brand === "anthropic") return { label: "Claude", short: "Cl", Icon: BrainCircuitIcon, markClass: "bg-muted text-foreground" };
  if (brand === "google") return { label: "Gemini", short: "Gm", Icon: StarIcon, markClass: "bg-primary/10 text-primary" };
  if (brand === "deepseek") return { label: "DeepSeek", short: "Ds", Icon: SearchIcon, markClass: "bg-[color:var(--construct-success-soft)] text-[color:var(--construct-success)]" };
  if (brand === "qwen") return { label: "Qwen", short: "Qw", Icon: CpuIcon, markClass: "bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]" };
  if (brand === "mistral") return { label: "Mistral", short: "Mi", Icon: RouteIcon, markClass: "bg-destructive/10 text-destructive" };
  if (brand === "meta") return { label: "Llama", short: "Ll", Icon: Layers3Icon, markClass: "bg-accent text-accent-foreground" };
  if (brand === "xai") return { label: "xAI", short: "xA", Icon: BrainCircuitIcon, markClass: "bg-foreground text-background" };
  if (brand === "perplexity") return { label: "Perplexity", short: "Px", Icon: SearchIcon, markClass: "bg-secondary text-secondary-foreground" };
  if (brand === "github-copilot") return { label: "Copilot", short: "Gh", Icon: BotIcon, markClass: "bg-primary/10 text-primary" };
  if (brand === "openrouter") return { label: "OpenRouter", short: "Or", Icon: RouteIcon, markClass: "bg-secondary text-secondary-foreground" };
  if (brand === "opencode-zen") return { label: "OpenCode Zen", short: "Oz", Icon: RouteIcon, markClass: "bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]" };
  if (brand === "litellm") return { label: "LiteLLM", short: "Lt", Icon: Layers3Icon, markClass: "bg-muted text-muted-foreground" };
  if (brand === "other") return { label: "Other", short: "AI", Icon: BrainCircuitIcon, markClass: "bg-muted text-muted-foreground" };
  return { label: "OpenAI", short: "GPT", Icon: BrainCircuitIcon, markClass: "bg-background text-foreground" };
}

function ModelBrandMark({
  brand,
  compact = false
}: {
  brand: ModelBrandKey;
  compact?: boolean;
}) {
  const meta = modelBrandMeta(brand);
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-border/70",
        compact ? "size-5 text-[9px] font-semibold" : "size-7 text-[10px] font-semibold",
        meta.markClass
      )}
      aria-hidden="true"
    >
      {compact ? meta.short.slice(0, 2) : <Icon size={14} />}
    </span>
  );
}

function formatTokens(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function markQuestionAnswered(
  sessions: ConstructFlowSession[],
  response: ConstructFlowQuestionResponse
): ConstructFlowSession[] {
  return sessions.map((session) => {
    if (session.id !== response.sessionId) return session;
    return {
      ...session,
      status: session.status === "waiting" ? "completed" : session.status,
      updatedAt: response.answeredAt,
      toolCalls: session.toolCalls.map((toolCall) => (
        toolCall.id === response.toolCallId
          ? { ...toolCall, response }
          : toolCall
      ))
    };
  });
}

function applyFlowActions(
  actions: ConstructFlowAction[],
  focusCode: (action: Extract<ConstructFlowAction, { type: "focus-code" | "open-file" }>) => void,
  runCommand: (command: string, cwd: string) => void,
  workspacePath: string
) {
  for (const action of actions) {
    if (action.type === "focus-code" || action.type === "open-file") {
      focusCode(action);
    }
    if (action.type === "run-terminal-command") {
      runCommand(action.command, action.cwd ?? workspacePath);
    }
  }
}

function firstFilePath(nodes: WorkspaceTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const nested = firstFilePath(node.children ?? []);
    if (nested) return nested;
  }
  return null;
}

function getShortModelName(name: string): string {
  if (!name) return "";
  let cleanName = name;
  const parts = name.split(":");
  if (parts.length > 1) {
    cleanName = parts[1].trim();
  }
  cleanName = cleanName
    .replace(/^gpt-/i, "")
    .replace(/^gemini-/i, "")
    .replace(/^claude-/i, "")
    .replace(/^deepseek-/i, "")
    .replace(/^qwen-/i, "")
    .replace(/^llama-/i, "")
    .replace(/^mistral-/i, "");

  return cleanName;
}

function FlowCircularContextMeter({ contextWindow }: { contextWindow?: ConstructAgentContextWindow }) {
  const usedTokens = contextWindow?.usedTokens ?? ((contextWindow?.inputTokens ?? 0) + (contextWindow?.outputTokens ?? 0));
  const maxTokens = contextWindow?.maxTokens;
  const percent = usedTokens && maxTokens
    ? Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)))
    : null;

  const radius = 6.2;
  const strokeWidth = 2.0;
  const circumference = 2 * Math.PI * radius;
  const displayPercent = percent ?? 0;
  const strokeDashoffset = circumference - (displayPercent / 100) * circumference;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted cursor-help">
          <svg className="size-[14px] -rotate-90 origin-center" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              r={radius}
              className="stroke-muted-foreground/15 fill-none"
              strokeWidth={strokeWidth}
            />
            <circle
              cx="8"
              cy="8"
              r={radius}
              className="stroke-muted-foreground fill-none transition-[stroke-dashoffset] duration-300"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={5} className="flex min-w-[15rem] flex-col items-stretch gap-1.5 rounded-[10px] px-4 py-3 text-left z-50">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Context Window</span>
        <strong className="text-sm font-semibold">{percent == null ? "Unknown" : `${percent}% full`}</strong>
        <span className="text-xs text-muted-foreground">{formatTokens(usedTokens)} / {maxTokens ? formatTokens(maxTokens) : "unknown"} tokens</span>
        <span className="grid gap-0.5 text-[11px] text-muted-foreground">
          <span className="flex justify-between gap-4"><span>System prompt</span><span>{formatTokens(contextWindow?.systemPromptTokens ?? 0)}</span></span>
          <span className="flex justify-between gap-4"><span>Flow state</span><span>{formatTokens(contextWindow?.flowStateTokens ?? 0)}</span></span>
          <span className="flex justify-between gap-4"><span>Chat messages</span><span>{formatTokens(contextWindow?.chatTokens ?? 0)}</span></span>
          <span className="flex justify-between gap-4"><span>Visible trace</span><span>{formatTokens(contextWindow?.visibleTranscriptTokens ?? 0)}</span></span>
          <span className="flex justify-between gap-4"><span>Model messages</span><span>{contextWindow?.messageCount ?? 0}</span></span>
          <span className="flex justify-between gap-4"><span>Visible events</span><span>{contextWindow?.visibleTranscriptEventCount ?? 0}</span></span>
          {contextWindow?.compactedSummaryTokens ? (
            <span className="flex justify-between gap-4"><span>Compacted summary</span><span>{formatTokens(contextWindow.compactedSummaryTokens)}</span></span>
          ) : null}
        </span>
        {contextWindow?.compaction ? (
          <span className="rounded-[7px] border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
            Compaction {contextWindow.compaction.status}
            {typeof contextWindow.compaction.summarizedMessageCount === "number" ? ` · ${contextWindow.compaction.summarizedMessageCount} summarized` : ""}
            {typeof contextWindow.compaction.preservedMessageCount === "number" ? ` · ${contextWindow.compaction.preservedMessageCount} preserved` : ""}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function FlowComposerRightControls({
  contextWindow,
  settings,
  model,
  models,
  modelsBusy,
  modelsError,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange
}: {
  contextWindow?: ConstructAgentContextWindow;
  settings: AiSettings | null;
  model: string;
  models: ModelCatalogEntry[];
  modelsBusy: boolean;
  modelsError: string | null;
  reasoningEffort: AiSettings["reasoningEffort"];
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: AiSettings["reasoningEffort"]) => void;
}) {
  const activeModel = models.find((m) => m.id === model) ?? null;
  const provider = settings?.provider ?? "openai";
  const activeBrand = modelBrandFor(activeModel, provider);
  const buckets = useMemo(() => bucketModelsByBrand(models, provider), [models, provider]);
  const visibleBrandKeys = useMemo(() => sortModelBrands([...buckets.keys()]), [buckets]);

  const shortModel = getShortModelName(activeModel?.name || readableModelName(model) || "Model");
  const activeEffort = reasoningEffortMeta(reasoningEffort);
  const shortEffort = activeEffort.value === "auto" ? "Extra High" : activeEffort.value === "none" ? "Off" : activeEffort.label;
  const triggerLabel = `${shortModel} ${shortEffort}`;

  return (
    <div className="flex items-center gap-1.5">
      <FlowCircularContextMeter contextWindow={contextWindow} />

      {settings ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                type="button"
                disabled={modelsBusy}
              >
                <CpuIcon size={15.5} className="shrink-0" />
                <span className="composer-trigger-text truncate max-w-[12rem]">{triggerLabel}</span>
                <ChevronDownIcon size={13.5} className="text-muted-foreground/70 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1 z-50">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reasoning</DropdownMenuLabel>
              {reasoningEffortOptions.map((option) => {
                const displayLabel = option.value === "auto" ? "Extra High" : option.label;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    className="flex items-center justify-between gap-2 rounded-[7px] text-xs"
                    onClick={() => onReasoningEffortChange(option.value)}
                  >
                    <span>{displayLabel}</span>
                    {option.value === reasoningEffort ? <CheckIcon size={13} className="text-foreground shrink-0" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Model</DropdownMenuLabel>
              {visibleBrandKeys.map((brand) => {
                const meta = modelBrandMeta(brand);
                const brandModels = buckets.get(brand) ?? [];

                return (
                  <DropdownMenuSub key={brand}>
                    <DropdownMenuSubTrigger className="flex items-center justify-between gap-2 rounded-[7px] text-xs">
                      <span>{meta.label}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="w-64 max-h-[220px] overflow-y-auto p-1 z-50">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sticky top-0 bg-popover z-10">
                            {meta.label} Models
                          </DropdownMenuLabel>
                          {brandModels.map((m) => (
                            <DropdownMenuItem
                              key={m.id}
                              className="flex items-center justify-between gap-2 rounded-[7px] text-xs"
                              onClick={() => onModelChange(m.id)}
                            >
                              <span className="truncate">{m.name || readableModelName(m.id)}</span>
                              {m.id === m.id ? null : null /* dummy to keep structure */}
                              {m.id === model ? <CheckIcon size={13} className="text-foreground shrink-0" /> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted/45 px-2 text-[11px] text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          Model
        </span>
      )}



      {modelsError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-destructive ring-1 ring-destructive/30">!</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[18rem] text-left z-50">{modelsError}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ActiveComposerItemIndicator({
  activeItem,
  isHeader = false,
  pending = false,
  onSubmitTask
}: {
  activeItem?: {
    type: "exercise" | "task";
    id: string;
    title: string;
    prompt: string;
    domId: string;
    item: ConstructFlowConceptExercise | ConstructFlowPracticeTask;
  };
  isHeader?: boolean;
  pending?: boolean;
  onSubmitTask?: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!activeItem) return null;

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsPopoverOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsPopoverOpen(false);
    }, 150);
  };

  const handlePillClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeItem.domId) return;
    const element = document.getElementById(activeItem.domId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      element.classList.add("highlight-flash");
      setTimeout(() => {
        element.classList.remove("highlight-flash");
      }, 4000);
    }, 450);
  };

  const isExercise = activeItem.type === "exercise";
  const task = activeItem.type === "task" ? activeItem.item as ConstructFlowPracticeTask : undefined;
  const active = task ? activeSubtask(task) : undefined;
  const activeSubtaskIndex = task?.subtasks?.findIndex((subtask) => subtask.id === active?.id) ?? -1;
  const subtaskCount = Math.max(task?.subtasks?.length ?? 1, 1);
  const subtaskNumber = activeSubtaskIndex >= 0 ? activeSubtaskIndex + 1 : 1;
  const subtaskStatus = active?.status;
  const canSubmitSubtask = Boolean(
    task &&
    onSubmitTask &&
    !pending &&
    !submitting &&
    task.status === "waiting" &&
    (!subtaskStatus || subtaskStatus === "active" || subtaskStatus === "needs-work" || subtaskStatus === "ready")
  );
  const subtaskActionLabel = submitting || pending
    ? "Reviewing"
    : task?.status === "completed" || subtaskStatus === "completed"
      ? "Done"
      : task?.status === "submitted" || subtaskStatus === "submitted"
        ? "Submitted"
        : "Submit";

  const handleSubmitSubtask = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!task || !onSubmitTask || !canSubmitSubtask) return;
    setIsPopoverOpen(false);
    setSubmitting(true);
    void onSubmitTask(task, undefined, active?.id)
      .catch((error) => {
        console.error("Failed to submit Flow subtask", error);
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const pulseDot = (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
    </span>
  );

  const subtaskSubmitPill = task ? (
    <button
      type="button"
      className={cn(
        "ml-auto inline-flex h-5 shrink-0 items-center gap-1 overflow-hidden rounded-full px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        !canSubmitSubtask && "cursor-default opacity-60 hover:bg-transparent hover:text-muted-foreground",
        isHeader ? "max-w-[10rem]" : "max-w-[9rem]"
      )}
      aria-label={`Submit subtask ${subtaskNumber} of ${subtaskCount} for Flow review`}
      title={`Subtask ${subtaskNumber} of ${subtaskCount}: ${active?.title ?? task.title}`}
      disabled={!canSubmitSubtask}
      onClick={handleSubmitSubtask}
    >
      <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-muted/55 px-1 font-mono text-[10px] text-muted-foreground">
        {subtaskNumber}/{subtaskCount}
      </span>
      <span className="min-w-0 truncate">{subtaskActionLabel}</span>
      {submitting || pending ? (
        <Loader2Icon size={10} className="shrink-0 animate-spin" />
      ) : (
        <SendIcon size={10} className="shrink-0" />
      )}
    </button>
  ) : null;

  const popoverContent = (
    <PopoverContent
      align="start"
      side="top"
      sideOffset={isHeader ? 4 : 6}
      className="z-50 flex w-80 flex-col gap-2.5 rounded-xl border border-border bg-card p-3 shadow-md"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex items-center justify-between border-b pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
          {isExercise ? "Concept Exercise" : "Project Task"}
        </span>
        <span className={cn(
          "rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
          isExercise
            ? "border-border bg-muted/40 text-muted-foreground/80"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        )}>
          {isExercise ? "Waiting for response" : "In Progress"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-bold leading-snug text-foreground">
          {activeItem.title}
        </h4>
        {activeItem.prompt ? (
          <div className="max-h-24 overflow-y-auto pr-1 text-[11px] leading-relaxed text-muted-foreground select-text">
            <MarkdownBlock content={activeItem.prompt} theme="system" onOpenFile={() => {}} />
          </div>
        ) : null}
      </div>

      {task?.subtasks?.length ? (
        <div className="flex flex-col gap-1 border-t pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">Subtasks</span>
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">
            {task.subtasks.map((subtask) => {
              const isCompleted = subtask.status === "completed";
              const isNeedsWork = subtask.status === "needs-work";
              const isActive = subtask.status === "active" || subtask.status === "submitted";

              let subtaskIcon = <CircleIcon size={11} className="shrink-0 text-muted-foreground/50" />;
              let subtaskColor = "text-muted-foreground/75";

              if (isCompleted) {
                subtaskIcon = <CheckCircle2Icon size={11} className="shrink-0 text-emerald-500/70" />;
                subtaskColor = "text-muted-foreground line-through opacity-80";
              } else if (isNeedsWork) {
                subtaskIcon = <CircleAlertIcon size={11} className="shrink-0 text-amber-500/70" />;
                subtaskColor = "text-muted-foreground/80";
              } else if (isActive) {
                subtaskIcon = (
                  <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80 opacity-75"></span>
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500/80"></span>
                  </span>
                );
                subtaskColor = "text-foreground/90 font-medium";
              }

              return (
                <div key={subtask.id} className="flex items-start gap-2 text-[11px]">
                  <div className="mt-0.5">{subtaskIcon}</div>
                  <span className={cn("truncate leading-relaxed", subtaskColor)} title={subtask.title}>
                    {subtask.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t pt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CornerDownLeftIcon size={10} />
          <span>Click to scroll to source</span>
        </span>
      </div>
    </PopoverContent>
  );

  if (isHeader) {
    return (
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <div
          className="flex w-full items-center gap-2 pb-0 pl-1.5 pr-5 pt-0.5 text-xs text-muted-foreground"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={handlePillClick}
              className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground focus-visible:outline-none"
            >
              {pulseDot}
              <span className="truncate font-medium text-foreground/80">{activeItem.title}</span>
            </button>
          </PopoverTrigger>
          {subtaskSubmitPill}
        </div>
        {popoverContent}
      </Popover>
    );
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <div
        className="flex min-w-0 items-center gap-1.5"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePillClick}
            className="h-7 min-w-0 gap-1.5 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            type="button"
          >
            {pulseDot}
            <span className="truncate">{activeItem.title}</span>
          </Button>
        </PopoverTrigger>
        {subtaskSubmitPill}
      </div>
      {popoverContent}
    </Popover>
  );
}
