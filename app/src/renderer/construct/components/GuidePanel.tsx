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

import { Button, Timeline } from "@opaline/ui";

import { MarkdownBlock } from "./MarkdownBlock";
import { assistanceLabel, blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type {
  ConstructBlock,
  EditBlock,
  ProjectRecord,
  ReferenceCard,
  VerificationLogEntry,
  VerificationResult
} from "../types";

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
  onCreateFile,
  onVerifyRecall,
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
  onCreateFile: (path: string) => Promise<void> | void;
  onVerifyRecall: () => void;
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
    (block.kind !== "recall" || !block.verify || verification?.passed === true);
  const assistance = block ? (project.assistance ?? {})[block.id] : undefined;
  const ghostProgress =
    block && block.kind === "edit" ? ghostProgressForBlock(block, (project.typingProgress ?? {})[block.id] ?? 0) : null;

  return (
    <aside className="guide-panel" data-construct-explainable="guide" data-construct-explainable-label="Guide">
      {!block ? (
        <div className="guide-panel__completed-state">
          <p className="eyebrow">Complete</p>
          <h2>Project finished</h2>
        </div>
      ) : (
        <>
          <div className="guide-panel__meta">
            <span>{blockLabel(block)}</span>
            <span>
              {currentBlockNumber(project)} / {totalBlocks(project.program)}
            </span>
          </div>
          <h2>{project.program.steps[project.currentStepIndex]?.title}</h2>
          <GuideBlock
            block={block}
            theme={theme}
            editComplete={editComplete}
            ghostProgress={ghostProgress}
            references={project.program.references ?? []}
            verification={verification}
            verificationLogs={verification?.logs ?? verificationLogs}
            recallMissingFiles={recallMissingFiles}
            verifyingId={verifyingId}
            onOpenReference={onOpenReference}
            onOpenConcept={onOpenConcept}
            onCreateFile={onCreateFile}
          />
          <p className="guide-panel__assist">{assistanceLabel(assistance)}</p>
          {block.kind === "run" || (block.kind === "recall" && block.verify) || canContinue ? (
            <div className="guide-panel__actions">
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
                  disabled={verifyingId === block.verify.id}
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
  ghostProgress,
  references,
  verification,
  verificationLogs,
  recallMissingFiles,
  verifyingId,
  onOpenReference,
  onOpenConcept,
  onCreateFile
}: {
  block: ConstructBlock;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  ghostProgress: GhostProgress | null;
  references: ReferenceCard[];
  verification?: VerificationResult;
  verificationLogs: VerificationLogEntry[];
  recallMissingFiles: string[];
  verifyingId: string | null;
  onOpenReference: (referenceId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onCreateFile: (path: string) => Promise<void> | void;
}) {
  if (block.kind === "run") {
    return (
      <div className="guide-block">
        <div className="run-command">
          <TerminalIcon size={15} />
          <code>{block.command}</code>
        </div>
        <p className="guide-panel__copy">cwd: {block.cwd}</p>
      </div>
    );
  }

  if (block.kind === "edit") {
    const note = block.notes.find((candidate) => candidate.when === (editComplete ? "done" : "start"));

    return (
      <div className="guide-block">
        <p className="guide-panel__copy">
          Type the ghost text in <code>{block.path}</code>.
        </p>
        {ghostProgress ? <GhostProgressMeter progress={ghostProgress} /> : null}
        {note ? (
          <div className="guide-panel__note">
            <MarkdownBlock content={note.content} theme={theme} onOpenConcept={onOpenConcept} />
          </div>
        ) : null}
      </div>
    );
  }

  if (block.kind === "recall") {
    const linkedReferences = block.references
      .map((referenceId) => references.find((reference) => reference.id === referenceId))
      .filter((reference): reference is ReferenceCard => Boolean(reference));

    return (
      <div className="guide-block recall-task">
        <div className="recall-task__section recall-task__task">
          <p className="guide-panel__label">Task</p>
          <MarkdownBlock content={block.task} theme={theme} onOpenConcept={onOpenConcept} />
        </div>
        {recallMissingFiles.length > 0 ? (
          <MissingFilesPanel files={recallMissingFiles} onCreateFile={onCreateFile} />
        ) : null}
        {block.support || block.supportSections.length > 0 ? (
          <div className="recall-task__section recall-task__support">
            <div className="recall-task__support-header">
              <LightbulbIcon size={13} className="support-icon" />
              <p className="guide-panel__label">Support</p>
            </div>
            {block.support ? <MarkdownBlock content={block.support} theme={theme} onOpenConcept={onOpenConcept} /> : null}
            {block.supportSections.length > 0 ? (
              <div className="recall-task__support-sections">
                {block.supportSections.map((section) => (
                  <section key={section.kind} className="recall-task__support-subsection">
                    <p>{supportSectionLabel(section.kind)}</p>
                    <MarkdownBlock content={section.content} theme={theme} onOpenConcept={onOpenConcept} />
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {linkedReferences.length > 0 ? (
          <div className="recall-task__references">
            {linkedReferences.map((reference) => (
              <button
                key={reference.id}
                className="recall-task__reference-button"
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
            successMessage={block.verify.messages.success}
            failureMessage={block.verify.messages.failure}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="guide-block">
      <MarkdownBlock content={block.content} theme={theme} onOpenConcept={onOpenConcept} />
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

function GhostProgressMeter({ progress }: { progress: GhostProgress }) {
  return (
    <div className="ghost-progress" aria-label="Guided write progress">
      <div className="ghost-progress__row">
        <span>Guided write progress</span>
        <strong>
          {progress.typedLines} / {progress.totalLines} lines · {progress.percent}%
        </strong>
      </div>
      <div className="ghost-progress__track">
        <span style={{ width: `${progress.percent}%` }} />
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
    <div className="recall-missing-files">
      <div>
        <p className="guide-panel__label">Workspace action</p>
        <p>The verifier needs these files as evidence.</p>
      </div>
      <div className="recall-missing-files__list">
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
      {error ? <p className="recall-missing-files__error">{error}</p> : null}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: string }) {
  const normLevel = level ? level.toLowerCase() : "";
  let statusColor = "is-high";
  if (normLevel === "medium") statusColor = "is-medium";
  else if (normLevel === "low") statusColor = "is-low";

  return (
    <div className={`confidence-badge ${statusColor}`}>
      <span className="confidence-badge__dot" aria-hidden="true" />
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
      <div className="verification-panel is-running">
        <div className="verification-panel__status">
          <WandSparklesIcon size={15} className="spinner-sparkles" />
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
  const panelState = result.passed ? "is-passed" : isAlmost ? "is-almost" : "is-failed";
  const statusText = result.passed ? successMessage : isAlmost ? "Close. One piece is still missing." : failureMessage;

  return (
    <div className={`verification-panel ${panelState}`}>
      <div className="verification-panel__status">
        {result.passed ? <CheckCircle2Icon size={16} /> : isAlmost ? <AlertCircleIcon size={16} /> : <XCircleIcon size={16} />}
        <span>{statusText}</span>
      </div>
      <div className="verification-panel__body">
        <p className="verification-panel__reason">{result.reason}</p>
        <ConfidenceBadge level={result.confidence} />
      </div>
      {result.suggestion ? (
        <div className="verification-panel__suggestion">
          <div className="verification-panel__suggestion-header">
            <SparklesIcon size={13} className="suggestion-icon" />
            <p className="guide-panel__label">Next</p>
          </div>
          <p className="verification-panel__suggestion-text">{result.suggestion}</p>
        </div>
      ) : null}
      {visibleLogs.length > 0 ? (
        <div className="verification-panel__activity">
          <p className="guide-panel__label">Agent activity</p>
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
        <div className="verification-log-detail-files">
          {items.map((file, idx) => (
            <code key={idx} className="verification-log-file-badge">{file}</code>
          ))}
        </div>
      );
    }

    return <small>{detail}</small>;
  }

  return <Timeline
    aria-label="Verification activity"
    className="verification-log-list"
    density="compact"
    items={logs.map((log, index) => ({
      id: `${log.at}:${index}`,
      title: log.message,
      status: log.status === "failed" ? "error" : log.status === "warning" ? "warning" : log.status === "running" ? "active" : "completed",
      content: log.detail ? renderDetail(log.detail) : undefined
    }))}
  />;
}

function ghostProgressForBlock(block: EditBlock, progress: number): GhostProgress {
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
