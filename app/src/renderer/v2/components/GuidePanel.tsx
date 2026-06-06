import {
  CheckCircle2Icon,
  ChevronRightIcon,
  PlayIcon,
  TerminalIcon
} from "lucide-react";

import { Button } from "@/components/open-shell";

import { blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type { ConstructBlock, ProjectRecord } from "../types";

export function GuidePanel({
  project,
  block,
  editComplete,
  onNext,
  onRunCommand
}: {
  project: ProjectRecord;
  block: ConstructBlock | null;
  editComplete: boolean;
  onNext: () => void;
  onRunCommand: (command: string, cwd: string) => void;
}) {
  if (!block) {
    return (
      <aside className="guide-panel">
        <p className="eyebrow">Complete</p>
        <h2>Project finished</h2>
      </aside>
    );
  }

  const canContinue = block.kind !== "edit" || editComplete;

  return (
    <aside className="guide-panel">
      <div className="guide-panel__meta">
        <span>{blockLabel(block)}</span>
        <span>
          {currentBlockNumber(project)} / {totalBlocks(project.program)}
        </span>
      </div>
      <h2>{project.program.steps[project.currentStepIndex]?.title}</h2>
      <GuideBlock block={block} onRunCommand={onRunCommand} />
      <div className="guide-panel__actions">
        {block.kind === "run" ? (
          <Button variant="secondary" onClick={() => onRunCommand(block.command, block.cwd)}>
            <PlayIcon size={15} />
            Run
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
  onRunCommand
}: {
  block: ConstructBlock;
  onRunCommand: (command: string, cwd: string) => void;
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
    return (
      <div className="guide-block">
        <p className="guide-panel__copy">
          Type the ghost text in <code>{block.path}</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="guide-block">
      <pre>{block.content}</pre>
    </div>
  );
}
