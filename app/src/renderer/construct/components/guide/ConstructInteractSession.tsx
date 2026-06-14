import { BookOpenIcon, FileCodeIcon, PathIcon, SparkleIcon } from "@phosphor-icons/react";
import { useRef } from "react";

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
  ConstructInteractToolCallRecord,
  ProjectLearningState
} from "../../../../shared/constructLearning";
import type { InlineFileRef } from "../../lib/inlineRefs";
import type { LogEntry } from "../../lib/logStore";
import type { ConstructInteractClientResult } from "../../types";
import { MarkdownBlock } from "../MarkdownBlock";

type ConstructInteractAction = NonNullable<ConstructInteractClientResult["actions"]>[number];

export function ConstructInteractSession({
  blockId,
  prompt,
  theme,
  sessions,
  result,
  progressLogs,
  answer,
  onAnswerChange,
  onSubmit,
  onAction,
  isPending,
  onOpenConcept,
  onOpenFile
}: {
  blockId: string;
  prompt: string;
  theme: "light" | "dark" | "system";
  sessions: ProjectLearningState["constructInteractSessions"];
  result?: ConstructInteractClientResult;
  progressLogs: LogEntry[];
  answer: string;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  onAction?: (action: ConstructInteractAction) => void;
  isPending: boolean;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const submittedAnswerRef = useRef("");
  if (!isPending && answer.trim()) {
    submittedAnswerRef.current = answer;
  }
  const pendingAnswer = isPending ? submittedAnswerRef.current : answer;
  const messages = buildInteractMessages({
    blockId,
    sessions,
    result,
    progressLogs,
    answerDraft: pendingAnswer,
    isPending,
    theme,
    onInteractAction: onAction,
    onOpenConcept,
    onOpenFile
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AgentSessionSurface
        eyebrow="Question"
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
        scrollKey={`${sessions.length}:${progressLogs.length}:${isPending}:${result?.status ?? "idle"}`}
        composer={
          <AgentSessionComposer
            value={answer}
            onValueChange={onAnswerChange}
            onSubmit={onSubmit}
            pending={isPending}
            submitLabel="Send answer"
            placeholder="Answer in your own words..."
          />
        }
      />
    </div>
  );
}

function buildInteractMessages({
  blockId,
  sessions,
  result,
  progressLogs,
  answerDraft,
  isPending,
  theme,
  onInteractAction,
  onOpenConcept,
  onOpenFile
}: {
  blockId: string;
  sessions: ProjectLearningState["constructInteractSessions"];
  result?: ConstructInteractClientResult;
  progressLogs: LogEntry[];
  answerDraft: string;
  isPending: boolean;
  theme: "light" | "dark" | "system";
  onInteractAction?: (action: ConstructInteractAction) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}): AgentSessionMessage[] {
  const recentSessions = sessions;
  const latestSessionId = recentSessions.at(-1)?.id;
  const messages = recentSessions.flatMap((session): AgentSessionMessage[] => {
    const isLatestResult = Boolean(result && session.id === latestSessionId);
    const events = isLatestResult ? (result?.agentEvents ?? session.agentEvents ?? []) : (session.agentEvents ?? []);
    const toolCalls = isLatestResult ? (result?.toolCalls ?? session.toolCalls ?? []) : (session.toolCalls ?? []);
    const traceEntries = buildAgentRunTraceEntries(events, toolCalls);
    const assistantParts: AgentSessionMessagePart[] = [];

    if (traceEntries.length > 0) {
      assistantParts.push({
        type: "text",
        id: `${session.id}:agent-trace`,
        content: (
          <AgentRunTrace
            state="thought"
            entries={traceEntries}
            durationMs={isLatestResult ? (result?.durationMs ?? session.durationMs) : session.durationMs}
          />
        )
      });
    }

    assistantParts.push({
      type: "text",
      id: `${session.id}:reply`,
      content: (
        <MarkdownBlock
          className="space-y-2 text-[13px] leading-[1.65] [&_p]:leading-[1.65]"
          content={session.reply}
          theme={theme}
          onOpenConcept={onOpenConcept}
          onOpenFile={onOpenFile}
        />
      ),
      meta: `${interactStatusLabel(session.status)} · ${session.confidence} confidence · ${session.assistanceLevel}`
    });

    if (isLatestResult && result) {
      assistantParts.push(...buildInteractResultParts(result, {
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

  if (isPending && answerDraft.trim()) {
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
              entries={buildPendingAgentRunTraceEntries(progressLogs)}
              defaultOpen
            />
          )
        }]
      }
    );
  }

  return messages;
}

function buildPendingAgentRunTraceEntries(logs: LogEntry[]): AgentRunTraceEntry[] {
  const entries: AgentRunTraceEntry[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    const payload = log.structured?.kind === "structured" ? log.structured.payload : undefined;
    const event = extractRunEvent(payload);
    if (event && !seen.has(event.id)) {
      seen.add(event.id);
      entries.push(runEventToTraceEntry(event));
      continue;
    }

    const legacyToolName = parseLegacyToolCallName(log.message);
    if (!legacyToolName) continue;
    const legacyId = `${log.timestamp}:${legacyToolName}`;
    if (seen.has(legacyId)) continue;
    seen.add(legacyId);
    entries.push({
      id: legacyId,
      kind: "tool",
      title: classifyInteractTool(legacyToolName),
      subtitle: log.message.split("\n").slice(1).find((line) => line.trim())?.trim(),
      status: log.level === "error" ? "error" : "completed",
      icon: classifyToolTraceIcon(legacyToolName)
    });
  }

  return entries.slice(-16);
}

function buildAgentRunTraceEntries(
  events: ConstructAgentRunEvent[],
  toolCalls: ConstructInteractToolCallRecord[]
): AgentRunTraceEntry[] {
  const entries = events.map(runEventToTraceEntry);
  const recordedToolIds = new Set(events.filter((event) => event.type === "tool").map((event) => event.id));

  for (const toolCall of toolCalls) {
    if (!recordedToolIds.has(toolCall.id)) {
      entries.push(toolCallToTraceEntry(toolCall));
    }
  }

  return entries;
}

function runEventToTraceEntry(event: ConstructAgentRunEvent): AgentRunTraceEntry {
  if (event.type === "iteration") {
    return {
      id: event.id,
      kind: "thought",
      title: event.title,
      subtitle: event.detail,
      status: traceStatus(event.status)
    };
  }

  return {
    id: event.id,
    kind: "tool",
    title: classifyInteractTool(event.toolName ?? event.title),
    subtitle: event.detail,
    status: traceStatus(event.status),
    icon: classifyToolTraceIcon(event.toolName ?? event.title),
    input: stringifyTraceValue(event.input),
    output: event.outputPreview
  };
}

function toolCallToTraceEntry(toolCall: ConstructInteractToolCallRecord): AgentRunTraceEntry {
  return {
    id: toolCall.id,
    kind: "tool",
    title: classifyInteractTool(toolCall.name),
    subtitle: toolCall.reason,
    status: "completed",
    icon: classifyToolTraceIcon(toolCall.name),
    input: stringifyTraceValue(toolCall.input),
    output: toolCall.outputPreview
  };
}

function extractRunEvent(payload: unknown): ConstructAgentRunEvent | null {
  if (isRunEvent(payload)) return payload;
  if (isRecord(payload) && isRunEvent(payload.event)) return payload.event;
  return null;
}

function isRunEvent(value: unknown): value is ConstructAgentRunEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && (value.type === "iteration" || value.type === "tool")
    && (value.status === "running" || value.status === "completed" || value.status === "error")
    && typeof value.title === "string"
    && typeof value.createdAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseLegacyToolCallName(message: string): string | null {
  return message.match(/^Tool call:\s*([^\n]+)/)?.[1]?.trim() ?? null;
}

function classifyToolTraceIcon(name: string): AgentRunTraceEntry["icon"] {
  switch (name) {
    case "searchTape":
      return "search";
    case "getStepFiles":
    case "readWorkspaceFile":
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
  result: ConstructInteractClientResult,
  {
    sessionId,
    onInteractAction
  }: {
    sessionId: string;
    onInteractAction?: (action: ConstructInteractAction) => void;
  }
): AgentSessionMessagePart[] {
  const parts: AgentSessionMessagePart[] = [];

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

  if (result.generatedLiveSteps?.length) {
    parts.push({
      type: "tool",
      id: `${sessionId}:live-steps`,
      tool: {
        id: `${sessionId}:live-steps-tool`,
        title: "Generated live steps",
        subtitle: `${result.generatedLiveSteps.length} step${result.generatedLiveSteps.length === 1 ? "" : "s"}`,
        status: "completed",
        content: (
          <div className="flex flex-col gap-2">
            {result.generatedLiveSteps.map((step) => (
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

  if (result.liveStepValidation?.length) {
    parts.push({
      type: "tool",
      id: `${sessionId}:validation`,
      tool: {
        id: `${sessionId}:validation-tool`,
        title: "Live step validation",
        subtitle: `${result.liveStepValidation.length} check${result.liveStepValidation.length === 1 ? "" : "s"}`,
        status: result.liveStepValidation.some((entry) => entry.status === "rejected") ? "error" : "completed",
        content: (
          <div className="flex flex-col gap-2">
            {result.liveStepValidation.map((entry, index) => (
              <div key={`${entry.stepId ?? entry.draftTitle ?? index}`} className="rounded-md border bg-muted/30 p-3 text-xs">
                <strong className="font-medium">{entry.stepId ?? entry.draftTitle ?? "Generated step"}</strong>
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
      return <FileCodeIcon data-icon="inline-start" />;
    case "go-to-step":
      return <PathIcon data-icon="inline-start" />;
    default:
      return <SparkleIcon data-icon="inline-start" />;
  }
}

function classifyInteractTool(name: string): string {
  switch (name) {
    case "getCurrentStep":
    case "getStepById":
    case "getPreviousSteps":
    case "getNextSteps":
      return "Read lesson step";
    case "getCurrentBlock":
      return "Checked current question";
    case "getAuthoredResources":
      return "Checked lesson resources";
    case "getConceptCard":
      return "Checked concept card";
    case "getReferenceCard":
      return "Checked reference card";
    case "findWhereConceptWasIntroduced":
      return "Found concept introduction";
    case "searchTape":
      return "Searched the tape";
    case "getLearnerState":
    case "getProjectLearnerState":
    case "getKnowledgeBase":
    case "getRecallHistory":
    case "getConstructInteractHistory":
      return "Checked learner history";
    case "getStepFiles":
    case "readWorkspaceFile":
      return "Read project context";
    case "getLatestTerminalOutput":
      return "Checked terminal output";
    default:
      return name;
  }
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
