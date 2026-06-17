import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckCircle2Icon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleIcon, Code2Icon, FileTextIcon, GaugeIcon, GitCompareIcon, HelpCircleIcon, ListChecksIcon, Loader2Icon, PencilIcon, PlusCircleIcon, RotateCcwIcon, SendIcon, SparklesIcon, Trash2Icon } from "lucide-react";
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

import type { ConstructAgentContextWindow, ConstructConceptLanguage } from "../../../shared/constructLearning";
import type {
  ConstructFlowAction,
  ConstructFlowPathNode,
  ConstructFlowMemoryPatchResult,
  ConstructFlowPracticeSubtask,
  ConstructFlowPracticeTask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowToolCallRecord
} from "../../../shared/constructFlow";
import type { AiSettings, ConceptCard, FlowProjectRecord, ModelCatalogEntry, WorkspaceTreeNode } from "../types";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  getSettings,
  listFiles,
  listModels,
  onConstructFlowSessionEvent,
  readFile,
  renameFile,
  runConstructFlowAgent,
  runConstructFlowResearch,
  submitFlowTask,
  updateAiSettings,
  updateProject,
  writeFile
} from "../lib/bridge";
import { EditorPane } from "./EditorPane";
import { MarkdownBlock } from "./MarkdownBlock";
import { KnowledgeCard } from "./KnowledgeCard";
import { ConceptSummaryCard } from "./ConceptSummaryCard";
import { iconForFile } from "./workspace/FileChooserContent";
import { ProviderModelPicker } from "./settings/ProviderModelPicker";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import {
  activateDocument,
  closeDocument,
  createDocumentSession,
  normalizeDocumentPath
} from "../lib/documentSession";

export function FlowWorkspace({
  project,
  theme,
  onGuidePanelChange,
  onKnowledgePanelChange,
  onProjectChange,
  onRunCommand,
  onFileOpened,
  onTreeChange,
  onSavingChange
}: {
  project: FlowProjectRecord;
  theme: "light" | "dark" | "system";
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onKnowledgePanelChange?: (panel: ReactNode | null) => void;
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
    duplicateFileFn: (path: string, destPath: string) => Promise<void>
  ) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [documentSession, setDocumentSession] = useState(() => createDocumentSession(project.activeFilePath));
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({});
  const [focusRange, setFocusRange] = useState<{ line: number; endLine?: number } | null>(null);
  const [sessions, setSessions] = useState<ConstructFlowSession[]>(project.flow.sessions ?? []);
  const [liveSession, setLiveSession] = useState<ConstructFlowSession | undefined>();
  const [pending, setPending] = useState(false);
  const [openConcept, setOpenConcept] = useState<ConceptCard | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activePath = documentSession.activePath;
  const content = activePath ? fileContents[activePath] ?? "" : "";
  const dirty = activePath ? dirtyPaths[activePath] === true : false;

  const refreshTree = useCallback(async () => {
    const next = await listFiles(project.id);
    setTree(next);
    return next;
  }, [project.id]);

  useEffect(() => {
    setDocumentSession(createDocumentSession(project.activeFilePath));
    setFileContents({});
    setDirtyPaths({});
    setFocusRange(null);
    setSessions(project.flow.sessions ?? []);
    setLiveSession(undefined);
    setOpenConcept(null);
  }, [project.id]);

  const openFile = useCallback(async (path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    if (!normalizedPath) return;

    if (!dirtyPaths[normalizedPath]) {
      const file = await readFile({ projectId: project.id, path: normalizedPath });
      setFileContents((current) => ({ ...current, [normalizedPath]: file.content }));
      setDirtyPaths((current) => ({ ...current, [normalizedPath]: false }));
    }

    setDocumentSession((session) => activateDocument(session, normalizedPath));
    setFocusRange(null);
    onFileOpened(normalizedPath);
    const updated = await updateProject({ id: project.id, patch: { activeFilePath: normalizedPath } });
    if (updated.kind === "flow") {
      onProjectChange(updated);
    }
  }, [dirtyPaths, onFileOpened, onProjectChange, project.id]);

  const saveFile = useCallback(async () => {
    if (!activePath) return;
    onSavingChange(true);
    try {
      await writeFile({ projectId: project.id, path: activePath, content: fileContents[activePath] ?? "" });
      setDirtyPaths((current) => ({ ...current, [activePath]: false }));
      await refreshTree();
    } finally {
      onSavingChange(false);
    }
  }, [activePath, fileContents, onSavingChange, project.id, refreshTree]);

  const createFile = useCallback((path: string) => {
    void writeFile({ projectId: project.id, path, content: "" })
      .then(() => refreshTree())
      .then(() => openFile(path));
  }, [openFile, project.id, refreshTree]);

  const deleteFileFn = useCallback(async (path: string) => {
    const normalizedPath = normalizeDocumentPath(path);
    await deleteFile({ projectId: project.id, path: normalizedPath });
    setDocumentSession((session) => closeDocument(session, normalizedPath));
    setFileContents((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      return next;
    });
    setDirtyPaths((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      return next;
    });
    await refreshTree();
  }, [project.id, refreshTree]);

  const renameFileFn = useCallback(async (oldPath: string, newPath: string) => {
    const normalizedOldPath = normalizeDocumentPath(oldPath);
    const normalizedNewPath = normalizeDocumentPath(newPath);
    await renameFile({ projectId: project.id, oldPath: normalizedOldPath, newPath: normalizedNewPath });
    setDocumentSession((session) => ({
      ...session,
      activePath: session.activePath === normalizedOldPath ? normalizedNewPath : session.activePath,
      tabs: session.tabs.map((tab) => tab === normalizedOldPath ? normalizedNewPath : tab),
    }));
    setFileContents((current) => {
      if (!(normalizedOldPath in current)) return current;
      const next = { ...current, [normalizedNewPath]: current[normalizedOldPath] };
      delete next[normalizedOldPath];
      return next;
    });
    setDirtyPaths((current) => {
      if (!(normalizedOldPath in current)) return current;
      const next = { ...current, [normalizedNewPath]: current[normalizedOldPath] };
      delete next[normalizedOldPath];
      return next;
    });
    await refreshTree();
  }, [project.id, refreshTree]);

  const createFolderFn = useCallback(async (path: string) => {
    await createFolder({ projectId: project.id, path });
    await refreshTree();
  }, [project.id, refreshTree]);

  const duplicateFileFn = useCallback(async (path: string, destPath: string) => {
    await duplicateFile({ projectId: project.id, path, destPath });
    await refreshTree();
  }, [project.id, refreshTree]);

  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  const focusCode = useCallback((action: Extract<ConstructFlowAction, { type: "focus-code" | "open-file" }>) => {
    void openFile(action.path).then(() => {
      if (action.type === "focus-code" && action.line) {
        setFocusRange({ line: action.line, endLine: action.endLine });
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

  useEffect(() => {
    void refreshTree().then((nextTree) => {
      const initialPath = project.activeFilePath ?? firstFilePath(nextTree);
      if (initialPath) {
        void openFileRef.current(initialPath);
      }
    });
  }, [project.activeFilePath, refreshTree]);

  useEffect(() => {
    onTreeChange(tree, activePath, null, openFile, createFile, deleteFileFn, renameFileFn, createFolderFn, duplicateFileFn);
  }, [activePath, createFile, createFolderFn, deleteFileFn, duplicateFileFn, onTreeChange, openFile, renameFileFn, tree]);

  useEffect(() => {
    const unsubscribe = onConstructFlowSessionEvent((event: ConstructFlowSessionEvent) => {
      if (event.projectId !== project.id) return;
      if (event.type === "completed" || event.type === "error" || event.type === "waiting") {
        setSessions((current) => upsertSession(current, event.session));
        setLiveSession(undefined);
      } else {
        setLiveSession(event.session);
      }
    });
    return unsubscribe;
  }, [project.id]);

  const flowConcepts = useMemo(() => collectFlowConcepts(mergeSessions(sessions, liveSession)), [liveSession, sessions]);
  const openConceptById = useCallback((conceptId: string) => {
    const concept = flowConcepts.find((candidate) => candidate.id === conceptId)
      ?? buildInlineConceptPlaceholder(conceptId);
    setOpenConcept(concept);
  }, [flowConcepts]);

  useEffect(() => {
    onGuidePanelChange(
      <FlowAgentPanel
        project={project}
        sessions={sessions}
        liveSession={liveSession}
        pending={pending}
        theme={theme}
        onRunAgent={runAgent}
        onRunResearch={() => void runConstructFlowResearch({ projectId: project.id })}
        onSubmitTask={submitTask}
        onOpenConceptDetails={(concept) => setOpenConcept(concept)}
        onOpenConceptById={openConceptById}
        onResetChat={() => {
          setSessions([]);
          setLiveSession(undefined);
        }}
      />
    );
    return () => onGuidePanelChange(null);
  }, [liveSession, onGuidePanelChange, openConceptById, pending, project, runAgent, sessions, submitTask, theme, setOpenConcept]);

  useEffect(() => {
    onKnowledgePanelChange?.(null);
    return () => onKnowledgePanelChange?.(null);
  }, [onKnowledgePanelChange]);

  const sidecar = openConcept ? (
    <div className="flex h-full max-h-full min-h-0 w-full flex-col gap-3 overflow-y-auto" aria-label="Open knowledge cards">
      <KnowledgeCard
        key={openConcept.id}
        concept={openConcept}
        saved={false}
        theme={theme}
        onClose={() => setOpenConcept(null)}
        onOpenConcept={openConceptById}
        onOpenFile={() => {}}
        onSaveChange={() => {}}
      />
    </div>
  ) : null;

  const editorSlotTabs: SlotTab[] = useMemo(() => (
    documentSession.tabs.map((tabPath) => {
      const filename = tabPath.split("/").pop() || tabPath;
      return {
        id: tabPath,
        title: filename,
        icon: iconForFile(filename),
        closable: true,
        active: tabPath === activePath,
        content: null,
      };
    })
  ), [activePath, documentSession.tabs]);

  const handleTabChange = useCallback((tabId: string) => {
    if (tabId && tabId !== activePath) {
      void openFile(tabId);
    }
  }, [activePath, openFile]);

  const handleTabClose = useCallback((tabId: string) => {
    const normalizedPath = normalizeDocumentPath(tabId);
    setDocumentSession((session) => closeDocument(session, normalizedPath));
    setFileContents((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      return next;
    });
    setDirtyPaths((current) => {
      const next = { ...current };
      delete next[normalizedPath];
      return next;
    });
  }, []);

  const editorOutlet = (
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
          setFileContents((current) => ({ ...current, [activePath]: next }));
          setDirtyPaths((current) => ({ ...current, [activePath]: true }));
        }}
        onGuidedProgress={() => undefined}
        onRevealLine={() => undefined}
        onSave={saveFile}
        theme={theme}
        focusRange={focusRange}
        onOpenFileAndJump={(path, line) => {
          void openFile(path).then(() => setFocusRange({ line }));
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
      open={openConcept !== null}
      pinned={false}
      sidecar={sidecar}
    >
      <SlotPanel
        activeTabId={activePath ?? undefined}
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
  language?: ConstructConceptLanguage;
  technology?: string;
  content?: string;
  examples: string[];
  confidence?: string;
  reason?: string;
  confidenceReason?: string;
  evidence: string[];
  authoredBy?: string;
  agentContributionPercent?: number;
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
  if (!toolName?.includes("concept")) return;
  const payload = readConceptPayload(input, outputPreview);
  if (!payload.id) return;

  if (toolName === "remove-concept") {
    concepts.delete(payload.id);
    return;
  }

  concepts.set(payload.id, buildConceptCardFromInput(payload));
}

function FlowAgentPanel({
  project,
  sessions,
  liveSession,
  pending,
  theme,
  onRunAgent,
  onRunResearch,
  onSubmitTask,
  onOpenConceptDetails,
  onOpenConceptById,
  onResetChat
}: {
  project: FlowProjectRecord;
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  pending: boolean;
  theme: "light" | "dark" | "system";
  onRunAgent: (message: string, options?: FlowAgentRunOptions) => Promise<void>;
  onRunResearch: () => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
  onResetChat: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "project">("chat");
  const mergedSessions = useMemo(() => mergeSessions(sessions, liveSession), [liveSession, sessions]);
  const flowConcepts = useMemo(() => collectFlowConcepts(mergedSessions), [mergedSessions]);
  const conceptMutations = useMemo(() => collectConceptMutations(mergedSessions), [mergedSessions]);
  const flowTasks = useMemo(() => mergedSessions.flatMap((session) => session.practiceTasks), [mergedSessions]);
  const pathNodes = useMemo(() => [...(project.flow.pathNodes ?? [])].sort((a, b) => a.order - b.order), [project.flow.pathNodes]);
  const currentPathNode = useMemo(() => currentFlowPathNode(pathNodes, project.flow.currentPathNodeId), [pathNodes, project.flow.currentPathNodeId]);
  const activeTask = useMemo(() => findActiveTaskForNode(flowTasks, currentPathNode?.id), [currentPathNode?.id, flowTasks]);
  const activeQuestion = useMemo(() => findActiveFlowQuestion(mergedSessions), [mergedSessions]);
  const messages = useMemo(() => buildFlowMessages({
    sessions: mergedSessions,
    conceptMutations,
    theme,
    onOpenConceptDetails,
    onOpenConceptById
  }), [conceptMutations, mergedSessions, theme, onOpenConceptDetails, onOpenConceptById]);
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

  useEffect(() => {
    setDraft("");
  }, [activeQuestion?.id]);

  const submitComposer = useCallback(() => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    void onRunAgent(message, activeTask ? { taskMessage: { taskId: activeTask.id, pathNodeId: activeTask.pathNodeId } } : undefined);
  }, [activeTask, draft, onRunAgent]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border/45 bg-background/95 px-4 py-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">Construct Flow</strong>
          <span className="block truncate text-[11px] text-muted-foreground">{project.flow.goal}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted/45 p-0.5">
          <Button className="rounded-full" size="sm" variant={activeView === "chat" ? "secondary" : "ghost"} onClick={() => setActiveView("chat")}>Chat</Button>
          <Button className="rounded-full" size="sm" variant={activeView === "project" ? "secondary" : "ghost"} onClick={() => setActiveView("project")}><ListChecksIcon size={14} />Project</Button>
          <Button className="rounded-full" size="sm" variant="ghost" onClick={onRunResearch}><SparklesIcon size={14} />Research</Button>
          <Button className="rounded-full" size="sm" variant="ghost" title="Reset visible Flow chat for debugging" onClick={onResetChat}><RotateCcwIcon size={14} /></Button>
        </div>
      </div>
      {activeView === "project" ? (
        <FlowProjectDataPanel
          project={project}
          pathNodes={pathNodes}
          currentPathNode={currentPathNode}
          tasks={flowTasks}
          concepts={flowConcepts}
          theme={theme}
          onOpenConcept={onOpenConceptDetails}
          onSubmitTask={onSubmitTask}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTask ? (
            <FloatingFlowTaskCard
              task={activeTask}
              node={currentPathNode}
              theme={theme}
              pending={pending}
              onSubmitTask={onSubmitTask}
            />
          ) : null}
          <AgentSessionSurface
            className="min-h-0 flex-1 bg-transparent"
            messages={messages}
            emptyState={<div className="flex flex-col items-center gap-2 text-center"><BotIcon size={18} /><span>Ask Flow what to build or learn next.</span></div>}
            scrollKey={`${messages.length}:${liveSession?.updatedAt ?? "idle"}`}
            composer={
              activeQuestion ? (
                <FlowQuestionComposer
                  key={activeQuestion.id}
                  question={activeQuestion}
                  theme={theme}
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
                  pending={pending}
                />
              ) : (
                <AgentSessionComposer
                  value={draft}
                  onValueChange={setDraft}
                  onSubmit={submitComposer}
                  pending={pending}
                  submitLabel="Send"
                  placeholder={activeTask ? `Message Flow about: ${activeTask.title}` : "Ask Flow, describe what you tried, or paste an error..."}
                  footerStart={
                    <FlowComposerControls
                      contextWindow={latestContextWindow}
                      settings={aiSettings}
                      model={activeFlowModel}
                      models={flowModelOptions}
                      modelsBusy={modelsBusy}
                      modelsError={modelsError}
                      onModelChange={updateFlowModel}
                      onRefreshModels={() => void refreshModels()}
                    />
                  }
                />
              )
            }
          />
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
  onModelChange,
  onRefreshModels
}: {
  contextWindow?: ConstructAgentContextWindow;
  settings: AiSettings | null;
  model: string;
  models: ModelCatalogEntry[];
  modelsBusy: boolean;
  modelsError: string | null;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <FlowContextMeter contextWindow={contextWindow} />
      {settings ? (
        <div className="flex min-w-0 items-center gap-1">
          {modelsBusy ? <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
          <ProviderModelPicker
            provider={settings.provider}
            value={model}
            models={models}
            disabled={modelsBusy}
            placeholder="Select model"
            triggerTitle="Select model"
            onChange={onModelChange}
          />
          <Button
            className="h-7 rounded-full px-2"
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
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted/45 px-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Model
        </span>
      )}
    </div>
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
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted/45 px-2 text-xs text-muted-foreground ring-1 ring-border/25"
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
        {contextWindow?.modelId ? <span className="max-w-full truncate text-muted-foreground">{contextWindow.modelId}</span> : null}
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
  concepts,
  theme,
  onOpenConcept,
  onSubmitTask
}: {
  project: FlowProjectRecord;
  pathNodes: ConstructFlowPathNode[];
  currentPathNode?: ConstructFlowPathNode;
  tasks: ConstructFlowPracticeTask[];
  concepts: ConceptCard[];
  theme: "light" | "dark" | "system";
  onOpenConcept: (concept: ConceptCard) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
}) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const currentNodeTasks = currentPathNode
    ? tasks.filter((task) => task.pathNodeId === currentPathNode.id)
    : tasks;
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
  const currentConcepts = currentPathNode?.concepts?.length
    ? currentPathNode.concepts.map((conceptId) => conceptsById.get(conceptId) ?? buildInlineConceptPlaceholder(conceptId))
    : concepts;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <FlowMetric label="Tasks" value={String(tasks.length)} />
          <FlowMetric label="Done" value={String(completedTasks)} />
          <FlowMetric label="Path" value={pathNodes.length ? `${pathNodes.filter((node) => node.status === "completed").length}/${pathNodes.length}` : "0"} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecksIcon size={15} />
            <span>Path</span>
          </div>
          {pathNodes.length ? (
            <FlowPathTimeline nodes={pathNodes} currentNodeId={currentPathNode?.id ?? project.flow.currentPathNodeId ?? undefined} />
          ) : (
            <div className="rounded-[8px] border border-dashed p-4 text-center text-xs text-muted-foreground">
              Flow will build the learning path after learner profiling.
            </div>
          )}
        </div>

        {currentPathNode ? (
          <div className="rounded-[8px] border bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Current node</p>
                <h3 className="truncate text-sm font-semibold">{currentPathNode.title}</h3>
              </div>
              <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{pathNodeStatusLabel(currentPathNode.status)}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{currentPathNode.summary}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecksIcon size={15} />
            <span>Tasks in this node</span>
          </div>
          {currentNodeTasks.length ? (
            <div className="flex flex-col gap-2">
              {currentNodeTasks.map((task) => (
                <FlowTaskCard key={task.id} task={task} theme={theme} onSubmitTask={onSubmitTask} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed p-4 text-center text-xs text-muted-foreground">
              Tasks for the active node will appear here.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BookOpenIcon size={15} />
            <span>Concept history in this node</span>
          </div>
          {currentConcepts.length ? (
            <div className="grid gap-2">
              {currentConcepts.map((concept) => (
                <ConceptSummaryCard key={concept.id} concept={concept} compact onOpen={() => onOpenConcept(concept)} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed p-4 text-center text-xs text-muted-foreground">
              Concepts touched by this path node will appear here.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileTextIcon size={15} />
            <span>Project memory</span>
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground">
            {["research.md", "project.md", "path.md", "learner.md"].map((file) => (
              <div key={file} className="rounded-[7px] border bg-background/60 px-2 py-1.5 font-mono">{file}</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function FlowMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border bg-muted/20 p-2">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <strong className="text-lg">{value}</strong>
    </div>
  );
}

function FlowPathTimeline({
  nodes,
  currentNodeId
}: {
  nodes: ConstructFlowPathNode[];
  currentNodeId?: string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-[8px] border bg-background/60 p-3">
      <div className="flex min-w-max items-stretch gap-2">
        {nodes.map((node, index) => (
          <div key={node.id} className="flex items-center gap-2">
            <div
              className={[
                "flex w-48 shrink-0 flex-col gap-2 rounded-[8px] border p-3 text-left transition-[opacity,border-color,background-color]",
                node.id === currentNodeId ? "bg-card text-foreground shadow-sm ring-1 ring-border/70" : "bg-muted/20 text-muted-foreground",
                node.status === "completed" ? "border-[color:var(--construct-success)] bg-[color:var(--construct-success-soft)] text-foreground" : "",
                node.status === "planned" ? "opacity-[0.58]" : ""
              ].filter(Boolean).join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <PathNodeIcon status={node.status} />
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/60">
                  {index + 1}
                </span>
              </div>
              <strong className="line-clamp-2 text-xs font-semibold">{node.title}</strong>
              <span className="line-clamp-2 text-[11px] leading-4">{node.summary}</span>
            </div>
            {index < nodes.length - 1 ? <ChevronRightIcon className="shrink-0 text-muted-foreground" size={16} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PathNodeIcon({ status }: { status: ConstructFlowPathNode["status"] }) {
  if (status === "completed") return <CheckCircle2Icon size={16} className="text-[color:var(--construct-success)]" />;
  if (status === "blocked") return <HelpCircleIcon size={16} className="text-destructive" />;
  if (status === "revising") return <PencilIcon size={16} className="text-[color:var(--construct-warning)]" />;
  if (status === "active") return <SparklesIcon size={16} className="text-foreground" />;
  return <CircleIcon size={16} className="text-muted-foreground" />;
}

function FloatingFlowTaskCard({
  task,
  node,
  theme,
  pending,
  onSubmitTask
}: {
  task: ConstructFlowPracticeTask;
  node?: ConstructFlowPathNode;
  theme: "light" | "dark" | "system";
  pending: boolean;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const active = activeSubtask(task);
  const completedSubtasks = task.subtasks?.filter((subtask) => subtask.status === "completed").length ?? 0;
  const subtaskCount = task.subtasks?.length ?? 1;

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex justify-center">
      <div
        className="construct-floating-task-card pointer-events-auto w-full max-w-[58rem] rounded-[16px] border bg-card/88 text-xs shadow-lg ring-1 ring-border/45 backdrop-blur-xl"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase text-muted-foreground">{node?.title ?? "Current task"}</span>
            <strong className="mt-0.5 block truncate text-sm">{task.title}</strong>
            <span className="block truncate text-muted-foreground">{taskStatusLabel(task.status)}</span>
          </div>
          <span className="ml-auto shrink-0 rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {completedSubtasks}/{subtaskCount}
          </span>
          <ChevronDownIcon
            size={14}
            className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div className={`construct-floating-task-card__details ${open ? "is-open" : ""}`}>
          <div className="flex flex-col gap-2 px-3 pb-3">
          <MarkdownBlock content={active?.prompt || task.prompt} theme={theme} />
          {task.successCriteria?.length ? (
            <div className="rounded-[8px] bg-muted/30 p-2">
              <span className="mb-1 block font-medium">Success criteria</span>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {task.successCriteria.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
              </ul>
            </div>
          ) : null}
          {task.taskFiles?.length ? (
            <div className="flex flex-wrap gap-1">
              {task.taskFiles.map((file) => (
                <span key={file} className="rounded-[6px] border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{file}</span>
              ))}
            </div>
          ) : null}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {active?.title ?? task.title}
              </span>
              <Button size="sm" onClick={() => void onSubmitTask(task, undefined, active?.id)} disabled={pending}>
                <SendIcon size={14} />
                Submit
              </Button>
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
  onSubmitTask,
  compact = false
}: {
  task: ConstructFlowPracticeTask;
  theme: "light" | "dark" | "system";
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
  compact?: boolean;
}) {
  const [note, setNote] = useState("");
  const active = activeSubtask(task);
  const canSubmit = task.status === "waiting" || task.status === "submitted";
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[8px] border bg-muted/20 p-3 text-xs shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-sm">{task.title}</strong>
          <span className="text-muted-foreground">{taskStatusLabel(task.status)}</span>
        </div>
        <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {task.subtasks?.length ?? 1} subtask{(task.subtasks?.length ?? 1) === 1 ? "" : "s"}
        </span>
      </div>
      <MarkdownBlock content={active?.prompt || task.prompt} theme={theme} />
      {task.focus ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Code2Icon size={13} />
          {task.focus.path}{task.focus.line ? `:${task.focus.line}` : ""}
        </span>
      ) : null}
      {task.conceptIds?.length ? (
        <div className="flex flex-wrap gap-1">
          {task.conceptIds.map((conceptId) => (
            <span key={conceptId} className="rounded-full border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{conceptId}</span>
          ))}
        </div>
      ) : null}
      {task.successCriteria?.length ? (
        <div className="rounded-[7px] border bg-background/60 p-2">
          <span className="mb-1 block font-semibold">Success criteria</span>
          <ul className="space-y-1 text-muted-foreground">
            {task.successCriteria.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
          </ul>
        </div>
      ) : null}
      {task.subtasks?.length && !compact ? (
        <div className="space-y-1">
          {task.subtasks.map((subtask, index) => (
            <div key={subtask.id} className="flex items-center gap-2 rounded-[7px] border bg-background/60 px-2 py-1.5">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-muted text-[10px] font-semibold">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
              <span className="text-[10px] text-muted-foreground">{subtask.status}</span>
            </div>
          ))}
        </div>
      ) : null}
      {task.taskFiles?.length && !compact ? (
        <div className="flex flex-wrap gap-1">
          {task.taskFiles.map((file) => (
            <span key={file} className="rounded-[6px] border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{file}</span>
          ))}
        </div>
      ) : null}
      {task.preparedFiles?.length && !compact ? (
        <div className="rounded-[7px] border bg-background/60 p-2 text-muted-foreground">
          <span className="mb-1 block font-semibold text-foreground">Prepared by Flow</span>
          {task.preparedFiles.map((file) => <div key={file.path} className="font-mono text-[10px]">{file.mode}: {file.path}</div>)}
        </div>
      ) : null}
      {canSubmit ? (
        <div className="flex flex-col gap-2">
          {!compact ? (
            <textarea
              className="min-h-16 resize-y rounded-[8px] border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={note}
              placeholder="Optional note for Flow before submitting..."
              onChange={(event) => setNote(event.target.value)}
            />
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void onSubmitTask(task, note.trim() || undefined, active?.id)}>
              <SendIcon size={14} />
              Submit {active ? "subtask" : "task"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function taskStatusLabel(status: ConstructFlowPracticeTask["status"]): string {
  if (status === "completed") return "Done";
  if (status === "submitted") return "Submitted for review";
  if (status === "cancelled") return "Cancelled";
  return "Waiting for learner work";
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
  return task.subtasks?.find((subtask) => subtask.status === "active" || subtask.status === "submitted")
    ?? task.subtasks?.find((subtask) => subtask.status !== "completed")
    ?? task.subtasks?.[0];
}

function buildFlowMessages({
  sessions,
  conceptMutations,
  theme,
  onOpenConceptDetails,
  onOpenConceptById
}: {
  sessions: ConstructFlowSession[];
  conceptMutations: ConceptMutation[];
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
}): AgentSessionMessage[] {
  return sessions.flatMap((session): AgentSessionMessage[] => {
    const user = session.messages.find((message) => message.role === "user");
    const assistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    const parts = buildFlowAgentParts({
      session,
      assistantContent: assistant?.content,
      conceptMutations,
      theme,
      onOpenConceptDetails,
      onOpenConceptById
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

    return [
      { id: `${session.id}:user`, role: "user", content: userContent },
      assistantMessage
    ];
  });
}

function buildFlowAgentParts({
  session,
  assistantContent,
  conceptMutations,
  theme,
  onOpenConceptDetails,
  onOpenConceptById
}: {
  session: ConstructFlowSession;
  assistantContent?: string;
  conceptMutations: ConceptMutation[];
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
  onOpenConceptById: (conceptId: string) => void;
}): AgentSessionMessagePart[] {
  const parts: AgentSessionMessagePart[] = [];
  const seenToolIds = new Set<string>();
  const seenToolNames = new Map<string, number>();
  let hasMessageEvent = false;
  const fallbackText = splitProcessNarration(assistantContent);
  const fallbackReasoning = !session.agentEvents.some((event) => event.type === "message")
    ? splitReasoningSegments(fallbackText.process)
    : [];
  let fallbackReasoningIndex = 0;
  const pushFallbackReasoning = () => {
    const text = fallbackReasoning[fallbackReasoningIndex++];
    if (!text) return;
    parts.push(buildFallbackReasoningPart(session.id, fallbackReasoningIndex, text));
  };

  for (const event of session.agentEvents) {
    if (event.type === "iteration") continue;
    if (event.type === "message") {
      if (!event.text?.trim()) continue;
      hasMessageEvent = true;
      parts.push({
        type: "text",
        id: `${session.id}:message:${event.id}`,
        content: <MarkdownBlock content={event.text} theme={theme} onOpenConcept={onOpenConceptById} />
      });
      continue;
    }
    if (event.type === "reasoning" && event.status === "completed" && !event.text?.trim()) {
      continue;
    }

    const toolName = event.toolName ?? event.title;
    const isConcept = toolName?.includes("concept");
    const isMemoryPatch = toolName === "flow-memory-patch" || toolName === "flow-memory-update";
    if (event.type === "tool" && isQuestionTool(toolName)) {
      continue;
    }

    if (isConcept && event.type === "tool") {
      seenToolIds.add(event.id);
      seenToolNames.set(toolName, (seenToolNames.get(toolName) ?? 0) + 1);
      parts.push(buildConceptCardPart(session.id, event.id, toolName, event.input, event.outputPreview, event.status, theme, conceptMutations, onOpenConceptDetails));
      pushFallbackReasoning();
      continue;
    }

    if (isMemoryPatch && event.type === "tool") {
      seenToolIds.add(event.id);
      seenToolNames.set(toolName, (seenToolNames.get(toolName) ?? 0) + 1);
      parts.push(buildMemoryUpdatedPart(session.id, event.id, event.input, event.outputPreview));
      pushFallbackReasoning();
      continue;
    }

    const entry = flowEventToTraceEntry(event);
    parts.push({
      type: "activity",
      id: `${session.id}:activity:${event.id}`,
      entry,
      defaultOpen: event.status === "running"
    });

    if (event.type === "tool") {
      seenToolIds.add(event.id);
      const toolName = event.toolName ?? event.title;
      seenToolNames.set(toolName, (seenToolNames.get(toolName) ?? 0) + 1);
      pushFallbackReasoning();
    }
  }

  for (const toolCall of session.toolCalls) {
    if (seenToolIds.has(toolCall.id)) continue;
    const seenCount = seenToolNames.get(toolCall.name) ?? 0;
    if (seenCount > 0) {
      seenToolNames.set(toolCall.name, seenCount - 1);
      continue;
    }

    const isConcept = toolCall.name.includes("concept");
    const isMemoryPatch = toolCall.name === "flow-memory-patch" || toolCall.name === "flow-memory-update";
    if (isQuestionTool(toolCall.name)) {
      if (toolCall.response) {
        parts.push(buildQuestionAnsweredPart(session.id, toolCall));
      }
      continue;
    }
    if (isConcept) {
      parts.push(buildConceptCardPart(session.id, toolCall.id, toolCall.name, toolCall.input, toolCall.outputPreview, toolCall.status, theme, conceptMutations, onOpenConceptDetails));
      pushFallbackReasoning();
      continue;
    }
    if (isMemoryPatch) {
      parts.push(buildMemoryUpdatedPart(session.id, toolCall.id, toolCall.input, toolCall.outputPreview));
      pushFallbackReasoning();
      continue;
    }

    parts.push({
      type: "activity",
      id: `${session.id}:tool-call:${toolCall.id}`,
      entry: toolCallToFlowTraceEntry(toolCall)
    });
    pushFallbackReasoning();
  }

  while (fallbackReasoningIndex < fallbackReasoning.length) {
    pushFallbackReasoning();
  }

  if (session.status === "running" && !parts.some((part) => part.type === "activity" && part.entry.status === "running")) {
    parts.push({
      type: "activity",
      id: `${session.id}:activity:live-tail`,
      entry: {
        id: `${session.id}:live-tail`,
        kind: "thought",
        title: "Working",
        status: "running"
      }
    });
  }

  if (!hasMessageEvent && fallbackText.answer) {
    parts.push({
      type: "text",
      id: `${session.id}:reply`,
      content: <MarkdownBlock content={fallbackText.answer} theme={theme} onOpenConcept={onOpenConceptById} />
    });
  }

  return parts;
}

function buildFallbackReasoningPart(sessionId: string, index: number, text: string): AgentSessionMessagePart {
  return {
    type: "activity",
    id: `${sessionId}:reasoning:fallback:${index}`,
    defaultOpen: false,
    entry: {
      id: `${sessionId}:reasoning:fallback:${index}`,
      kind: "thought",
      title: "Reasoning",
      status: "completed",
      output: text
    }
  };
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
  toolCall: ConstructFlowToolCallRecord
): AgentSessionMessagePart {
  const payload = readAskUserPayload(toolCall.input, toolCall.outputPreview);
  const response = toolCall.response;
  const question = response?.question || payload.question || "Flow question";
  const answer = response?.answer || "";
  return {
    type: "actions",
    id: `${sessionId}:question-answer:${toolCall.id}`,
    content: (
      <div className="group flex w-fit max-w-full min-w-0 items-start gap-2 rounded-[12px] border border-border/70 bg-muted/20 px-3 py-2 text-xs shadow-sm transition-[background-color,border-color] duration-150 hover:bg-muted/30">
        <HelpCircleIcon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="font-medium text-foreground">Question answered</strong>
            <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground ring-1 ring-border/60">
              {response?.skipped ? "Skipped" : "Answered"}
            </span>
          </div>
          <p className="mt-1 max-w-[68ch] text-muted-foreground">{question}</p>
          {answer ? (
            <p className="mt-1 max-w-[68ch] whitespace-pre-wrap break-words text-foreground/90">
              {answer}
            </p>
          ) : null}
        </div>
      </div>
    )
  };
}

function ConfidenceBadge({ level }: { level: string }) {
  const normLevel = level ? level.toLowerCase() : "";
  let statusColor = "bg-muted-foreground/45";
  if (normLevel === "strong") statusColor = "bg-[color:var(--construct-success)]";
  else if (normLevel === "emerging") statusColor = "bg-[color:var(--construct-warning)]";
  else if (normLevel === "weak") statusColor = "bg-destructive";

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground bg-background">
      <span className={`size-1.5 rounded-full ${statusColor}`} aria-hidden="true" />
      <span className="capitalize">{level} confidence</span>
    </div>
  );
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
  const content = readString(conceptObj.content) ?? readString(inputObj.content);
  const examples = readStringArray(conceptObj.examples).length
    ? readStringArray(conceptObj.examples)
    : readStringArray(inputObj.examples);
  const evidence = readStringArray(outputObj.evidence).length
    ? readStringArray(outputObj.evidence)
    : readStringArray(inputObj.evidence).length
      ? readStringArray(inputObj.evidence)
      : readStringArray(conceptObj.learnerEvidence);

  return {
    id,
    title,
    language: readConceptLanguage(conceptObj.language) ?? readConceptLanguage(inputObj.language) ?? readConceptLanguage(outputObj.language) ?? inferConceptLanguage(id, title),
    technology: readString(conceptObj.technology) ?? readString(inputObj.technology) ?? readString(outputObj.technology),
    content,
    examples,
    confidence: readString(conceptObj.confidence) ?? readString(outputObj.nextConfidence) ?? readString(inputObj.confidence),
    reason: readString(outputObj.reason) ?? readString(inputObj.reason) ?? readString(conceptObj.lastChangeReason),
    confidenceReason: readString(outputObj.confidenceReason) ?? readString(inputObj.confidenceReason) ?? readString(conceptObj.confidenceReason),
    evidence,
    authoredBy: readString(conceptObj.authoredBy) ?? readString(inputObj.authoredBy),
    agentContributionPercent: readNumber(conceptObj.agentContributionPercent) ?? readNumber(inputObj.agentContributionPercent),
    normalizedFrom: readString(outputObj.normalizedFrom)
  };
}

function buildConceptCardFromInput(input: ConceptPayload | Record<string, unknown>): ConceptCard {
  const id = typeof input.id === "string" ? input.id : "";
  const title = typeof input.title === "string" ? input.title : conceptTitleFromId(id);
  const language = readConceptLanguage((input as Record<string, unknown>).language) ?? inferConceptLanguage(id, title);
  const technology = readString((input as Record<string, unknown>).technology);
  const content = typeof input.content === "string" ? input.content : "";
  const examples = Array.isArray(input.examples) ? input.examples.filter((item): item is string => typeof item === "string") : [];
  return {
    id,
    title: title || id || "Concept",
    kind: "concept",
    language,
    technology,
    tags: id.split(".").slice(0, -1),
    summary: content ? (content.split("\n")[0] || title || "") : (title || id || ""),
    why: "",
    example: examples[0] || "",
    docs: [],
    guides: content ? [
      {
        kind: "guide",
        id: "explanation",
        guideKind: "guide.explanation",
        content,
        sections: []
      }
    ] : []
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return parseJsonObject(value) ?? {};
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  onOpenConceptDetails: (concept: ConceptCard) => void
): AgentSessionMessagePart {
  const payload = readConceptPayload(input, outputPreview);
  const conceptId = payload.id;
  const kind = conceptMutationKindForTool(toolName);
  const meta = conceptMutationMeta(kind, status);
  const conceptCard = buildConceptCardFromInput(payload);
  const conceptReason = payload.reason;
  const allMutations = ensureCurrentMutation(conceptMutations, {
    id: conceptId,
    title: payload.title || conceptId,
    kind: kind ?? "modified",
    eventId
  }, kind);

  return {
    type: "actions",
    id: `${sessionId}:concept:${eventId}`,
    content: (
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-[18px] bg-card/72 p-3 text-xs shadow-[0_6px_18px_color-mix(in_srgb,var(--foreground)_5%,transparent)] ring-1 ring-border/45">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}>
            <meta.Icon size={12} />
            {meta.label}
          </span>
          {payload.confidence && <ConfidenceBadge level={payload.confidence} />}
        </div>

        {toolName !== "remove-concept" ? (
          <ConceptSummaryCard
            concept={conceptCard}
            variant="chat"
            actionLabel="Open"
            onOpen={() => onOpenConceptDetails(conceptCard)}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-1 rounded-[14px] border border-destructive/20 bg-destructive/10 p-3">
            <strong className="truncate text-sm font-semibold text-destructive">{payload.title || conceptId || "Removed concept"}</strong>
            <span className="truncate font-mono text-[11px] text-destructive/80">{conceptId || "unknown concept"}</span>
          </div>
        )}

        {payload.normalizedFrom ? (
          <span className="text-[11px] text-muted-foreground">
            Canonicalized from <span className="font-mono">{payload.normalizedFrom}</span>
          </span>
        ) : null}

        {kind ? <ConceptMutationTree mutations={allMutations} currentId={conceptId} currentKind={kind} /> : null}

        {(conceptReason || payload.confidenceReason || payload.evidence.length) ? (
          <div className="flex flex-col gap-2 rounded-[12px] bg-muted/25 px-3 py-2.5 text-muted-foreground">
            {conceptReason ? (
              <div>
                <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Reason</span>
                <p className="leading-relaxed">{conceptReason}</p>
              </div>
            ) : null}
            {payload.confidenceReason ? (
              <div>
                <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Confidence evidence</span>
                <p className="leading-relaxed">{payload.confidenceReason}</p>
              </div>
            ) : null}
            {payload.evidence.length ? (
              <div>
                <span className="mb-0.5 block text-[11px] font-semibold text-foreground">Evidence</span>
                <ul className="flex flex-col gap-1 leading-relaxed">
                  {payload.evidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {payload.authoredBy || payload.agentContributionPercent !== undefined ? (
          <span className="text-[11px] text-muted-foreground">
            Authorship: {payload.authoredBy ?? "unknown"}{payload.agentContributionPercent !== undefined ? ` · agent ${payload.agentContributionPercent}%` : ""}
          </span>
        ) : null}
      </div>
    )
  };
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
  return (
    <div className="rounded-[12px] border bg-background/55 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-foreground">Concept tree</span>
        {currentKind ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${conceptMutationMeta(currentKind).textClass}`}>
            {conceptMutationLabel(currentKind)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
        {roots.map((node) => (
          <ConceptTreeBranch key={node.id} node={node} currentId={currentId} depth={0} />
        ))}
      </div>
    </div>
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
      label: status === "running" ? "Adding concept" : "Added concept",
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
  if (kind === "added") return "added";
  if (kind === "modified") return "modified";
  return "removed";
}

function FlowQuestionComposer({
  question,
  value,
  onValueChange,
  onAnswer,
  onSkip,
  pending
}: {
  question: ActiveFlowQuestion;
  theme: "light" | "dark" | "system";
  value: string;
  onValueChange: (value: string) => void;
  onAnswer: (response: ConstructFlowQuestionResponse) => void;
  onSkip: () => void;
  pending: boolean;
}) {
  const payload = question.payload;
  const choices = payload.choices ?? [];
  const allowOther = payload.allowOther !== false;
  const [selected, setSelected] = useState<string | null>(choices.length ? null : (allowOther ? "__other__" : null));
  const usingOther = selected === "__other__" || choices.length === 0;
  const answer = usingOther ? value.trim() : selected?.trim() ?? "";
  const canSubmit = !pending && Boolean(answer);
  const questionText = payload.question || "I need one more detail before continuing.";

  function submit() {
    if (!canSubmit) return;
    onAnswer(buildFlowQuestionResponse(question, answer));
  }

  return (
    <div className="mx-auto w-full max-w-[840px] overflow-hidden rounded-[28px] bg-card/95 shadow-[0_8px_24px_color-mix(in_srgb,var(--foreground)_6%,transparent)] ring-1 ring-border/65 transition-[box-shadow,background-color] duration-200 ease-out focus-within:ring-ring/70">
      <div className="px-4 pb-2 pt-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground ring-1 ring-border/60">
            <HelpCircleIcon size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block text-xs font-medium text-muted-foreground">Flow needs an answer</strong>
            <p className="mt-0.5 text-[13px] leading-5 text-foreground">{questionText}</p>
          </div>
        </div>
      </div>
      {choices.length ? (
        <div className="grid grid-cols-1 gap-1.5 px-3 pb-2">
          {choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className={`flex min-h-9 items-center gap-2 rounded-[14px] border px-2.5 py-1.5 text-left text-[13px] transition-[background-color,border-color,color] duration-150 ${selected === choice ? "border-foreground/60 bg-muted/80 text-foreground shadow-sm" : "border-border/65 bg-background/35 text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
              onClick={() => {
                setSelected(choice);
                onValueChange("");
              }}
              disabled={pending}
            >
              <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[7px] text-[11px] font-semibold ${selected === choice ? "bg-background text-foreground" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
              <span className="min-w-0 flex-1">{choice}</span>
            </button>
          ))}
        </div>
      ) : null}
      {allowOther ? (
        <div className="px-3 pb-2">
          <textarea
            className={`min-h-12 max-h-28 w-full resize-none rounded-[18px] border-0 bg-background/45 px-3 py-2 text-[13px] leading-5 shadow-none outline-none ring-1 ring-border/45 transition-[background-color,box-shadow,color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-ring/65 ${usingOther ? "text-foreground" : "text-muted-foreground"}`}
            value={value}
            placeholder={choices.length ? "Other (write your answer)..." : "Write your answer..."}
            onFocus={() => setSelected("__other__")}
            onChange={(event) => {
              setSelected("__other__");
              onValueChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey && canSubmit) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={pending}
            spellCheck
          />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 px-2 pb-2 pt-1.5">
        {payload.allowSkip !== false ? (
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={pending}>
            Skip
          </Button>
        ) : null}
        <Button className="rounded-full" size="sm" disabled={!canSubmit} onClick={submit}>
          Submit
        </Button>
      </div>
    </div>
  );
}

function readAskUserPayload(input: unknown, outputPreview?: string): { question?: string; reason?: string; choices?: string[]; allowOther?: boolean; allowSkip?: boolean; blocksProgress?: boolean } {
  const parsedOutput = parseJsonObject(outputPreview);
  const source = parsedOutput ?? (typeof input === "object" && input !== null ? input as Record<string, unknown> : {});
  return {
    question: typeof source.question === "string" ? source.question : undefined,
    reason: typeof source.reason === "string" ? source.reason : undefined,
    choices: Array.isArray(source.choices) ? source.choices.filter((choice): choice is string => typeof choice === "string") : undefined,
    allowOther: typeof source.allowOther === "boolean" ? source.allowOther : true,
    allowSkip: typeof source.allowSkip === "boolean" ? source.allowSkip : true,
    blocksProgress: typeof source.blocksProgress === "boolean" ? source.blocksProgress : false
  };
}

function buildMemoryUpdatedPart(
  sessionId: string,
  eventId: string,
  input: unknown,
  outputPreview: string | undefined
): AgentSessionMessagePart {
  const results = readMemoryPatchResults(input, outputPreview);
  return {
    type: "actions",
    id: `${sessionId}:memory:${eventId}`,
    content: <FlowMemoryUpdateCard results={results} />
  };
}

function FlowMemoryUpdateCard({ results }: { results: ConstructFlowMemoryPatchResult[] }) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(results[0]?.file ?? "research.md");
  const selected = results.find((result) => result.file === selectedFile) ?? results[0];
  const fileLabel = results.length ? results.map((result) => result.file).join(", ") : "Flow Memory";
  return (
    <div className="flex w-fit max-w-full min-w-0 items-center gap-2 rounded-[16px] bg-card/68 px-3 py-2 text-xs shadow-[0_4px_14px_color-mix(in_srgb,var(--foreground)_4%,transparent)] ring-1 ring-border/45 transition-[background-color,box-shadow] duration-150 hover:bg-card/82">
      <FileTextIcon size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="shrink-0 font-medium text-foreground">Memory updated</strong>
          <span className="min-w-0 truncate text-muted-foreground">{fileLabel}</span>
        </div>
        {results[0]?.reason && results[0].reason !== "Flow Memory changed." ? (
          <p className="mt-0.5 line-clamp-1 text-muted-foreground">{results[0].reason}</p>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <GitCompareIcon size={14} />
        View diff
      </Button>
      <ShadcnDialog open={open} onOpenChange={setOpen}>
        <ShadcnDialogContent className="flex max-h-[82vh] w-[min(64rem,calc(100vw-3rem))] max-w-none flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/95 p-5 shadow-2xl">
          <ShadcnDialogHeader>
            <ShadcnDialogTitle>Flow Memory diff</ShadcnDialogTitle>
            <ShadcnDialogDescription>
              {selected?.path ?? "Changed Flow Memory file"}
            </ShadcnDialogDescription>
          </ShadcnDialogHeader>
          <div className="flex min-h-0 flex-col gap-3">
            {results.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {results.map((result) => (
                  <Button
                    key={result.file}
                    size="sm"
                    variant={result.file === selected?.file ? "secondary" : "ghost"}
                    onClick={() => setSelectedFile(result.file)}
                  >
                    {result.file}
                  </Button>
                ))}
              </div>
            ) : null}
            {selected ? (
              <div className="min-h-0 overflow-hidden rounded-[14px] border bg-background">
                <DiffViewer diff={readRenderableMemoryDiff(selected)} />
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

function DiffViewer({ diff }: { diff: string }) {
  return (
    <pre className="max-h-[58vh] max-w-full overflow-auto p-3 font-mono text-[11px] leading-relaxed">
      {diff.split(/\r?\n/).map((line, index) => {
        const tone = line.startsWith("+") && !line.startsWith("+++")
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : line.startsWith("-") && !line.startsWith("---")
            ? "bg-destructive/10 text-destructive"
            : line.startsWith("@@")
              ? "bg-muted text-muted-foreground"
              : "text-foreground";
        return (
          <code key={`${index}:${line}`} className={`block min-w-full w-max whitespace-pre px-2 py-0.5 ${tone}`}>
            {line || " "}
          </code>
        );
      })}
    </pre>
  );
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
        path: item.path ?? `.construct/flow-memory/${item.file}`,
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

function flowEventToTraceEntry(event: ConstructFlowSession["agentEvents"][number]): AgentRunTraceEntry {
  const toolName = event.toolName ?? event.title;
  const isConcept = toolName?.includes("concept");
  let title = event.type === "reasoning" ? "Reasoning" : event.title;
  let subtitle = event.type === "reasoning" && event.text ? undefined : event.detail;

  if (isConcept && event.type === "tool") {
    const inputObj = typeof event.input === "string" ? parseJsonObject(event.input) : (event.input as any || {});
    const conceptId = inputObj.id ?? "";
    const conceptTitle = inputObj.title ?? "";

    if (toolName === "add-concept") {
      title = `Added concept "${conceptTitle || conceptId}"`;
    } else if (toolName === "modify-concept") {
      title = `Modified concept "${conceptTitle || conceptId}"`;
    } else if (toolName === "remove-concept") {
      title = `Removed concept "${conceptId}"`;
    }
    subtitle = conceptId;
  }

  return {
    id: event.id,
    kind: event.type === "reasoning" ? "thought" : "tool",
    title,
    subtitle,
    status: event.status === "error" ? "error" : event.status === "running" ? "running" : "completed",
    icon: event.type === "tool" ? classifyToolIcon(toolName) : undefined,
    input: stringify(event.input),
    output: event.type === "reasoning" ? event.text : event.outputPreview
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

function splitReasoningSegments(text: string | undefined): string[] {
  const value = text?.trim();
  if (!value) return [];
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return [value];
  const segments: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    segments.push(sentences.slice(index, index + 2).join(" "));
  }
  return segments;
}

function toolCallToFlowTraceEntry(toolCall: ConstructFlowToolCallRecord): AgentRunTraceEntry {
  const isConcept = toolCall.name.includes("concept");
  let title = toolCall.title;
  let subtitle = toolCall.reason;

  if (isConcept) {
    const inputObj = typeof toolCall.input === "string" ? parseJsonObject(toolCall.input) : (toolCall.input as any || {});
    const conceptId = inputObj.id ?? "";
    const conceptTitle = inputObj.title ?? "";

    if (toolCall.name === "add-concept") {
      title = `Added concept "${conceptTitle || conceptId}"`;
    } else if (toolCall.name === "modify-concept") {
      title = `Modified concept "${conceptTitle || conceptId}"`;
    } else if (toolCall.name === "remove-concept") {
      title = `Removed concept "${conceptId}"`;
    }
    subtitle = conceptId;
  }

  return {
    id: toolCall.id,
    kind: "tool",
    title,
    subtitle,
    status: toolCall.status,
    icon: classifyToolIcon(toolCall.name),
    input: stringify(toolCall.input),
    output: toolCall.outputPreview
  };
}

function classifyToolIcon(name: string): AgentRunTraceEntry["icon"] {
  if (name.includes("memory") || name.includes("concept")) return "memory";
  if (name.includes("read")) return "read";
  if (name.includes("search") || name.includes("find")) return "search";
  if (name.includes("terminal") || name.includes("command")) return "terminal";
  if (name.includes("file") || name.includes("edit") || name.includes("view") || name.includes("glob") || name.includes("list")) return "file";
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
  return globalModelForProvider(settings) || defaultFlowModelForProvider(settings.provider);
}

function globalModelForProvider(settings: AiSettings): string {
  if (settings.provider === "openrouter") return settings.openRouterModel.trim();
  if (settings.provider === "opencode-zen") return settings.opencodeZenModel.trim();
  if (settings.provider === "github-copilot") return settings.githubCopilotModel.trim();
  if (settings.provider === "litellm") return settings.liteLlmModel.trim();
  return settings.openAiModel.trim();
}

function defaultFlowModelForProvider(provider: AiSettings["provider"]): string {
  if (provider === "openrouter") return "deepseek/deepseek-v4-flash";
  if (provider === "opencode-zen") return "gpt-5.1-codex";
  if (provider === "github-copilot") return "github_copilot/gpt-4";
  if (provider === "litellm") return "openai/gpt-5-mini";
  return "gpt-5-mini";
}

function apiKeyForProvider(settings: AiSettings): string | undefined {
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
