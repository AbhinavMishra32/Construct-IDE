import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckIcon, CheckCircle2Icon, Code2Icon, FileTextIcon, GitCompareIcon, HelpCircleIcon, ListChecksIcon, RotateCcwIcon, SendIcon, SparklesIcon } from "lucide-react";
import {
  AdaptiveSidecarLayout,
  AgentSessionComposer,
  AgentSessionSurface,
  Button,
  HoverPreview,
  SidebarBottomSlot,
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

import type {
  ConstructFlowAction,
  ConstructFlowMemoryPatchResult,
  ConstructFlowPracticeTask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowToolCallRecord
} from "../../../shared/constructFlow";
import type { ConceptCard, FlowProjectRecord, WorkspaceTreeNode } from "../types";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  listFiles,
  onConstructFlowSessionEvent,
  readFile,
  renameFile,
  runConstructFlowAgent,
  runConstructFlowResearch,
  submitFlowTask,
  updateProject,
  writeFile
} from "../lib/bridge";
import { EditorPane } from "./EditorPane";
import { MarkdownBlock } from "./MarkdownBlock";
import { KnowledgeCard } from "./KnowledgeCard";
import { iconForFile } from "./workspace/FileChooserContent";
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
    if (!message.trim() && !taskSubmission && !questionResponse) return;
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
        message: message.trim() || (questionResponse ? "Continue from the tracked question answer." : "Continue from the learner's task submission."),
        taskSubmission,
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
        onResetChat={() => {
          setSessions([]);
          setLiveSession(undefined);
        }}
      />
    );
    return () => onGuidePanelChange(null);
  }, [liveSession, onGuidePanelChange, pending, project, runAgent, sessions, submitTask, theme, setOpenConcept]);

  const sidebarKnowledgeContent = useMemo(() => (
    <SidebarBottomSlot
      className="border-t"
      defaultHeight={Math.min(300, Math.max(132, 50 + flowConcepts.length * 34))}
      minHeight={118}
      maxHeight={420}
      header={(
        <div className="flex w-full items-center gap-2 text-xs font-medium">
          <BookOpenIcon size={14} />
          <span className="min-w-0 flex-1 text-left">Knowledge</span>
          <small className="text-muted-foreground">{flowConcepts.length}</small>
        </div>
      )}
    >
      <section className="h-full min-h-0 overflow-y-auto p-2" aria-label="Flow knowledge">
        {flowConcepts.length > 0 ? (
          <div className="space-y-1">
            {flowConcepts.map((concept) => (
              <HoverPreview
                key={concept.id}
                content={<div className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{concept.kind}</span><strong className="block text-sm font-medium">{concept.title}</strong><p className="text-xs text-muted-foreground">{concept.summary}</p>{concept.tags.length ? <small className="block text-[10px] text-muted-foreground">{concept.tags.join(" · ")}</small> : null}</div>}
              >
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  type="button"
                  onClick={() => setOpenConcept(concept)}
                >
                  <BookOpenIcon size={13} />
                  <span className="min-w-0 flex-1 truncate">{concept.title}</span>
                  <CheckCircle2Icon size={12} className="opacity-60" />
                </button>
              </HoverPreview>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-20 items-center justify-center rounded-[8px] border border-dashed px-3 text-center text-xs text-muted-foreground">
            Flow concepts will appear here.
          </div>
        )}
      </section>
    </SidebarBottomSlot>
  ), [flowConcepts]);

  useEffect(() => {
    onKnowledgePanelChange?.(sidebarKnowledgeContent);
    return () => onKnowledgePanelChange?.(null);
  }, [onKnowledgePanelChange, sidebarKnowledgeContent]);

  const sidecar = openConcept ? (
    <div className="flex h-full max-h-full min-h-0 w-full flex-col gap-3 overflow-y-auto" aria-label="Open knowledge cards">
      <KnowledgeCard
        key={openConcept.id}
        concept={openConcept}
        saved={false}
        theme={theme}
        onClose={() => setOpenConcept(null)}
        onOpenConcept={() => {}}
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
  questionResponse?: ConstructFlowQuestionResponse;
};

function collectFlowConcepts(sessions: ConstructFlowSession[]): ConceptCard[] {
  const concepts = new Map<string, ConceptCard>();

  for (const session of sessions) {
    for (const event of session.agentEvents) {
      if (event.type !== "tool") continue;
      const toolName = event.toolName ?? event.title;
      applyFlowConceptRecord(concepts, toolName, event.input);
    }

    for (const toolCall of session.toolCalls) {
      applyFlowConceptRecord(concepts, toolCall.name, toolCall.input);
    }
  }

  return Array.from(concepts.values());
}

function applyFlowConceptRecord(concepts: Map<string, ConceptCard>, toolName: string | undefined, input: unknown) {
  if (!toolName?.includes("concept")) return;
  const inputObj = typeof input === "string" ? parseJsonObject(input) : (input as Record<string, unknown> | null | undefined);
  if (!inputObj || typeof inputObj.id !== "string" || !inputObj.id.trim()) return;

  if (toolName === "remove-concept") {
    concepts.delete(inputObj.id);
    return;
  }

  concepts.set(inputObj.id, buildConceptCardFromInput(inputObj));
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
  onResetChat: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "project">("chat");
  const mergedSessions = useMemo(() => mergeSessions(sessions, liveSession), [liveSession, sessions]);
  const flowConcepts = useMemo(() => collectFlowConcepts(mergedSessions), [mergedSessions]);
  const flowTasks = useMemo(() => mergedSessions.flatMap((session) => session.practiceTasks), [mergedSessions]);
  const activeQuestion = useMemo(() => findActiveFlowQuestion(mergedSessions), [mergedSessions]);
  const messages = useMemo(() => buildFlowMessages({
    sessions: mergedSessions,
    theme,
    onOpenConceptDetails
  }), [mergedSessions, theme, onOpenConceptDetails]);

  useEffect(() => {
    setDraft("");
  }, [activeQuestion?.id]);

  const submitComposer = useCallback(() => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    void onRunAgent(message);
  }, [draft, onRunAgent]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">Construct Flow</strong>
          <span className="block truncate text-[11px] text-muted-foreground">{project.flow.goal}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={activeView === "chat" ? "secondary" : "ghost"} onClick={() => setActiveView("chat")}>Chat</Button>
          <Button size="sm" variant={activeView === "project" ? "secondary" : "ghost"} onClick={() => setActiveView("project")}><ListChecksIcon size={14} />Project</Button>
          <Button size="sm" variant="ghost" onClick={onRunResearch}><SparklesIcon size={14} />Research</Button>
          <Button size="sm" variant="ghost" title="Reset visible Flow chat for debugging" onClick={onResetChat}><RotateCcwIcon size={14} /></Button>
        </div>
      </div>
      {activeView === "project" ? (
        <FlowProjectDataPanel
          tasks={flowTasks}
          concepts={flowConcepts}
          theme={theme}
          onOpenConcept={onOpenConceptDetails}
          onSubmitTask={onSubmitTask}
        />
      ) : (
        <AgentSessionSurface
          className="min-h-0 flex-1"
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
                placeholder="Ask Flow, describe what you tried, or paste an error..."
              />
            )
          }
        />
      )}
    </aside>
  );
}

function FlowProjectDataPanel({
  tasks,
  concepts,
  theme,
  onOpenConcept,
  onSubmitTask
}: {
  tasks: ConstructFlowPracticeTask[];
  concepts: ConceptCard[];
  theme: "light" | "dark" | "system";
  onOpenConcept: (concept: ConceptCard) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string, subtaskId?: string) => Promise<void>;
}) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <section className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <FlowMetric label="Tasks" value={String(tasks.length)} />
          <FlowMetric label="Done" value={String(completedTasks)} />
          <FlowMetric label="Concepts" value={String(concepts.length)} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecksIcon size={15} />
            <span>Roadmap</span>
          </div>
          {tasks.length ? (
            <div className="space-y-2">
              {tasks.map((task) => (
                <FlowTaskCard key={task.id} task={task} theme={theme} onSubmitTask={onSubmitTask} />
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed p-4 text-center text-xs text-muted-foreground">
              Flow-created learner tasks will appear here.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BookOpenIcon size={15} />
            <span>Concepts</span>
          </div>
          {concepts.length ? (
            <div className="grid gap-1">
              {concepts.map((concept) => (
                <button
                  key={concept.id}
                  type="button"
                  className="flex min-h-9 items-center gap-2 rounded-[7px] border bg-background/60 px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onOpenConcept(concept)}
                >
                  <BookOpenIcon size={13} />
                  <span className="min-w-0 flex-1 truncate">{concept.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed p-4 text-center text-xs text-muted-foreground">
              Evidence-backed concepts will appear here.
            </div>
          )}
        </div>

        <div className="space-y-2">
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
  const active = task.subtasks?.find((subtask) => subtask.status === "active" || subtask.status === "submitted")
    ?? task.subtasks?.find((subtask) => subtask.status !== "completed")
    ?? task.subtasks?.[0];
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

function buildFlowMessages({
  sessions,
  theme,
  onOpenConceptDetails
}: {
  sessions: ConstructFlowSession[];
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
}): AgentSessionMessage[] {
  return sessions.flatMap((session): AgentSessionMessage[] => {
    const user = session.messages.find((message) => message.role === "user");
    const assistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    const parts = buildFlowAgentParts({
      session,
      assistantContent: assistant?.content,
      theme,
      onOpenConceptDetails
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
  theme,
  onOpenConceptDetails
}: {
  session: ConstructFlowSession;
  assistantContent?: string;
  theme: "light" | "dark" | "system";
  onOpenConceptDetails: (concept: ConceptCard) => void;
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
        content: <MarkdownBlock content={event.text} theme={theme} />
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
      parts.push(buildConceptCardPart(session.id, event.id, toolName, event.input, event.status, theme, onOpenConceptDetails));
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
      parts.push(buildConceptCardPart(session.id, toolCall.id, toolCall.name, toolCall.input, toolCall.status, theme, onOpenConceptDetails));
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
      content: <MarkdownBlock content={fallbackText.answer} theme={theme} />
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
  for (const session of [...sessions].reverse()) {
    if (session.status !== "waiting") continue;
    const toolCall = [...session.toolCalls].reverse().find((candidate) => (
      candidate.status !== "error" && isQuestionTool(candidate.name) && !candidate.response
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

function isQuestionTool(name: string | undefined): boolean {
  return name === "ask-user" || name === "ask-question";
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
      <div className="group flex w-fit max-w-full min-w-0 items-start gap-2 rounded-[12px] border border-border/70 bg-muted/20 px-3 py-2 text-xs shadow-sm transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-muted/30">
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
  if (normLevel === "strong") statusColor = "bg-emerald-500";
  else if (normLevel === "emerging") statusColor = "bg-amber-500";
  else if (normLevel === "weak") statusColor = "bg-destructive";

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground bg-background">
      <span className={`size-1.5 rounded-full ${statusColor}`} aria-hidden="true" />
      <span className="capitalize">{level} confidence</span>
    </div>
  );
}

function renderConceptBreadcrumb(id: string) {
  const parts = id.split(".");
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground font-mono">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span className="opacity-55">/</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  );
}

function buildConceptCardFromInput(input: any): ConceptCard {
  return {
    id: input.id ?? "",
    title: input.title ?? input.id ?? "Concept",
    kind: "concept",
    tags: (input.id ?? "").split(".").slice(0, -1),
    summary: input.content ? (input.content.split("\n")[0] || input.title || "") : (input.title || ""),
    why: "",
    example: input.examples?.[0] || "",
    docs: [],
    guides: input.content ? [
      {
        kind: "guide",
        id: "explanation",
        guideKind: "guide.explanation",
        content: input.content,
        sections: []
      }
    ] : []
  };
}

function buildConceptCardPart(
  sessionId: string,
  eventId: string,
  toolName: string,
  input: unknown,
  status: string,
  theme: "light" | "dark" | "system",
  onOpenConceptDetails: (concept: ConceptCard) => void
): AgentSessionMessagePart {
  const inputObj = typeof input === "string" ? parseJsonObject(input) : (input as any || {});
  const conceptId = inputObj.id ?? "";
  const conceptTitle = inputObj.title ?? "";
  const confidence = inputObj.confidence;
  const reason = typeof inputObj.reason === "string" ? inputObj.reason : undefined;
  const confidenceReason = typeof inputObj.confidenceReason === "string" ? inputObj.confidenceReason : undefined;
  const rawEvidence = (inputObj as { evidence?: unknown }).evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item: unknown): item is string => typeof item === "string") : [];
  const authoredBy = typeof inputObj.authoredBy === "string" ? inputObj.authoredBy : undefined;
  const agentContributionPercent = typeof inputObj.agentContributionPercent === "number" ? inputObj.agentContributionPercent : undefined;
  
  let actionLabel = "Added Concept";
  let badgeColor = "text-muted-foreground bg-background/70 border-border";
  if (toolName === "modify-concept") {
    actionLabel = "Modified Concept";
    badgeColor = "text-muted-foreground bg-background/70 border-border";
  } else if (toolName === "remove-concept") {
    actionLabel = "Removed Concept";
    badgeColor = "text-destructive bg-destructive/10 border-destructive/20";
  }

  const conceptCard = buildConceptCardFromInput(inputObj);

  return {
    type: "actions",
    id: `${sessionId}:concept:${eventId}`,
    content: (
      <div className="flex w-full min-w-0 flex-col gap-2 rounded-[8px] border border-border bg-muted/20 p-3 text-xs shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeColor}`}>
            {actionLabel}
          </span>
          {confidence && <ConfidenceBadge level={confidence} />}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          {renderConceptBreadcrumb(conceptId)}
          <strong className="text-sm font-semibold truncate text-foreground">
            {conceptTitle || conceptId}
          </strong>
        </div>
        {reason ? (
          <div className="rounded-[7px] border bg-background/60 p-2 text-muted-foreground">
            <span className="mb-1 block text-[11px] font-semibold text-foreground">Reason</span>
            {reason}
          </div>
        ) : null}
        {confidenceReason ? (
          <div className="rounded-[7px] border bg-background/60 p-2 text-muted-foreground">
            <span className="mb-1 block text-[11px] font-semibold text-foreground">Confidence evidence</span>
            {confidenceReason}
          </div>
        ) : null}
        {evidence.length ? (
          <div className="rounded-[7px] border bg-background/60 p-2">
            <span className="mb-1 block text-[11px] font-semibold text-foreground">Evidence</span>
            <ul className="space-y-1 text-muted-foreground">
              {evidence.map((item: string, index: number) => <li key={`${index}:${item}`}>- {item}</li>)}
            </ul>
          </div>
        ) : null}
        {authoredBy || agentContributionPercent !== undefined ? (
          <span className="text-[11px] text-muted-foreground">
            Authorship: {authoredBy ?? "unknown"}{agentContributionPercent !== undefined ? ` · agent ${agentContributionPercent}%` : ""}
          </span>
        ) : null}
        {toolName !== "remove-concept" && (
          <div className="mt-1 flex items-center justify-end">
            <button
              type="button"
              className="rounded-full px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
              onClick={() => onOpenConceptDetails(conceptCard)}
            >
              View Details
            </button>
          </div>
        )}
      </div>
    )
  };
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
    <div className="mx-auto w-full max-w-[840px] overflow-hidden rounded-[26px] bg-card/95 shadow-[0_12px_36px_color-mix(in_srgb,var(--foreground)_9%,transparent)] ring-1 ring-border/80 transition-[box-shadow,background-color,transform] duration-200 ease-out focus-within:ring-ring/70">
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
        <div className="grid gap-1.5 px-3 pb-2 sm:grid-cols-2">
          {choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className={`flex min-h-9 items-center gap-2 rounded-[14px] border px-2.5 text-left text-[13px] transition-[background-color,border-color,transform,color] duration-150 active:translate-y-px ${selected === choice ? "border-foreground/70 bg-muted text-foreground shadow-sm" : "border-border/70 bg-background/35 text-muted-foreground hover:-translate-y-0.5 hover:bg-muted/55 hover:text-foreground"}`}
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
        <div className="border-t border-border/50 bg-background/25">
          <textarea
            className={`min-h-12 max-h-28 w-full resize-none border-0 bg-transparent px-4 py-2 text-[13px] leading-5 shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 ${usingOther ? "text-foreground" : "text-muted-foreground"}`}
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
        <Button className="rounded-full transition-transform active:translate-y-px" size="sm" disabled={!canSubmit} onClick={submit}>
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
    <div className="flex w-fit max-w-full min-w-0 items-center gap-2 rounded-[12px] border border-border/70 bg-muted/15 px-3 py-2 text-xs shadow-sm transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-muted/25">
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
