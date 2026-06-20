import type { ConstructAgentContextWindow, ConstructAgentRunEvent } from "./constructLearning";

export type FlowMemoryFileName = "research.md" | "project.md" | "path.md" | "learner.md";

export type ConstructFlowRunStatus = "queued" | "running" | "waiting" | "completed" | "error";

export type ConstructFlowMessageRole = "user" | "assistant";

export type ConstructFlowMessage = {
  id: string;
  role: ConstructFlowMessageRole;
  content: string;
  createdAt: string;
};

export type ConstructFlowToolCallRecord = {
  id: string;
  name: string;
  title: string;
  reason: string;
  input?: unknown;
  outputPreview?: string;
  response?: ConstructFlowQuestionResponse;
  status: "running" | "completed" | "error";
  createdAt: string;
  completedAt?: string;
};

export type ConstructFlowTimelinePart =
  | {
      id: string;
      kind: "reasoning";
      status: "running" | "completed" | "error";
      title: string;
      detail?: string;
      text?: string;
      createdAt: string;
      updatedAt?: string;
    }
  | {
      id: string;
      kind: "message";
      status: "running" | "completed" | "error";
      text: string;
      createdAt: string;
      updatedAt?: string;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: string;
      title: string;
      reason?: string;
      status: "running" | "completed" | "error";
      input?: unknown;
      outputPreview?: string;
      createdAt: string;
      completedAt?: string;
      updatedAt?: string;
    };

export type ConstructFlowQuestionResponse = {
  sessionId: string;
  toolCallId: string;
  question: string;
  answer: string;
  skipped?: boolean;
  answeredAt: string;
};

export type ConstructFlowSessionOrigin = "user" | "system" | "question-response" | "task-submission";

export type ConstructFlowPathNodeStatus = "planned" | "active" | "completed" | "blocked" | "revising";

export type ConstructFlowPathNode = {
  id: string;
  title: string;
  summary: string;
  status: ConstructFlowPathNodeStatus;
  order: number;
  kind?: "profile" | "foundation" | "build" | "connect" | "polish" | "ship" | "custom";
  learnerLevel?: "new" | "beginner" | "comfortable" | "advanced" | "unknown";
  concepts?: string[];
  taskIds?: string[];
  entryCriteria?: string[];
  exitCriteria?: string[];
  researchNotes?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ConstructFlowProjectSettings = {
  projectType: "app" | "library" | "cli" | "agent" | "research";
  codebaseState: "empty" | "existing" | "mixed";
  projectPhase: "explore" | "build" | "refactor" | "ship";
  setupScope: "minimal" | "standard" | "complete";
  packageManager: "auto" | "pnpm" | "npm" | "yarn" | "bun";
  testStrategy: "none" | "smoke" | "unit" | "full";
  docsLevel: "none" | "brief" | "standard" | "detailed";
  gitStrategy: "skip" | "initialize" | "existing";
  agentEdits: "ask" | "workspace" | "agentic";
  openWorkspace: boolean;
};

export type ConstructFlowAction =
  | {
      type: "open-concept";
      conceptId: string;
      label: string;
      reason: string;
    }
  | {
      type: "focus-code";
      path: string;
      line?: number;
      endLine?: number;
      label: string;
      reason: string;
    }
  | {
      type: "open-file";
      path: string;
      label: string;
      reason: string;
    }
  | {
      type: "focus-terminal";
      label: string;
      reason: string;
    }
  | {
      type: "run-terminal-command";
      command: string;
      cwd?: string;
      label: string;
      reason: string;
    };

export type ConstructFlowPracticeSubtask = {
  id: string;
  title: string;
  prompt: string;
  status: "ready" | "active" | "submitted" | "needs-work" | "completed";
  successCriteria?: string[];
  completedAt?: string;
  evidence?: string;
  reviewedAt?: string;
  reviewNote?: string;
  nextInstructions?: string;
};

export type ConstructFlowTaskGuidance = {
  id: string;
  title: string;
  instruction: string;
  path: string;
  line?: number;
  endLine?: number;
  placeholder?: string;
  subtaskId?: string;
};

export type ConstructFlowCodeAuthorship = {
  actor: "learner" | "agent" | "system";
  label: string;
  reason: string;
  createdAt: string;
};

export type ConstructFlowPracticeTask = {
  id: string;
  projectId: string;
  sessionId: string;
  pathNodeId?: string;
  title: string;
  prompt: string;
  focus?: {
    path: string;
    line?: number;
    endLine?: number;
  };
  status: "waiting" | "submitted" | "completed" | "cancelled";
  baseline: ConstructFlowTaskBaseline;
  createdAt: string;
  submittedAt?: string;
  learnerNote?: string;
  submission?: ConstructFlowTaskSubmission;
  taskFiles?: string[];
  conceptIds?: string[];
  introducedConceptIds?: string[];
  successCriteria?: string[];
  subtasks?: ConstructFlowPracticeSubtask[];
  guidance?: ConstructFlowTaskGuidance[];
  messages?: Array<{
    id: string;
    role: ConstructFlowMessageRole;
    content: string;
    createdAt: string;
  }>;
  preparedFiles?: Array<{
    path: string;
    mode: "create" | "overwrite" | "replace";
    authoredBy: ConstructFlowCodeAuthorship;
  }>;
  authoredBy?: ConstructFlowCodeAuthorship;
  submissionSessionId?: string;
};

export type ConstructFlowTaskBaseline = {
  capturedAt: string;
  files: Record<string, string>;
};

export type ConstructFlowTaskSubmission = {
  taskId: string;
  subtaskId?: string;
  note?: string;
  touchedFiles: string[];
  compactDiff: string;
  nothingChanged: boolean;
  submittedAt: string;
  authoredBy?: ConstructFlowCodeAuthorship;
};

export type ConstructFlowMemoryPatchResult = {
  file: FlowMemoryFileName;
  path: string;
  reason: string;
  mode: "append" | "prepend" | "replace";
  diff: string;
  updatedAt: string;
  addedText: string;
  removedText?: string;
};

export type ConstructFlowSession = {
  id: string;
  projectId: string;
  threadId: string;
  origin?: ConstructFlowSessionOrigin;
  questionResponse?: ConstructFlowQuestionResponse;
  messages: ConstructFlowMessage[];
  status: ConstructFlowRunStatus;
  toolCalls: ConstructFlowToolCallRecord[];
  agentEvents: ConstructAgentRunEvent[];
  timeline: ConstructFlowTimelinePart[];
  contextWindow?: ConstructAgentContextWindow;
  actions: ConstructFlowAction[];
  practiceTasks: ConstructFlowPracticeTask[];
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  errorMessage?: string;
};

export type ConstructFlowMemoryRead = {
  file: FlowMemoryFileName;
  path: string;
  content: string;
  exists: boolean;
  updatedAt: string | null;
};

export type ConstructFlowAgentInput = {
  projectId: string;
  message: string;
  threadId?: string;
  taskSubmission?: ConstructFlowTaskSubmission;
  taskMessage?: {
    taskId: string;
    pathNodeId?: string;
  };
  questionResponse?: ConstructFlowQuestionResponse;
  startReason?: "new-project";
  quickAction?: "continue" | "tried" | "stuck" | "run-tests" | "explain-selection" | "checkpoint";
};

export type ConstructFlowRewindInput = {
  projectId: string;
  sessionId: string;
};

export type ConstructFlowAgentResult = {
  session: ConstructFlowSession;
  reply: string;
  actions: ConstructFlowAction[];
};

export type ConstructFlowSessionEvent = {
  type: "started" | "updated" | "waiting" | "completed" | "error";
  projectId: string;
  session: ConstructFlowSession;
  result?: ConstructFlowAgentResult;
};
