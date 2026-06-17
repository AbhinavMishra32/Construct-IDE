import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckIcon, CheckCircle2Icon, Code2Icon, PlayIcon, SendIcon, SparklesIcon } from "lucide-react";
import {
  AdaptiveSidecarLayout,
  AgentSessionComposer,
  AgentSessionSurface,
  Button,
  HoverPreview,
  SidebarBottomSlot,
  SlotPanel,
  type AgentRunTraceEntry,
  type AgentSessionMessage,
  type AgentSessionMessagePart,
  type SlotTab
} from "@opaline/ui";

import type {
  ConstructFlowAction,
  ConstructFlowAgentResult,
  ConstructFlowPracticeTask,
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

  const runAgent = useCallback(async (message: string, taskSubmission?: Awaited<ReturnType<typeof submitFlowTask>>) => {
    if (!message.trim() && !taskSubmission) return;
    setPending(true);
    try {
      const result = await runConstructFlowAgent({
        projectId: project.id,
        message: message.trim() || "Continue from the learner's task submission.",
        taskSubmission
      });
      setSessions((current) => upsertSession(current, result.session));
      setLiveSession(undefined);
      onProjectChange({
        ...project,
        flow: {
          ...project.flow,
          sessions: upsertSession(project.flow.sessions ?? [], result.session),
          updatedAt: result.session.updatedAt
        }
      });
      applyFlowActions(result.actions, focusCode, onRunCommand, project.workspacePath);
    } finally {
      setPending(false);
    }
  }, [focusCode, onProjectChange, onRunCommand, project]);

  const submitTask = useCallback(async (task: ConstructFlowPracticeTask, note?: string) => {
    const submission = await submitFlowTask({ projectId: project.id, taskId: task.id, note });
    await runAgent("Review my practice task submission.", submission);
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
        onAction={(action) => applyFlowActions([action], focusCode, onRunCommand, project.workspacePath)}
        onSubmitTask={submitTask}
        onOpenConceptDetails={(concept) => setOpenConcept(concept)}
      />
    );
    return () => onGuidePanelChange(null);
  }, [focusCode, liveSession, onGuidePanelChange, onRunCommand, pending, project, runAgent, sessions, submitTask, theme, setOpenConcept]);

  const flowConcepts = useMemo(() => collectFlowConcepts(mergeSessions(sessions, liveSession)), [liveSession, sessions]);

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
    <div className="flex max-h-full w-full flex-col gap-3 overflow-y-auto" aria-label="Open knowledge cards">
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
  onAction,
  onSubmitTask,
  onOpenConceptDetails
}: {
  project: FlowProjectRecord;
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  pending: boolean;
  theme: "light" | "dark" | "system";
  onRunAgent: (message: string) => Promise<void>;
  onRunResearch: () => void;
  onAction: (action: ConstructFlowAction) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string) => Promise<void>;
  onOpenConceptDetails: (concept: ConceptCard) => void;
}) {
  const [draft, setDraft] = useState("");
  const messages = useMemo(() => buildFlowMessages({
    sessions: mergeSessions(sessions, liveSession),
    theme,
    onAction,
    onSubmitTask,
    onOpenConceptDetails
  }), [liveSession, onAction, onSubmitTask, sessions, theme, onOpenConceptDetails]);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">Construct Flow</strong>
          <span className="block truncate text-[11px] text-muted-foreground">{project.flow.goal}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onRunResearch}><SparklesIcon size={14} />Research</Button>
      </div>
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button size="sm" variant="secondary" onClick={() => void onRunAgent("Continue from the current project state.")}><PlayIcon size={14} />Continue</Button>
        <Button size="sm" variant="ghost" onClick={() => void onRunAgent("I tried. Help me review what changed.")}>I tried</Button>
        <Button size="sm" variant="ghost" onClick={() => void onRunAgent("I'm stuck. Ask one focused question or give a smaller next step.")}>I'm stuck</Button>
        <Button size="sm" variant="ghost" onClick={() => void onRunAgent("Run the relevant tests or checks for the current project state.")}>Run tests</Button>
      </div>
      <AgentSessionSurface
        className="min-h-0 flex-1"
        messages={messages}
        emptyState={<div className="flex flex-col items-center gap-2 text-center"><BotIcon size={18} /><span>Ask Flow what to build or learn next.</span></div>}
        scrollKey={`${messages.length}:${liveSession?.updatedAt ?? "idle"}`}
        composer={
          <AgentSessionComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => {
              const message = draft;
              setDraft("");
              void onRunAgent(message);
            }}
            pending={pending}
            submitLabel="Send"
            placeholder="Ask Flow, describe what you tried, or paste an error..."
          />
        }
      />
    </aside>
  );
}

function buildFlowMessages({
  sessions,
  theme,
  onAction,
  onSubmitTask,
  onOpenConceptDetails
}: {
  sessions: ConstructFlowSession[];
  theme: "light" | "dark" | "system";
  onAction: (action: ConstructFlowAction) => void;
  onSubmitTask: (task: ConstructFlowPracticeTask, note?: string) => Promise<void>;
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
    session.practiceTasks.filter((task) => task.status === "waiting").forEach((task) => {
      parts.push({
        type: "actions",
        id: `${task.id}:task`,
        content: (
          <div className="flex min-w-0 flex-col gap-2 rounded-[8px] border bg-muted/25 p-3 text-xs">
            <strong className="text-sm">{task.title}</strong>
            <MarkdownBlock content={task.prompt} theme={theme} />
            {task.focus ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Code2Icon size={13} />{task.focus.path}{task.focus.line ? `:${task.focus.line}` : ""}</span> : null}
          </div>
        ),
        actions: [
          {
            id: `${task.id}:submit`,
            label: "Submit",
            icon: <SendIcon size={14} />,
            onSelect: () => void onSubmitTask(task)
          },
          {
            id: `${task.id}:stuck`,
            label: "I'm stuck",
            variant: "secondary",
            onSelect: () => void onSubmitTask(task, "I'm stuck.")
          }
        ]
      });
    });
    if (session.actions.length) {
      parts.push({
        type: "actions",
        id: `${session.id}:actions`,
        actions: session.actions.map((action, index) => ({
          id: `${action.type}:${index}`,
          label: action.label,
          description: action.reason,
          onSelect: () => onAction(action)
        }))
      });
    }

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

    return [
      { id: `${session.id}:user`, role: "user", content: userContent },
      { id: `${session.id}:assistant`, role: "assistant", parts }
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

    if (isConcept && event.type === "tool") {
      seenToolIds.add(event.id);
      seenToolNames.set(toolName, (seenToolNames.get(toolName) ?? 0) + 1);
      parts.push(buildConceptCardPart(session.id, event.id, toolName, event.input, event.status, theme, onOpenConceptDetails));
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
      if (toolName === "ask-user") {
        parts.push(buildAskUserPart(session.id, event.id, event.input, event.outputPreview, theme));
      }
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
    if (isConcept) {
      parts.push(buildConceptCardPart(session.id, toolCall.id, toolCall.name, toolCall.input, toolCall.status, theme, onOpenConceptDetails));
      pushFallbackReasoning();
      continue;
    }

    parts.push({
      type: "activity",
      id: `${session.id}:tool-call:${toolCall.id}`,
      entry: toolCallToFlowTraceEntry(toolCall)
    });
    if (toolCall.name === "ask-user") {
      parts.push(buildAskUserPart(session.id, toolCall.id, toolCall.input, toolCall.outputPreview, theme));
    }
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

function buildAskUserPart(
  sessionId: string,
  id: string,
  input: unknown,
  outputPreview: string | undefined,
  theme: "light" | "dark" | "system"
): AgentSessionMessagePart {
  const payload = readAskUserPayload(input, outputPreview);
  return {
    type: "actions",
    id: `${sessionId}:ask-user:${id}`,
    content: (
      <div className="flex min-w-0 flex-col gap-2 rounded-[8px] border bg-muted/25 p-3 text-xs">
        <strong className="text-sm">Question for you</strong>
        <MarkdownBlock content={payload.question || "I need one more detail before continuing."} theme={theme} />
        {payload.reason ? <span className="text-muted-foreground">{payload.reason}</span> : null}
        {payload.choices?.length ? (
          <div className="flex flex-wrap gap-1">
            {payload.choices.map((choice) => <span key={choice} className="rounded-full border bg-background/70 px-2 py-1 text-muted-foreground">{choice}</span>)}
          </div>
        ) : null}
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

function readAskUserPayload(input: unknown, outputPreview?: string): { question?: string; reason?: string; choices?: string[] } {
  const parsedOutput = parseJsonObject(outputPreview);
  const source = parsedOutput ?? (typeof input === "object" && input !== null ? input as Record<string, unknown> : {});
  return {
    question: typeof source.question === "string" ? source.question : undefined,
    reason: typeof source.reason === "string" ? source.reason : undefined,
    choices: Array.isArray(source.choices) ? source.choices.filter((choice): choice is string => typeof choice === "string") : undefined
  };
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
  if (name.includes("search") || name.includes("find")) return "search";
  if (name.includes("terminal") || name.includes("command")) return "terminal";
  if (name.includes("file") || name.includes("edit") || name.includes("view")) return "file";
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
