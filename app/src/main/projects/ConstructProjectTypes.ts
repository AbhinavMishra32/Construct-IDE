import type { VerificationResult } from "../constructVerifierAgent";
import type {
  ConstructFlowPathNode,
  ConstructFlowProjectSettings,
  ConstructFlowSession,
  FlowMemoryFileName
} from "../../shared/constructFlow";

export type ConstructProjectKind = "tape" | "flow";

export type StoredProjectBase = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  completedAt: string | null;
};

export type StoredTapeProject = StoredProjectBase & {
  kind?: "tape";
  source: string;
  originalSource?: string;
  authoringFixes?: Array<{
    id: string;
    title: string;
    description: string;
    kind: string;
    safety: "safe-auto" | "suggested" | "semantic";
    line?: number;
    appliedAt: string;
  }>;
  sourcePath: string | null;
  program: {
    spec?: string;
    id: string;
    title: string;
    description: string;
    files: Array<{ path: string; content: string }>;
    concepts?: unknown[];
    references?: Array<{
      id: string;
      title: string;
      body: string;
    }>;
    targets?: unknown[];
    steps: Array<{
      id?: string;
      title?: string;
      blocks: Array<{
        id: string;
        kind?: string;
        path?: string;
        title?: string;
        task?: string;
        content?: string;
      }>;
    }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  assistance: Record<string, StoredBlockAssistance>;
  verificationResults: Record<string, VerificationResult>;
  completedBlocks: Record<string, boolean>;
};

export type StoredFlowProject = StoredProjectBase & {
  kind: "flow";
  source?: never;
  sourcePath: string | null;
  flow: {
    goal: string;
    stackPreference?: string;
    autonomyPreference?: "guided" | "balanced" | "agentic";
    permissionsPreference?: "ask" | "workspace" | "agentic";
    projectSettings?: ConstructFlowProjectSettings;
    memoryDirectory: ".construct/flow-memory";
    threadId: string;
    researchEnabled: boolean;
    researchCompletedAt?: string | null;
    pathNodes?: ConstructFlowPathNode[];
    currentPathNodeId?: string | null;
    pathCreatedAt?: string | null;
    pathUpdatedAt?: string | null;
    sessions: ConstructFlowSession[];
    createdAt: string;
    updatedAt: string;
  };
};

export type StoredProject = StoredTapeProject | StoredFlowProject;

export type StoredBlockAssistance = {
  revealLineCount: number;
  revealBlockCount: number;
  referenceCardsOpened: string[];
  referenceCardsPinned: string[];
  extraExplanationCount: number;
  recallAttemptCount: number;
  verificationFailureCount: number;
};

export type ProjectSummary = {
  kind: ConstructProjectKind;
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  sourcePath: string | null;
  currentStepIndex?: number;
  currentBlockIndex?: number;
  currentStepTitle?: string | null;
  currentBlockKind?: string | null;
  currentBlockLabel?: string | null;
  activeFilePath?: string | null;
  stepCount?: number;
  blockCount?: number;
  completedBlockCount?: number;
  fileCount?: number;
  conceptCount?: number;
  referenceCount?: number;
  verificationPassCount?: number;
  verificationFailCount?: number;
  authoringFixCount?: number;
  completedAt?: string | null;
  flowGoal?: string;
  flowMemoryFileCount?: number;
  flowSessionCount?: number;
  flowLastActivityAt?: string | null;
};

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: WorkspaceTreeNode[];
};

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  hasRemote: boolean;
  dirtyFiles: string[];
};

export function projectKind(project: StoredProject): ConstructProjectKind {
  return project.kind === "flow" ? "flow" : "tape";
}

export function isFlowProject(project: StoredProject): project is StoredFlowProject {
  return projectKind(project) === "flow";
}

export function isTapeProject(project: StoredProject): project is StoredTapeProject {
  return projectKind(project) === "tape";
}
