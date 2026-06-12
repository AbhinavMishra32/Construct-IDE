import {
  CaretDown,
  BookOpen,
  BookmarkSimple,
  CheckCircle,
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FileTs,
  FileTsx,
  GitBranch,
  MagnifyingGlass
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AdaptiveSidecarLayout, HoverPreview, SidebarBottomSlot, SlotPanel, Timeline } from "@opaline/ui";
import { logStore } from "../lib/logStore";
import { lspClient } from "../lib/lspClient";
import type { SlotTab } from "@opaline/ui";
import { EditorPane } from "./EditorPane";
import { GuidePanel } from "./GuidePanel";
import { ReferenceCard } from "./ReferenceCard";
import { KnowledgeCard } from "./KnowledgeCard";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { StepList } from "./StepList";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  gitCommit,
  gitPush,
  gitStatus,
  listFiles,
  onVerifyLog,
  readFile,
  renameFile,
  runConstructInteract,
  updateProject,
  verifyRecall,
  writeFile
} from "../lib/bridge";
import { currentBlock, emptyBlockAssistance, nextPosition } from "../lib/runtime";
import {
  activateDocument,
  closeDocument,
  consumeDocumentReveal,
  createDocumentSession,
  revealDocument,
} from "../lib/documentSession";
import type { InlineFileRef } from "../lib/inlineRefs";
import {
  readKnowledgeRecords,
  recordKnowledgeOpen,
  removeKnowledgeConcept,
  saveKnowledgeConcept
} from "../lib/knowledgeStore";
import type {
  BlockAssistance,
  ConceptCard,
  EditBlock,
  GitActionResult,
  GitMilestone,
  GitMilestoneStatus,
  GitStatus,
  ProjectRecord,
  RecallBlock,
  ReferenceLink,
  VerificationLogEntry,
  ConstructInteractClientResult,
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
  onKnowledgePanelChange,
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
  onKnowledgePanelChange?: (panel: ReactNode | null) => void;
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
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const fileContentsRef = useRef<Record<string, string>>({});
  const [documentSession, setDocumentSession] = useState(() => {
    const initialBlock = currentBlock(project);
    const initialPath = project.activeFilePath
      ?? (initialBlock?.kind === "edit" ? initialBlock.path : null)
      ?? project.program.files[0]?.path
      ?? null;
    return createDocumentSession(normalizeOptionalWorkspacePath(initialPath, project.workspacePath));
  });
  const [isStepsCollapsed, setIsStepsCollapsed] = useState(false);
  const [openReferenceIds, setOpenReferenceIds] = useState<string[]>([]);
  const [pinnedReferenceIds, setPinnedReferenceIds] = useState<string[]>([]);
  const [openConceptIds, setOpenConceptIds] = useState<string[]>([]);
  const [savedConceptIds, setSavedConceptIds] = useState<string[]>(() => initialSavedConceptIds(project, project.program.concepts ?? []));
  const [selectedKnowledgeConceptId, setSelectedKnowledgeConceptId] = useState<string | null>(null);
  const [gitMilestoneStates, setGitMilestoneStates] = useState<Record<string, StoredGitMilestoneState>>(() =>
    readGitMilestoneStates(project.id)
  );
  const [gitMilestoneMessages, setGitMilestoneMessages] = useState<Record<string, string>>({});
  const [gitProjectStatus, setGitProjectStatus] = useState<GitStatus | null>(null);
  const [gitBusyId, setGitBusyId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationLogs, setVerificationLogs] = useState<Record<string, VerificationLogEntry[]>>({});
  const [recallAnswers, setRecallAnswers] = useState<Record<string, string>>({});
  const [interactAnswers, setInteractAnswers] = useState<Record<string, string>>({});
  const [interactResults, setInteractResults] = useState<Record<string, ConstructInteractClientResult>>({});
  const [interactingId, setInteractingId] = useState<string | null>(null);
  const autoOpenedRecallRef = useRef<string | null>(null);
  const fileLoadSequenceRef = useRef(0);

  const typingProgress = project.typingProgress ?? {};
  const editAnchors = project.editAnchors ?? {};
  const assistance = project.assistance ?? {};
  const verificationResults = project.verificationResults ?? {};
  const references = project.program.references ?? [];
  const concepts = project.program.concepts ?? [];
  const gitMilestones = project.program.gitMilestones ?? [];
  const targets = project.program.targets ?? [];
  const block = currentBlock(project);
  const activeEdit = block?.kind === "edit" ? block : null;
  const relevantPath = activeEdit?.path ?? null;
  const activeFilePath = documentSession.activePath;
  const openTabs = documentSession.tabs;
  const pendingJump = documentSession.reveal?.kind === "jump" ? documentSession.reveal : null;
  const focusRange = documentSession.reveal?.kind === "focus" ? documentSession.reveal : null;
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
    (block.kind !== "recall" || !block.verify || verification?.passed === true) &&
    (block.kind !== "interact" || interactResults[block.id]?.shouldAdvance === true);

  const fileList = useMemo(() => flattenTree(tree), [tree]);
  const fileSet = useMemo(() => new Set(fileList), [fileList]);
  const recallMissingFiles = useMemo(() => {
    if (!block || block.kind !== "recall" || !block.verify) {
      return [];
    }

    return block.verify.evidence.files.filter((filePath) => !fileSet.has(filePath));
  }, [block, fileSet]);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    lspClient.setWorkspaceFiles(fileList);
  }, [fileList]);

  useEffect(() => {
    setDocumentSession(createDocumentSession(
      normalizeOptionalWorkspacePath(project.activeFilePath ?? relevantPath ?? project.program.files[0]?.path ?? null, project.workspacePath),
    ));
  }, [project.id]);

  // Reset tabs when project changes
  useEffect(() => {
    setFileContents({});
    setActiveFileContent("");
    setOpenReferenceIds([]);
    setPinnedReferenceIds([]);
    setVerifyingId(null);
    setVerificationLogs({});
    autoOpenedRecallRef.current = null;
  }, [project.id]);

  useEffect(() => {
    setGitMilestoneStates(readGitMilestoneStates(project.id));
    setGitMilestoneMessages(Object.fromEntries(gitMilestones.map((milestone) => [milestone.id, milestone.message])));
    setGitProjectStatus(null);
  }, [project.id, gitMilestones]);

  useEffect(() => {
    let disposed = false;
    gitStatus(project.id)
      .then((status) => {
        if (!disposed) {
          setGitProjectStatus(status);
        }
      })
      .catch(() => {
        if (!disposed) {
          setGitProjectStatus({
            isRepo: false,
            branch: null,
            hasRemote: false,
            dirtyFiles: []
          });
        }
      });

    return () => {
      disposed = true;
    };
  }, [project.id, project.completedBlocks, project.verificationResults]);

  // Handle closing a tab
  async function closeTab(rawTabPath: string) {
    const tabPath = normalizeOptionalWorkspacePath(rawTabPath, project.workspacePath);
    if (!tabPath) {
      return;
    }

    const nextSession = closeDocument(documentSession, tabPath);
    setDocumentSession(nextSession);
    setFileContents((current) => {
      const next = { ...current };
      delete next[tabPath];
      return next;
    });

    if (activeFilePath === tabPath) {
      if (nextSession.activePath) {
        const nextActive = nextSession.activePath;
        await navigateToFile(nextActive, { persist: true });
      } else {
        setActiveFileContent("");
        await persistProject({ activeFilePath: null });
      }
    }
  }

  useEffect(() => {
    void refreshTree();
  }, [project.id]);

  useEffect(() => {
    if (!activeFilePath) {
      setActiveFileContent("");
      return;
    }

    void loadActiveFile(activeFilePath);
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
          
          // Also log to the global verifier log channel
          const msg = `[${log.status.toUpperCase()}] ${log.message}${log.detail ? ` - ${log.detail}` : ""}`;
          logStore.addLog("verifier", msg, log.status === "failed" ? "error" : log.status === "warning" ? "warn" : "info");

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

  function openConceptCard(conceptId: string) {
    const concept = concepts.find((candidate) => candidate.id === conceptId);
    if (concept) recordKnowledgeOpen(project, concept, block?.kind === "recall");
    setOpenConceptIds((current) => (
      current.includes(conceptId) ? current : [...current, conceptId]
    ));
  }

  function closeConceptCard(conceptId: string) {
    setOpenConceptIds((current) => current.filter((id) => id !== conceptId));
  }

  function setConceptSaved(conceptId: string, saved: boolean) {
    const concept = concepts.find((candidate) => candidate.id === conceptId);
    if (!concept) return;
    setSavedConceptIds((current) => {
      const next = saved ? uniqueStrings([...current, conceptId]) : current.filter((id) => id !== conceptId);
      if (saved) saveKnowledgeConcept(project, concept, block?.kind === "recall");
      else removeKnowledgeConcept(project.id, conceptId);
      return next;
    });
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
    setDocumentSession((session) => ({ ...session, reveal: null }));
    const targetPath = await resolveRecallPath(recall);

    if (targetPath) {
      await navigateToFile(targetPath, { persist: true });
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
      await navigateToFile(link.file, { persist: true });
      setDocumentSession((session) => revealDocument(session, {
        kind: "focus",
        path: link.file!,
        line: 1,
        column: 1,
      }));
    }
  }

  async function openInlineFile(reference: InlineFileRef) {
    if (reference.anchor) {
      await focusAnchor(reference.anchor);
      return;
    }
    await navigateToFile(reference.path, { persist: true });
    setDocumentSession((session) => revealDocument(session, {
      kind: reference.endLine ? "focus" : "jump",
      path: reference.path,
      line: reference.line ?? 1,
      endLine: reference.endLine,
      column: 1,
    }));
  }

  async function focusTarget(targetId: string) {
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target) {
      return;
    }

    await navigateToFile(target.path, { persist: true });

    if (target.anchor) {
      await focusAnchor(target.anchor);
      return;
    }

    if (target.line) {
      setDocumentSession((session) => revealDocument(session, {
        kind: "focus",
        path: target.path,
        line: target.line!,
        column: 1,
      }));
      return;
    }

    if (target.find) {
      const content = await readMaybeFile(target.path);
      const offset = content.indexOf(target.find);
      if (offset >= 0) {
        setDocumentSession((session) => revealDocument(session, {
          kind: "focus",
          path: target.path,
          line: lineNumberForOffset(content, offset),
          column: 1,
        }));
      }
    }
  }

  async function focusAnchor(anchor: string) {
    const target = targets.find((candidate) => candidate.anchor === anchor || candidate.id === anchor);
    if (target) {
      await navigateToFile(target.path, { persist: true });

      if (target.line) {
        setDocumentSession((session) => revealDocument(session, {
          kind: "focus",
          path: target.path,
          line: target.line!,
          column: 1,
        }));
        return;
      }

      if (target.find) {
        const content = await readMaybeFile(target.path);
        const offset = content.indexOf(target.find);
        if (offset >= 0) {
          const line = lineNumberForOffset(content, offset);
          const endLine = line + target.find.split("\n").length - 1;
          setDocumentSession((session) => revealDocument(session, {
            kind: "focus",
            path: target.path,
            line,
            endLine,
            column: 1,
          }));
          return;
        }
      }

      setDocumentSession((session) => revealDocument(session, {
        kind: "jump",
        path: target.path,
        line: 1,
        column: 1,
      }));
      return;
    }

    const edit = findEditByAnchor(anchor);
    if (!edit) {
      return;
    }

    await navigateToFile(edit.path, { persist: true });
    const content = await readMaybeFile(edit.path);
    const needle = edit.content.trim();
    const offset = needle ? content.indexOf(needle) : -1;
    if (offset < 0) {
      setDocumentSession((session) => revealDocument(session, {
        kind: "jump",
        path: edit.path,
        line: 1,
        column: 1,
      }));
      return;
    }

    const line = lineNumberForOffset(content, offset);
    const lineCount = needle.split("\n").length;

    setDocumentSession((session) => revealDocument(session, {
      kind: "focus",
      path: edit.path,
      line,
      endLine: Math.max(line, line + lineCount - 1),
      column: 1,
    }));
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

  async function loadActiveFile(rawPath: string) {
    const nextPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
    if (!nextPath) {
      return;
    }

    const sequence = fileLoadSequenceRef.current + 1;
    fileLoadSequenceRef.current = sequence;
    if (fileContentsRef.current[nextPath] != null) {
      setActiveFileContent(fileContentsRef.current[nextPath]);
    }

    const file = await readMaybeFile(nextPath);
    if (fileLoadSequenceRef.current !== sequence) {
      return;
    }

    setActiveFileContent(file);
    setFileContents((current) => ({ ...current, [nextPath]: file }));
  }

  async function navigateToFile(rawPath: string, options: { persist?: boolean } = {}) {
    const nextPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
    if (!nextPath) {
      return;
    }

    const sequence = fileLoadSequenceRef.current + 1;
    fileLoadSequenceRef.current = sequence;
    let file = fileContentsRef.current[nextPath];
    if (file == null) {
      try {
        file = (await readFile({ projectId: project.id, path: nextPath })).content;
      } catch (error) {
        logStore.addLog(
          "main",
          `Could not open ${nextPath}: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
        return;
      }
    }
    if (fileLoadSequenceRef.current !== sequence) {
      return;
    }

    // Load the file before mounting its Monaco model. Sending an empty didOpen for
    // declaration files makes tsserver temporarily replace their on-disk exports.
    setFileContents((current) => ({ ...current, [nextPath]: file }));
    fileContentsRef.current = { ...fileContentsRef.current, [nextPath]: file };
    setActiveFileContent(file);
    setDocumentSession((session) => activateDocument(session, nextPath));
    if (options.persist !== false && project.activeFilePath !== nextPath) {
      await persistProject({ activeFilePath: nextPath });
    }
  }

  async function openFileAndRecord(path: string) {
    const nextPath = normalizeOptionalWorkspacePath(path, project.workspacePath);
    if (!nextPath) {
      return;
    }

    await navigateToFile(nextPath, { persist: true });
    onFileOpened?.(nextPath);
  }

  async function deleteWorkspaceFile(rawPath: string) {
    const nextPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
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
    const oldPath = normalizeOptionalWorkspacePath(oldRaw, project.workspacePath);
    const newPath = normalizeOptionalWorkspacePath(newRaw, project.workspacePath);
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
    const nextPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
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
    const srcPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
    if (!srcPath) return;
    // Auto-generate a unique dest path: append _copy before extension
    const destPath = rawDestPath ? normalizeOptionalWorkspacePath(rawDestPath, project.workspacePath) : generateCopyPath(srcPath);
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
    const nextPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
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

      const editPath = normalizeOptionalWorkspacePath(edit.path, project.workspacePath);
      if (!editPath) {
        return;
      }

      if (!editAnchors[edit.id]) {
        await persistProject({
          activeFilePath: editPath,
          editAnchors: {
            ...editAnchors,
            [edit.id]: anchor
          }
        });
      } else if (project.activeFilePath !== editPath) {
        await persistProject({ activeFilePath: editPath });
      }

      await writeFile({
        projectId: project.id,
        path: editPath,
        content: `${anchor}${edit.content.slice(0, typingProgress[edit.id] ?? 0)}`
      });
      const nextContent = `${anchor}${edit.content.slice(0, typingProgress[edit.id] ?? 0)}`;
      setActiveFileContent(nextContent);
      setFileContents((current) => ({ ...current, [editPath]: nextContent }));
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

  async function handleFreeEditForPath(rawPath: string, content: string) {
    const targetPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
    if (!targetPath) {
      return;
    }

    onSavingChange?.(true);
    try {
      if (targetPath === activeFilePath) {
        setActiveFileContent(content);
      }
      setFileContents((current) => ({ ...current, [targetPath]: content }));
      await writeFile({ projectId: project.id, path: targetPath, content });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function handleManualSaveForPath(rawPath: string) {
    const targetPath = normalizeOptionalWorkspacePath(rawPath, project.workspacePath);
    if (!targetPath) {
      return;
    }
    const content = fileContentsRef.current[targetPath] ?? (targetPath === activeFilePath ? activeFileContent : "");

    onSavingChange?.(true);
    try {
      await writeFile({ projectId: project.id, path: targetPath, content });
      setFileContents((current) => ({ ...current, [targetPath]: content }));
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
      const editPath = normalizeOptionalWorkspacePath(activeEdit.path, project.workspacePath);
      setActiveFileContent(nextContent);
      if (editPath) {
        setFileContents((current) => ({ ...current, [editPath]: nextContent }));
      }
      await writeFile({
        projectId: project.id,
        path: editPath || activeEdit.path,
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
          .filter((reference): reference is (typeof references)[number] => Boolean(reference)),
        concepts: block.concepts
          .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
          .filter((concept): concept is ConceptCard => Boolean(concept)),
        savedKnowledge: savedConceptIds
          .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
          .filter((concept): concept is ConceptCard => Boolean(concept)),
        answer: block.mode === "reply" ? recallAnswers[block.id] ?? "" : undefined
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

  async function handleConstructInteract() {
    if (!block || block.kind !== "interact") {
      return;
    }

    setInteractingId(block.id);
    try {
      const result = await runConstructInteract({
        projectId: project.id,
        blockId: block.id,
        prompt: block.prompt,
        answer: interactAnswers[block.id] ?? "",
        basis: block.basis,
        understanding: block.understanding,
        assessment: block.assessment,
        resources: block.resources,
        projectContext: {
          title: project.title,
          currentStep: project.program.steps[project.currentStepIndex]?.title,
          currentBlock: block.id,
          concepts: block.resources.concepts
            .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
            .filter(Boolean)
        }
      });
      setInteractResults((current) => ({
        ...current,
        [block.id]: result
      }));
      if (result.shouldAdvance) {
        await handleNext();
      }
    } finally {
      setInteractingId(null);
    }
  }

  async function handleNext() {
    if (!block) {
      return;
    }

    const position = nextPosition(project);
    const nextProject = await updateProject({
      id: project.id,
      patch: {
        ...position,
        completedBlocks: {
          ...(project.completedBlocks ?? {}),
          [block.id]: true
        }
      }
    });
    onProjectChange(nextProject);

    const nextBlock = currentBlock(nextProject);
    if (nextBlock?.kind === "edit") {
      await navigateToFile(nextBlock.path, { persist: false });
    }
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

  async function refreshGitProjectStatus() {
    setGitProjectStatus(await gitStatus(project.id));
  }

  function updateGitMilestoneState(milestoneId: string, patch: Partial<StoredGitMilestoneState>) {
    setGitMilestoneStates((current) => {
      const next = {
        ...current,
        [milestoneId]: {
          ...(current[milestoneId] ?? {}),
          ...patch,
          updatedAt: new Date().toISOString()
        }
      };
      writeGitMilestoneStates(project.id, next);
      return next;
    });
  }

  async function handleCommitMilestone(milestone: GitMilestone, pushAfterCommit: boolean) {
    const message = gitMilestoneMessages[milestone.id] ?? milestone.message;
    setGitBusyId(milestone.id);
    updateGitMilestoneState(milestone.id, {
      status: "suggested",
      message
    });

    try {
      const commitResult = await gitCommit({
        projectId: project.id,
        message,
        paths: milestone.includePaths
      });
      updateGitMilestoneState(milestone.id, gitResultToMilestoneState(commitResult, "committed", message));

      if (!commitResult.success || !pushAfterCommit) {
        await refreshGitProjectStatus();
        return;
      }

      const pushResult = await gitPush(project.id);
      updateGitMilestoneState(milestone.id, gitResultToMilestoneState(pushResult, "pushed", message, commitResult.commitHash));
      await refreshGitProjectStatus();
    } finally {
      setGitBusyId(null);
    }
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
      onOpenConcept={openConceptCard}
      onOpenFile={(reference) => void openInlineFile(reference)}
      onCreateFile={(path) => createWorkspaceFile(path)}
      onVerifyRecall={() => void handleVerifyRecall()}
      recallAnswer={block?.kind === "recall" ? recallAnswers[block.id] ?? "" : ""}
      onRecallAnswerChange={(answer) => {
        if (block?.kind === "recall") {
          setRecallAnswers((current) => ({ ...current, [block.id]: answer }));
        }
      }}
      interactAnswer={block?.kind === "interact" ? interactAnswers[block.id] ?? "" : ""}
      onInteractAnswerChange={(answer) => {
        if (block?.kind === "interact") {
          setInteractAnswers((current) => ({ ...current, [block.id]: answer }));
        }
      }}
      interactResult={block?.kind === "interact" ? interactResults[block.id] : undefined}
      onSubmitInteract={() => void handleConstructInteract()}
      interactingId={interactingId}
      verifyingId={verifyingId}
      verificationLogs={block?.kind === "recall" && block.verify
        ? verificationLogs[block.verify.id] ?? []
        : []}
      recallMissingFiles={recallMissingFiles}
    />
  ), [block, editComplete, interactAnswers, interactResults, interactingId, onRunCommand, project, recallAnswers, recallMissingFiles, theme, verificationLogs, verifyingId, furthestUnlockedStepIndex, furthestUnlockedBlockIndex]);

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

  const sidebarKnowledgeContent = useMemo(() => {
    const currentConceptIds = block?.kind === "recall" || block?.kind === "explain" ? block.concepts : [];
    const introducedConceptIds = conceptIdsIntroducedThrough(
      project,
      furthestUnlockedStepIndex,
      furthestUnlockedBlockIndex
    );
    const introducedConcepts = introducedConceptIds
      .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
      .filter((concept): concept is ConceptCard => Boolean(concept));
    const savedConcepts = introducedConcepts.filter((concept) => savedConceptIds.includes(concept.id));
    const availableConcepts = introducedConcepts.filter((concept) => !savedConceptIds.includes(concept.id));

    if (introducedConcepts.length === 0) {
      return null;
    }

    return (
      <SidebarBottomSlot
        className="construct-sidebar-knowledge-slot"
        defaultHeight={Math.min(320, Math.max(150, 58 + introducedConcepts.length * 34))}
        minHeight={118}
        maxHeight={520}
        header={<div className="construct-sidebar-knowledge__header">
          <BookOpen size={14} weight="duotone" />
          <span>Knowledge</span>
          <small>{savedConcepts.length}/{introducedConcepts.length}</small>
        </div>}
      >
        <section className="construct-sidebar-knowledge" aria-label="Project knowledge" data-construct-explainable="knowledge-card" data-construct-explainable-label="Project knowledge">
          {availableConcepts.length > 0 ? (
            <div className="construct-sidebar-knowledge__list">
              {availableConcepts.map((concept) => renderSidebarConceptRow(concept, false, currentConceptIds.includes(concept.id)))}
            </div>
          ) : null}
          {savedConcepts.length > 0 ? (
            <div className="construct-sidebar-knowledge__saved">
              <span className="construct-sidebar-knowledge__group-label">Saved</span>
              <div className="construct-sidebar-knowledge__list">
                {savedConcepts.map((concept) => renderSidebarConceptRow(concept, true, currentConceptIds.includes(concept.id)))}
              </div>
            </div>
          ) : null}
        </section>
      </SidebarBottomSlot>
    );

    function renderSidebarConceptRow(concept: ConceptCard, isSaved: boolean, isCurrent: boolean) {
      return (
        <HoverPreview
          key={concept.id}
          content={<div className="construct-knowledge-preview"><span>{concept.kind}</span><strong>{concept.title}</strong><p>{concept.summary}</p>{concept.tags.length ? <small>{concept.tags.join(" · ")}</small> : null}</div>}
        >
          <button
            className="construct-sidebar-knowledge__row"
            data-current={isCurrent ? "true" : "false"}
            onClick={() => {
              recordKnowledgeOpen(project, concept, block?.kind === "recall");
              setSelectedKnowledgeConceptId(concept.id);
            }}
            type="button"
          >
            <BookOpen size={13} weight="regular" />
            <span>{concept.title}</span>
            {isSaved ? <BookmarkSimple size={12} weight="fill" /> : null}
          </button>
        </HoverPreview>
      );
    }
  }, [block, concepts, furthestUnlockedBlockIndex, furthestUnlockedStepIndex, project, savedConceptIds]);

  const gitTabContent = useMemo(() => (
    <div className="git-panel">
      <div className="git-panel__status">
        <GitBranch size={16} weight="duotone" />
        <div>
          <strong>{gitProjectStatus?.isRepo ? gitProjectStatus.branch ?? "Git repository" : "No repository"}</strong>
          <span>
            {gitProjectStatus?.isRepo
              ? `${gitProjectStatus.dirtyFiles.length} changed file${gitProjectStatus.dirtyFiles.length === 1 ? "" : "s"}${gitProjectStatus.hasRemote ? " · remote ready" : ""}`
              : "Initialize git when importing a project to enable milestone commits."}
          </span>
        </div>
      </div>

      {gitMilestones.length > 0 ? <Timeline className="git-panel__timeline" items={gitMilestones.map((milestone) => {
          const stored = gitMilestoneStates[milestone.id];
          const status = resolveMilestoneStatus(milestone, stored, project);
          const isBusy = gitBusyId === milestone.id;
          const message = gitMilestoneMessages[milestone.id] ?? milestone.message;
          const canCommit = gitProjectStatus?.isRepo === true && status !== "pending" && status !== "committed" && status !== "pushed" && !isBusy;

          return {
            id: milestone.id,
            title: milestoneStatusLabel(status),
            meta: milestone.after,
            status: status === "suggested" ? "warning" : status === "committed" ? "active" : status === "pushed" ? "pushed" : status === "failed" ? "error" : "pending",
            icon: status === "committed" || status === "pushed" ? <CheckCircle weight="bold" /> : <GitBranch weight="bold" />,
            content: <div className="git-panel__milestone-body">
                <div className="git-panel__milestone-head">
                  <span>{milestone.description || "Suggested commit for this learning milestone."}</span>
                </div>
                <input
                  value={message}
                  onChange={(event) => setGitMilestoneMessages((current) => ({
                    ...current,
                    [milestone.id]: event.target.value
                  }))}
                  aria-label={`Commit message for ${milestone.id}`}
                />
                <div className="git-panel__files">
                  {milestone.includePaths.length > 0
                    ? milestone.includePaths.map((includePath) => <code key={includePath}>{includePath}</code>)
                    : <code>all changed files</code>}
                </div>
                {stored?.output ? <pre>{stored.output}</pre> : null}
                <div className="git-panel__actions">
                  <button type="button" disabled={!canCommit} onClick={() => void handleCommitMilestone(milestone, false)}>
                    <CheckCircle size={13} weight="duotone" />
                    {isBusy ? "Committing" : "Commit"}
                  </button>
                  <button type="button" disabled={!canCommit || gitProjectStatus?.hasRemote !== true} onClick={() => void handleCommitMilestone(milestone, true)}>
                    <GitBranch size={13} weight="duotone" />
                    Commit + Push
                  </button>
                  <button
                    type="button"
                    disabled={status === "pending" || isBusy}
                    onClick={() => updateGitMilestoneState(milestone.id, { status: "pending", output: "Deferred for later." })}
                  >
                    Later
                  </button>
                </div>
              </div>
          };
        })} /> : (
          <p className="git-panel__empty">No git milestones are declared in this tape yet.</p>
        )}
    </div>
  ), [gitBusyId, gitMilestoneMessages, gitMilestoneStates, gitMilestones, gitProjectStatus, project]);

  useEffect(() => {
    const normalizedRightSlotId = activeRightSlotId === "knowledge" ? "guide" : activeRightSlotId;
    if (normalizedRightSlotId !== activeRightSlotId) {
      onRightSlotChange(normalizedRightSlotId);
      return;
    }

    const panelTabs: SlotTab[] = [
      {
        id: "guide",
        title: "Guide",
        icon: <FileCode size={13} weight="duotone" />,
        active: normalizedRightSlotId === "guide",
        content: guideTabContent
      },
      {
        id: "steps",
        title: "Steps",
        icon: <File size={13} weight="duotone" />,
        active: normalizedRightSlotId === "steps",
        content: stepsTabContent
      },
      {
        id: "git",
        title: "Git",
        icon: <GitBranch size={13} weight="duotone" />,
        active: normalizedRightSlotId === "git",
        content: gitTabContent
      }
    ];

    onGuidePanelChange(
      <SlotPanel
        activeTabId={normalizedRightSlotId}
        tabs={panelTabs}
        syncTabs
        className="construct-guide-slot-panel"
        ariaLabel="Guide and steps tabs"
        onActiveTabChange={(tabId) => onRightSlotChange(tabId ?? "guide")}
      />
    );

    return () => onGuidePanelChange(null);
  }, [activeRightSlotId, gitTabContent, guideTabContent, onGuidePanelChange, onRightSlotChange, stepsTabContent]);

  useEffect(() => {
    onKnowledgePanelChange?.(sidebarKnowledgeContent);
    return () => onKnowledgePanelChange?.(null);
  }, [onKnowledgePanelChange, sidebarKnowledgeContent]);

  // The tab strip owns document identity while one persistent Monaco instance
  // switches models beneath it. This avoids disposing editor services on every
  // tab close or navigation event.
  const editorSlotTabs: SlotTab[] = useMemo(() => {
    return uniqueStrings(openTabs.map(normalizeWorkspacePath).filter(Boolean)).map((tabPath) => {
      const filename = tabPath.split("/").pop() || "";
      const isActiveTab = tabPath === activeFilePath;
      return {
        id: tabPath,
        title: filename,
        icon: iconForFile(filename),
        closable: true,
        active: isActiveTab,
        content: null,
      };
    });
  }, [openTabs, activeFilePath]);

  const editorOutlet = (
    <EditorPane
      path={activeFilePath}
      workspacePath={project.workspacePath}
      content={activeFilePath ? fileContents[activeFilePath] ?? activeFileContent : ""}
      activeEdit={isActiveEditReady ? activeEdit : null}
      editAnchor={editAnchor}
      editProgress={editProgress}
      onFreeEdit={(content) => activeFilePath && void handleFreeEditForPath(activeFilePath, content)}
      onGuidedProgress={(progress) => void handleGuidedProgress(progress)}
      onRevealLine={() => void handleRevealLineAssistance()}
      onSave={() => activeFilePath && void handleManualSaveForPath(activeFilePath)}
      theme={theme}
      pendingJump={pendingJump ? { line: pendingJump.line, column: pendingJump.column ?? 1 } : null}
      focusRange={focusRange}
      onJumpComplete={() => {
        if (documentSession.reveal) {
          setDocumentSession((session) => consumeDocumentReveal(session, documentSession.reveal!.id));
        }
      }}
      onOpenFileAndJump={async (path, line, col) => {
        await navigateToFile(path, { persist: true });
        setDocumentSession((session) => revealDocument(session, {
          kind: "jump",
          path,
          line,
          column: col,
        }));
        onFileOpened?.(path);
      }}
    />
  );

  // When the user switches tabs in the SlotPanel, load that file's content
  const handleTabChange = useCallback((tabId: string) => {
    const nextPath = normalizeOptionalWorkspacePath(tabId, project.workspacePath);
    if (nextPath && nextPath !== activeFilePath) {
      void openFileAndRecord(nextPath);
    }
  }, [activeFilePath, project.workspacePath]);

  // When the user closes a tab in SlotPanel, propagate to Workspace state
  const handleTabClose = useCallback((tabId: string) => {
    void closeTab(tabId);
  }, [openTabs, activeFilePath]);

  const hasOpenContextCards = openReferenceIds.length > 0 || openConceptIds.length > 0;
  const hasPinnedContextCard = openReferenceIds.some((referenceId) => pinnedReferenceIds.includes(referenceId));
  const contextCards = hasOpenContextCards ? (
    <div className="construct-context-card-stack" aria-label="Open reference and knowledge cards">
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
            onOpenFile={(reference) => void openInlineFile(reference)}
          />
        ))}
      {openConceptIds
        .map((conceptId) => project.program.concepts.find((concept) => concept.id === conceptId))
        .filter((concept): concept is (typeof project.program.concepts)[number] => Boolean(concept))
        .map((concept) => (
          <KnowledgeCard
            key={concept.id}
            concept={concept}
            saved={savedConceptIds.includes(concept.id)}
            theme={theme}
            onClose={() => closeConceptCard(concept.id)}
            onOpenConcept={openConceptCard}
            onOpenFile={(reference) => void openInlineFile(reference)}
            onSaveChange={(saved) => setConceptSaved(concept.id, saved)}
          />
        ))}
    </div>
  ) : null;

  return (
    <AdaptiveSidecarLayout
      className="workspace workspace--editor-only construct-workspace-sidecar"
      open={hasOpenContextCards}
      pinned={hasPinnedContextCard}
      sidecar={contextCards}
    >
      <SlotPanel
        activeTabId={activeFilePath ?? undefined}
        tabs={editorSlotTabs}
        syncTabs
        outlet={editorOutlet}
        className="construct-editor-slot-panel"
        ariaLabel="Editor file tabs"
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
      />
      <KnowledgeDialog
        concept={concepts.find((concept) => concept.id === selectedKnowledgeConceptId) ?? null}
        open={selectedKnowledgeConceptId != null}
        saved={selectedKnowledgeConceptId != null && savedConceptIds.includes(selectedKnowledgeConceptId)}
        theme={theme}
        onOpenChange={(open) => { if (!open) setSelectedKnowledgeConceptId(null); }}
        onOpenConcept={openConceptCard}
        onOpenFile={(reference) => void openInlineFile(reference)}
        onSaveChange={(saved) => { if (selectedKnowledgeConceptId) setConceptSaved(selectedKnowledgeConceptId, saved); }}
      />
    </AdaptiveSidecarLayout>
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

function uniqueConcepts(values: ConceptCard[]): ConceptCard[] {
  const seen = new Set<string>();
  return values.filter((concept) => {
    if (seen.has(concept.id)) {
      return false;
    }

    seen.add(concept.id);
    return true;
  });
}

function conceptIdsIntroducedThrough(project: ProjectRecord, stepIndex: number, blockIndex: number): string[] {
  const ids: string[] = [];
  const known = new Set(project.program.concepts.map((concept) => concept.id));

  for (let currentStepIndex = 0; currentStepIndex <= stepIndex; currentStepIndex += 1) {
    const step = project.program.steps[currentStepIndex];
    if (!step) continue;
    const finalBlockIndex = currentStepIndex === stepIndex ? Math.min(blockIndex, step.blocks.length - 1) : step.blocks.length - 1;
    for (let currentBlockIndex = 0; currentBlockIndex <= finalBlockIndex; currentBlockIndex += 1) {
      const current = step.blocks[currentBlockIndex];
      if (!current) continue;
      const declared = current.kind === "explain" || current.kind === "recall" ? current.concepts : [];
      const inlineText = current.kind === "explain"
        ? current.content
        : current.kind === "recall"
          ? `${current.task}\n${current.support}`
          : "";
      const inline = [...inlineText.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]);
      for (const id of [...declared, ...inline]) {
        if (known.has(id) && !ids.includes(id)) ids.push(id);
      }
    }
  }

  return ids;
}

function initialSavedConceptIds(project: ProjectRecord, concepts: ConceptCard[]): string[] {
  const existing = readKnowledgeRecords().filter((record) => record.sourceProjectId === project.id).map((record) => record.id);
  try {
    const legacy = JSON.parse(window.localStorage.getItem("construct.knowledge.savedConceptIds") ?? "[]");
    if (Array.isArray(legacy)) {
      for (const conceptId of legacy) {
        const concept = concepts.find((candidate) => candidate.id === conceptId);
        if (concept && !existing.includes(concept.id)) {
          saveKnowledgeConcept(project, concept);
          existing.push(concept.id);
        }
      }
    }
  } catch {
    // Ignore malformed legacy storage and keep valid records.
  }
  return uniqueStrings(existing);
}

type StoredGitMilestoneState = {
  status?: GitMilestoneStatus;
  message?: string;
  output?: string;
  commitHash?: string;
  updatedAt?: string;
};

function gitMilestoneStorageKey(projectId: string): string {
  return `construct.git.milestones.${projectId}`;
}

function readGitMilestoneStates(projectId: string): Record<string, StoredGitMilestoneState> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(gitMilestoneStorageKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, StoredGitMilestoneState>
      : {};
  } catch {
    return {};
  }
}

function writeGitMilestoneStates(projectId: string, states: Record<string, StoredGitMilestoneState>): void {
  window.localStorage.setItem(gitMilestoneStorageKey(projectId), JSON.stringify(states));
}

function gitResultToMilestoneState(
  result: GitActionResult,
  successStatus: GitMilestoneStatus,
  message: string,
  fallbackCommitHash?: string
): StoredGitMilestoneState {
  return {
    status: result.success ? successStatus : "failed",
    message,
    output: result.output || (result.success ? "Done." : "Git command failed."),
    commitHash: result.commitHash ?? fallbackCommitHash
  };
}

function resolveMilestoneStatus(
  milestone: GitMilestone,
  stored: StoredGitMilestoneState | undefined,
  project: ProjectRecord
): GitMilestoneStatus {
  if (stored?.status === "committed" || stored?.status === "pushed" || stored?.status === "failed") {
    return stored.status;
  }

  const linkedVerificationPassed = project.verificationResults?.[milestone.after]?.passed === true;
  const linkedBlockCompleted = project.completedBlocks?.[milestone.after] === true;
  if (linkedVerificationPassed || linkedBlockCompleted) {
    return "suggested";
  }

  return "pending";
}

function milestoneStatusLabel(status: GitMilestoneStatus): string {
  switch (status) {
    case "suggested":
      return "Suggested";
    case "committed":
      return "Committed";
    case "pushed":
      return "Pushed";
    case "failed":
      return "Failed";
    case "pending":
    default:
      return "Waiting";
  }
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

function normalizeOptionalWorkspacePath(path: string | null | undefined, workspacePath?: string): string | null {
  if (!path) {
    return null;
  }

  const withoutFileScheme = path.replace(/^file:\/\//, "");
  if (isAbsoluteFilesystemPath(withoutFileScheme)) {
    if (!workspacePath) {
      return null;
    }

    const relative = relativeWorkspacePath(workspacePath, withoutFileScheme);
    if (!relative) {
      console.warn("[construct] Ignoring absolute path outside workspace", {
        path,
        workspacePath
      });
      return null;
    }

    return relative;
  }

  const normalized = normalizeWorkspacePath(withoutFileScheme);
  return normalized || null;
}

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

function relativeWorkspacePath(workspacePath: string, absolutePath: string): string | null {
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedAbsolute = absolutePath.replace(/\\/g, "/");
  if (normalizedAbsolute === normalizedWorkspace) {
    return "";
  }

  if (!normalizedAbsolute.startsWith(`${normalizedWorkspace}/`)) {
    return null;
  }

  return normalizeWorkspacePath(normalizedAbsolute.slice(normalizedWorkspace.length + 1));
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
