import type { VerificationResult } from "../constructVerifierAgent";

export type StoredProject = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
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
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  assistance: Record<string, StoredBlockAssistance>;
  verificationResults: Record<string, VerificationResult>;
  completedBlocks: Record<string, boolean>;
  completedAt: string | null;
};

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
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  sourcePath: string | null;
  currentStepIndex: number;
  currentBlockIndex: number;
  currentStepTitle: string | null;
  currentBlockKind: string | null;
  currentBlockLabel: string | null;
  activeFilePath: string | null;
  stepCount: number;
  blockCount: number;
  completedBlockCount: number;
  fileCount: number;
  conceptCount: number;
  referenceCount: number;
  verificationPassCount: number;
  verificationFailCount: number;
  authoringFixCount: number;
  completedAt: string | null;
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
