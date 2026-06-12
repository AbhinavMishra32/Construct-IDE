import type {
  ConceptUnderstanding,
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  ConstructInteractSession,
  ConstructLearningState,
  KnowledgeBaseRecord,
  LearningStatePatch,
  ProjectLearningState
} from "../../shared/constructLearning";

export type ConstructProgram = {
  spec: string;
  version: string;
  id: string;
  title: string;
  description: string;
  root: string;
  requires: string[];
  audience?: string;
  teaching: string[];
  source: string;
  files: ConstructFile[];
  guides: GuideBlock[];
  concepts: ConceptCard[];
  gitMilestones: GitMilestone[];
  warnings: ConstructLintWarning[];
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
  kind?: string;
  teaches: string[];
  requires: string[];
  blocks: ConstructBlock[];
};

export type ConstructBlock =
  | ExplainBlock
  | InteractBlock
  | GuideBlock
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
  concepts: string[];
};

export type GuideSection = { kind: string; content: string };

export type GuideBlock = {
  kind: "guide";
  id: string;
  guideKind: string;
  title?: string;
  content: string;
  sections: GuideSection[];
};

export type InteractBlock = {
  kind: "interact";
  id: string;
  interactKind: string;
  uses: string[];
  prompt: string;
  basis: string;
  understanding: string;
  assessment: string;
  resources: {
    concepts: string[];
    files: string[];
  };
};

export type EditBlock = {
  kind: "edit";
  id: string;
  path: string;
  mode: "create" | "append" | "replace";
  typing: "ghost";
  anchor?: string;
  notes: ConstructNote[];
  guides: GuideBlock[];
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

export type ConceptDocsLink = {
  title: string;
  url: string;
  why?: string;
};

export type ConceptCard = {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  summary: string;
  why: string;
  commonMistake?: string;
  example: string;
  docs: ConceptDocsLink[];
  guides: GuideBlock[];
};

export type SupportSection = {
  kind: "intent" | "concepts" | "api" | "mental-model" | "common-mistake" | string;
  content: string;
};

export type GitMilestone = {
  id: string;
  after: string;
  message: string;
  description: string;
  includePaths: string[];
};

export type GitMilestoneStatus = "pending" | "suggested" | "committed" | "pushed" | "failed";

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  hasRemote: boolean;
  dirtyFiles: string[];
};

export type GitActionResult = {
  success: boolean;
  output: string;
  commitHash?: string;
};

export type LspLanguageId = "typescript" | "python";

export type LspStartResult = {
  languages: LspLanguageId[];
  workspacePath: string;
};

export type ConstructLintWarning = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  target?: string;
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
  mode: "code" | "reply";
  path?: string;
  target?: string;
  references: string[];
  concepts: string[];
  difficulty: "supported-recall" | string;
  task: string;
  support: string;
  supportSections: SupportSection[];
  verify?: VerificationBlock;
};

export type VerificationBlock = {
  id: string;
  kind: "agent" | string;
  goal: string;
  evidence: VerificationEvidence;
  rubric: string;
  messages?: VerificationMessages;
};

export type VerificationEvidence = {
  answer?: "latest" | string;
  files: string[];
  interaction?: string;
  terminalCommand?: string;
  terminalOutput?: "latest" | string;
};

export type VerificationMessages = {
  success: string;
  failure: string;
};

export type VerificationResult = {
  status?: "pass" | "fail" | "almost";
  passed: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
  suggestion?: string;
  relatedConceptIds?: string[];
  logs?: VerificationLogEntry[];
};

export type ConstructInteractClientResult = ConstructInteractResult & {
  session: ConstructInteractSession;
  learningState: ConstructLearningState;
};

export type SelectionExplanationLogEntry = {
  at: string;
  status: "pending" | "running" | "done" | "failed" | "warning";
  message: string;
  detail?: string;
  tool?: "codebase" | "web" | "agent";
};

export type SelectionExplanationResult = {
  title: string;
  summary: string;
  explanation: string;
  sources: Array<{
    id: string;
    kind: "code" | "web";
    title: string;
    url?: string;
    path?: string;
    line?: number;
    domain?: string;
  }>;
  researchMode: "web-and-codebase" | "codebase-only";
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
};

export type ProjectRecord = ProjectSummary & {
  source: string;
  originalSource?: string;
  authoringFixes?: AuthoringFixRecord[];
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

export type AuthoringFixRecord = {
  id: string;
  title: string;
  description: string;
  kind: string;
  safety: "safe-auto" | "suggested" | "semantic";
  line?: number;
  appliedAt: string;
};

export type AiProvider = "openai" | "openrouter";

export type AiSettings = {
  provider: AiProvider;
  openAiApiKey: string;
  openAiModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  featureModels: Record<string, string>;
};

export type AiFeatureSettings = {
  id: string;
  title: string;
  description: string;
  defaultOpenAiModel: string;
  defaultOpenRouterModel: string;
  model: string;
};

export type ModelCatalogEntry = {
  id: string;
  name: string;
  description?: string | null;
  contextLength?: number | null;
  pricing?: string | null;
};

export type ProjectSettings = {
  workspaceRoot: string;
  ai: AiSettings;
  releaseVersion: string;
};

export type DeleteProjectCheck = {
  hasGit: boolean;
  branch: string | null;
  hasRemote: boolean;
  hasUncommittedChanges: boolean;
  unpushedCommits: number;
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

export type DebugProcessSnapshot = {
  id: string;
  kind: "terminal" | "lsp" | "installer";
  label: string;
  pid: number | null;
  status: "running" | "stopped";
  workspacePath?: string | null;
  command?: string;
  cpuPercent?: number | null;
  memoryMb?: number | null;
  elapsed?: string | null;
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
    originalSource?: string;
    authoringFixes?: AuthoringFixRecord[];
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
  updateAiSettings(input: {
    ai: Partial<AiSettings>;
  }): Promise<ProjectSettings>;
  listAiFeatures(): Promise<AiFeatureSettings[]>;
  listModels(input: {
    provider: AiProvider;
    apiKey: string;
  }): Promise<ModelCatalogEntry[]>;
  getLearningState(): Promise<ConstructLearningState>;
  getProjectLearningState(projectId: string): Promise<ProjectLearningState>;
  applyLearningPatch(input: LearningStatePatch): Promise<ConstructLearningState>;
  getWeakConcepts(input?: { projectId?: string }): Promise<ConceptUnderstanding[]>;
  saveKnowledgeConcept(input: KnowledgeBaseRecord): Promise<ConstructLearningState>;
  openKnowledgeConcept(input: KnowledgeBaseRecord): Promise<ConstructLearningState>;
  removeKnowledgeConcept(input: { projectId: string; conceptId: string }): Promise<ConstructLearningState>;
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
    concepts?: ConceptCard[];
    savedKnowledge?: ConceptCard[];
    answer?: string;
  }): Promise<VerificationResult>;
  runConstructInteract(input: Omit<ConstructInteractRuntimeInput, "learningState">): Promise<ConstructInteractClientResult>;
  reviewConstructAuthoring(input: {
    spec: string;
    projectView: unknown;
    diagnostics: Array<{ code: string; severity: string; message: string; line: number; blockId?: string }>;
    snippets: Array<{ label: string; startLine: number; text: string }>;
  }): Promise<import("./compiler/semantic-review").AuthoringSuggestion[]>;
  explainSelection(input: {
    requestId: string;
    projectId: string;
    selection: import("./lib/selectionContext").ConstructSelectionContext;
    learningContext?: unknown;
  }): Promise<SelectionExplanationResult>;
  onSelectionExplanationLog(callback: (event: { requestId: string; entry: SelectionExplanationLogEntry }) => void): () => void;
  onAgentLog(callback: (event: { agent: string; message: string; level: string }) => void): () => void;
  startCodeGhostStream(input: {
    requestId: string;
    lineNumber: number;
    lineContent: string;
    language: string;
    linesBefore: string[];
    linesAfter: string[];
  }): void;
  onCodeGhostToken(callback: (payload: {
    requestId: string;
    lineNumber: number;
    token: string;
    done: boolean;
    error?: string;
  }) => void): () => void;
  deleteProject(input: { projectId: string; force?: boolean }): Promise<DeleteProjectCheck | { deleted: true }>;
  gitStatus(projectId: string): Promise<GitStatus>;
  gitCommit(input: { projectId: string; message: string; paths: string[] }): Promise<GitActionResult>;
  gitPush(projectId: string): Promise<GitActionResult>;
  terminalCreate(input: { projectId: string; cols?: number; rows?: number }): Promise<{ sessionId: string }>;
  terminalInput(input: { sessionId: string; data: string }): Promise<void>;
  terminalResize(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  terminalKill(input: { sessionId: string }): Promise<void>;
  onTerminalData(callback: (event: TerminalEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
  debugProcesses(): Promise<DebugProcessSnapshot[]>;
  onVerifyLog(callback: (event: { entry: VerificationLogEntry }) => void): () => void;
  lspRequest(payload: unknown): Promise<unknown>;
  onLspNotification(callback: (payload: any) => void): () => void;
  onLspStderr(callback: (payload: string | { language: "typescript" | "python"; level: "info" | "warn" | "error"; text: string }) => void): () => void;
  onMainLog(callback: (payload: { level: string; message: string; timestamp: string }) => void): () => void;
  onLspInstallProgress(callback: (payload: { language?: "all" | "typescript" | "python"; type: "stdout" | "stderr"; text: string }) => void): () => void;
  lspGetStatus(projectId: string): Promise<Record<"typescript" | "python", {
    command: string;
    installCommand: string;
    installed: boolean;
    label: string;
    resolvedPath: string | null;
    status: "not-installed" | "running" | "stopped" | "installing";
  }>>;
  lspInstall(projectId: string): Promise<boolean>;
  lspStart(projectId: string): Promise<LspStartResult>;
  lspStop(): Promise<void>;
};
