import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  PlayIcon,
  TerminalIcon,
  WandSparklesIcon,
  XCircleIcon
} from "lucide-react";

import { Button } from "@/components/open-shell";

import { MarkdownBlock } from "./MarkdownBlock";
import { assistanceLabel, blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type { ConstructBlock, ProjectRecord, ReferenceCard, VerificationResult } from "../types";

export function GuidePanel({
  project,
  block,
  theme,
  editComplete,
  onNext,
  onRunCommand,
  onOpenReference,
  onVerifyRecall,
  verifyingId
}: {
  project: ProjectRecord;
  block: ConstructBlock | null;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  onNext: () => void;
  onRunCommand: (command: string, cwd: string) => void;
  onOpenReference: (referenceId: string) => void;
  onVerifyRecall: () => void;
  verifyingId: string | null;
}) {
  if (!block) {
    return (
      <aside className="guide-panel">
        <p className="eyebrow">Complete</p>
        <h2>Project finished</h2>
      </aside>
    );
  }

  const verification = block.kind === "recall" && block.verify
    ? project.verificationResults[block.verify.id]
    : undefined;
  const canContinue =
    (block.kind !== "edit" || editComplete) &&
    (block.kind !== "recall" || !block.verify || verification?.passed === true);
  const assistance = project.assistance[block.id];

  return (
    <aside className="guide-panel">
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
        references={project.program.references}
        verification={verification}
        verifyingId={verifyingId}
        onOpenReference={onOpenReference}
        onRunCommand={onRunCommand}
        onVerifyRecall={onVerifyRecall}
      />
      <p className="guide-panel__assist">{assistanceLabel(assistance)}</p>
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
        <Button onClick={onNext} disabled={!canContinue}>
          {block.kind === "checkpoint" ? (
            <CheckCircle2Icon size={15} />
          ) : (
            <ChevronRightIcon size={15} />
          )}
          Continue
        </Button>
      </div>
    </aside>
  );
}

function GuideBlock({
  block,
  theme,
  editComplete,
  references,
  verification,
  verifyingId,
  onOpenReference,
  onRunCommand,
  onVerifyRecall
}: {
  block: ConstructBlock;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  references: ReferenceCard[];
  verification?: VerificationResult;
  verifyingId: string | null;
  onOpenReference: (referenceId: string) => void;
  onRunCommand: (command: string, cwd: string) => void;
  onVerifyRecall: () => void;
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
        {note ? (
          <div className="guide-panel__note">
            <MarkdownBlock content={note.content} theme={theme} />
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
        <div className="recall-task__section">
          <p className="guide-panel__label">Task</p>
          <MarkdownBlock content={block.task} theme={theme} />
        </div>
        {block.support ? (
          <div className="recall-task__section recall-task__support">
            <p className="guide-panel__label">Support</p>
            <MarkdownBlock content={block.support} theme={theme} />
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
            verifying={verifyingId === block.verify.id}
            successMessage={block.verify.messages.success}
            failureMessage={block.verify.messages.failure}
            onVerify={onVerifyRecall}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="guide-block">
      <MarkdownBlock content={block.content} theme={theme} />
    </div>
  );
}

function VerificationPanel({
  result,
  verifying,
  successMessage,
  failureMessage,
  onVerify
}: {
  result?: VerificationResult;
  verifying: boolean;
  successMessage: string;
  failureMessage: string;
  onVerify: () => void;
}) {
  if (verifying) {
    return (
      <div className="verification-panel is-running">
        <WandSparklesIcon size={15} />
        <span>Construct verifier is reading the code, terminal evidence, and rubric.</span>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="verification-panel">
        <div>
          <p className="guide-panel__label">Verification</p>
          <p>Run the verifier when the engineering outcome is ready.</p>
        </div>
        <Button variant="secondary" onClick={onVerify}>
          <WandSparklesIcon size={15} />
          Verify
        </Button>
      </div>
    );
  }

  return (
    <div className={`verification-panel ${result.passed ? "is-passed" : "is-failed"}`}>
      <div className="verification-panel__status">
        {result.passed ? <CheckCircle2Icon size={16} /> : <XCircleIcon size={16} />}
        <span>{result.passed ? successMessage : failureMessage}</span>
      </div>
      <p>{result.reason}</p>
      <small>Confidence: {result.confidence}</small>
      {result.suggestion ? <p className="verification-panel__suggestion">{result.suggestion}</p> : null}
    </div>
  );
}
