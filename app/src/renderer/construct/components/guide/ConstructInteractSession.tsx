import { BookOpenIcon, FileCodeIcon, PathIcon, SparkleIcon } from "@phosphor-icons/react";
import { useRef, type ReactNode } from "react";

import {
  AgentSessionComposer,
  AgentSessionSurface,
  type AgentRunTraceEntry,
  type AgentSessionMessage,
  type AgentSessionMessagePart
} from "@opaline/ui";

import type {
  ConstructAgentRunEvent,
  ConstructInteractSession as ConstructInteractSessionRecord,
  ConstructInteractToolCallRecord,
  ProjectLearningState
} from "../../../../shared/constructLearning";
import type { InlineFileRef } from "../../lib/inlineRefs";
import type { ConstructInteractClientResult } from "../../types";
import { MarkdownBlock } from "../MarkdownBlock";

type ConstructInteractAction = NonNullable<ConstructInteractClientResult["actions"]>[number];

export function ConstructInteractSession({
  blockId,
  prompt,
  theme,
  sessions,
  liveSession,
  result,
  answer,
  onAnswerChange,
  onSubmit,
  onAction,
  isPending,
  onOpenConcept,
  onOpenFile,
  toolbar,
  eyebrow = "Question",
  submitLabel = "Send answer",
  placeholder = "Answer in your own words..."
}: {
  blockId: string;
  prompt: string;
  theme: "light" | "dark" | "system";
  sessions: ProjectLearningState["constructInteractSessions"];
  liveSession?: ConstructInteractSessionRecord;
  result?: ConstructInteractClientResult;
  answer: string;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  onAction?: (action: ConstructInteractAction) => void;
  isPending: boolean;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  toolbar?: ReactNode;
  eyebrow?: string;
  submitLabel?: string;
  placeholder?: string;
}) {
  const submittedAnswerRef = useRef("");
  if (!isPending && answer.trim()) {
    submittedAnswerRef.current = answer;
  }
  const pendingAnswer = isPending ? submittedAnswerRef.current : answer;
  const messages = buildInteractMessages({
    blockId,
    sessions,
    liveSession,
    result,
    answerDraft: pendingAnswer,
    isPending,
    theme,
    onInteractAction: onAction,
    onOpenConcept,
    onOpenFile
  });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {toolbar ? <div className="shrink-0 border-b p-2">{toolbar}</div> : null}
      <AgentSessionSurface
        eyebrow={eyebrow}
        lead={
          <MarkdownBlock
            className="space-y-2 text-[13px] leading-5 [&_p]:leading-5"
            content={prompt}
            theme={theme}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        }
        messages={messages}
        emptyState={null}
        scrollKey={`${sessions.length}:${liveSession?.id ?? "idle"}:${liveSession?.updatedAt ?? "none"}:${isPending}:${result?.status ?? "idle"}`}
        composer={
          <AgentSessionComposer
            value={answer}
            onValueChange={onAnswerChange}
            onSubmit={onSubmit}
            pending={isPending}
            submitLabel={submitLabel}
            placeholder={placeholder}
          />
        }
      />
    </div>
  );
}

function buildInteractMessages({
  blockId,
  sessions,
  liveSession,
  result,
  answerDraft,
  isPending,
  theme,
  onInteractAction,
  onOpenConcept,
  onOpenFile
}: {
  blockId: string;
  sessions: ProjectLearningState["constructInteractSessions"];
  liveSession?: ConstructInteractSessionRecord;
  result?: ConstructInteractClientResult;
  answerDraft: string;
  isPending: boolean;
  theme: "light" | "dark" | "system";
  onInteractAction?: (action: ConstructInteractAction) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}): AgentSessionMessage[] {
  const recentSessions = mergeSessions(sessions, liveSession);
  const latestSessionId = recentSessions.at(-1)?.id;
  const messages = recentSessions.flatMap((session): AgentSessionMessage[] => {
    const isLiveSession = Boolean(liveSession && session.id === liveSession.id && session.runStatus === "running");
    const isLatestResult = Boolean(result && (result.session?.id === session.id || session.id === latestSessionId));
    const completedEvents = isLatestResult
      ? (result?.agentEvents ?? session.agentEvents ?? [])
      : (session.agentEvents ?? []);
    const completedToolCalls = isLatestResult
      ? (result?.toolCalls ?? session.toolCalls ?? [])
      : (session.toolCalls ?? []);
    const events = isLiveSession ? (session.agentEvents ?? []) : completedEvents;
    const toolCalls = isLiveSession ? (session.toolCalls ?? []) : completedToolCalls;
    const assistantParts = buildAgentEventParts({
      sessionId: session.id,
      events,
      toolCalls,
      replyText: session.reply,
      assessmentMeta: !isLiveSession && session.assessment
        ? `${interactStatusLabel(session.assessment.status)} · ${session.assessment.confidence} confidence · ${session.assessment.assistanceLevel}`
        : undefined,
      isLiveSession,
      theme,
      onOpenConcept,
      onOpenFile
    });

    const resultSource = isLatestResult && result
      ? result
      : sessionToResultPartsSource(session);
    if (!isLiveSession) {
      assistantParts.push(...buildInteractResultParts(resultSource, {
        sessionId: session.id,
        onInteractAction
      }));
    }

    return [
      {
        id: `${session.id}:user`,
        role: "user",
        content: session.answer
      },
      {
        id: `${session.id}:assistant`,
        role: "assistant",
        parts: assistantParts
      }
    ];
  });

  if (isPending && !liveSession && answerDraft.trim()) {
    messages.push(
      {
        id: `${blockId}:pending-user`,
        role: "user",
        content: answerDraft
      },
      {
        id: `${blockId}:pending-assistant`,
        role: "assistant",
        parts: [{
          type: "activity",
          id: `${blockId}:agent-trace`,
          entry: {
            id: `${blockId}:pending-agent`,
            kind: "thought",
            title: "Working",
            status: "running"
          }
        }]
      }
    );
  }

  return messages;
}

function buildAgentEventParts({
  sessionId,
  events,
  toolCalls,
  replyText,
  assessmentMeta,
  isLiveSession,
  theme,
  onOpenConcept,
  onOpenFile
}: {
  sessionId: string;
  events: ConstructAgentRunEvent[];
  toolCalls: ConstructInteractToolCallRecord[];
  replyText: string;
  assessmentMeta?: string;
  isLiveSession: boolean;
  theme: "light" | "dark" | "system";
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}): AgentSessionMessagePart[] {
  const parts: AgentSessionMessagePart[] = [];
  const seenToolIds = new Set<string>();
  const seenToolNames = new Map<string, number>();
  let hasMessageEvent = false;
  const fallbackText = splitProcessNarration(replyText);
  const fallbackReasoning = !events.some((event) => event.type === "message")
    ? splitReasoningSegments(fallbackText.process)
    : [];
  let fallbackReasoningIndex = 0;
  const pushFallbackReasoning = () => {
    const text = fallbackReasoning[fallbackReasoningIndex++];
    if (!text) return;
    parts.push(buildFallbackReasoningPart(sessionId, fallbackReasoningIndex, text));
  };

  for (const event of events) {
    if (event.type === "iteration") continue;
    if (event.type === "message") {
      if (!event.text?.trim()) continue;
      hasMessageEvent = true;
      parts.push({
        type: "text",
        id: `${sessionId}:message:${event.id}`,
        content: (
          <div className={isLiveSession && event.status === "running" ? "construct-interact-streaming-reply" : undefined} data-streaming={isLiveSession && event.status === "running" || undefined}>
            <MarkdownBlock
              className="space-y-2 text-[13px] leading-[1.65] [&_p]:leading-[1.65]"
              content={event.text}
              theme={theme}
              onOpenConcept={onOpenConcept}
              onOpenFile={onOpenFile}
            />
          </div>
        )
      });
      continue;
    }
    if (event.type === "reasoning" && event.status === "completed" && !event.text?.trim()) {
      continue;
    }
    if (event.type === "reasoning") {
      parts.push({
        type: "activity",
        id: `${sessionId}:reasoning:${event.id}`,
        entry: runEventToTraceEntry(event),
        defaultOpen: false
      });
      continue;
    }
    seenToolIds.add(event.id);
    const toolName = event.toolName ?? event.title;
    seenToolNames.set(toolName, (seenToolNames.get(toolName) ?? 0) + 1);
    parts.push({
      type: "activity",
      id: `${sessionId}:tool:${event.id}`,
      entry: runEventToTraceEntry(event),
      defaultOpen: false
    });
    pushFallbackReasoning();
  }
  for (const toolCall of toolCalls) {
    if (seenToolIds.has(toolCall.id)) continue;
    const seenCount = seenToolNames.get(toolCall.name) ?? 0;
    if (seenCount > 0) {
      seenToolNames.set(toolCall.name, seenCount - 1);
      continue;
    }
    parts.push({
      type: "activity",
      id: `${sessionId}:tool-call:${toolCall.id}`,
      entry: toolCallToTraceEntry(toolCall)
    });
    pushFallbackReasoning();
  }
  while (fallbackReasoningIndex < fallbackReasoning.length) {
    pushFallbackReasoning();
  }
  if (isLiveSession && !parts.some((part) => part.type === "activity" && part.entry.status === "running")) {
    parts.push({
      type: "activity",
      id: `${sessionId}:live-tail`,
      entry: {
        id: `${sessionId}:live-tail`,
        kind: "thought",
        title: "Continuing",
        status: "running"
      }
    });
  }
  if (!hasMessageEvent && fallbackText.answer) {
    parts.push({
      type: "text",
      id: `${sessionId}:reply`,
      content: (
        <div className={isLiveSession ? "construct-interact-streaming-reply" : undefined} data-streaming={isLiveSession || undefined}>
          <MarkdownBlock
            className="space-y-2 text-[13px] leading-[1.65] [&_p]:leading-[1.65]"
            content={fallbackText.answer}
            theme={theme}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        </div>
      ),
      meta: assessmentMeta
    });
  }
  return parts;
}

function buildFallbackReasoningPart(sessionId: string, index: number, text: string): AgentSessionMessagePart {
  return {
    type: "activity",
    id: `${sessionId}:reasoning:fallback:${index}`,
    defaultOpen: false,
    entry: {
      id: `${sessionId}:reasoning:fallback:${index}`,
      kind: "thought",
      title: "Reasoning",
      status: "completed",
      output: text
    }
  };
}

function runEventToTraceEntry(event: ConstructAgentRunEvent): AgentRunTraceEntry {
  if (event.type === "iteration" || event.type === "reasoning") {
    return {
      id: event.id,
      kind: "thought",
      title: event.type === "reasoning" ? "Reasoning" : event.title,
      subtitle: event.type === "reasoning" && event.text ? undefined : event.detail,
      status: traceStatus(event.status),
      input: event.type === "iteration" ? stringifyTraceValue(event.input) : undefined,
      output: event.type === "reasoning"
        ? event.text
        : event.type === "iteration"
          ? sanitizeIterationOutput(event.outputPreview)
          : undefined
    };
  }

  const status = traceStatus(event.status);
  const copy = interactToolCopy(event.toolName ?? event.title, status);
  return {
    id: event.id,
    kind: "tool",
    title: copy.title,
    subtitle: event.detail,
    status,
    icon: classifyToolTraceIcon(event.toolName ?? event.title),
    input: stringifyTraceValue(event.input),
    output: event.outputPreview
  };
}

function splitProcessNarration(text: string | undefined): { process?: string; answer?: string } {
  const value = text?.trim();
  if (!value) return {};
  const processPattern = /(?:^|\n)(?=(?:#{1,4}\s+|\*\*|The project structure:|Here(?:'|’)s where|Here is where|What we have|Next step|So,? here|Now we can)\b)/i;
  const match = value.match(processPattern);
  if (!match?.index || match.index < 80) {
    return { answer: value };
  }
  const process = value.slice(0, match.index).trim();
  const answer = value.slice(match.index).trim();
  return { process, answer: answer || value };
}

function splitReasoningSegments(text: string | undefined): string[] {
  const value = text?.trim();
  if (!value) return [];
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return [value];
  const segments: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    segments.push(sentences.slice(index, index + 2).join(" "));
  }
  return segments;
}

function toolCallToTraceEntry(toolCall: ConstructInteractToolCallRecord): AgentRunTraceEntry {
  const copy = interactToolCopy(toolCall.name, "completed");
  return {
    id: toolCall.id,
    kind: "tool",
    title: copy.title,
    subtitle: toolCall.reason,
    status: "completed",
    icon: classifyToolTraceIcon(toolCall.name),
    input: stringifyTraceValue(toolCall.input),
    output: toolCall.outputPreview
  };
}

function traceStatus(status: ConstructAgentRunEvent["status"]): AgentRunTraceEntry["status"] {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "completed";
}

function stringifyTraceValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeIterationOutput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    delete parsed.text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return undefined;
  }
}

function classifyToolTraceIcon(name: string): AgentRunTraceEntry["icon"] {
  switch (name) {
    case "searchTape":
      return "search";
    case "getStepFiles":
    case "readWorkspaceFile":
    case "writeWorkspaceFile":
    case "appendWorkspaceFile":
    case "createWorkspaceFolder":
      return "file";
    case "getLatestTerminalOutput":
      return "terminal";
    case "getLearnerState":
    case "getProjectLearnerState":
    case "getKnowledgeBase":
    case "getRecallHistory":
    case "getConstructInteractHistory":
      return "memory";
    case "getCurrentStep":
    case "getStepById":
    case "getPreviousSteps":
    case "getNextSteps":
    case "getCurrentBlock":
    case "getAuthoredResources":
    case "getConceptCard":
    case "getReferenceCard":
    case "findWhereConceptWasIntroduced":
      return "read";
    default:
      return "tool";
  }
}

function buildInteractResultParts(
  result: Pick<ConstructInteractClientResult, "actions" | "dynamicSteps" | "dynamicStepValidation" | "generatedLiveSteps" | "liveStepValidation">,
  {
    sessionId,
    onInteractAction
  }: {
    sessionId: string;
    onInteractAction?: (action: ConstructInteractAction) => void;
  }
): AgentSessionMessagePart[] {
  const parts: AgentSessionMessagePart[] = [];
  const dynamicSteps = result.dynamicSteps ?? result.generatedLiveSteps ?? [];
  const dynamicStepValidation = result.dynamicStepValidation ?? result.liveStepValidation ?? [];

  if (result.actions?.length) {
    parts.push({
      type: "actions",
      id: `${sessionId}:actions`,
      actions: result.actions.map((action, index) => ({
        id: `${action.type}-${index}`,
        label: action.label,
        description: action.reason,
        icon: interactActionIcon(action),
        variant: "outline",
        onSelect: () => onInteractAction?.(action)
      }))
    });
  }

  if (dynamicSteps.length) {
    parts.push({
      type: "tool",
      id: `${sessionId}:live-steps`,
      tool: {
        id: `${sessionId}:live-steps-tool`,
        title: "Dynamic Steps",
        subtitle: `${dynamicSteps.length} step${dynamicSteps.length === 1 ? "" : "s"}`,
        status: "completed",
        content: (
          <div className="flex flex-col gap-2">
            {dynamicSteps.map((step) => (
              <div key={step.id ?? step.title} className="rounded-md border bg-muted/30 p-3 text-xs">
                <strong className="font-medium">{step.title}</strong>
                <p>{step.reason}</p>
              </div>
            ))}
          </div>
        )
      }
    });
  }

  if (dynamicStepValidation.length) {
    parts.push({
      type: "tool",
      id: `${sessionId}:validation`,
      tool: {
        id: `${sessionId}:validation-tool`,
        title: "Dynamic Step validation",
        subtitle: `${dynamicStepValidation.length} check${dynamicStepValidation.length === 1 ? "" : "s"}`,
        status: dynamicStepValidation.some((entry) => entry.status === "rejected") ? "error" : "completed",
        content: (
          <div className="flex flex-col gap-2">
            {dynamicStepValidation.map((entry, index) => (
              <div key={`${entry.stepId ?? entry.draftTitle ?? index}`} className="rounded-md border bg-muted/30 p-3 text-xs">
                <strong className="font-medium">{entry.stepId ?? entry.draftTitle ?? "Dynamic Step"}</strong>
                <p>{entry.reason}</p>
              </div>
            ))}
          </div>
        )
      }
    });
  }

  return parts;
}

function interactActionIcon(action: ConstructInteractAction) {
  switch (action.type) {
    case "open-concept":
      return <BookOpenIcon data-icon="inline-start" />;
    case "open-file":
    case "focus-code":
      return <FileCodeIcon data-icon="inline-start" />;
    case "go-to-step":
      return <PathIcon data-icon="inline-start" />;
    default:
      return <SparkleIcon data-icon="inline-start" />;
  }
}

function interactToolCopy(name: string, status: AgentRunTraceEntry["status"]): { title: string } {
  const done = status === "completed";
  const failed = status === "error";
  const title = failed ? "Failed" : done ? "Completed" : "Running";
  switch (name) {
    case "getTapeOverview":
      return { title: failed ? "Could not inspect tape" : done ? "Inspected tape" : "Inspecting tape" };
    case "getTapeStep":
    case "getTapeStepBlock":
      return { title: failed ? "Could not read tape structure" : done ? "Read tape structure" : "Reading tape structure" };
    case "getTapeFileManifest":
      return { title: failed ? "Could not inspect tape files" : done ? "Inspected tape files" : "Inspecting tape files" };
    case "parseDynamicStep":
      return { title: failed ? "Could not parse Dynamic Step" : done ? "Parsed Dynamic Step" : "Parsing Dynamic Step" };
    case "compileDynamicStep":
      return { title: failed ? "Could not compile Dynamic Step" : done ? "Compiled Dynamic Step" : "Compiling Dynamic Step" };
    case "createDynamicStep":
      return { title: failed ? "Could not create Dynamic Step" : done ? "Created Dynamic Step" : "Creating Dynamic Step" };
    case "recordLearnerAssessment":
      return { title: failed ? "Could not record assessment" : done ? "Recorded assessment" : "Recording assessment" };
    case "getCurrentStep":
    case "getStepById":
    case "getPreviousSteps":
    case "getNextSteps":
      return { title: failed ? "Could not read lesson step" : done ? "Read lesson step" : "Reading lesson step" };
    case "getCurrentBlock":
      return { title: failed ? "Could not check current question" : done ? "Checked current question" : "Checking current question" };
    case "getAuthoredResources":
      return { title: failed ? "Could not fetch lesson resources" : done ? "Fetched lesson resources" : "Fetching lesson resources" };
    case "getConceptCard":
      return { title: failed ? "Could not fetch concept card" : done ? "Fetched concept card" : "Fetching concept card" };
    case "getReferenceCard":
      return { title: failed ? "Could not fetch reference card" : done ? "Fetched reference card" : "Fetching reference card" };
    case "findWhereConceptWasIntroduced":
      return { title: failed ? "Could not find concept introduction" : done ? "Found concept introduction" : "Finding concept introduction" };
    case "searchTape":
      return { title: failed ? "Could not search lesson" : done ? "Searched lesson" : "Searching lesson" };
    case "getLearnerState":
    case "getProjectLearnerState":
    case "getKnowledgeBase":
    case "getRecallHistory":
    case "getConstructInteractHistory":
      return { title: failed ? "Could not check learner history" : done ? "Checked learner history" : "Checking learner history" };
    case "getStepFiles":
    case "readWorkspaceFile":
      return { title: failed ? "Could not read project context" : done ? "Read project context" : "Reading project context" };
    case "writeWorkspaceFile":
    case "appendWorkspaceFile":
    case "createWorkspaceFolder":
      return { title: failed ? "Could not edit workspace" : done ? "Edited workspace" : "Editing workspace" };
    case "getLatestTerminalOutput":
      return { title: failed ? "Could not check terminal output" : done ? "Checked terminal output" : "Checking terminal output" };
    default:
      return { title: `${title} ${name}` };
  }
}

function mergeSessions(
  sessions: ConstructInteractSessionRecord[],
  liveSession?: ConstructInteractSessionRecord
): ConstructInteractSessionRecord[] {
  if (!liveSession) {
    return sessions;
  }
  const index = sessions.findIndex((session) => session.id === liveSession.id);
  if (index >= 0) {
    return sessions.map((session, sessionIndex) => sessionIndex === index ? liveSession : session);
  }
  return [...sessions, liveSession];
}

function sessionToResultPartsSource(
  session: ConstructInteractSessionRecord
): Pick<ConstructInteractClientResult, "actions" | "dynamicSteps" | "dynamicStepValidation" | "generatedLiveSteps" | "liveStepValidation"> {
  return {
    actions: session.actions,
    dynamicSteps: session.dynamicSteps,
    dynamicStepValidation: session.dynamicStepValidation,
    generatedLiveSteps: session.generatedLiveSteps,
    liveStepValidation: session.liveStepValidation
  };
}

function interactStatusLabel(status: ConstructInteractClientResult["status"]): string {
  switch (status) {
    case "pass":
      return "Ready to continue";
    case "almost":
      return "Almost there";
    case "skip":
      return "Continuing with support";
    default:
      return "Follow-up";
  }
}
