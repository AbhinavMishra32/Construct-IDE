import { BookOpenIcon, FileCodeIcon, PathIcon, SparkleIcon } from "@phosphor-icons/react";
import { useRef, type ReactNode } from "react";

import {
  AgentRunTrace,
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
    const events = (isLiveSession ? (session.agentEvents ?? []) : completedEvents)
      .filter((event) => event.type !== "message" && event.type !== "iteration");
    const toolCalls = isLiveSession ? (session.toolCalls ?? []) : completedToolCalls;
    const traceEntries = buildAgentRunTraceEntries(events, toolCalls, isLiveSession);
    const assistantParts: AgentSessionMessagePart[] = [];
    const tracePart: AgentSessionMessagePart | null = traceEntries.length > 0 || isLiveSession
      ? {
          type: "text",
          id: `${session.id}:agent-trace`,
          content: (
            <AgentRunTrace
              state={isLiveSession ? "thinking" : "thought"}
              entries={traceEntries}
              durationMs={isLatestResult ? (result?.durationMs ?? session.durationMs) : session.durationMs}
              defaultOpen={isLiveSession}
            />
          )
        }
      : null;

    if (tracePart) {
      assistantParts.push(tracePart);
    }

    if (session.reply.trim()) {
      assistantParts.push({
        type: "text",
        id: `${session.id}:reply`,
        content: (
          <div className={isLiveSession ? "construct-interact-streaming-reply" : undefined} data-streaming={isLiveSession || undefined}>
            <MarkdownBlock
              className="space-y-2 text-[13px] leading-[1.65] [&_p]:leading-[1.65]"
              content={session.reply}
              theme={theme}
              onOpenConcept={onOpenConcept}
              onOpenFile={onOpenFile}
            />
          </div>
        ),
        meta: !isLiveSession && session.assessment
          ? `${interactStatusLabel(session.assessment.status)} · ${session.assessment.confidence} confidence · ${session.assessment.assistanceLevel}`
          : undefined
      });
    }

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
          type: "text",
          id: `${blockId}:agent-trace`,
          content: (
            <AgentRunTrace
              state="thinking"
              entries={[]}
              defaultOpen
            />
          )
        }]
      }
    );
  }

  return messages;
}

function buildAgentRunTraceEntries(
  events: ConstructAgentRunEvent[],
  toolCalls: ConstructInteractToolCallRecord[],
  active = false
): AgentRunTraceEntry[] {
  const entries = events.filter((event) => event.type !== "iteration").map(runEventToTraceEntry);
  const recordedToolCounts = new Map<string, number>();
  for (const event of events) {
    if (event.type === "tool") {
      const name = event.toolName ?? event.title;
      recordedToolCounts.set(name, (recordedToolCounts.get(name) ?? 0) + 1);
    }
  }

  for (const toolCall of toolCalls) {
    const recordedCount = recordedToolCounts.get(toolCall.name) ?? 0;
    if (recordedCount > 0) {
      recordedToolCounts.set(toolCall.name, recordedCount - 1);
      continue;
    }
    entries.push(toolCallToTraceEntry(toolCall));
  }

  if (active && !entries.some((entry) => entry.status === "running" || entry.status === "pending")) {
    entries.push({
      id: "construct-interact-live-tail",
      kind: "thought",
      title: "Continuing",
      status: "running"
    });
  }

  return entries;
}

function runEventToTraceEntry(event: ConstructAgentRunEvent): AgentRunTraceEntry {
  if (event.type === "iteration" || event.type === "reasoning") {
    return {
      id: event.id,
      kind: "thought",
      title: event.type === "reasoning" ? "Analyzing request" : event.title,
      subtitle: event.type === "reasoning" && event.status === "completed" ? undefined : event.detail,
      status: traceStatus(event.status),
      input: event.type === "iteration" ? stringifyTraceValue(event.input) : undefined,
      output: event.type === "iteration" ? sanitizeIterationOutput(event.outputPreview) : undefined
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
