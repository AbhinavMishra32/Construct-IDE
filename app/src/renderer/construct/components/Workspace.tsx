import {
  CaretDown,
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FileTs,
  FileTsx,
  MagnifyingGlass
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SlotPanel } from "@/components/open-shell";
import type { SlotPanelHandle, SlotTab, SlotLauncherItem } from "@/components/open-shell";
import { EditorPane } from "./EditorPane";
import { GuidePanel } from "./GuidePanel";
import { ReferenceCard } from "./ReferenceCard";
import { StepList } from "./StepList";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  listFiles,
  onVerifyLog,
  readFile,
  renameFile,
  updateProject,
  verifyRecall,
  writeFile
} from "../lib/bridge";
import { currentBlock, emptyBlockAssistance, nextPosition } from "../lib/runtime";
import type {
  BlockAssistance,
  EditBlock,
  ProjectRecord,
  RecallBlock,
  ReferenceLink,
  VerificationLogEntry,
  WorkspaceTreeNode
} from "../types";

function iconForFile(filename: string) {
  const props = { size: 12, weight: "duotone" as const };

  if (/\.(tsx)$/.test(filename)) return <FileTsx {...props} />;
  if (/\.(ts|mts|cts)$/.test(filename)) return <FileTs {...props} />;
  if (/\.(js|jsx|mjs|cjs)$/.test(filename)) return <FileJs {...props} />;
  if (/\.css$/.test(filename)) return <FileCss {...props} />;
  if (/\.json$/.test(filename)) return <FileCode {...props} />;
  if (/\.mdx?$/.test(filename)) return <FileMd {...props} />;

  return <File {...props} />;
}

/* ------------------------------------------------------------------ */
/*  File Chooser (shown when user clicks + → Open file)               */
/* ------------------------------------------------------------------ */
function FileChooserContent({
  files,
  onSelectFile
}: {
  files: string[];
  onSelectFile: (path: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, search]);

  return (
    <div className="construct-file-chooser">
      <div className="construct-file-chooser-search">
        <MagnifyingGlass size={14} weight="bold" className="construct-file-chooser-search-icon" />
        <input
          ref={inputRef}
          className="construct-file-chooser-input"
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="construct-file-chooser-list">
        {filtered.map((filePath) => {
          const filename = filePath.split("/").pop() || "";
          return (
            <button
              key={filePath}
              className="construct-file-chooser-item"
              type="button"
              onClick={() => onSelectFile(filePath)}
            >
              <span className="construct-file-chooser-item-icon">{iconForFile(filename)}</span>
              <span className="construct-file-chooser-item-name">{filename}</span>
              <span className="construct-file-chooser-item-path">{filePath}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="construct-file-chooser-empty">No matching files</div>
        )}
      </div>
    </div>
  );
}

export function Workspace({
  project,
  theme,
  onGuidePanelChange,
  onProjectChange,
  onRunCommand,
  onTreeChange,
  onSavingChange,
  activeRightSlotId,
  onRightSlotChange,
  onFileOpened
}: {
  project: ProjectRecord;
  theme: "light" | "dark" | "system";
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onProjectChange: (project: ProjectRecord) => void;
  onRunCommand: (command: string, cwd: string) => void;
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
  onSavingChange?: (saving: boolean) => void;
  activeRightSlotId: string;
  onRightSlotChange: (slotId: string) => void;
  onFileOpened?: (path: string) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [activeFileContent, setActiveFileContent] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [isStepsCollapsed, setIsStepsCollapsed] = useState(false);
  const [pendingJump, setPendingJump] = useState<{ line: number; column: number } | null>(null);
  const [focusRange, setFocusRange] = useState<{ line: number; endLine?: number; column?: number } | null>(null);
  const [openReferenceIds, setOpenReferenceIds] = useState<string[]>([]);
  const [pinnedReferenceIds, setPinnedReferenceIds] = useState<string[]>([]);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationLogs, setVerificationLogs] = useState<Record<string, VerificationLogEntry[]>>({});
  const editorPanelRef = useRef<SlotPanelHandle>(null);
  const autoOpenedRecallRef = useRef<string | null>(null);

  const typingProgress = project.typingProgress ?? {};
  const editAnchors = project.editAnchors ?? {};
  const assistance = project.assistance ?? {};
  const verificationResults = project.verificationResults ?? {};
  const references = project.program.references ?? [];
  const targets = project.program.targets ?? [];
  const block = currentBlock(project);
  const activeEdit = block?.kind === "edit" ? block : null;
  const relevantPath = activeEdit?.path ?? null;
  const activeFilePath = project.activeFilePath ?? relevantPath ?? project.program.files[0]?.path ?? null;
  const editProgress = activeEdit ? typingProgress[activeEdit.id] ?? 0 : 0;
  const editComplete = activeEdit ? editProgress >= activeEdit.content.length : false;
  const editAnchor = activeEdit ? editAnchors[activeEdit.id] ?? "" : "";
  const isActiveEditReady = activeEdit ? isGuidedEditReady(activeEdit, editAnchors) : false;

  const { furthestUnlockedStepIndex, furthestUnlockedBlockIndex } = useMemo(() => {
    const completedBlocks = project.completedBlocks ?? {};
    const steps = project.program.steps;
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
  }, [project.completedBlocks, project.program.steps]);

  const verification = block && block.kind === "recall" && block.verify
    ? verificationResults[block.verify.id]
    : undefined;

  const canContinue =
    block &&
    (block.kind !== "edit" || editComplete) &&
    (block.kind !== "recall" || !block.verify || verification?.passed === true);

  const fileList = useMemo(() => flattenTree(tree), [tree]);
  const fileSet = useMemo(() => new Set(fileList), [fileList]);
  const recallMissingFiles = useMemo(() => {
    if (!block || block.kind !== "recall" || !block.verify) {
      return [];
    }

    return block.verify.evidence.files.filter((filePath) => !fileSet.has(filePath));
  }, [block, fileSet]);

  // Reset tabs when project changes
  useEffect(() => {
    setOpenTabs(activeFilePath ? [activeFilePath] : []);
    setPendingJump(null);
    setFocusRange(null);
    setOpenReferenceIds([]);
    setPinnedReferenceIds([]);
    setVerifyingId(null);
    setVerificationLogs({});
    autoOpenedRecallRef.current = null;
  }, [project.id]);

  // Sync open tabs with active file
  useEffect(() => {
    if (activeFilePath && !openTabs.includes(activeFilePath)) {
      setOpenTabs((prev) => [...prev, activeFilePath]);
    }
  }, [activeFilePath]);

  // Handle closing a tab
  async function closeTab(tabPath: string) {
    const nextTabs = openTabs.filter((t) => t !== tabPath);
    setOpenTabs(nextTabs);

    if (activeFilePath === tabPath) {
      if (nextTabs.length > 0) {
        const nextActive = nextTabs[nextTabs.length - 1];
        await openFile(nextActive);
      } else {
        setActiveFileContent("");
        await persistProject({ activeFilePath: null });
      }
    }
  }

  const handleReadFileContent = useCallback(async (path: string) => {
    return await readMaybeFile(path);
  }, [project.id]);

  useEffect(() => {
    void refreshTree();
  }, [project.id]);

  useEffect(() => {
    if (!activeFilePath) {
      setActiveFileContent("");
      return;
    }

    void openFile(activeFilePath);
  }, [activeFilePath, project.id]);

  useEffect(() => {
    if (!activeEdit) {
      return;
    }

    void prepareEdit(activeEdit);
  }, [activeEdit?.id, project.id]);

  useEffect(() => {
    const unsubscribe = onVerifyLog((event: { entry: VerificationLogEntry }) => {
      if (block?.kind === "recall" && block.verify) {
        const verifyId = block.verify.id;
        setVerificationLogs((current) => {
          const currentLogs = current[verifyId] ?? [];
          const log = event.entry;
          if (currentLogs.some((l) => l.message === log.message && l.status === log.status && l.detail === log.detail)) {
            return current;
          }
          return {
            ...current,
            [verifyId]: [...currentLogs, log]
          };
        });
      }
    });
    return unsubscribe;
  }, [block?.id]);

  useEffect(() => {
    if (!block) {
      return;
    }

    if (block.kind === "explain" && block.focus) {
      void focusAnchor(block.focus);
      return;
    }

    if (block.kind === "recall") {
      void prepareRecall(block);
    }
  }, [block?.id, project.id]);

  // Expose tree data to parent for sidebar rendering.
  useEffect(() => {
    onTreeChange(
      tree,
      activeFilePath,
      relevantPath,
      (path: string) => {
        void openFileAndRecord(path);
      },
      (path: string) => {
        void createWorkspaceFile(path);
      },
      async (path: string) => {
        await deleteWorkspaceFile(path);
      },
      async (oldPath: string, newPath: string) => {
        await renameWorkspaceFile(oldPath, newPath);
      },
      async (path: string) => {
        await createWorkspaceFolder(path);
      },
      async (path: string, destPath: string) => {
        await duplicateWorkspaceFile(path, destPath);
      }
    );
  }, [tree, activeFilePath, relevantPath]);

  async function refreshTree() {
    setTree(await listFiles(project.id));
  }

  async function persistProject(patch: Parameters<typeof updateProject>[0]["patch"]) {
    onProjectChange(await updateProject({ id: project.id, patch }));
  }

  async function persistAssistance(
    blockId: string,
    update: (assistance: BlockAssistance) => BlockAssistance
  ) {
    const current = {
      ...emptyBlockAssistance(),
      ...(assistance[blockId] ?? {})
    };
    await persistProject({
      assistance: {
        ...assistance,
        [blockId]: update(current)
      }
    });
  }

  function openReferenceCard(referenceId: string) {
    setOpenReferenceIds((current) => (
      current.includes(referenceId) ? current : [...current, referenceId]
    ));

    if (block) {
      void persistAssistance(block.id, (assistance) => ({
        ...assistance,
        referenceCardsOpened: uniqueStrings([
          ...assistance.referenceCardsOpened,
          referenceId
        ])
      }));
    }
  }

  function closeReferenceCard(referenceId: string) {
    setOpenReferenceIds((current) => current.filter((id) => id !== referenceId));
    setPinnedReferenceIds((current) => current.filter((id) => id !== referenceId));
  }

  function setReferencePinned(referenceId: string, pinned: boolean) {
    setPinnedReferenceIds((current) => {
      const next = pinned
        ? uniqueStrings([...current, referenceId])
        : current.filter((id) => id !== referenceId);

      return next;
    });

    if (pinned && block) {
      void persistAssistance(block.id, (assistance) => ({
        ...assistance,
        referenceCardsPinned: uniqueStrings([
          ...assistance.referenceCardsPinned,
          referenceId
        ])
      }));
    }
  }

  async function prepareRecall(recall: RecallBlock) {
    setFocusRange(null);
    const targetPath = await resolveRecallPath(recall);

    if (targetPath) {
      await openFile(targetPath);
      await focusRecallTarget(recall);
    }

    if (autoOpenedRecallRef.current !== recall.id) {
      autoOpenedRecallRef.current = recall.id;
      for (const referenceId of recall.references) {
        openReferenceCard(referenceId);
      }
    }
  }

  async function resolveRecallPath(recall: RecallBlock): Promise<string | null> {
    if (recall.path) {
      return recall.path;
    }

    if (recall.target) {
      const target = targets.find((candidate) => candidate.id === recall.target);
      if (target) {
        return target.path;
      }

      const edit = findEditByAnchor(recall.target);
      if (edit) {
        return edit.path;
      }
    }

    return null;
  }

  async function focusRecallTarget(recall: RecallBlock) {
    if (!recall.target) {
      return;
    }

    const target = targets.find((candidate) => candidate.id === recall.target);
    if (target) {
      await focusTarget(target.id);
      return;
    }

    await focusAnchor(recall.target);
  }

  async function focusReferenceLink(link: ReferenceLink) {
    if (link.anchor) {
      await focusAnchor(link.anchor);
      return;
    }

    if (link.file) {
      await openFile(link.file);
      setFocusRange({ line: 1, column: 1 });
    }
  }

  async function focusTarget(targetId: string) {
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target) {
      return;
    }

    await openFile(target.path);

    if (target.anchor) {
      await focusAnchor(target.anchor);
      return;
    }

    if (target.line) {
      setFocusRange({ line: target.line, column: 1 });
      return;
    }

    if (target.find) {
      const content = await readMaybeFile(target.path);
      const offset = content.indexOf(target.find);
      if (offset >= 0) {
        setFocusRange({
          line: lineNumberForOffset(content, offset),
          column: 1
        });
      }
    }
  }

  async function focusAnchor(anchor: string) {
    const edit = findEditByAnchor(anchor);
    if (!edit) {
      return;
    }

    await openFile(edit.path);
    const content = await readMaybeFile(edit.path);
    const needle = edit.content.trim();
    const offset = needle ? content.indexOf(needle) : -1;
    const line = offset >= 0 ? lineNumberForOffset(content, offset) : 1;
    const lineCount = edit.content.split("\n").length;

    setFocusRange({
      line,
      endLine: Math.max(line, line + lineCount - 1),
      column: 1
    });
  }

  function findEditByAnchor(anchor: string): EditBlock | null {
    for (const step of project.program.steps) {
      for (const candidate of step.blocks) {
        if (candidate.kind === "edit" && candidate.anchor === anchor) {
          return candidate;
        }
      }
    }

    return null;
  }

  async function openFile(path: string) {
    const file = await readMaybeFile(path);
    setActiveFileContent(file);
    await persistProject({ activeFilePath: path });
  }

  async function openFileAndRecord(path: string) {
    await openFile(path);
    onFileOpened?.(path);
  }

  async function deleteWorkspaceFile(rawPath: string) {
    const nextPath = normalizeWorkspacePath(rawPath);
    if (!nextPath) return;
    onSavingChange?.(true);
    try {
      await deleteFile({ projectId: project.id, path: nextPath });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function renameWorkspaceFile(oldRaw: string, newRaw: string) {
    const oldPath = normalizeWorkspacePath(oldRaw);
    const newPath = normalizeWorkspacePath(newRaw);
    if (!oldPath || !newPath) return;
    onSavingChange?.(true);
    try {
      await renameFile({ projectId: project.id, oldPath, newPath });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function createWorkspaceFolder(rawPath: string) {
    const nextPath = normalizeWorkspacePath(rawPath);
    if (!nextPath) return;
    onSavingChange?.(true);
    try {
      await createFolder({ projectId: project.id, path: nextPath });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function duplicateWorkspaceFile(rawPath: string, rawDestPath: string) {
    const srcPath = normalizeWorkspacePath(rawPath);
    if (!srcPath) return;
    // Auto-generate a unique dest path: append _copy before extension
    const destPath = rawDestPath ? normalizeWorkspacePath(rawDestPath) : generateCopyPath(srcPath);
    if (!destPath) return;
    onSavingChange?.(true);
    try {
      await duplicateFile({ projectId: project.id, path: srcPath, destPath });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function createWorkspaceFile(rawPath: string) {
    const nextPath = normalizeWorkspacePath(rawPath);
    if (!nextPath) {
      throw new Error("Enter a project-relative file path.");
    }

    const existing = await readMaybeFile(nextPath);
    if (existing) {
      await openFileAndRecord(nextPath);
      return;
    }

    onSavingChange?.(true);
    try {
      await writeFile({
        projectId: project.id,
        path: nextPath,
        content: ""
      });
      await refreshTree();
      await openFileAndRecord(nextPath);
    } finally {
      onSavingChange?.(false);
    }
  }

  async function prepareEdit(edit: EditBlock) {
    onSavingChange?.(true);
    try {
      const existing = await readMaybeFile(edit.path);
      const anchor =
        editAnchors[edit.id] ??
        deriveEditAnchor({
          edit,
          existing,
          progress: typingProgress[edit.id] ?? 0
        });

      if (!editAnchors[edit.id]) {
        await persistProject({
          activeFilePath: edit.path,
          editAnchors: {
            ...editAnchors,
            [edit.id]: anchor
          }
        });
      } else if (project.activeFilePath !== edit.path) {
        await persistProject({ activeFilePath: edit.path });
      }

      await writeFile({
        projectId: project.id,
        path: edit.path,
        content: `${anchor}${edit.content.slice(0, typingProgress[edit.id] ?? 0)}`
      });
      setActiveFileContent(`${anchor}${edit.content.slice(0, typingProgress[edit.id] ?? 0)}`);
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function readMaybeFile(path: string): Promise<string> {
    try {
      return (await readFile({ projectId: project.id, path })).content;
    } catch {
      return "";
    }
  }

  async function handleFreeEdit(content: string) {
    if (!activeFilePath) {
      return;
    }

    onSavingChange?.(true);
    try {
      setActiveFileContent(content);
      await writeFile({ projectId: project.id, path: activeFilePath, content });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function handleManualSave() {
    if (!activeFilePath) {
      return;
    }

    onSavingChange?.(true);
    try {
      await writeFile({ projectId: project.id, path: activeFilePath, content: activeFileContent });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function handleGuidedProgress(progress: number) {
    if (!activeEdit) {
      return;
    }

    onSavingChange?.(true);
    try {
      const nextContent = `${editAnchor}${activeEdit.content.slice(0, progress)}`;
      setActiveFileContent(nextContent);
      await writeFile({
        projectId: project.id,
        path: activeEdit.path,
        content: nextContent
      });
      await persistProject({
        typingProgress: {
          ...typingProgress,
          [activeEdit.id]: progress
        }
      });
    } finally {
      onSavingChange?.(false);
    }
  }

  async function handleRevealLineAssistance() {
    if (!activeEdit) {
      return;
    }

    await persistAssistance(activeEdit.id, (assistance) => ({
      ...assistance,
      revealLineCount: assistance.revealLineCount + 1
    }));
  }

  async function handleVerifyRecall() {
    if (!block || block.kind !== "recall" || !block.verify) {
      return;
    }

    setVerifyingId(block.verify.id);
    setVerificationLogs((current) => ({
      ...current,
      [block.verify!.id]: buildVerificationStartLogs(block)
    }));
    await persistAssistance(block.id, (assistance) => ({
      ...assistance,
      recallAttemptCount: assistance.recallAttemptCount + 1
    }));

    try {
      const result = await verifyRecall({
        projectId: project.id,
        recall: block,
        references: block.references
          .map((referenceId) => references.find((reference) => reference.id === referenceId))
          .filter((reference): reference is (typeof references)[number] => Boolean(reference))
      });
      setVerificationLogs((current) => ({
        ...current,
        [block.verify!.id]: result.logs ?? current[block.verify!.id] ?? []
      }));
      await persistProject({
        verificationResults: {
          ...verificationResults,
          [block.verify.id]: result
        }
      });

      if (!result.passed) {
        await persistAssistance(block.id, (assistance) => ({
          ...assistance,
          verificationFailureCount: assistance.verificationFailureCount + 1
        }));
      }
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleNext() {
    if (!block) {
      return;
    }

    const position = nextPosition(project);
    await persistProject({
      ...position,
        completedBlocks: {
        ...(project.completedBlocks ?? {}),
        [block.id]: true
      }
    });
  }

  async function handleSelectStep(stepIndex: number) {
    if (stepIndex >= 0 && stepIndex < project.program.steps.length) {
      if (stepIndex <= furthestUnlockedStepIndex) {
        await persistProject({
          currentStepIndex: stepIndex,
          currentBlockIndex: 0,
          activeFilePath: null
        });
      }
    }
  }

  async function handleReturnToActive() {
    await persistProject({
      currentStepIndex: furthestUnlockedStepIndex,
      currentBlockIndex: furthestUnlockedBlockIndex,
      activeFilePath: null
    });
  }

  // Build SlotPanel tabs from openTabs state
  const guideTabContent = useMemo(() => (
    <GuidePanel
      project={project}
      block={block}
      theme={theme}
      editComplete={editComplete}
      onNext={() => void handleNext()}
      onRunCommand={onRunCommand}
      onOpenReference={openReferenceCard}
      onCreateFile={(path) => createWorkspaceFile(path)}
      onVerifyRecall={() => void handleVerifyRecall()}
      verifyingId={verifyingId}
      verificationLogs={block?.kind === "recall" && block.verify
        ? verificationLogs[block.verify.id] ?? []
        : []}
      recallMissingFiles={recallMissingFiles}
    />
  ), [block, editComplete, onRunCommand, project, recallMissingFiles, theme, verificationLogs, verifyingId, furthestUnlockedStepIndex, furthestUnlockedBlockIndex]);

  const stepsTabContent = useMemo(() => (
    <div className={`workspace-right-panel-steps ${isStepsCollapsed ? "is-collapsed" : ""}`}>
      <button
        className="workspace-panel__header"
        onClick={() => setIsStepsCollapsed(prev => !prev)}
        aria-expanded={!isStepsCollapsed}
        aria-label="Toggle steps timeline"
      >
        <span>Steps</span>
        <CaretDown size={11} weight="bold" className="workspace-panel__header-chevron" />
      </button>
      <div className="workspace-right-panel-steps-timeline-container">
        <StepList
          project={project}
          onSelectStep={(idx) => void handleSelectStep(idx)}
          furthestUnlockedStepIndex={furthestUnlockedStepIndex}
        />
      </div>
    </div>
  ), [isStepsCollapsed, project, furthestUnlockedStepIndex]);

  useEffect(() => {
    const panelTabs: SlotTab[] = [
      {
        id: "guide",
        title: "Guide",
        icon: <FileCode size={13} weight="duotone" />,
        active: activeRightSlotId === "guide",
        content: guideTabContent
      },
      {
        id: "steps",
        title: "Steps",
        icon: <File size={13} weight="duotone" />,
        active: activeRightSlotId === "steps",
        content: stepsTabContent
      }
    ];

    onGuidePanelChange(
      <SlotPanel
        activeTabId={activeRightSlotId}
        tabs={panelTabs}
        syncTabs
        launcherItems={panelTabs.map((tab) => ({
          type: tab.id,
          title: tab.title,
          description: tab.id === "guide" ? "Current block explainer" : "Project step timeline",
          icon: tab.icon ?? <File size={13} weight="duotone" />,
          createTab: () => tab
        }))}
        className="construct-guide-slot-panel"
        ariaLabel="Guide and steps tabs"
        onActiveTabChange={(tabId) => onRightSlotChange(tabId ?? "guide")}
      />
    );

    return () => onGuidePanelChange(null);
  }, [activeRightSlotId, guideTabContent, onGuidePanelChange, onRightSlotChange, stepsTabContent]);

  // Build SlotPanel tabs from openTabs state
  const editorSlotTabs: SlotTab[] = useMemo(() => {
    return openTabs.map((tabPath) => {
      const filename = tabPath.split("/").pop() || "";
      const tabActiveEdit =
        tabPath === activeFilePath && isActiveEditReady ? activeEdit : null;
      return {
        id: tabPath,
        title: filename,
        icon: iconForFile(filename),
        closable: true,
        active: tabPath === activeFilePath,
        content: (
          <EditorPane
            path={tabPath}
            content={tabPath === activeFilePath ? activeFileContent : ""}
            activeEdit={tabActiveEdit}
            editAnchor={tabPath === activeFilePath ? editAnchor : ""}
            editProgress={tabPath === activeFilePath ? editProgress : 0}
            onFreeEdit={(content) => void handleFreeEdit(content)}
            onGuidedProgress={(progress) => void handleGuidedProgress(progress)}
            onRevealLine={() => void handleRevealLineAssistance()}
            onSave={() => void handleManualSave()}
            fileList={flattenTree(tree)}
            theme={theme}
            pendingJump={tabPath === activeFilePath ? pendingJump : null}
            focusRange={tabPath === activeFilePath ? focusRange : null}
            onJumpComplete={() => setPendingJump(null)}
            onOpenFileAndJump={async (path, line, col) => {
              setPendingJump({ line, column: col });
              await openFileAndRecord(path);
            }}
            readFileContent={handleReadFileContent}
          />
        ),
      };
    });
  }, [openTabs, activeFilePath, activeFileContent, activeEdit, isActiveEditReady, editAnchor, editProgress, tree, pendingJump, focusRange, handleReadFileContent, theme]);

  // Launcher items for the editor + button
  const editorLauncherItems: SlotLauncherItem[] = useMemo(() => [
    {
      type: "open-file",
      title: "Open file",
      description: "Browse and open a project file",
      icon: <File size={16} weight="duotone" />,
      shortcut: "⌘P",
      createTab: () => ({
        id: `__file-chooser-${Date.now()}`,
        title: "Open file",
        icon: <MagnifyingGlass size={12} weight="bold" />,
        closable: true,
        content: (
          <FileChooserContent
            files={fileList}
            onSelectFile={(path) => {
              void openFileAndRecord(path);
            }}
          />
        ),
      }),
    },
  ], [fileList]);

  // When the user switches tabs in the SlotPanel, load that file's content
  const handleTabChange = useCallback((tabId: string) => {
    // Don't switch to file-chooser tabs
    if (tabId.startsWith("__file-chooser-")) return;
    if (tabId !== activeFilePath) {
      void openFileAndRecord(tabId);
    }
  }, [activeFilePath]);

  // When the user closes a tab in SlotPanel, propagate to Workspace state
  const handleTabClose = useCallback((tabId: string) => {
    void closeTab(tabId);
  }, [openTabs, activeFilePath]);

  return (
    <div className="workspace workspace--editor-only">
      <SlotPanel
        ref={editorPanelRef}
        activeTabId={activeFilePath}
        tabs={editorSlotTabs}
        syncTabs
        launcherItems={editorLauncherItems}
        className="construct-editor-slot-panel"
        ariaLabel="Editor file tabs"
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
      />
      {openReferenceIds.length > 0 ? (
        <div className="construct-floating-card-layer" aria-label="Open reference cards">
          {openReferenceIds
            .map((referenceId) => references.find((reference) => reference.id === referenceId))
            .filter((reference): reference is (typeof references)[number] => Boolean(reference))
            .map((reference) => (
              <ReferenceCard
                key={reference.id}
                card={reference}
                pinned={pinnedReferenceIds.includes(reference.id)}
                theme={theme}
                onClose={() => closeReferenceCard(reference.id)}
                onPinChange={(pinned) => setReferencePinned(reference.id, pinned)}
                onOpenLink={(link) => void focusReferenceLink(link)}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function flattenTree(nodes: WorkspaceTreeNode[]): string[] {
  const result: string[] = [];
  function visit(node: WorkspaceTreeNode) {
    if (node.type === "file") {
      result.push(node.path);
    } else if (node.children) {
      node.children.forEach(visit);
    }
  }
  nodes.forEach(visit);
  return result;
}

function lineNumberForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isGuidedEditReady(
  edit: EditBlock,
  editAnchors: Record<string, string>
): boolean {
  return edit.mode !== "append" || Object.prototype.hasOwnProperty.call(editAnchors, edit.id);
}

function deriveEditAnchor({
  edit,
  existing,
  progress
}: {
  edit: EditBlock;
  existing: string;
  progress: number;
}): string {
  if (edit.mode !== "append") {
    return "";
  }

  const materializedLength = longestMaterializedEditPrefixLength(existing, edit.content, progress);
  const base = materializedLength > 0 ? existing.slice(0, existing.length - materializedLength) : existing;

  if (!base) {
    return "";
  }

  return base.endsWith("\n") ? base : `${base}\n`;
}

function longestMaterializedEditPrefixLength(
  existing: string,
  editContent: string,
  progress: number
): number {
  const max = Math.min(existing.length, editContent.length, progress);

  for (let length = max; length > 0; length -= 1) {
    if (existing.endsWith(editContent.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

function buildVerificationStartLogs(recall: RecallBlock): VerificationLogEntry[] {
  if (!recall.verify) {
    return [];
  }

  const now = new Date().toISOString();
  const files = recall.verify.evidence.files;
  const command = recall.verify.evidence.terminalCommand;

  return [
    {
      at: now,
      status: "running",
      message: "Preparing verifier evidence",
      detail: files.length > 0 ? files.join(", ") : "No files declared."
    },
    {
      at: now,
      status: command ? "pending" : "done",
      message: command ? "Terminal command queued" : "No terminal command declared",
      detail: command ?? "The verifier will judge from files and rubric."
    },
    {
      at: now,
      status: "pending",
      message: "Construct Verifier Agent",
      detail: "Goal, rubric, support, references, files, and terminal evidence will be checked together."
    }
  ];
}

function normalizeWorkspacePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function generateCopyPath(srcPath: string): string {
  const lastDot = srcPath.lastIndexOf(".");
  const lastSlash = srcPath.lastIndexOf("/");
  if (lastDot > lastSlash) {
    // Has extension
    return `${srcPath.slice(0, lastDot)}_copy${srcPath.slice(lastDot)}`;
  }
  return `${srcPath}_copy`;
}
