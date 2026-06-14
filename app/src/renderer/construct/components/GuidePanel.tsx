import {
  AlertCircleIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FilePlusIcon,
  LightbulbIcon,
  PlayIcon,
  SparklesIcon,
  TerminalIcon,
  WandSparklesIcon,
  XCircleIcon
} from "lucide-react";
import { useState, useMemo } from "react";

import type { ReactNode } from "react";
import {
  AgentSessionComposer,
  AgentSessionSurface,
  Button,
  Timeline,
  type AgentSessionMessage,
  type AgentSessionMessagePart,
  type AgentSessionToolEntry
} from "@opaline/ui";

import { MarkdownBlock } from "./MarkdownBlock";
import { assistanceLabel, blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type { InlineFileRef } from "../lib/inlineRefs";
import type {
  ConstructBlock,
  ConstructInteractClientResult,
  EditBlock,
  ProjectRecord,
  ReferenceCard,
  VerificationLogEntry,
  VerificationResult
} from "../types";
import type { ProjectLearningState } from "../../../shared/constructLearning";

type GhostProgress = {
  typedChars: number;
  totalChars: number;
  typedLines: number;
  totalLines: number;
  percent: number;
};

export function GuidePanel({
  project,
  block,
  theme,
  editComplete,
  onNext,
  onRunCommand,
  onOpenReference,
  onOpenConcept,
  onOpenFile,
  onCreateFile,
  onVerifyRecall,
  recallAnswer,
  onRecallAnswerChange,
  interactAnswer,
  onInteractAnswerChange,
  interactResult,
  onSubmitInteract,
  onInteractAction,
  interactingId,
  projectLearningState,
  verifyingId,
  verificationLogs,
  recallMissingFiles
}: {
  project: ProjectRecord;
  block: ConstructBlock | null;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  onNext: () => void;
  onRunCommand: (command: string, cwd: string) => void;
  onOpenReference: (referenceId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onCreateFile: (path: string) => Promise<void> | void;
  onVerifyRecall: () => void;
  recallAnswer: string;
  onRecallAnswerChange: (answer: string) => void;
  interactAnswer: string;
  onInteractAnswerChange: (answer: string) => void;
  interactResult?: ConstructInteractClientResult;
  onSubmitInteract: () => void;
  onInteractAction?: (action: NonNullable<ConstructInteractClientResult["actions"]>[number]) => void;
  interactingId: string | null;
  projectLearningState: ProjectLearningState | null;
  verifyingId: string | null;
  verificationLogs: VerificationLogEntry[];
  recallMissingFiles: string[];
}) {
  const { furthestUnlockedStepIndex, furthestUnlockedBlockIndex } = useMemo(() => {
    const completedBlocks = project.completedBlocks ?? {};
    const steps = project.program.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      for (let j = 0; j < step.blocks.length; j++) {
        if (!completedBlocks[step.blocks[j].id]) {
          return { furthestUnlockedStepIndex: i, furthestUnlockedBlockIndex: j };
        }
      }
    }
    const lastStepIdx = steps.length - 1;
    const lastBlockIdx = Math.max(0, (steps[lastStepIdx]?.blocks.length ?? 1) - 1);
    return { furthestUnlockedStepIndex: lastStepIdx, furthestUnlockedBlockIndex: lastBlockIdx };
  }, [project.completedBlocks, project.program.steps]);

  const isAtFrontier =
    project.currentStepIndex === furthestUnlockedStepIndex &&
    project.currentBlockIndex === furthestUnlockedBlockIndex;

  const verification = block && block.kind === "recall" && block.verify
    ? (project.verificationResults ?? {})[block.verify.id]
    : undefined;
  const canContinue =
    block &&
    (block.kind !== "edit" || editComplete) &&
    (block.kind !== "recall" || !block.verify || verification?.passed === true) &&
    (block.kind !== "interact" || interactResult?.shouldAdvance === true);
  const assistance = block ? (project.assistance ?? {})[block.id] : undefined;
  const codeProgress =
    block && block.kind === "edit" ? codeProgressForBlock(block, (project.typingProgress ?? {})[block.id] ?? 0) : null;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 text-foreground" data-construct-explainable="guide" data-construct-explainable-label="Guide">
      {!block ? (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Complete</p>
          <h2 className="mt-1 text-lg font-semibold">Project finished</h2>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{blockLabel(block)}</span>
            <span>
              {currentBlockNumber(project)} / {totalBlocks(project.program)}
            </span>
          </div>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">{project.program.steps[project.currentStepIndex]?.title}</h2>
          <GuideBlock
            block={block}
            theme={theme}
            editComplete={editComplete}
            codeProgress={codeProgress}
            references={project.program.references ?? []}
            verification={verification}
            verificationLogs={verification?.logs ?? verificationLogs}
            recallMissingFiles={recallMissingFiles}
            verifyingId={verifyingId}
            onOpenReference={onOpenReference}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
            recallAnswer={recallAnswer}
            onRecallAnswerChange={onRecallAnswerChange}
            interactAnswer={interactAnswer}
            onInteractAnswerChange={onInteractAnswerChange}
            interactResult={interactResult}
            onSubmitInteract={onSubmitInteract}
            onInteractAction={onInteractAction}
            interactingId={interactingId}
            projectLearningState={projectLearningState}
          />
          <p className="mt-4 text-xs text-muted-foreground">{assistanceLabel(assistance)}</p>
          {block.kind === "run" || (block.kind === "recall" && block.verify) || canContinue ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
              {block.kind === "run" ? (
                <Button variant="secondary" onClick={() => onRunCommand(block.command, block.cwd)}>
                  <PlayIcon size={15} />
                  Run
                </Button>
              ) : null}
              {block.kind === "recall" && block.verify ? (
                <Button
                  variant="secondary"
                  onClick={onVerifyRecall}
                  disabled={verifyingId === block.verify.id || (block.mode === "reply" && !recallAnswer.trim())}
                >
                  <WandSparklesIcon size={15} />
                  {verifyingId === block.verify.id ? "Checking" : "Verify"}
                </Button>
              ) : null}
              {canContinue ? (
                <Button onClick={onNext}>
                  {block.kind === "checkpoint" ? (
                    <CheckCircle2Icon size={15} />
                  ) : (
                    <ChevronRightIcon size={15} />
                  )}
                  Continue
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

function GuideBlock({
  block,
  theme,
  editComplete,
  codeProgress,
  references,
  verification,
  verificationLogs,
  recallMissingFiles,
  verifyingId,
  recallAnswer,
  onRecallAnswerChange,
  interactAnswer,
  onInteractAnswerChange,
  interactResult,
  onSubmitInteract,
  onInteractAction,
  interactingId,
  projectLearningState,
  onOpenReference,
  onOpenConcept,
  onOpenFile,
  onCreateFile
}: {
  block: ConstructBlock;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  codeProgress: GhostProgress | null;
  references: ReferenceCard[];
  verification?: VerificationResult;
  verificationLogs: VerificationLogEntry[];
  recallMissingFiles: string[];
  verifyingId: string | null;
  recallAnswer: string;
  onRecallAnswerChange: (answer: string) => void;
  interactAnswer: string;
  onInteractAnswerChange: (answer: string) => void;
  interactResult?: ConstructInteractClientResult;
  onSubmitInteract: () => void;
  onInteractAction?: (action: NonNullable<ConstructInteractClientResult["actions"]>[number]) => void;
  interactingId: string | null;
  projectLearningState: ProjectLearningState | null;
  onOpenReference: (referenceId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onCreateFile: (path: string) => Promise<void> | void;
}) {
  if (block.kind === "run") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
          <TerminalIcon size={15} />
          <code>{block.command}</code>
        </div>
        <p className="text-xs text-muted-foreground">cwd: {block.cwd}</p>
      </div>
    );
  }

  if (block.kind === "guide") {
    return (
      <div className="space-y-4" data-guide-kind={block.guideKind}>
        {block.title ? <h3 className="text-sm font-semibold">{block.title}</h3> : null}
        {block.content ? <MarkdownBlock content={block.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
        {block.sections.map((section) => (
          <section key={section.kind} className="border-t pt-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{supportSectionLabel(section.kind.replace(/^guide\./, ""))}</p>
            <MarkdownBlock content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </section>
        ))}
      </div>
    );
  }

  if (block.kind === "edit") {
    const note = block.notes.find((candidate) => candidate.when === (editComplete ? "done" : "start"));

    return (
      <div className="space-y-4">
        {block.guides.map((guide) => (
          <GuideBlock
            key={guide.id}
            block={guide}
            theme={theme}
            editComplete={editComplete}
            codeProgress={null}
            references={references}
            verification={verification}
            verificationLogs={verificationLogs}
            recallMissingFiles={recallMissingFiles}
            verifyingId={verifyingId}
            onOpenReference={onOpenReference}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
            recallAnswer={recallAnswer}
            onRecallAnswerChange={onRecallAnswerChange}
            interactAnswer={interactAnswer}
            onInteractAnswerChange={onInteractAnswerChange}
            interactResult={interactResult}
            onSubmitInteract={onSubmitInteract}
            onInteractAction={onInteractAction}
            interactingId={interactingId}
            projectLearningState={projectLearningState}
          />
        ))}
        <p className="text-sm text-muted-foreground">
          Complete the highlighted implementation in <code>{block.path}</code>.
        </p>
        {codeProgress ? <CodeProgressMeter progress={codeProgress} /> : null}
        {note ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <MarkdownBlock content={note.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </div>
        ) : null}
      </div>
    );
  }

  if (block.kind === "interact") {
    const sessions = (projectLearningState?.constructInteractSessions ?? []).filter((session) => session.blockId === block.id);
    const messages = buildInteractMessages({
      blockId: block.id,
      sessions,
      result: interactResult,
      answerDraft: interactAnswer,
      isPending: interactingId === block.id,
      theme,
      onInteractAction,
      onOpenConcept,
      onOpenFile
    });

    return (
      <div className="min-h-0 overflow-hidden rounded-lg border">
        <AgentSessionSurface
          eyebrow="Construct Interact"
          lead={
            <MarkdownBlock
              content={block.prompt}
              theme={theme}
              onOpenConcept={onOpenConcept}
              onOpenFile={onOpenFile}
            />
          }
          messages={messages}
          emptyState="Answer in your own words and Construct Interact will respond here."
          composer={
            <AgentSessionComposer
              value={interactAnswer}
              onValueChange={onInteractAnswerChange}
              onSubmit={onSubmitInteract}
              pending={interactingId === block.id}
              submitLabel="Send answer"
              placeholder="Answer in your own words..."
            />
          }
        />
      </div>
    );
  }

  if (block.kind === "recall") {
    const linkedReferences = block.references
      .map((referenceId) => references.find((reference) => reference.id === referenceId))
      .filter((reference): reference is ReferenceCard => Boolean(reference));

    return (
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Task</p>
          <MarkdownBlock content={block.task} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </div>
        {block.mode === "reply" ? (
          <div className="border-t pt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Your answer</p>
            <textarea
              className="min-h-28 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              value={recallAnswer}
              onChange={(event) => onRecallAnswerChange(event.target.value)}
              placeholder="Explain it in your own words..."
              spellCheck
            />
          </div>
        ) : null}
        {recallMissingFiles.length > 0 ? (
          <MissingFilesPanel files={recallMissingFiles} onCreateFile={onCreateFile} />
        ) : null}
        {block.support || block.supportSections.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
              <LightbulbIcon size={13} />
              <p className="text-[10px] font-medium uppercase tracking-wide">Support</p>
            </div>
            {block.support ? <MarkdownBlock content={block.support} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
            {block.supportSections.length > 0 ? (
              <div className="mt-3 space-y-3">
                {block.supportSections.map((section) => (
                  <section key={section.kind} className="border-t pt-3">
                    <p className="mb-1 text-xs font-medium">{supportSectionLabel(section.kind)}</p>
                    <MarkdownBlock content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {linkedReferences.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {linkedReferences.map((reference) => (
              <button
                key={reference.id}
                className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
                type="button"
                onClick={() => onOpenReference(reference.id)}
              >
                <BookOpenIcon size={14} />
                <span>{reference.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {block.verify ? (
          <VerificationPanel
            result={verification}
            logs={verificationLogs}
            verifying={verifyingId === block.verify.id}
            successMessage={block.verify.messages?.success ?? "Construct verified this recall."}
            failureMessage={block.verify.messages?.failure ?? "Construct needs a stronger answer before continuing."}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MarkdownBlock content={block.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
    </div>
  );
}

function supportSectionLabel(kind: string): string {
  switch (kind) {
    case "intent":
      return "Intent";
    case "concepts":
      return "Concepts";
    case "api":
      return "API shape";
    case "mental-model":
      return "Mental model";
    case "common-mistake":
      return "Common mistake";
    default:
      return kind.replace(/-/g, " ");
  }
}

function buildInteractMessages({
  blockId,
  sessions,
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
  result?: ConstructInteractClientResult;
  answerDraft: string;
  isPending: boolean;
  theme: "light" | "dark" | "system";
  onInteractAction?: (action: NonNullable<ConstructInteractClientResult["actions"]>[number]) => void;
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
            content: "Reviewing your explanation and deciding whether you can continue or need a targeted follow-up."
          }
        ]
      }
    );
  }

  return messages;
}

function buildInteractResultParts(
  result: ConstructInteractClientResult,
  {
    sessionId,
    onInteractAction
  }: {
    sessionId: string;
    onInteractAction?: (action: NonNullable<ConstructInteractClientResult["actions"]>[number]) => void;
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

function CodeProgressMeter({ progress }: { progress: GhostProgress }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3" aria-label="Code step progress">
      <div className="flex items-center justify-between text-xs">
        <span>Code step progress</span>
        <strong>
          {progress.typedLines} / {progress.totalLines} lines · {progress.percent}%
        </strong>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}

function MissingFilesPanel({
  files,
  onCreateFile
}: {
  files: string[];
  onCreateFile: (path: string) => Promise<void> | void;
}) {
  const [creatingPath, setCreatingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createFile(path: string) {
    setCreatingPath(path);
    setError(null);
    try {
      await onCreateFile(path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreatingPath(null);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-3">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Workspace action</p>
        <p>The verifier needs these files as evidence.</p>
      </div>
      <div className="mt-3 space-y-1">
        {files.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => void createFile(path)}
            disabled={creatingPath === path}
          >
            <FilePlusIcon size={14} />
            <span>{creatingPath === path ? "Creating" : "Create"}</span>
            <code>{path}</code>
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: string }) {
  const normLevel = level ? level.toLowerCase() : "";
  let statusColor = "bg-emerald-500";
  if (normLevel === "medium") statusColor = "bg-amber-500";
  else if (normLevel === "low") statusColor = "bg-destructive";

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] text-muted-foreground">
      <span className={`size-1.5 rounded-full ${statusColor}`} aria-hidden="true" />
      <span>Confidence: {level}</span>
    </div>
  );
}

function VerificationPanel({
  result,
  logs,
  verifying,
  successMessage,
  failureMessage
}: {
  result?: VerificationResult;
  logs: VerificationLogEntry[];
  verifying: boolean;
  successMessage: string;
  failureMessage: string;
}) {
  const visibleLogs = result?.logs ?? logs;

  if (verifying) {
    return (
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WandSparklesIcon size={15} className="animate-spin" />
          <span>Verifier run</span>
        </div>
        <VerificationLogList logs={visibleLogs} />
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const isAlmost = result.status === "almost";
  const panelState = result.passed ? "border-emerald-500/30 bg-emerald-500/5" : isAlmost ? "border-amber-500/30 bg-amber-500/5" : "border-destructive/30 bg-destructive/5";
  const statusText = result.passed ? successMessage : isAlmost ? "Close. One piece is still missing." : failureMessage;

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${panelState}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {result.passed ? <CheckCircle2Icon size={16} /> : isAlmost ? <AlertCircleIcon size={16} /> : <XCircleIcon size={16} />}
        <span>{statusText}</span>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{result.reason}</p>
        <ConfidenceBadge level={result.confidence} />
      </div>
      {result.suggestion ? (
        <div className="border-t pt-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <SparklesIcon size={13} />
            <p className="text-[10px] font-medium uppercase tracking-wide">Next</p>
          </div>
          <p className="mt-1 text-sm">{result.suggestion}</p>
        </div>
      ) : null}
      {visibleLogs.length > 0 ? (
        <div className="border-t pt-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Agent activity</p>
          <VerificationLogList logs={visibleLogs} />
        </div>
      ) : null}
    </div>
  );
}

function VerificationLogList({ logs }: { logs: VerificationLogEntry[] }) {
  if (logs.length === 0) {
    return null;
  }

  function renderDetail(detail: string) {
    const fileRegex = /^[a-zA-Z0-9_\-\/.]+\.[a-zA-Z0-9]+$/;
    const items = detail.split(",").map(i => i.trim());
    const isFilesList = items.length > 0 && items.every(item => {
      return fileRegex.test(item) || item.includes("/") || item.includes(".");
    });

    if (isFilesList) {
      return (
        <div className="flex flex-wrap gap-1">
          {items.map((file, idx) => (
            <code key={idx} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{file}</code>
          ))}
        </div>
      );
    }

    return <small>{detail}</small>;
  }

  return <Timeline
    aria-label="Verification activity"
    density="compact"
    items={logs.map((log, index) => ({
      id: `${log.at}:${index}`,
      title: log.message,
      status: log.status === "failed" ? "error" : log.status === "warning" ? "warning" : log.status === "running" ? "active" : "completed",
      content: log.detail ? renderDetail(log.detail) : undefined
    }))}
  />;
}

function codeProgressForBlock(block: EditBlock, progress: number): GhostProgress {
  const totalChars = block.content.length;
  const typedChars = clampNumber(progress, 0, totalChars);
  const totalLines = countGhostLines(block.content);
  const typedLines = typedChars <= 0
    ? 0
    : Math.min(totalLines, countGhostLines(block.content.slice(0, typedChars)));
  const percent = totalChars === 0 ? 100 : Math.round((typedChars / totalChars) * 100);

  return {
    typedChars,
    totalChars,
    typedLines,
    totalLines,
    percent
  };
}

function countGhostLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split("\n").length;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
