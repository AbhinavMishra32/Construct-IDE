import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  AgentSessionComposer,
  AgentSessionSurface,
  type AgentSessionMessage,
  type AgentSessionMessagePart,
  type AgentSessionToolEntry
} from "@opaline/ui";

import { MarkdownBlock } from "../MarkdownBlock";
import type { InlineFileRef } from "../../lib/inlineRefs";
import type { LogEntry } from "../../lib/logStore";
import type { ConstructInteractClientResult } from "../../types";
import type { ProjectLearningState } from "../../../../shared/constructLearning";

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
  const messages = buildInteractMessages({
    blockId,
    sessions,
    result,
    progressLogs,
    answerDraft: answer,
    isPending,
    theme,
    onInteractAction: onAction,
    onOpenConcept,
    onOpenFile
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <AgentSessionSurface
        eyebrow="Construct Interact"
        lead={
          <MarkdownBlock
            content={prompt}
            theme={theme}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        }
        messages={messages}
        emptyState="Answer in your own words and Construct Interact will respond here."
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
  const recentSessions = sessions.slice(-6);
  const latestSessionId = recentSessions.at(-1)?.id;
  const messages = recentSessions.flatMap((session): AgentSessionMessage[] => {
    const assistantParts: AgentSessionMessagePart[] = [
      {
        type: "text",
        id: `${session.id}:reply`,
        content: <MarkdownBlock content={session.reply} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />,
        meta: `${interactStatusLabel(session.status)} · ${session.confidence} confidence · ${session.assistanceLevel}`
      }
    ];

    if (result && session.id === latestSessionId) {
      const enrichedParts = buildInteractResultParts(result, {
        sessionId: session.id,
        onInteractAction
      });
      assistantParts.unshift(...enrichedParts.prelude);
      assistantParts.push(...enrichedParts.trailing);
    }

    return [
      {
        id: `${session.id}:user`,
        role: "user",
        content: session.answer,
        meta: "Your answer"
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
        content: answerDraft,
        meta: "Your answer"
      },
      {
        id: `${blockId}:pending-assistant`,
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            id: `${blockId}:thinking`,
            label: "Construct Interact is thinking",
            active: true,
            defaultOpen: true,
            content: latestInteractProgress(progressLogs)
          }
        ]
      }
    );

    const progressEntries = buildPendingInteractToolEntries(progressLogs);
    if (progressEntries.length > 0) {
      messages[messages.length - 1].parts?.push({
        type: "context",
        id: `${blockId}:pending-progress`,
        active: true,
        activeLabel: "Steps taken",
        summary: summarizePendingProgress(progressEntries),
        entries: progressEntries,
        defaultOpen: true
      });
    }
  }

  return messages;
}

function latestInteractProgress(logs: LogEntry[]): string {
  const latest = logs.filter((entry) => pendingInteractProgressEntry(entry) != null).at(-1);
  if (!latest) {
    return "Reviewing your explanation and deciding whether you can continue or need a targeted follow-up.";
  }

  const label = pendingInteractProgressEntry(latest)?.title ?? describeInteractLog(latest);
  if (latest.level === "warn" || latest.level === "error") {
    return `${label}. Recovering so this interaction does not stay stuck.`;
  }
  return label;
}

function buildPendingInteractToolEntries(logs: LogEntry[]): AgentSessionToolEntry[] {
  const entries: AgentSessionToolEntry[] = [];
  const seen = new Set<string>();

  for (const entry of logs) {
    const progress = pendingInteractProgressEntry(entry);
    if (!progress || seen.has(progress.title)) {
      continue;
    }
    seen.add(progress.title);

    entries.push({
      id: `${entry.timestamp}-${entries.length}`,
      title: progress.title,
      subtitle: progress.subtitle,
      status: entry.level === "error" ? "error" : entry.level === "warn" ? "running" : "completed"
    });
  }

  return entries.slice(-6);
}

function summarizePendingProgress(entries: AgentSessionToolEntry[]): string {
  const running = entries.some((entry) => entry.status === "running");
  const failed = entries.some((entry) => entry.status === "error");
  if (failed) return `${entries.length} step${entries.length === 1 ? "" : "s"}; recovering`;
  if (running) return `${entries.length} step${entries.length === 1 ? "" : "s"}; still working`;
  return `${entries.length} step${entries.length === 1 ? "" : "s"}`;
}

function describeInteractLog(entry: LogEntry): string {
  if (entry.structured?.kind === "structured") {
    return entry.structured.title;
  }
  return firstLogLine(entry.message);
}

function pendingInteractProgressEntry(entry: LogEntry): { title: string; subtitle?: string } | null {
  const structuredTitle = entry.structured?.kind === "structured" ? entry.structured.title : undefined;
  const firstLine = firstLogLine(entry.message);
  const toolName = parseToolCallName(entry.message);

  if (firstLine.startsWith("Queued answer")) {
    return { title: "Queued answer", subtitle: "Saving your response and starting the check." };
  }

  if (firstLine.startsWith("Evaluating interaction")) {
    return { title: "Reading your answer", subtitle: "Comparing it with the current Construct Interact prompt." };
  }

  if (firstLine.startsWith("Waiting for model response")) {
    return { title: "Waiting for model", subtitle: "The app will recover automatically if the provider hangs or returns bad JSON." };
  }

  if (toolName) {
    switch (toolName) {
      case "getCurrentStep":
        return { title: "Reading current step", subtitle: "Anchoring the answer to the authored lesson." };
      case "getCurrentBlock":
        return { title: "Checking current question", subtitle: "Using the block rubric instead of a generic answer." };
      case "getConceptCard":
        return { title: "Checking concept cards", subtitle: "Looking up the concepts this question depends on." };
      case "findWhereConceptWasIntroduced":
        return { title: "Finding prior explanation", subtitle: "Looking for the authored place where this concept was introduced." };
      case "getProjectLearnerState":
        return { title: "Checking learner state", subtitle: "Looking at recent recall, assistance, and weak concepts." };
      case "getLatestTerminalOutput":
        return { title: "Checking terminal context", subtitle: "Only used if the answer mentions commands or errors." };
      default:
        return { title: "Gathering context", subtitle: parseToolCallReason(entry.message) };
    }
  }

  if (structuredTitle === "Interaction request") {
    return { title: "Preparing evaluation", subtitle: "Bundling the prompt, answer, rubric, and scoped context." };
  }

  if (structuredTitle === "Agent request") {
    return { title: "Starting evaluator", subtitle: "Calling the selected model for a structured response." };
  }

  if (structuredTitle === "Raw structured output" || structuredTitle === "Validated structured result") {
    return { title: "Reading evaluator result", subtitle: "Validating the response before updating the lesson state." };
  }

  if (structuredTitle === "Interaction recovery fallback") {
    return { title: "Recovering from provider failure", subtitle: "Returning a guided follow-up instead of leaving the UI stuck." };
  }

  if (structuredTitle === "Interaction result payload" || firstLine.startsWith("Interaction result:")) {
    return { title: "Finished check", subtitle: "Updating the conversation and learner state." };
  }

  return null;
}

function firstLogLine(message: string): string {
  return message.split("\n").find((line) => line.trim())?.trim() || "Working";
}

function parseToolCallName(message: string): string | null {
  const match = message.match(/^Tool call:\s*([^\n]+)/);
  return match?.[1]?.trim() ?? null;
}

function parseToolCallReason(message: string): string | undefined {
  return message.split("\n").slice(1).find((line) => line.trim())?.trim();
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
): {
  prelude: AgentSessionMessagePart[];
  trailing: AgentSessionMessagePart[];
} {
  const prelude: AgentSessionMessagePart[] = [];
  const trailing: AgentSessionMessagePart[] = [];
  const toolEntries = buildInteractToolEntries(result.toolCalls ?? []);

  if (toolEntries.length > 0) {
    prelude.push({
      type: "context",
      id: `${sessionId}:context`,
      doneLabel: "Gathered context",
      summary: summarizeContextEntries(toolEntries),
      entries: toolEntries,
      defaultOpen: false
    });
  }

  if (result.actions?.length) {
    trailing.push({
      type: "actions",
      id: `${sessionId}:actions`,
      content: (
        <div className="flex flex-wrap gap-2">
          {result.actions.map((action, index) => (
            <button key={`${action.type}-${index}`} type="button" onClick={() => onInteractAction?.(action)}>
              <SparklesIcon size={13} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )
    });
  }

  if (result.generatedLiveSteps?.length) {
    trailing.push({
      type: "tool",
      id: `${sessionId}:live-steps`,
      tool: {
        id: `${sessionId}:live-steps-tool`,
        title: "Generated live steps",
        subtitle: `${result.generatedLiveSteps.length} step${result.generatedLiveSteps.length === 1 ? "" : "s"}`,
        status: "completed",
        content: (
          <div className="space-y-2">
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
    trailing.push({
      type: "tool",
      id: `${sessionId}:validation`,
      tool: {
        id: `${sessionId}:validation-tool`,
        title: "Live step validation",
        subtitle: `${result.liveStepValidation.length} check${result.liveStepValidation.length === 1 ? "" : "s"}`,
        status: result.liveStepValidation.some((entry) => entry.status === "rejected") ? "error" : "completed",
        content: (
          <div className="space-y-2">
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

  return { prelude, trailing };
}

function buildInteractToolEntries(toolCalls: NonNullable<ConstructInteractClientResult["toolCalls"]>): AgentSessionToolEntry[] {
  return toolCalls.map((toolCall, index) => {
    const classification = classifyInteractTool(toolCall.name);
    return {
      id: toolCall.id ?? `${toolCall.name}-${index}`,
      title: classification.title,
      subtitle: toolCall.reason,
      args: classification.args,
      status: "completed",
      content: toolCall.outputPreview ? <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{toolCall.outputPreview}</pre> : undefined
    };
  });
}

function classifyInteractTool(name: string): { title: string; args?: ReactNode[] } {
  const normalized = name.toLowerCase();
  if (normalized.includes("read")) return { title: "Read" };
  if (normalized.includes("list")) return { title: "List" };
  if (normalized.includes("glob")) return { title: "Glob" };
  if (normalized.includes("grep") || normalized.includes("search")) return { title: "Search" };
  if (normalized.includes("web")) return { title: "Web" };
  if (normalized.includes("shell") || normalized.includes("bash")) return { title: "Shell" };
  return { title: name };
}

function summarizeContextEntries(entries: AgentSessionToolEntry[]) {
  const counts = {
    read: 0,
    search: 0,
    list: 0,
    other: 0
  };

  for (const entry of entries) {
    const title = typeof entry.title === "string" ? entry.title.toLowerCase() : "";
    if (title === "read") counts.read += 1;
    else if (title === "search" || title === "glob") counts.search += 1;
    else if (title === "list") counts.list += 1;
    else counts.other += 1;
  }

  return [
    counts.read ? `${counts.read} read${counts.read === 1 ? "" : "s"}` : null,
    counts.search ? `${counts.search} search${counts.search === 1 ? "" : "es"}` : null,
    counts.list ? `${counts.list} list${counts.list === 1 ? "" : "s"}` : null,
    counts.other ? `${counts.other} tool${counts.other === 1 ? "" : "s"}` : null
  ].filter(Boolean).join(", ");
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
