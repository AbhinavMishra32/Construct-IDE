export type ConstructProgram = {
  version: string;
  id: string;
  title: string;
  description: string;
  root: string;
  source: string;
  files: ConstructFile[];
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
  | RunBlock
  | ExpectBlock
  | CheckpointBlock;

export type ExplainBlock = {
  kind: "explain";
  id: string;
  content: string;
};

export type EditBlock = {
  kind: "edit";
  id: string;
  path: string;
  mode: "create" | "append" | "replace";
  typing: "ghost";
  language: string;
  content: string;
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
  terminalCreate(input: { projectId: string; cols?: number; rows?: number }): Promise<{ sessionId: string }>;
  terminalInput(input: { sessionId: string; data: string }): Promise<void>;
  terminalResize(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  terminalKill(input: { sessionId: string }): Promise<void>;
  onTerminalData(callback: (event: TerminalEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
};
