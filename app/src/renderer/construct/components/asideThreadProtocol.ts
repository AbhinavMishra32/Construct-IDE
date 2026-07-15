import type {
  ConstructFlowPracticeTask,
  ConstructFlowSession,
  ConstructFlowTimelinePart,
} from "../../../shared/constructFlow";

type AsideTextPart = { type: "text"; text: string };
type AsideThinkingPart = { type: "thinking"; thinking: string };
type AsideToolCallPart = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };
type AsideAssistantPart = AsideTextPart | AsideThinkingPart | AsideToolCallPart;

type AsideAssistantMessage = {
  id: string;
  role: "assistant";
  content: AsideAssistantPart[];
  provider: string;
  model: string;
  timestamp: number;
  stopReason: "stop" | "end_turn";
};

export type AsideBridgeMessage =
  | {
      id: string;
      role: "user";
      content: AsideTextPart[];
      timestamp: number;
    }
  | AsideAssistantMessage
  | {
      id: string;
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: AsideTextPart[];
      details: Record<string, unknown>;
      isError: boolean;
      timestamp: number;
    };

export type AsideBridgeSessionInput = {
  projectId: string;
  projectTitle: string;
  workspacePath: string;
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  provider: string;
  model: string;
  thinkingLevel: string;
};

export function buildAsideSession(input: AsideBridgeSessionInput): Record<string, unknown> {
  const merged = mergeSessions(input.sessions, input.liveSession);
  const tasks = merged.flatMap((session) => session.practiceTasks ?? []);
  const activeQuestion = findPendingQuestion(merged);
  const running = input.liveSession?.status === "running" || input.liveSession?.status === "queued";
  const now = new Date().toISOString();

  return {
    id: input.projectId,
    agentId: "construct-flow",
    title: input.projectTitle,
    status: running ? "running" : "idle",
    createdAt: merged[0]?.createdAt ?? now,
    updatedAt: input.liveSession?.updatedAt ?? merged.at(-1)?.updatedAt ?? now,
    readAt: null,
    model: {
      provider: input.provider,
      modelId: input.model,
      thinkingLevel: input.thinkingLevel,
      fastMode: false,
    },
    permissionMode: "guard",
    runtimeConfig: {
      memoryExtractionDisabled: false,
      proactiveMode: false,
      strictModelSelection: false,
      finalConfirm: true,
      takeScreenshotOnEverySnapshot: false,
      workingDirs: [input.workspacePath],
    },
    toolState: {
      todo: { todos: tasksToAsideTodos(tasks) },
      bash: { cwd: input.workspacePath },
      skills: {},
      question: activeQuestion ? {
        question: activeQuestion.question,
        choices: activeQuestion.choices,
        toolCallId: activeQuestion.toolCallId,
      } : {},
    },
    incognito: false,
  };
}

export function buildAsideMessages(
  sessions: ConstructFlowSession[],
  liveSession: ConstructFlowSession | undefined,
  provider: string,
  model: string,
): AsideBridgeMessage[] {
  return mergeSessions(sessions, liveSession).flatMap((session) => sessionToAsideMessages(session, provider, model));
}

export type AsideEnvelopeEmitter = (value: Record<string, unknown>) => void;

export class AsideRunProjector {
  readonly runId = crypto.randomUUID();
  private sequence = 0;
  private assistant: AsideAssistantMessage | null = null;
  private readonly parts = new Map<string, { index: number; text: string; ended: boolean }>();
  private readonly tools = new Map<string, { index: number; ended: boolean }>();
  private ended = false;
  private started = false;

  constructor(
    private readonly emitEnvelope: AsideEnvelopeEmitter,
    private readonly provider: string,
    private readonly model: string,
  ) {}

  start(userText: string): void {
    if (this.started) return;
    this.started = true;
    this.emit({ type: "agent_start" });
    if (!userText.trim()) return;
    const userMessage = {
      id: `${this.runId}:user`,
      role: "user",
      content: [{ type: "text", text: userText }],
      timestamp: Date.now(),
    };
    this.emit({ type: "message_start", message: userMessage });
    this.emit({ type: "message_end", message: userMessage });
  }

  project(session: ConstructFlowSession): void {
    if (this.ended) return;
    if (!this.started) this.start(session.messages.find((message) => message.role === "user")?.content ?? "");
    for (const part of session.timeline ?? []) this.projectPart(session, part);

    if ((session.timeline?.length ?? 0) === 0 && isTerminalSession(session)) {
      const reply = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
      if (reply) this.projectText({
        id: `${session.id}:reply`,
        kind: "message",
        status: "completed",
        text: reply,
        createdAt: session.updatedAt,
      });
    }

    if (isTerminalSession(session)) this.finish(session.status === "error");
  }

  fail(message: string): void {
    if (this.ended) return;
    this.ensureAssistant();
    this.projectText({
      id: `${this.runId}:error`,
      kind: "message",
      status: "error",
      text: message,
      createdAt: new Date().toISOString(),
    });
    this.finish(true);
  }

  private projectPart(session: ConstructFlowSession, part: ConstructFlowTimelinePart): void {
    if (part.kind === "reasoning" || part.kind === "message") {
      this.projectText(part);
      return;
    }
    if (part.kind === "tool") this.projectTool(session, part);
  }

  private projectText(part: Extract<ConstructFlowTimelinePart, { kind: "reasoning" | "message" }>): void {
    const assistant = this.ensureAssistant();
    const kind = part.kind === "reasoning" ? "thinking" : "text";
    const text = part.kind === "reasoning" ? (part.text ?? part.detail ?? "") : part.text;
    let state = this.parts.get(part.id);
    if (!state) {
      state = { index: assistant.content.length, text: "", ended: false };
      this.parts.set(part.id, state);
      assistant.content.push(kind === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" });
      this.update({ type: kind === "thinking" ? "thinking_start" : "text_start", contentIndex: state.index });
    }
    if (text !== state.text) {
      const delta = text.startsWith(state.text) ? text.slice(state.text.length) : text;
      state.text = text;
      assistant.content[state.index] = kind === "thinking" ? { type: "thinking", thinking: text } : { type: "text", text };
      if (delta) this.update({ type: kind === "thinking" ? "thinking_delta" : "text_delta", contentIndex: state.index, delta });
    }
    if (part.status !== "running" && !state.ended) {
      state.ended = true;
      this.update({ type: kind === "thinking" ? "thinking_end" : "text_end", contentIndex: state.index });
    }
  }

  private projectTool(session: ConstructFlowSession, part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>): void {
    const assistant = this.ensureAssistant();
    const toolCallId = part.toolCallId || part.id;
    const toolName = asideToolName(part.name);
    const args = constructToolArguments(part, session);
    let state = this.tools.get(part.id);
    if (!state) {
      state = { index: assistant.content.length, ended: false };
      this.tools.set(part.id, state);
      assistant.content.push({ type: "toolCall", id: toolCallId, name: toolName, arguments: args });
      this.update({ type: "toolcall_start", contentIndex: state.index, id: toolCallId, toolName });
      this.update({ type: "toolcall_delta", contentIndex: state.index, delta: JSON.stringify(args) });
      this.update({ type: "toolcall_end", contentIndex: state.index });
      this.emit({ type: "tool_execution_start", toolCallId, toolName, args });
    }
    if (part.status !== "running" && !state.ended) {
      state.ended = true;
      const resultText = part.outputPreview ?? part.reason ?? part.title;
      const result = {
        content: [{ type: "text", text: resultText }],
        details: constructToolDetails(part, session),
      };
      this.emit({
        type: "tool_execution_end",
        toolCallId,
        toolName,
        result,
        isError: part.status === "error",
      });
      const toolMessage = {
        id: `${session.id}:tool-result:${toolCallId}`,
        role: "toolResult",
        toolCallId,
        toolName,
        content: result.content,
        details: result.details,
        isError: part.status === "error",
        timestamp: toTimestamp(part.completedAt ?? part.updatedAt ?? session.updatedAt),
      };
      this.emit({ type: "message_start", message: toolMessage });
      this.emit({ type: "message_end", message: toolMessage });
    }
  }

  private ensureAssistant(): AsideAssistantMessage {
    if (this.assistant) return this.assistant;
    this.assistant = {
      id: `${this.runId}:assistant`,
      role: "assistant",
      content: [],
      provider: this.provider,
      model: this.model,
      timestamp: Date.now(),
      stopReason: "stop",
    };
    this.emit({ type: "message_start", message: structuredClone(this.assistant) });
    return this.assistant;
  }

  private update(assistantMessageEvent: Record<string, unknown>): void {
    const assistant = this.ensureAssistant();
    this.emit({
      type: "message_update",
      message: structuredClone(assistant),
      assistantMessageEvent,
    });
  }

  private finish(error: boolean): void {
    if (this.ended) return;
    this.ended = true;
    if (this.assistant) {
      this.assistant.stopReason = error ? "stop" : "end_turn";
      this.emit({ type: "message_end", message: structuredClone(this.assistant) });
    }
    this.emit({ type: "agent_end", messages: [] });
  }

  private emit(event: Record<string, unknown>): void {
    this.emitEnvelope({
      op: "event",
      protocolVersion: 1,
      runId: this.runId,
      seq: this.sequence++,
      event,
    });
  }
}

function sessionToAsideMessages(session: ConstructFlowSession, provider: string, model: string): AsideBridgeMessage[] {
  const output: AsideBridgeMessage[] = session.messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      id: message.id,
      role: "user" as const,
      content: [{ type: "text" as const, text: message.content }],
      timestamp: toTimestamp(message.createdAt),
    }));

  const assistantParts: AsideAssistantPart[] = [];
  const toolResults: AsideBridgeMessage[] = [];
  for (const part of session.timeline ?? []) {
    if (part.kind === "reasoning") {
      const thinking = part.text ?? part.detail;
      if (thinking) assistantParts.push({ type: "thinking", thinking });
      continue;
    }
    if (part.kind === "message") {
      if (part.text) assistantParts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.kind !== "tool") continue;
    const toolCallId = part.toolCallId || part.id;
    const toolName = asideToolName(part.name);
    assistantParts.push({ type: "toolCall", id: toolCallId, name: toolName, arguments: constructToolArguments(part, session) });
    if (part.status !== "running") toolResults.push({
      id: `${session.id}:tool-result:${toolCallId}`,
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text: part.outputPreview ?? part.reason ?? part.title }],
      details: constructToolDetails(part, session),
      isError: part.status === "error",
      timestamp: toTimestamp(part.completedAt ?? part.updatedAt ?? session.updatedAt),
    });
  }

  if (assistantParts.length === 0) {
    for (const message of session.messages.filter((message) => message.role === "assistant")) {
      assistantParts.push({ type: "text", text: message.content });
    }
  }
  if (assistantParts.length > 0) output.push({
    id: `${session.id}:assistant`,
    role: "assistant",
    content: assistantParts,
    provider,
    model,
    timestamp: toTimestamp(session.createdAt),
    stopReason: isTerminalSession(session) ? "end_turn" : "stop",
  });
  output.push(...toolResults);
  return output;
}

function constructToolArguments(
  part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>,
  session: ConstructFlowSession,
): Record<string, unknown> {
  const input = isRecord(part.input) ? part.input : { input: part.input };
  if (asideToolName(part.name) === "write_todos") {
    return { todos: tasksToAsideTodos(session.practiceTasks ?? []) };
  }
  const concept = conceptForTool(part);
  const task = taskForTool(part, session);
  return {
    ...input,
    ...(concept ? { conceptId: concept.id, title: concept.title, language: concept.language, masteryLevel: concept.masteryLevel, summary: concept.summary } : {}),
    ...(task ? { taskId: task.id, title: task.title, prompt: task.prompt, status: task.status } : {}),
  };
}

function constructToolDetails(
  part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>,
  session: ConstructFlowSession,
): Record<string, unknown> {
  const concept = conceptForTool(part);
  const task = taskForTool(part, session);
  return {
    constructKind: concept ? "concept" : task ? "task" : "tool",
    concept,
    task,
    outputPreview: part.outputPreview,
  };
}

function conceptForTool(part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>): Record<string, unknown> | undefined {
  if (!["add-concept", "modify-concept", "suggest-existing-concept"].includes(part.name)) return undefined;
  const input = isRecord(part.input) ? part.input : {};
  const parsed = parseRecord(part.outputPreview);
  const source = { ...input, ...parsed };
  const id = stringValue(source.id) ?? stringValue(source.conceptId);
  if (!id) return undefined;
  return {
    id,
    title: stringValue(source.title) ?? stringValue(source.name) ?? id,
    summary: stringValue(source.summary) ?? stringValue(source.description) ?? "",
    language: stringValue(source.language) ?? "general",
    masteryLevel: stringValue(source.masteryLevel) ?? "L0",
  };
}

function taskForTool(part: Extract<ConstructFlowTimelinePart, { kind: "tool" }>, session: ConstructFlowSession): ConstructFlowPracticeTask | undefined {
  if (!["practice-task", "create-practice-task"].includes(part.name)) return undefined;
  const input = isRecord(part.input) ? part.input : {};
  const id = stringValue(input.id) ?? stringValue(input.taskId);
  return session.practiceTasks.find((task) => task.id === id) ?? session.practiceTasks.at(-1);
}

function asideToolName(name: string): string {
  if (name === "read-file") return "read_file";
  if (name === "write-file") return "write_file";
  if (name === "run-terminal-command") return "bash";
  if (name === "ask-question") return "ask_user_question";
  if (["practice-task", "create-practice-task"].includes(name)) return "construct_practice_task";
  if (["add-concept", "modify-concept", "suggest-existing-concept"].includes(name)) return "construct_concept";
  if (name === "concept-exercise") return "construct_concept_exercise";
  return name.replaceAll("-", "_");
}

function tasksToAsideTodos(tasks: ConstructFlowPracticeTask[]): Array<Record<string, unknown>> {
  return tasks.flatMap((task) => {
    const subtasks = task.subtasks?.length ? task.subtasks : [{ id: task.id, title: task.title, status: task.status }];
    return subtasks.map((subtask) => ({
      id: subtask.id,
      content: subtask.title,
      status: subtask.status === "completed" ? "completed"
        : subtask.status === "cancelled" ? "cancelled"
          : subtask.status === "active" || subtask.status === "submitted" ? "in_progress"
            : "pending",
      taskId: task.id,
    }));
  });
}

function findPendingQuestion(sessions: ConstructFlowSession[]): { question: string; choices: string[]; toolCallId: string } | undefined {
  for (const session of [...sessions].reverse()) {
    for (const tool of [...session.toolCalls].reverse()) {
      if (tool.name !== "ask-question" || tool.status === "error" || tool.response) continue;
      const input = isRecord(tool.input) ? tool.input : {};
      const question = stringValue(input.question);
      if (!question) continue;
      return {
        question,
        choices: Array.isArray(input.choices) ? input.choices.filter((choice): choice is string => typeof choice === "string") : [],
        toolCallId: tool.id,
      };
    }
  }
  return undefined;
}

function mergeSessions(sessions: ConstructFlowSession[], liveSession?: ConstructFlowSession): ConstructFlowSession[] {
  if (!liveSession) return sessions;
  const index = sessions.findIndex((session) => session.id === liveSession.id);
  if (index < 0) return [...sessions, liveSession];
  if (isTerminalSession(sessions[index]) && !isTerminalSession(liveSession)) return sessions;
  return sessions.map((session, sessionIndex) => sessionIndex === index ? liveSession : session);
}

function isTerminalSession(session: Pick<ConstructFlowSession, "status">): boolean {
  return session.status === "completed" || session.status === "error" || session.status === "waiting";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
