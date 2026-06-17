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
  status: "running" | "completed" | "error";
  createdAt: string;
  completedAt?: string;
};

export type ConstructFlowAction =
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

export type ConstructFlowPracticeTask = {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  prompt: string;
  focus?: {
    path: string;
    line?: number;
    endLine?: number;
  };
  status: "waiting" | "submitted" | "cancelled";
  baseline: ConstructFlowTaskBaseline;
  createdAt: string;
  submittedAt?: string;
  learnerNote?: string;
  submission?: ConstructFlowTaskSubmission;
};

export type ConstructFlowTaskBaseline = {
  capturedAt: string;
  files: Record<string, string>;
};

export type ConstructFlowTaskSubmission = {
  taskId: string;
  note?: string;
  touchedFiles: string[];
  compactDiff: string;
  nothingChanged: boolean;
  submittedAt: string;
};

export type ConstructFlowSession = {
  id: string;
  projectId: string;
  threadId: string;
  messages: ConstructFlowMessage[];
  status: ConstructFlowRunStatus;
  toolCalls: ConstructFlowToolCallRecord[];
  agentEvents: ConstructAgentRunEvent[];
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
  quickAction?: "continue" | "tried" | "stuck" | "run-tests" | "explain-selection" | "checkpoint";
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
