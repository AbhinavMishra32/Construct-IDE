import { useEffect, useMemo, useRef, type RefObject } from "react";

import type {
  ConstructFlowPracticeTask,
  ConstructFlowQuestionResponse,
  ConstructFlowSession,
} from "../../../shared/constructFlow";
import type { AiSettings, FlowProjectRecord, ModelCatalogEntry } from "../types";
import {
  AsideRunProjector,
  answerFromAsideSuspensionResponse,
  buildAsideMessages,
  buildAsideSession,
  questionResultTextFromAsideSuspensionResponse,
} from "./asideThreadProtocol";

const ASIDE_BRIDGE_CHANNEL = "construct-aside-bridge:v1";
const ASIDE_THREAD_BRIDGE_REVISION = "2026-07-15-layout-v2";

type AsideHostMessage = {
  channel: typeof ASIDE_BRIDGE_CHANNEL;
  frameId: string;
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

type AsideRunOptions = {
  taskMessage?: { taskId: string; pathNodeId?: string };
  questionResponse?: ConstructFlowQuestionResponse;
};

type ActiveBridgeRun = {
  socketId: string;
  startedAt: number;
  sessionId?: string;
  projector: AsideRunProjector;
};

type AsideSocketDescriptor = {
  kind: "chat" | "session-subscription";
  sessionId: string;
};

export type AsideConstructThreadProps = {
  project: FlowProjectRecord;
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  pending: boolean;
  chatMode: "panel" | "maximized";
  theme: "light" | "dark" | "system";
  aiSettings: AiSettings | null;
  models: ModelCatalogEntry[];
  activeModel: string;
  activeTask?: ConstructFlowPracticeTask;
  onRunAgent: (message: string, options?: AsideRunOptions) => Promise<void>;
  onModelChange: (model: string) => Promise<void>;
  onProviderChange: (provider: AiSettings["provider"] | "construct-cloud") => Promise<void>;
  onReasoningEffortChange: (effort: AiSettings["reasoningEffort"]) => Promise<void>;
  onOpenConcept: (conceptId: string) => void;
  onOpenTask: (task: ConstructFlowPracticeTask) => void;
  onChatMaximize: () => void;
  onChatPanel: () => void;
  onChatClose: () => void;
};

type LatestThreadState = Omit<AsideConstructThreadProps, "theme"> & { resolvedTheme: "light" | "dark" };

type AsideProcedureBridge = {
  frameId: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  socketsRef: RefObject<Map<string, AsideSocketDescriptor>>;
  activeRunRef: RefObject<ActiveBridgeRun | null>;
};

export function AsideConstructThread({
  project,
  sessions,
  liveSession,
  pending,
  chatMode,
  theme,
  aiSettings,
  models,
  activeModel,
  activeTask,
  onRunAgent,
  onModelChange,
  onProviderChange,
  onReasoningEffortChange,
  onOpenConcept,
  onOpenTask,
  onChatMaximize,
  onChatPanel,
  onChatClose,
}: AsideConstructThreadProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameIdRef = useRef<string | null>(null);
  const socketsRef = useRef(new Map<string, AsideSocketDescriptor>());
  const activeRunRef = useRef<ActiveBridgeRun | null>(null);
  const resolvedTheme = resolveTheme(theme);
  const latestRef = useRef<LatestThreadState>({
    project,
    sessions,
    liveSession,
    pending,
    chatMode,
    resolvedTheme,
    aiSettings,
    models,
    activeModel,
    activeTask,
    onRunAgent,
    onModelChange,
    onProviderChange,
    onReasoningEffortChange,
    onOpenConcept,
    onOpenTask,
    onChatMaximize,
    onChatPanel,
    onChatClose,
  });
  latestRef.current = {
    project,
    sessions,
    liveSession,
    pending,
    chatMode,
    resolvedTheme,
    aiSettings,
    models,
    activeModel,
    activeTask,
    onRunAgent,
    onModelChange,
    onProviderChange,
    onReasoningEffortChange,
    onOpenConcept,
    onOpenTask,
    onChatMaximize,
    onChatPanel,
    onChatClose,
  };

  const source = useMemo(() => {
    const entry = new URL("./aside-thread/main.html", document.baseURI);
    entry.searchParams.set("constructBridge", ASIDE_THREAD_BRIDGE_REVISION);
    entry.hash = `/u/1/sidepanel?sessionId=${encodeURIComponent(project.id)}`;
    return entry.href;
  }, [project.id, ASIDE_THREAD_BRIDGE_REVISION]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !isAsideHostMessage(event.data)) return;
      frameIdRef.current = event.data.frameId;
      void handleAsideMessage({
        message: event.data,
        iframeRef,
        latestRef,
        socketsRef,
        activeRunRef,
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const activeRun = activeRunRef.current;
    if (activeRun) {
      const snapshot = flowSnapshotForRun(activeRun, sessions, liveSession);
      if (snapshot) {
        activeRun.sessionId = snapshot.id;
        activeRun.projector.project(snapshot);
        if (isTerminalSession(snapshot)) activeRunRef.current = null;
      }
    }

    const session = buildAsideSession({
      projectId: project.id,
      projectTitle: project.title,
      workspacePath: project.workspacePath,
      sessions,
      liveSession,
      provider: currentProvider(aiSettings),
      model: activeModel,
      thinkingLevel: reasoningLevel(aiSettings),
    });
    for (const [socketId, descriptor] of socketsRef.current) {
      if (descriptor.kind !== "session-subscription" || descriptor.sessionId !== project.id) continue;
      sendSocketMessage(iframeRef, frameIdRef.current ?? "", socketId, { op: "update", session });
    }
  }, [activeModel, aiSettings, liveSession, project, sessions]);

  useEffect(() => {
    sendToAsideFrame(iframeRef, frameIdRef.current, "theme", { theme: resolvedTheme });
  }, [resolvedTheme]);

  useEffect(() => {
    sendToAsideFrame(iframeRef, frameIdRef.current, "layout", { chatMode });
  }, [chatMode]);

  return (
    <iframe
      ref={iframeRef}
      allow="clipboard-read; clipboard-write"
      className="h-full min-h-0 w-full border-0 bg-background"
      data-construct-agent-thread="aside-production-bundle"
      src={source}
      title={`${project.title} Construct agent`}
    />
  );
}

async function handleAsideMessage({
  message,
  iframeRef,
  latestRef,
  socketsRef,
  activeRunRef,
}: {
  message: AsideHostMessage;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  latestRef: RefObject<LatestThreadState>;
  socketsRef: RefObject<Map<string, AsideSocketDescriptor>>;
  activeRunRef: RefObject<ActiveBridgeRun | null>;
}): Promise<void> {
  const latest = latestRef.current;
  if (!latest) return;

  if (message.type === "ready") {
    sendToAsideFrame(iframeRef, message.frameId, "theme", { theme: latest.resolvedTheme });
    sendToAsideFrame(iframeRef, message.frameId, "layout", { chatMode: latest.chatMode });
    return;
  }

  if (message.type === "rpc") {
    const paths = arrayOfStrings(message.payload?.paths);
    const inputs = Array.isArray(message.payload?.inputs) ? message.payload.inputs : [];
    try {
      const bridge = {
        frameId: message.frameId,
        iframeRef,
        socketsRef,
        activeRunRef,
      };
      const values = await Promise.all(paths.map((path, index) => resolveAsideProcedure(path, inputs[index], latestRef, bridge)));
      respondToAsideFrame(iframeRef, message, { ok: true, value: values });
    } catch (error) {
      respondToAsideFrame(iframeRef, message, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (message.type === "ws-connect") {
    const socketId = stringValue(message.payload?.socketId);
    if (!socketId) return;
    const descriptor = asideSocketDescriptor(stringValue(message.payload?.url), latest.project.id);
    socketsRef.current.set(socketId, descriptor);
    sendToAsideFrame(iframeRef, message.frameId, "ws-open", { socketId, sessionId: descriptor.sessionId });
    if (descriptor.kind === "session-subscription") {
      sendSocketMessage(iframeRef, message.frameId, socketId, {
        op: "snapshot",
        session: buildAsideSession({
          projectId: latest.project.id,
          projectTitle: latest.project.title,
          workspacePath: latest.project.workspacePath,
          sessions: latest.sessions,
          liveSession: latest.liveSession,
          provider: currentProvider(latest.aiSettings),
          model: latest.activeModel,
          thinkingLevel: reasoningLevel(latest.aiSettings),
        }),
      });
    }
    return;
  }

  if (message.type === "ws-disconnect") {
    const socketId = stringValue(message.payload?.socketId);
    if (socketId) socketsRef.current.delete(socketId);
    return;
  }

  if (message.type === "ws-send") {
    const socketId = stringValue(message.payload?.socketId);
    const source = stringValue(message.payload?.data);
    if (!socketId || !source) return;
    await runAsideCommand({ socketId, source, frameId: message.frameId, iframeRef, latestRef, activeRunRef });
    return;
  }

  if (message.type === "action") {
    const action = stringValue(message.payload?.action);
    if (action === "open-concept") {
      const conceptId = stringValue(message.payload?.conceptId);
      if (conceptId) latest.onOpenConcept(conceptId);
    }
    if (action === "open-task") {
      const taskId = stringValue(message.payload?.taskId);
      const task = mergedSessions(latest.sessions, latest.liveSession)
        .flatMap((session) => session.practiceTasks)
        .find((candidate) => candidate.id === taskId);
      if (task) latest.onOpenTask(task);
    }
    if (action === "chat-maximize") latest.onChatMaximize();
    if (action === "chat-panel") latest.onChatPanel();
    if (action === "chat-close") latest.onChatClose();
  }
}

async function runAsideCommand({
  socketId,
  source,
  frameId,
  iframeRef,
  latestRef,
  activeRunRef,
}: {
  socketId: string;
  source: string;
  frameId: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  latestRef: RefObject<LatestThreadState>;
  activeRunRef: RefObject<ActiveBridgeRun | null>;
}): Promise<void> {
  const latest = latestRef.current;
  if (!latest) return;
  const command = parseRecord(source);
  const commandBody = recordValue(command.command);
  const commandType = stringValue(commandBody.type) ?? "prompt";
  const commandId = stringValue(command.commandId) ?? crypto.randomUUID();
  sendSocketMessage(iframeRef, frameId, socketId, {
    op: "ack",
    protocolVersion: 1,
    commandId,
    commandType,
  });
  if (commandType === "interrupt") return;

  const message = commandText(commandBody.message) || (commandType === "continue" ? "Continue." : "");
  if (!message.trim()) return;
  const projector = new AsideRunProjector(
    (value) => sendSocketMessage(iframeRef, frameId, socketId, value),
    currentProvider(latest.aiSettings),
    latest.activeModel,
  );
  projector.start(message);
  activeRunRef.current = { socketId, startedAt: Date.now(), projector };

  const pendingQuestion = findPendingQuestion(latest.sessions, latest.liveSession);
  const options: AsideRunOptions | undefined = pendingQuestion ? {
    questionResponse: {
      sessionId: pendingQuestion.sessionId,
      toolCallId: pendingQuestion.toolCallId,
      question: pendingQuestion.question,
      answer: message,
      answeredAt: new Date().toISOString(),
    },
  } : latest.activeTask ? {
    taskMessage: { taskId: latest.activeTask.id, pathNodeId: latest.activeTask.pathNodeId },
  } : undefined;

  try {
    await latest.onRunAgent(message, options);
  } catch (error) {
    projector.fail(error instanceof Error ? error.message : String(error));
    activeRunRef.current = null;
  }
}

async function resolveAsideProcedure(
  path: string,
  rawInput: unknown,
  latestRef: RefObject<LatestThreadState>,
  bridge: AsideProcedureBridge,
): Promise<unknown> {
  const latest = latestRef.current;
  if (!latest) return {};
  const input = recordValue(rawInput);
  const session = () => buildAsideSession({
    projectId: latest.project.id,
    projectTitle: latest.project.title,
    workspacePath: latest.project.workspacePath,
    sessions: latest.sessions,
    liveSession: latest.liveSession,
    provider: currentProvider(latest.aiSettings),
    model: latest.activeModel,
    thinkingLevel: reasoningLevel(latest.aiSettings),
  });

  if (path === "accounts.ensureProfileAccount" || path === "accounts.resolveProfileAccountByProfile") return { id: 1 };
  if (path === "accounts.current") return { accountId: 1 };
  if (path === "accounts.auth.me") return { id: 1, name: "Construct", email: "local@construct" };
  if (path === "accounts.get") return { id: 1, mode: "local", authStatus: "active" };
  if (path === "sessions.get" || path === "sessions.create" || path === "sessions.createAndPrompt") return session();
  if (path === "sessions.messages") return buildAsideMessages(
    latest.sessions,
    latest.liveSession,
    currentProvider(latest.aiSettings),
    latest.activeModel,
  );
  if (path === "sessions.markRead") return { readAt: new Date().toISOString() };
  if (path === "sessions.resolveSuspension") {
    const pendingQuestion = findPendingQuestion(
      latest.sessions,
      latest.liveSession,
      stringValue(input.toolCallId),
    );
    if (!pendingQuestion) throw new Error("The tracked Construct question is no longer pending.");
    const response = recordValue(input.response);
    const answer = answerFromAsideSuspensionResponse(response);
    if (!answer) throw new Error("Choose an option or enter a custom answer before submitting.");
    return continueFromAsideQuestion({
      latestRef,
      bridge,
      pendingQuestion,
      answer,
      resultText: questionResultTextFromAsideSuspensionResponse(response),
      skipped: false,
    });
  }
  if (path === "sessions.interrupt") {
    const pendingQuestion = findPendingQuestion(latest.sessions, latest.liveSession);
    if (!pendingQuestion) return session();
    return continueFromAsideQuestion({
      latestRef,
      bridge,
      pendingQuestion,
      answer: "Skipped",
      resultText: "Asked user 1 question(s)\nUser responses to asked questions:\n- Question: Skipped",
      skipped: true,
    });
  }
  if (path === "sessions.update") {
    const model = modelInput(input);
    if (model.provider && isConstructProvider(model.provider) && model.provider !== currentProvider(latest.aiSettings)) {
      await latest.onProviderChange(model.provider);
    }
    if (model.modelId && model.modelId !== latest.activeModel) await latest.onModelChange(model.modelId);
    if (model.thinkingLevel) await latest.onReasoningEffortChange(reasoningEffort(model.thinkingLevel));
    return session();
  }
  if (path === "sessions.tabs.list" || path === "sessions.messageRows" || path.includes("listPreviewItems")) return [];
  if (path === "settings.getAll") return {
    defaultModel: {
      modelProvider: currentProvider(latest.aiSettings),
      provider: currentProvider(latest.aiSettings),
      modelId: latest.activeModel,
      thinkingLevel: reasoningLevel(latest.aiSettings),
      fastMode: false,
    },
    modelCategories: {},
    mcp: { servers: {} },
  };
  if (path === "settings.update" || path === "settings.setDefaultModel" || path === "settings.set") {
    const model = modelInput(input);
    if (model.provider && isConstructProvider(model.provider)) await latest.onProviderChange(model.provider);
    if (model.modelId) await latest.onModelChange(model.modelId);
    if (model.thinkingLevel) await latest.onReasoningEffortChange(reasoningEffort(model.thinkingLevel));
    return { ok: true };
  }
  if (path === "models.listSettingsInventory") return modelInventory(latest);
  if (path === "models.listAvailable" || path === "models.listSupported") return modelInventory(latest).availableModels;
  if (path === "models.listCredentials") return [currentProvider(latest.aiSettings)];
  if (path.startsWith("models.")) return {};
  if (path.startsWith("agents.")) return [];
  if (path.startsWith("analytics.")) return {};
  return {};
}

async function continueFromAsideQuestion({
  latestRef,
  bridge,
  pendingQuestion,
  answer,
  resultText,
  skipped,
}: {
  latestRef: RefObject<LatestThreadState>;
  bridge: AsideProcedureBridge;
  pendingQuestion: NonNullable<ReturnType<typeof findPendingQuestion>>;
  answer: string;
  resultText: string;
  skipped: boolean;
}): Promise<Record<string, unknown>> {
  const latest = latestRef.current;
  if (!latest) return {};
  const socketId = [...bridge.socketsRef.current.entries()].find(([, descriptor]) => (
    descriptor.kind === "chat"
      && (descriptor.sessionId === latest.project.id || descriptor.sessionId === pendingQuestion.sessionId)
  ))?.[0];
  const projector = socketId ? new AsideRunProjector(
    (value) => sendSocketMessage(bridge.iframeRef, bridge.frameId, socketId, value),
    currentProvider(latest.aiSettings),
    latest.activeModel,
  ) : undefined;
  const startedAt = Date.now();
  if (projector && socketId) {
    projector.resumeQuestion(pendingQuestion.toolCallId, resultText);
    bridge.activeRunRef.current = { socketId, startedAt, projector };
  }

  try {
    await latest.onRunAgent(answer, {
      questionResponse: {
        sessionId: pendingQuestion.sessionId,
        toolCallId: pendingQuestion.toolCallId,
        question: pendingQuestion.question,
        answer: skipped ? "" : answer,
        skipped,
        answeredAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    projector?.fail(error instanceof Error ? error.message : String(error));
    bridge.activeRunRef.current = null;
    throw error;
  }

  const refreshed = latestRef.current;
  if (!refreshed) return {};
  return clearResolvedSuspension(buildAsideSession({
    projectId: refreshed.project.id,
    projectTitle: refreshed.project.title,
    workspacePath: refreshed.project.workspacePath,
    sessions: refreshed.sessions,
    liveSession: refreshed.liveSession,
    provider: currentProvider(refreshed.aiSettings),
    model: refreshed.activeModel,
    thinkingLevel: reasoningLevel(refreshed.aiSettings),
  }), pendingQuestion.toolCallId);
}

function clearResolvedSuspension(session: Record<string, unknown>, toolCallId: string): Record<string, unknown> {
  const suspension = recordValue(session.suspension);
  if (stringValue(suspension.toolCallId) !== toolCallId) return session;
  const toolState = recordValue(session.toolState);
  return {
    ...session,
    status: "idle",
    suspension: undefined,
    toolState: { ...toolState, question: {} },
  };
}

function modelInventory(latest: LatestThreadState) {
  const provider = currentProvider(latest.aiSettings);
  const availableModels = latest.models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    provider: model.providerId || provider,
    availableThinkingLevels: ["off", "low", "medium", "high"],
    supportsFastMode: false,
  }));
  if (latest.activeModel && !availableModels.some((model) => model.id === latest.activeModel)) {
    availableModels.unshift({
      id: latest.activeModel,
      name: latest.activeModel,
      provider,
      availableThinkingLevels: ["off", "low", "medium", "high"],
      supportsFastMode: false,
    });
  }
  return {
    connectedProviders: [{ providerId: provider, type: "api_key", linked: true }],
    availableModels,
    subscriptionPlan: "local",
  };
}

function sendSocketMessage(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  frameId: string,
  socketId: string,
  data: Record<string, unknown>,
): void {
  sendToAsideFrame(iframeRef, frameId, "ws-message", { socketId, data });
}

function sendToAsideFrame(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  frameId: string | null,
  type: string,
  payload: Record<string, unknown>,
  requestId?: string,
): void {
  if (!frameId) return;
  iframeRef.current?.contentWindow?.postMessage({
    channel: ASIDE_BRIDGE_CHANNEL,
    frameId,
    type,
    requestId,
    payload,
  }, "*");
}

function respondToAsideFrame(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  message: AsideHostMessage,
  payload: Record<string, unknown>,
): void {
  sendToAsideFrame(iframeRef, message.frameId, "response", payload, message.requestId);
}

function flowSnapshotForRun(
  activeRun: ActiveBridgeRun,
  sessions: ConstructFlowSession[],
  liveSession?: ConstructFlowSession,
): ConstructFlowSession | undefined {
  if (activeRun.sessionId) {
    if (liveSession?.id === activeRun.sessionId) return liveSession;
    return sessions.find((session) => session.id === activeRun.sessionId);
  }
  if (liveSession && timestamp(liveSession.createdAt) >= activeRun.startedAt - 1_500) return liveSession;
  return [...sessions]
    .reverse()
    .find((session) => timestamp(session.createdAt) >= activeRun.startedAt - 1_500);
}

function findPendingQuestion(sessions: ConstructFlowSession[], liveSession?: ConstructFlowSession, toolCallId?: string) {
  for (const session of [...mergedSessions(sessions, liveSession)].reverse()) {
    for (const tool of [...session.toolCalls].reverse()) {
      if (!isQuestionToolName(tool.name) || tool.status === "error" || tool.response) continue;
      if (toolCallId && tool.id !== toolCallId) continue;
      const input = recordValue(tool.input);
      const question = stringValue(input.question);
      if (!question) continue;
      return { sessionId: session.id, toolCallId: tool.id, question };
    }
  }
  return undefined;
}

function isQuestionToolName(name: string): boolean {
  const normalized = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "askquestion" || normalized === "askuser" || normalized === "askuserquestion";
}

function mergedSessions(sessions: ConstructFlowSession[], liveSession?: ConstructFlowSession): ConstructFlowSession[] {
  if (!liveSession) return sessions;
  const index = sessions.findIndex((session) => session.id === liveSession.id);
  if (index < 0) return [...sessions, liveSession];
  if (isTerminalSession(sessions[index]) && !isTerminalSession(liveSession)) return sessions;
  return sessions.map((session, sessionIndex) => sessionIndex === index ? liveSession : session);
}

function commandText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(commandText).filter(Boolean).join("\n");
  const record = recordValue(value);
  if (record.type === "text" && typeof record.text === "string") return record.text;
  return commandText(record.content ?? record.message ?? record.parts);
}

function modelInput(input: Record<string, unknown>): { provider?: string; modelId?: string; thinkingLevel?: string } {
  const source = recordValue(input.model ?? recordValue(input.patch).model ?? input.defaultModel ?? input.value);
  return {
    provider: stringValue(source.provider) ?? stringValue(source.modelProvider),
    modelId: stringValue(source.modelId),
    thinkingLevel: stringValue(source.thinkingLevel),
  };
}

function currentProvider(settings: AiSettings | null): AiSettings["provider"] | "construct-cloud" {
  return settings?.source === "construct-cloud" ? "construct-cloud" : settings?.provider ?? "openai";
}

function reasoningLevel(settings: AiSettings | null): string {
  const effort = settings?.reasoningEffort ?? "auto";
  return effort === "auto" ? "medium" : effort === "none" ? "off" : effort;
}

function reasoningEffort(level: string): AiSettings["reasoningEffort"] {
  if (level === "off") return "none";
  return level === "low" || level === "medium" || level === "high" ? level : "auto";
}

function resolveTheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function asideSocketDescriptor(value: string | undefined, fallbackSessionId: string): AsideSocketDescriptor {
  if (!value) return { kind: "chat", sessionId: fallbackSessionId };
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/ws/sessions/")) {
      return {
        kind: "session-subscription",
        sessionId: decodeURIComponent(url.pathname.slice("/ws/sessions/".length)) || fallbackSessionId,
      };
    }
    const pathId = url.pathname.startsWith("/agents/chat/")
      ? decodeURIComponent(url.pathname.slice("/agents/chat/".length))
      : undefined;
    return {
      kind: "chat",
      sessionId: url.searchParams.get("sessionId") ?? pathId ?? fallbackSessionId,
    };
  } catch {
    return { kind: "chat", sessionId: fallbackSessionId };
  }
}

function isConstructProvider(value: string): value is AiSettings["provider"] | "construct-cloud" {
  return ["openai", "openrouter", "github-copilot", "opencode-zen", "litellm", "construct-cloud"].includes(value);
}

function isTerminalSession(session: Pick<ConstructFlowSession, "status">): boolean {
  return session.status === "completed" || session.status === "error" || session.status === "waiting";
}

function isAsideHostMessage(value: unknown): value is AsideHostMessage {
  const record = recordValue(value);
  return record.channel === ASIDE_BRIDGE_CHANNEL && typeof record.frameId === "string" && typeof record.type === "string";
}

function parseRecord(source: string): Record<string, unknown> {
  try {
    return recordValue(JSON.parse(source));
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}
