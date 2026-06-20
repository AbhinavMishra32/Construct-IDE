import {
  AlertCircleIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FilePlusIcon,
  LightbulbIcon,
  PlayIcon,
  RotateCcwIcon,
  TerminalIcon,
  XCircleIcon
} from "lucide-react";
import { BookOpenIcon as PhosphorBookOpenIcon } from "@phosphor-icons/react";
import { useState, useMemo, type ReactNode } from "react";

import { Button, Timeline } from "@opaline/ui";

import { ConstructInteractSession } from "./guide/ConstructInteractSession";
import { MarkdownBlock } from "./MarkdownBlock";
import { assistanceLabel, blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type { InlineFileRef } from "../lib/inlineRefs";
import type {
  ConstructBlock,
  ConstructInteractClientResult,
  ConceptCard,
  EditBlock,
  ProjectRecord,
  ReferenceCard,
  VerificationLogEntry,
  VerificationResult
} from "../types";
import type { ConstructInteractSession as ConstructInteractSessionRecord, ProjectLearningState } from "../../../shared/constructLearning";

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
  liveInteractSession,
  interactSessions,
  interactToolbar,
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
  liveInteractSession?: ConstructInteractSessionRecord;
  interactSessions?: ProjectLearningState["constructInteractSessions"];
  interactToolbar?: ReactNode;
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
    <aside className={`flex h-full min-h-0 flex-col bg-background p-3 text-foreground ${block?.kind === "interact" ? "overflow-hidden" : "overflow-y-auto"}`} data-construct-explainable="guide" data-construct-explainable-label="Guide">
      {!block ? (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <p className="text-xs font-medium text-muted-foreground">Complete</p>
          <h2 className="mt-1 text-base font-semibold">Project finished</h2>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{blockLabel(block)}</span>
            <span>
              {currentBlockNumber(project)} / {totalBlocks(project.program)}
            </span>
          </div>
          <h2 className="mb-4 text-base font-semibold tracking-tight">{project.program.steps[project.currentStepIndex]?.title}</h2>
          <GuideBlock
            block={block}
            theme={theme}
            editComplete={editComplete}
            codeProgress={codeProgress}
            references={project.program.references ?? []}
            concepts={project.program.concepts}
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
            liveInteractSession={liveInteractSession}
            interactSessions={interactSessions}
            interactToolbar={interactToolbar}
            onSubmitInteract={onSubmitInteract}
            onInteractAction={onInteractAction}
            interactingId={interactingId}
            projectLearningState={projectLearningState}
          />
          {block.kind !== "interact" ? <p className="mt-4 text-xs text-muted-foreground">{assistanceLabel(assistance)}</p> : null}
          {block.kind === "run" || (block.kind === "recall" && block.verify) || canContinue ? (
            <div className={block.kind === "interact" ? "mt-2 flex flex-wrap justify-end gap-2" : "mt-4 flex flex-wrap justify-end gap-2 border-t pt-3"}>
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
                  <CheckCircle2Icon size={15} />
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
  concepts,
  verification,
  verificationLogs,
  recallMissingFiles,
  verifyingId,
  recallAnswer,
  onRecallAnswerChange,
  interactAnswer,
  onInteractAnswerChange,
  interactResult,
  liveInteractSession,
  interactSessions,
  interactToolbar,
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
  concepts: ConceptCard[];
  verification?: VerificationResult;
  verificationLogs: VerificationLogEntry[];
  recallMissingFiles: string[];
  verifyingId: string | null;
  recallAnswer: string;
  onRecallAnswerChange: (answer: string) => void;
  interactAnswer: string;
  onInteractAnswerChange: (answer: string) => void;
  interactResult?: ConstructInteractClientResult;
  liveInteractSession?: ConstructInteractSessionRecord;
  interactSessions?: ProjectLearningState["constructInteractSessions"];
  interactToolbar?: ReactNode;
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
        <div className="flex items-center gap-2 rounded-[8px] border bg-muted/30 px-3 py-2 font-mono text-xs shadow-sm">
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
            <p className="mb-2 text-xs font-medium text-muted-foreground">{supportSectionLabel(section.kind.replace(/^guide\./, ""))}</p>
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
            concepts={concepts}
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
            liveInteractSession={liveInteractSession}
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
          <div className="rounded-[8px] border bg-muted/25 p-3">
            <MarkdownBlock content={note.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </div>
        ) : null}
      </div>
    );
  }

  if (block.kind === "interact") {
    const sessions = interactSessions
      ?? (projectLearningState?.constructInteractSessions ?? []).filter((session) => session.blockId === block.id);
    return (
      <ConstructInteractSession
        blockId={block.id}
        prompt={block.prompt}
        theme={theme}
        sessions={sessions}
        result={interactResult}
        liveSession={liveInteractSession}
        toolbar={interactToolbar}
        answer={interactAnswer}
        onAnswerChange={onInteractAnswerChange}
        onSubmit={onSubmitInteract}
        onAction={onInteractAction}
        isPending={interactingId === block.id}
        onOpenConcept={onOpenConcept}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (block.kind === "explain") {
    const linkedConcepts = block.concepts
      .map((conceptId) => concepts.find((concept) => concept.id === conceptId))
      .filter((concept): concept is ConceptCard => Boolean(concept));

    return (
      <div className="flex flex-col gap-4">
        <MarkdownBlock content={block.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        {linkedConcepts.length > 0 ? (
          <section className="flex flex-col gap-2 border-t pt-3" aria-label="Concepts introduced in this explanation">
            <p className="text-xs font-medium text-muted-foreground">Concepts introduced here</p>
            <div className="flex flex-wrap gap-2">
              {linkedConcepts.map((concept) => (
                <Button key={concept.id} size="small" variant="secondary" onClick={() => onOpenConcept(concept.id)}>
                  <PhosphorBookOpenIcon data-icon="inline-start" />
                  {concept.title}
                </Button>
              ))}
            </div>
          </section>
        ) : null}
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
          <p className="mb-2 text-xs font-medium text-muted-foreground">Task</p>
          <MarkdownBlock content={block.task} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </div>
        {block.mode === "reply" ? (
          <div className="border-t pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Your answer</p>
            <textarea
              className="min-h-28 w-full resize-y rounded-[8px] border bg-background/70 p-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
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
          <div className="rounded-[8px] border bg-muted/25 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
              <LightbulbIcon size={13} />
              <p className="text-xs font-medium">Support</p>
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
                className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

function CodeProgressMeter({ progress }: { progress: GhostProgress }) {
  return (
    <div className="space-y-2 rounded-[8px] border bg-muted/25 p-3" aria-label="Code step progress">
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
    <div className="rounded-[8px] border border-dashed p-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Workspace action</p>
        <p className="text-sm">The verifier needs these files as evidence.</p>
      </div>
      <div className="mt-3 space-y-1">
        {files.map((path) => (
          <button
            key={path}
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            onClick={() => void createFile(path)}
            disabled={creatingPath === path}
          >
            <FilePlusIcon size={14} />
            <span>{creatingPath === path ? "Creating" : "Create"}</span>
            <code className="min-w-0 truncate font-mono text-[11px] text-foreground">{path}</code>
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
    <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
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
      <div className="space-y-3 rounded-[8px] border bg-muted/25 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <RotateCcwIcon size={15} className="animate-spin" />
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
    <div className={`space-y-3 rounded-[8px] border p-3 ${panelState}`}>
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
            <LightbulbIcon size={13} />
            <p className="text-xs font-medium">Next</p>
          </div>
          <p className="mt-1 text-sm">{result.suggestion}</p>
        </div>
      ) : null}
      {visibleLogs.length > 0 ? (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Agent activity</p>
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
