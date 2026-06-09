export type ConstructProgram = {
  spec: string;
  version: string;
  id: string;
  title: string;
  description: string;
  root: string;
  requires: string[];
  source: string;
  files: ConstructFile[];
  references: ReferenceCard[];
  targets: ConstructTarget[];
  steps: ConstructStep[];
};

export type ConstructFile = {
  path: string;
  language: string;
  content: string;
};

export type ConstructStep = {
  id: string;
  title: string;
  blocks: ConstructBlock[];
};

export type ConstructBlock =
  | ExplainBlock
  | EditBlock
  | RecallBlock
  | RunBlock
  | ExpectBlock
  | CheckpointBlock;

export type ExplainBlock = {
  kind: "explain";
  id: string;
  content: string;
  focus?: string;
};

export type EditBlock = {
  kind: "edit";
  id: string;
  path: string;
  mode: "create" | "append" | "replace";
  typing: "ghost";
  anchor?: string;
  notes: ConstructNote[];
  language: string;
  content: string;
};

export type ConstructNote = {
  when: "start" | "done" | "progress";
  content: string;
};

export type ReferenceCard = {
  id: string;
  title: string;
  kind: string;
  reveal: string;
  body: string;
  links: ReferenceLink[];
};

export type ReferenceLink = {
  anchor?: string;
  file?: string;
  label?: string;
};

export type ConstructTarget = {
  id: string;
  path: string;
  find?: string;
  line?: number;
  anchor?: string;
};

export type RecallBlock = {
  kind: "recall";
  id: string;
  path?: string;
  target?: string;
  references: string[];
  difficulty: "supported-recall" | string;
  task: string;
  support: string;
  verify?: VerificationBlock;
};

export type VerificationBlock = {
  id: string;
  kind: "agent" | string;
  goal: string;
  evidence: VerificationEvidence;
  rubric: string;
  messages: VerificationMessages;
};

export type VerificationEvidence = {
  files: string[];
  terminalCommand?: string;
  terminalOutput?: "latest" | string;
};

export type VerificationMessages = {
  success: string;
  failure: string;
};

export type VerificationResult = {
  passed: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
  suggestion?: string;
  logs?: VerificationLogEntry[];
};

export type VerificationLogEntry = {
  at: string;
  status: "pending" | "running" | "done" | "failed" | "warning";
  message: string;
  detail?: string;
};

export type BlockAssistance = {
  revealLineCount: number;
  revealBlockCount: number;
  referenceCardsOpened: string[];
  referenceCardsPinned: string[];
  extraExplanationCount: number;
  recallAttemptCount: number;
  verificationFailureCount: number;
};

export type RunBlock = {
  kind: "run";
  id: string;
  cwd: string;
  command: string;
};

export type ExpectBlock = {
  kind: "expect";
  id: string;
  expectationType: "manual";
  content: string;
};

export type CheckpointBlock = {
  kind: "checkpoint";
  id: string;
  content: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  sourcePath: string | null;
  workspacePath: string;
};

export type ProjectRecord = ProjectSummary & {
  source: string;
  program: ConstructProgram;
  currentStepIndex: number;
  currentBlockIndex: number;
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  assistance: Record<string, BlockAssistance>;
  verificationResults: Record<string, VerificationResult>;
  completedBlocks: Record<string, boolean>;
  completedAt: string | null;
};

export type ProjectSettings = {
  workspaceRoot: string;
};

export type WorkspaceFile = {
  path: string;
  content: string;
};

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
};

export type TerminalEvent = {
  sessionId: string;
  data: string;
};

export type TerminalExitEvent = {
  sessionId: string;
  exitCode: number | null;
};

export type ConstructProjectsApi = {
  setThemeSource(theme: "light" | "dark" | "system"): Promise<void>;
  ensureProject(input: {
    source: string;
    sourcePath?: string | null;
    program: ConstructProgram;
  }): Promise<ProjectRecord>;
  importProject(input: {
    initializeGit: boolean;
    source: string;
    sourcePath: string | null;
    program: ConstructProgram;
    workspacePath: string;
  }): Promise<ProjectRecord>;
  openConstructFile(): Promise<{ path: string; source: string } | null>;
  selectWorkspaceDirectory(input?: {
    defaultPath?: string;
  }): Promise<string | null>;
  getSettings(): Promise<ProjectSettings>;
  setWorkspaceRoot(input: {
    workspaceRoot: string;
  }): Promise<{
    settings: ProjectSettings;
    projects: ProjectSummary[];
  }>;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(id: string): Promise<ProjectRecord>;
  updateProject(input: {
    id: string;
    patch: Partial<
      Pick<
        ProjectRecord,
        | "currentStepIndex"
        | "currentBlockIndex"
        | "activeFilePath"
        | "title"
        | "description"
        | "fileTreeExpanded"
        | "typingProgress"
        | "editAnchors"
        | "assistance"
        | "verificationResults"
        | "completedBlocks"
        | "completedAt"
      >
    >;
  }): Promise<ProjectRecord>;
  listFiles(projectId: string): Promise<WorkspaceTreeNode[]>;
  readFile(input: { projectId: string; path: string }): Promise<WorkspaceFile>;
  writeFile(input: {
    projectId: string;
    path: string;
    content: string;
  }): Promise<WorkspaceFile>;
  deleteFile(input: { projectId: string; path: string }): Promise<void>;
  renameFile(input: { projectId: string; oldPath: string; newPath: string }): Promise<void>;
  createFolder(input: { projectId: string; path: string }): Promise<void>;
  duplicateFile(input: { projectId: string; path: string; destPath: string }): Promise<void>;
  verifyRecall(input: {
    projectId: string;
    recall: RecallBlock;
    references: ReferenceCard[];
  }): Promise<VerificationResult>;
  terminalCreate(input: { projectId: string; cols?: number; rows?: number }): Promise<{ sessionId: string }>;
  terminalInput(input: { sessionId: string; data: string }): Promise<void>;
  terminalResize(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  terminalKill(input: { sessionId: string }): Promise<void>;
  onTerminalData(callback: (event: TerminalEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
  onVerifyLog(callback: (event: { entry: VerificationLogEntry }) => void): () => void;
  lspRequest(payload: unknown): Promise<unknown>;
  onLspNotification(callback: (payload: any) => void): () => void;
};
