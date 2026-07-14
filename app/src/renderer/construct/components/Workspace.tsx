import {
  CaretDown,
  BookOpen,
  BookmarkSimple,
  CheckCircle,
  File,
  FileCode,
  GitBranch,
  ChatCircle,
  PlusCircle,
  ArrowCounterClockwise
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AdaptiveSidecarLayout, Button, HoverPreview, SidebarBottomSlot, SlotPanel, Timeline } from "@opaline/ui";
import { logStore } from "../lib/logStore";
import { lspClient } from "../lib/lspClient";
import { apiTracker } from "../lib/apiTracker";
import type { SlotTab } from "@opaline/ui";
import { EditorPane } from "./EditorPane";
import { GuidePanel } from "./GuidePanel";
import { ConstructInteractSession } from "./guide/ConstructInteractSession";
import { ReferenceCard } from "./ReferenceCard";
import { KnowledgeCard } from "./KnowledgeCard";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { StepList } from "./StepList";
import { FileChooserContent, iconForFile } from "./workspace/FileChooserContent";
import { LiveStepPanel } from "./workspace/LiveStepPanel";
import {
  deriveEditAnchor,
  isGuidedEditReady,
  lineNumberForOffset
} from "./workspace/editGuidance";
import {
  gitResultToMilestoneState,
  milestoneStatusLabel,
  readGitMilestoneStates,
  resolveMilestoneStatus,
  writeGitMilestoneStates,
  type StoredGitMilestoneState
} from "./workspace/gitMilestoneState";
import { buildVerificationStartLogs } from "./workspace/verificationLogSeed";
import {
  conceptIdsIntroducedThrough,
  initialSavedConceptIds,
  uniqueConcepts,
  uniqueStrings
} from "./workspace/workspaceKnowledge";
import {
  generateCopyPath,
  isAbsoluteFilesystemPath,
  normalizeOptionalWorkspacePath,
  normalizeWorkspacePath,
  relativeWorkspacePath
} from "./workspace/workspacePaths";
import { flattenTree } from "./workspace/workspaceTree";
import {
  createFolder,
  deleteFile,
  duplicateFile,
  gitCommit,
  gitPush,
  gitStatus,
  applyLearningPatch,
  getProjectLearningState,
  getUiState,
  listFiles,
  onVerifyLog,
  onConstructInteractSessionEvent,
  readFile,
  readLspSourceFile,
  renameFile,
  runConstructInteract,
  setUiState,
  updateProject,
  verifyRecall,
  writeFile,
  onFileChanged
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
  recordKnowledgeOpen,
  removeKnowledgeConcept,
  saveKnowledgeConcept
} from "../lib/knowledgeStore";
import type {
  BlockAssistance,
  ConstructBlock,
  ConceptCard,
  ConstructTarget,
  EditBlock,
  GitMilestone,
  GitStatus,
  ProjectRecord,
  RecallBlock,
  ReferenceCard as ReferenceCardData,
  ReferenceLink,
  VerificationLogEntry,
  ConstructInteractClientResult,
  WorkspaceTreeNode
} from "../types";
import type {
  ConstructInteractSession as ConstructInteractSessionRecord,
  GeneratedLiveStep,
  ProjectLearningState
} from "../../../shared/constructLearning";

const EMPTY_CONCEPTS: ConceptCard[] = [];
const EMPTY_GENERATED_LIVE_STEPS: GeneratedLiveStep[] = [];
const EMPTY_GIT_MILESTONES: GitMilestone[] = [];
const EMPTY_REFERENCE_CARDS: ReferenceCardData[] = [];
const EMPTY_TARGETS: ConstructTarget[] = [];
const WORKSPACE_CONTEXT_CARDS_UI_STATE_KEY = "workspace.context-cards";

type WorkspaceContextCardsUiState = {
  version: 1;
  openReferenceIds: string[];
  pinnedReferenceIds: string[];
  openConceptIds: string[];
};

function resolveNavigableFilePath(rawPath: string, workspacePath: string): string | null {
  const withoutFileScheme = rawPath.replace(/^file:\/\//, "");
  if (isAbsoluteFilesystemPath(withoutFileScheme)) {
    return relativeWorkspacePath(workspacePath, withoutFileScheme) ?? withoutFileScheme;
  }

  const normalized = normalizeWorkspacePath(withoutFileScheme);
  return normalized || null;
}

function isExternalSourcePath(filePath: string, workspacePath: string): boolean {
  return isAbsoluteFilesystemPath(filePath) && relativeWorkspacePath(workspacePath, filePath) == null;
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
    duplicateFileFn: (path: string, destPath: string) => Promise<void>,
    refreshTreeFn: () => Promise<void>
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
  const [contextCardsUiStateHydrated, setContextCardsUiStateHydrated] = useState(false);
  const [savedConceptIds, setSavedConceptIds] = useState<string[]>(() => initialSavedConceptIds(project, project.program.concepts ?? EMPTY_CONCEPTS));
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
  const [liveInteractSessions, setLiveInteractSessions] = useState<Record<string, ConstructInteractSessionRecord>>({});
  const [lessonInteractThreadIds, setLessonInteractThreadIds] = useState<Record<string, string>>({});
  const [generalInteractAnswer, setGeneralInteractAnswer] = useState("");
  const [generalInteractThreadId, setGeneralInteractThreadId] = useState(() => createInteractThreadId());
  const [generalInteractResult, setGeneralInteractResult] = useState<ConstructInteractClientResult | undefined>();
  const [projectLearningState, setProjectLearningState] = useState<ProjectLearningState | null>(null);
  const [activeLiveStepId, setActiveLiveStepId] = useState<string | null>(null);
  const autoOpenedRecallRef = useRef<string | null>(null);
  const fileLoadSequenceRef = useRef(0);

  useEffect(() => {
    if (gitProjectStatus?.isRepo) {
      apiTracker.setGit(gitProjectStatus.branch, gitProjectStatus.dirtyFiles.length);
    } else {
      apiTracker.setGit(null, 0);
    }
  }, [gitProjectStatus]);

  const typingProgress = project.typingProgress ?? {};
  const editAnchors = project.editAnchors ?? {};
  const assistance = project.assistance ?? {};
  const verificationResults = project.verificationResults ?? {};
  const references = project.program.references ?? EMPTY_REFERENCE_CARDS;
  const concepts = project.program.concepts ?? EMPTY_CONCEPTS;
  const gitMilestones = project.program.gitMilestones ?? EMPTY_GIT_MILESTONES;
  const targets = project.program.targets ?? EMPTY_TARGETS;
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
  const generatedLiveSteps = projectLearningState?.generatedLiveSteps ?? EMPTY_GENERATED_LIVE_STEPS;
  const activeLiveStep = activeLiveStepId
    ? generatedLiveSteps.find((step) => step.id === activeLiveStepId && step.status !== "dismissed") ?? null
    : null;
  const generalInteractBlockId = `general:${project.id}`;
  const activeLessonInteractThreadId = block?.kind === "interact"
    ? lessonInteractThreadIds[block.id] ?? `lesson:${block.id}`
    : null;
  const lessonInteractSessions = useMemo(() => {
    if (!block || block.kind !== "interact") {
      return [];
    }
    return (projectLearningState?.constructInteractSessions ?? []).filter((session) => (
      session.blockId === block.id &&
      (session.threadId ?? `lesson:${block.id}`) === activeLessonInteractThreadId
    ));
  }, [activeLessonInteractThreadId, block, projectLearningState?.constructInteractSessions]);
  const liveLessonInteractSession = block?.kind === "interact" &&
    liveInteractSessions[block.id]?.threadId === activeLessonInteractThreadId
    ? liveInteractSessions[block.id]
    : undefined;
  const generalInteractSessions = useMemo(() => {
    return (projectLearningState?.constructInteractSessions ?? []).filter((session) => session.blockId === generalInteractBlockId);
  }, [generalInteractBlockId, projectLearningState?.constructInteractSessions]);
  const generalInteractThreads = useMemo(() => {
    const byThread = new Map<string, ConstructInteractSessionRecord[]>();
    for (const session of generalInteractSessions) {
      const threadId = session.threadId ?? generalInteractBlockId;
      byThread.set(threadId, [...(byThread.get(threadId) ?? []), session]);
    }
    return [...byThread.entries()]
      .map(([threadId, sessions]) => ({
        threadId,
        label: sessions.at(-1)?.answer.slice(0, 48) || "New chat",
        updatedAt: sessions.at(-1)?.updatedAt ?? sessions.at(-1)?.createdAt ?? ""
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [generalInteractBlockId, generalInteractSessions]);
  const activeGeneralInteractSessions = useMemo(() => {
    return generalInteractSessions.filter((session) => (session.threadId ?? generalInteractBlockId) === generalInteractThreadId);
  }, [generalInteractBlockId, generalInteractSessions, generalInteractThreadId]);
  const liveGeneralInteractSession = liveInteractSessions[generalInteractBlockId]?.threadId === generalInteractThreadId
    ? liveInteractSessions[generalInteractBlockId]
    : undefined;

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
    setOpenConceptIds([]);
    setContextCardsUiStateHydrated(false);
    setVerifyingId(null);
    setVerificationLogs({});
    setInteractingId(null);
    setLiveInteractSessions({});
    setLessonInteractThreadIds({});
    setGeneralInteractAnswer("");
    setGeneralInteractThreadId(createInteractThreadId());
    setGeneralInteractResult(undefined);
    setActiveLiveStepId(null);
    autoOpenedRecallRef.current = null;

    let cancelled = false;
    void getUiState<WorkspaceContextCardsUiState | null>({
      key: WORKSPACE_CONTEXT_CARDS_UI_STATE_KEY,
      scope: "workspace",
      projectId: project.id,
      fallback: null
    }).then((saved) => {
      if (cancelled || !saved || saved.version !== 1) return;
      const referenceIds = new Set((project.program.references ?? EMPTY_REFERENCE_CARDS).map((reference) => reference.id));
      const conceptIds = new Set((project.program.concepts ?? EMPTY_CONCEPTS).map((concept) => concept.id));
      const restoredReferenceIds = uniqueStrings(saved.openReferenceIds ?? []).filter((id) => referenceIds.has(id));
      setOpenReferenceIds(restoredReferenceIds);
      setPinnedReferenceIds(uniqueStrings(saved.pinnedReferenceIds ?? []).filter((id) => restoredReferenceIds.includes(id)));
      setOpenConceptIds(uniqueStrings(saved.openConceptIds ?? []).filter((id) => conceptIds.has(id)));
    }).catch(() => {
      // Browser-only smoke checks run without native storage.
    }).finally(() => {
      if (!cancelled) setContextCardsUiStateHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!contextCardsUiStateHydrated) return;
    const timeout = window.setTimeout(() => {
      void setUiState({
        key: WORKSPACE_CONTEXT_CARDS_UI_STATE_KEY,
        scope: "workspace",
        projectId: project.id,
        value: {
          version: 1,
          openReferenceIds,
          pinnedReferenceIds,
          openConceptIds
        } satisfies WorkspaceContextCardsUiState
      }).catch(() => {
        // Browser-only smoke checks run without native storage.
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [contextCardsUiStateHydrated, openConceptIds, openReferenceIds, pinnedReferenceIds, project.id]);

  useEffect(() => {
    let disposed = false;
    getProjectLearningState(project.id)
      .then((state) => {
        if (!disposed) {
          setProjectLearningState(state);
        }
      })
      .catch(() => {
        if (!disposed) {
          setProjectLearningState(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [project.id]);

  useEffect(() => {
    return onConstructInteractSessionEvent((event) => {
      if (event.projectId !== project.id) {
        return;
      }

      setLiveInteractSessions((current) => {
        if (event.type === "completed" || event.type === "error") {
          const next = { ...current };
          delete next[event.blockId];
          return next;
        }
        return {
          ...current,
          [event.blockId]: event.session
        };
      });

      if (event.learningState) {
        setProjectLearningState(event.learningState.projects[project.id] ?? null);
      }

      if (event.result && event.learningState) {
        if (event.session.mode === "general") {
          setGeneralInteractResult({
            ...event.result,
            session: event.session,
            learningState: event.learningState
          });
        } else {
          setInteractResults((current) => ({
            ...current,
            [event.blockId]: {
              ...event.result!,
              session: event.session,
              learningState: event.learningState!
            }
          }));
        }
      }
    });
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

    const handleFocus = () => {
      void refreshTree();
    };

    window.addEventListener("focus", handleFocus);
    const unsubscribe = onFileChanged(() => {
      void refreshTree();
    });

    return () => {
      window.removeEventListener("focus", handleFocus);
      unsubscribe();
    };
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
      },
      async () => {
        await refreshTree();
      }
    );
  }, [tree, activeFilePath, relevantPath, onTreeChange]);

  async function refreshTree() {
    setTree(await listFiles(project.id));
  }

  async function persistProject(patch: Parameters<typeof updateProject>[0]["patch"]) {
    onProjectChange(requireTapeProject(await updateProject({ id: project.id, patch })));
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

  function resolveConceptId(conceptId: string): string {
    if (concepts.some((candidate) => candidate.id === conceptId)) return conceptId;
    const lower = conceptId.toLowerCase();
    const byLower = concepts.find((candidate) => candidate.id.toLowerCase() === lower);
    if (byLower) return byLower.id;
    const byTitle = concepts.find((candidate) => candidate.title.toLowerCase() === lower);
    if (byTitle) return byTitle.id;
    const byTitleContains = concepts.find((candidate) => candidate.title.toLowerCase().includes(lower));
    if (byTitleContains) return byTitleContains.id;
    return conceptId;
  }

  function openConceptCard(conceptId: string) {
    const resolvedId = resolveConceptId(conceptId);
    const concept = concepts.find((candidate) => candidate.id === resolvedId);
    if (concept) {
      void recordKnowledgeOpen(project, concept, block?.kind === "recall")
        .then((state) => setProjectLearningState(state.projects[project.id] ?? null))
        .catch(console.error);
    }
    setOpenConceptIds((current) => (
      current.includes(resolvedId) ? current : [...current, resolvedId]
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
    const nextPath = resolveNavigableFilePath(rawPath, project.workspacePath);
    if (!nextPath) {
      return;
    }
    const externalSource = isExternalSourcePath(nextPath, project.workspacePath);

    const sequence = fileLoadSequenceRef.current + 1;
    fileLoadSequenceRef.current = sequence;
    let file = fileContentsRef.current[nextPath];
    if (file == null) {
      try {
        file = externalSource
          ? (await readLspSourceFile({ projectId: project.id, path: nextPath })).content
          : (await readFile({ projectId: project.id, path: nextPath })).content;
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
    if (!externalSource && options.persist !== false && project.activeFilePath !== nextPath) {
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

    const submittedAnswer = interactAnswers[block.id]?.trim() ?? "";
    if (!submittedAnswer) {
      return;
    }

    setInteractingId(block.id);
    setInteractAnswers((current) => ({ ...current, [block.id]: "" }));
    try {
      const threadId = lessonInteractThreadIds[block.id] ?? `lesson:${block.id}`;
      const result = await runConstructInteract({
        mode: "lesson-check",
        threadId,
        projectId: project.id,
        blockId: block.id,
        tapeSpec: project.program.spec,
        prompt: block.prompt,
        answer: submittedAnswer,
        basis: block.basis,
        understanding: block.understanding,
        assessment: block.assessment,
        resources: block.resources,
        projectContext: {
          title: project.title,
          currentStep: project.program.steps[project.currentStepIndex]?.title,
          currentBlock: block.id,
          concepts: (block.resources.concepts ?? [])
            .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
            .filter(Boolean)
        }
      });
      setInteractResults((current) => ({
        ...current,
        [block.id]: result
      }));
      setProjectLearningState(result.learningState.projects[project.id] ?? null);
      setLiveInteractSessions((current) => {
        const next = { ...current };
        delete next[block.id];
        return next;
      });
      const firstGenerated = (result.dynamicSteps ?? result.generatedLiveSteps)?.[0];
      if (firstGenerated?.id) {
        setActiveLiveStepId(firstGenerated.id);
      }
    } finally {
      setInteractingId(null);
    }
  }

  async function handleGeneralConstructInteract() {
    const submittedAnswer = generalInteractAnswer.trim();
    if (!submittedAnswer) {
      return;
    }

    const threadId = generalInteractThreadId || createInteractThreadId();
    setGeneralInteractThreadId(threadId);
    setInteractingId(generalInteractBlockId);
    setGeneralInteractAnswer("");
    try {
      const result = await runConstructInteract({
        mode: "general",
        threadId,
        projectId: project.id,
        blockId: generalInteractBlockId,
        tapeSpec: project.program.spec,
        prompt: "Construct Interact",
        answer: submittedAnswer,
        basis: "General-purpose Construct project assistant. It can inspect the current tape, workspace files, learner state, and terminal output.",
        understanding: "Help the user move the project forward. Prefer concrete actions when the intent is clear.",
        assessment: "Use tools before claiming state. When an action is useful, return an action for the UI to execute.",
        resources: buildGeneralInteractResources(project, block, activeFilePath, openTabs),
        projectContext: {
          title: project.title,
          currentStep: project.program.steps[project.currentStepIndex]?.title,
          currentBlock: block?.id,
          activeFilePath,
          openTabs,
          workspacePath: project.workspacePath
        }
      });
      setGeneralInteractResult(result);
      setProjectLearningState(result.learningState.projects[project.id] ?? null);
      await refreshTree();
    } finally {
      setInteractingId(null);
      setLiveInteractSessions((current) => {
        const next = { ...current };
        delete next[generalInteractBlockId];
        return next;
      });
    }
  }

  function handleNewGeneralInteractThread() {
    setGeneralInteractThreadId(createInteractThreadId());
    setGeneralInteractAnswer("");
    setGeneralInteractResult(undefined);
  }

  function handleResetLessonInteract() {
    if (!block || block.kind !== "interact") {
      return;
    }
    const nextThreadId = createInteractThreadId();
    setLessonInteractThreadIds((current) => ({
      ...current,
      [block.id]: nextThreadId
    }));
    setInteractAnswers((current) => ({
      ...current,
      [block.id]: ""
    }));
    setInteractResults((current) => {
      const next = { ...current };
      delete next[block.id];
      return next;
    });
    setLiveInteractSessions((current) => {
      const next = { ...current };
      delete next[block.id];
      return next;
    });
  }

  async function handleNext() {
    if (!block) {
      return;
    }

    const position = nextPosition(project);
    const nextProject = requireTapeProject(await updateProject({
      id: project.id,
      patch: {
        ...position,
        completedBlocks: {
          ...(project.completedBlocks ?? {}),
          [block.id]: true
        }
      }
    }));
    onProjectChange(nextProject);

    const nextBlock = currentBlock(nextProject);
    if (nextBlock?.kind === "edit") {
      await navigateToFile(nextBlock.path, { persist: false });
    }
  }

  async function handleSelectStep(stepIndex: number) {
    if (stepIndex >= 0 && stepIndex < project.program.steps.length) {
      if (stepIndex <= furthestUnlockedStepIndex) {
        setActiveLiveStepId(null);
        await persistProject({
          currentStepIndex: stepIndex,
          currentBlockIndex: 0,
          activeFilePath: null
        });
      }
    }
  }

  async function updateLiveStepStatus(stepId: string, status: GeneratedLiveStep["status"]) {
    const state = await applyLearningPatch({
      generatedLiveStepStatus: {
        projectId: project.id,
        stepId,
        status,
        updatedAt: new Date().toISOString()
      }
    });
    setProjectLearningState(state.projects[project.id] ?? null);
    if (status === "completed" || status === "dismissed") {
      setActiveLiveStepId(null);
    }
  }

  function openGeneratedLiveStep(stepId: string) {
    if (!generatedLiveSteps.some((step) => step.id === stepId && step.status !== "dismissed")) {
      return;
    }
    setActiveLiveStepId(stepId);
    onRightSlotChange("guide");
  }

  async function handleInteractAction(action: NonNullable<ConstructInteractClientResult["actions"]>[number]) {
    if (action.type === "go-to-step") {
      const stepIndex = project.program.steps.findIndex((step) => step.id === action.stepId);
      if (stepIndex >= 0) {
        await handleSelectStep(stepIndex);
      }
      return;
    }

    if (action.type === "open-concept") {
      openConceptCard(action.conceptId);
      return;
    }

    if (action.type === "open-file") {
      if (action.anchor) {
        await focusAnchor(action.anchor);
      } else {
        await openFileAndRecord(action.path);
      }
      return;
    }

    if (action.type === "focus-code") {
      if (action.anchor) {
        await focusAnchor(action.anchor);
        return;
      }
      await navigateToFile(action.path, { persist: true });
      setDocumentSession((session) => revealDocument(session, {
        kind: action.endLine ? "focus" : "jump",
        path: action.path,
        line: action.line ?? 1,
        endLine: action.endLine,
        column: 1
      }));
      return;
    }

    if (action.type === "focus-terminal") {
      onRunCommand("", project.workspacePath);
      return;
    }

    if (action.type === "run-terminal-command") {
      onRunCommand(action.command, action.cwd ?? project.workspacePath);
      return;
    }

    if (action.type !== "create-live-steps" && action.type !== "open-dynamic-steps") {
      return;
    }

    const firstStepId = action.stepIds.find((stepId) => generatedLiveSteps.some((step) => step.id === stepId));
    if (firstStepId) {
      openGeneratedLiveStep(firstStepId);
    }
  }

  async function handleReturnToActive() {
    setActiveLiveStepId(null);
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
  const guideTabContent = useMemo(() => activeLiveStep ? (
    <LiveStepPanel
      liveStep={activeLiveStep}
      theme={theme}
      onOpenConcept={openConceptCard}
      onOpenFile={(reference) => void openInlineFile(reference)}
      onRunCommand={onRunCommand}
      onComplete={() => void updateLiveStepStatus(activeLiveStep.id, "completed")}
      onDismiss={() => void updateLiveStepStatus(activeLiveStep.id, "dismissed")}
      onBack={() => setActiveLiveStepId(null)}
    />
  ) : (
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
      liveInteractSession={liveLessonInteractSession}
      interactSessions={lessonInteractSessions}
      interactToolbar={block?.kind === "interact" ? (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-label="Reset learner chat"
            title="Start over for this step"
            onClick={handleResetLessonInteract}
          >
            <ArrowCounterClockwise size={14} weight="duotone" />
          </Button>
        </div>
      ) : undefined}
      onSubmitInteract={() => void handleConstructInteract()}
      onInteractAction={(action) => void handleInteractAction(action)}
      interactingId={interactingId}
      projectLearningState={projectLearningState}
      verifyingId={verifyingId}
      verificationLogs={block?.kind === "recall" && block.verify
        ? verificationLogs[block.verify.id] ?? []
        : []}
      recallMissingFiles={recallMissingFiles}
    />
  ), [
    activeLiveStep,
    block,
    editComplete,
    interactAnswers,
    interactResults,
    interactingId,
    lessonInteractSessions,
    liveLessonInteractSession,
    onRunCommand,
    project,
    recallAnswers,
    recallMissingFiles,
    theme,
    verificationLogs,
    verifyingId
  ]);

  const generalInteractTabContent = useMemo(() => {
    const activeResult = generalInteractResult?.session.threadId === generalInteractThreadId
      ? generalInteractResult
      : undefined;
    const threadOptions = generalInteractThreads.some((thread) => thread.threadId === generalInteractThreadId)
      ? generalInteractThreads
      : [
          {
            threadId: generalInteractThreadId,
            label: "New chat",
            updatedAt: ""
          },
          ...generalInteractThreads
        ];

    return (
      <ConstructInteractSession
        blockId={generalInteractBlockId}
        prompt={`Project: ${project.title}\n\nCurrent step: ${project.program.steps[project.currentStepIndex]?.title ?? "None"}`}
        theme={theme}
        sessions={activeGeneralInteractSessions}
        liveSession={liveGeneralInteractSession}
        result={activeResult}
        answer={generalInteractAnswer}
        onAnswerChange={setGeneralInteractAnswer}
        onSubmit={() => void handleGeneralConstructInteract()}
        onAction={(action) => void handleInteractAction(action)}
        isPending={interactingId === generalInteractBlockId}
        onOpenConcept={openConceptCard}
        onOpenFile={(reference) => void openInlineFile(reference)}
        eyebrow="Construct Interact"
        submitLabel="Send"
        placeholder="Ask about the project..."
        toolbar={
          <div className="flex items-center gap-2">
            <select
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/30"
              value={generalInteractThreadId}
              onChange={(event) => {
                setGeneralInteractThreadId(event.target.value);
                setGeneralInteractAnswer("");
                setGeneralInteractResult(undefined);
              }}
              aria-label="Construct Interact session"
            >
              {threadOptions.map((thread) => (
                <option key={thread.threadId} value={thread.threadId}>
                  {thread.label || "New chat"}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-label="Start new Construct Interact chat"
              title="Start new chat"
              onClick={handleNewGeneralInteractThread}
            >
              <PlusCircle size={14} weight="duotone" />
            </Button>
          </div>
        }
      />
    );
  }, [
    activeGeneralInteractSessions,
    generalInteractAnswer,
    generalInteractBlockId,
    generalInteractResult,
    generalInteractThreadId,
    generalInteractThreads,
    interactingId,
    liveGeneralInteractSession,
    project,
    theme
  ]);

  const stepsTabContent = useMemo(() => (
    <div className="flex h-full min-h-0 flex-col">
      <Button
        variant="ghost"
        className="w-full justify-between"
        onClick={() => setIsStepsCollapsed(prev => !prev)}
        aria-expanded={!isStepsCollapsed}
        aria-label="Toggle steps timeline"
      >
        <span>Steps</span>
        <CaretDown data-icon="inline-end" weight="bold" />
      </Button>
      <div className={isStepsCollapsed ? "hidden" : "min-h-0 flex-1 overflow-hidden"}>
        <StepList
          project={project}
          onSelectStep={(idx) => void handleSelectStep(idx)}
          generatedLiveSteps={generatedLiveSteps}
          activeLiveStepId={activeLiveStepId}
          onSelectLiveStep={openGeneratedLiveStep}
          furthestUnlockedStepIndex={furthestUnlockedStepIndex}
        />
      </div>
    </div>
  ), [isStepsCollapsed, project, furthestUnlockedStepIndex, generatedLiveSteps, activeLiveStepId]);

  const sidebarKnowledgeContent = useMemo(() => {
    const currentConceptIds = block?.kind === "recall" || block?.kind === "explain"
      ? block.concepts
      : block?.kind === "interact"
        ? (block.resources.concepts ?? [])
        : [];
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
    const openedConceptIds = new Set(Object.keys(projectLearningState?.conceptEngagement ?? {}));
    const openedConceptCount = introducedConcepts.filter((concept) => openedConceptIds.has(concept.id)).length;

    if (introducedConcepts.length === 0) {
      return null;
    }

    return (
      <SidebarBottomSlot
        className="border-t"
        defaultHeight={Math.min(320, Math.max(150, 58 + introducedConcepts.length * 34))}
        minHeight={118}
        maxHeight={520}
        header={<div className="flex items-center gap-2 text-xs font-medium">
          <BookOpen size={14} weight="duotone" />
          <span>Concepts</span>
          <small>{introducedConcepts.length} introduced · {openedConceptCount} opened · {savedConcepts.length} saved</small>
        </div>}
      >
        <section className="space-y-3 p-2" aria-label="Project knowledge" data-construct-explainable="knowledge-card" data-construct-explainable-label="Project knowledge">
          {availableConcepts.length > 0 ? (
            <div className="space-y-1">
              <span className="px-2 text-xs font-medium text-muted-foreground">Introduced</span>
              {availableConcepts.map((concept) => renderSidebarConceptRow(concept, false, openedConceptIds.has(concept.id), currentConceptIds.includes(concept.id)))}
            </div>
          ) : null}
          {savedConcepts.length > 0 ? (
            <div className="border-t pt-3">
              <span className="px-2 text-xs font-medium text-muted-foreground">Saved</span>
              <div className="mt-1 space-y-1">
                {savedConcepts.map((concept) => renderSidebarConceptRow(concept, true, openedConceptIds.has(concept.id), currentConceptIds.includes(concept.id)))}
              </div>
            </div>
          ) : null}
        </section>
      </SidebarBottomSlot>
    );

    function renderSidebarConceptRow(concept: ConceptCard, isSaved: boolean, isOpened: boolean, isCurrent: boolean) {
      return (
        <HoverPreview
          key={concept.id}
          content={<div className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{concept.kind}</span><strong className="block text-sm font-medium">{concept.title}</strong><p className="text-xs text-muted-foreground">{concept.summary}</p>{concept.tags.length ? <small className="block text-[10px] text-muted-foreground">{concept.tags.join(" · ")}</small> : null}</div>}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-[current=true]:bg-muted data-[current=true]:font-medium data-[current=true]:text-foreground"
            data-current={isCurrent ? "true" : "false"}
            onClick={() => {
              void recordKnowledgeOpen(project, concept, block?.kind === "recall")
                .then((state) => setProjectLearningState(state.projects[project.id] ?? null))
                .catch(console.error);
              setSelectedKnowledgeConceptId(concept.id);
            }}
            type="button"
          >
            <BookOpen size={13} weight="regular" />
            <span className="min-w-0 flex-1 truncate">{concept.title}</span>
            {isOpened ? <CheckCircle size={12} weight="fill" aria-label="Opened" /> : null}
            {isSaved ? <BookmarkSimple size={12} weight="fill" /> : null}
          </button>
        </HoverPreview>
      );
    }
  }, [block, concepts, furthestUnlockedBlockIndex, furthestUnlockedStepIndex, project, projectLearningState?.conceptEngagement, savedConceptIds]);

  const gitTabContent = useMemo(() => (
    <div className="space-y-4 p-3">
      <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm">
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

      {gitMilestones.length > 0 ? <Timeline items={gitMilestones.map((milestone) => {
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
            content: <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                  <span>{milestone.description || "Suggested commit for this learning milestone."}</span>
                </div>
                <input
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/30"
                  value={message}
                  onChange={(event) => setGitMilestoneMessages((current) => ({
                    ...current,
                    [milestone.id]: event.target.value
                  }))}
                  aria-label={`Commit message for ${milestone.id}`}
                />
                <div className="flex flex-wrap gap-1">
                  {milestone.includePaths.length > 0
                    ? milestone.includePaths.map((includePath) => <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]" key={includePath}>{includePath}</code>)
                    : <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">all changed files</code>}
                </div>
                {stored?.output ? <pre className="overflow-auto rounded-md bg-muted p-2 font-mono text-[10px]">{stored.output}</pre> : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" type="button" disabled={!canCommit} onClick={() => void handleCommitMilestone(milestone, false)}>
                    <CheckCircle size={13} weight="duotone" />
                    {isBusy ? "Committing" : "Commit"}
                  </Button>
                  <Button size="sm" variant="secondary" type="button" disabled={!canCommit || gitProjectStatus?.hasRemote !== true} onClick={() => void handleCommitMilestone(milestone, true)}>
                    <GitBranch size={13} weight="duotone" />
                    Commit + Push
                  </Button>
                  <Button size="sm" variant="ghost"
                    type="button"
                    disabled={status === "pending" || isBusy}
                    onClick={() => updateGitMilestoneState(milestone.id, { status: "pending", output: "Deferred for later." })}
                  >
                    Later
                  </Button>
                </div>
              </div>
          };
        })} /> : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No git milestones are declared in this tape yet.</p>
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
        id: "interact",
        title: "Interact",
        icon: <ChatCircle size={13} weight="duotone" />,
        active: normalizedRightSlotId === "interact",
        content: generalInteractTabContent
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
        ariaLabel="Guide and steps tabs"
        onActiveTabChange={(tabId) => onRightSlotChange(tabId ?? "guide")}
      />
    );

    return () => onGuidePanelChange(null);
  }, [activeRightSlotId, generalInteractTabContent, gitTabContent, guideTabContent, onGuidePanelChange, onRightSlotChange, stepsTabContent]);

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
    <div className="flex h-full max-h-full min-h-0 w-full flex-col gap-3 overflow-y-auto" aria-label="Open reference and knowledge cards">
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
            relatedConcepts={project.program.concepts}
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
      className="h-full min-h-0"
      open={hasOpenContextCards}
      pinned={hasPinnedContextCard}
      sidecar={contextCards}
    >
      <SlotPanel
        activeTabId={activeFilePath ?? undefined}
        tabs={editorSlotTabs}
        syncTabs
        outlet={editorOutlet}
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

function requireTapeProject(project: Awaited<ReturnType<typeof updateProject>>): ProjectRecord {
  if (project.kind === "flow") {
    throw new Error("Tape workspace received a Flow project update.");
  }
  return project;
}

function createInteractThreadId(): string {
  return `chat:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildGeneralInteractResources(
  project: ProjectRecord,
  block: ConstructBlock | null,
  activeFilePath: string | null,
  openTabs: string[]
) {
  const currentStep = project.program.steps[project.currentStepIndex];
  const stepId = currentStep?.id ?? `step-${project.currentStepIndex + 1}`;
  const concepts: string[] = [];
  const files: string[] = [];
  const references: string[] = [];

  if (block?.kind === "interact") {
    concepts.push(...(block.resources.concepts ?? []));
    files.push(...(block.resources.files ?? []));
    references.push(...(block.resources.references ?? []));
  }

  if (block?.kind === "recall") {
    concepts.push(...block.concepts);
    references.push(...block.references);
    if (block.path) {
      files.push(block.path);
    }
    if (block.verify) {
      files.push(...block.verify.evidence.files);
    }
  }

  if (block?.kind === "explain") {
    concepts.push(...block.concepts);
  }

  if (block?.kind === "edit") {
    files.push(block.path);
  }

  if (activeFilePath) {
    files.push(activeFilePath);
  }
  files.push(...openTabs);

  return {
    concepts: uniqueStrings(concepts),
    files: uniqueStrings(files.map((filePath) => normalizeWorkspacePath(filePath)).filter(Boolean)),
    references: uniqueStrings(references),
    steps: uniqueStrings([stepId])
  };
}
