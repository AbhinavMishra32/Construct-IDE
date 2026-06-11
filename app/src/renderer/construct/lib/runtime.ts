import type { BlockAssistance, ConstructBlock, ConstructProgram, ProjectRecord } from "../types";

export function currentBlock(project: ProjectRecord): ConstructBlock | null {
  return (
    project.program.steps[project.currentStepIndex]?.blocks[project.currentBlockIndex] ??
    null
  );
}

export function currentBlockNumber(project: ProjectRecord): number {
  let count = 0;

  for (let index = 0; index < project.program.steps.length; index += 1) {
    if (index < project.currentStepIndex) {
      count += project.program.steps[index].blocks.length;
      continue;
    }

    if (index === project.currentStepIndex) {
      return count + project.currentBlockIndex + 1;
    }
  }

  return count;
}

export function totalBlocks(program: ConstructProgram): number {
  return program.steps.reduce((total, step) => total + step.blocks.length, 0);
}

export function nextPosition(project: ProjectRecord): {
  currentStepIndex: number;
  currentBlockIndex: number;
  completedAt: string | null;
} {
  const currentStep = project.program.steps[project.currentStepIndex];
  const hasNextBlock = currentStep && project.currentBlockIndex < currentStep.blocks.length - 1;

  if (hasNextBlock) {
    return {
      currentStepIndex: project.currentStepIndex,
      currentBlockIndex: project.currentBlockIndex + 1,
      completedAt: null
    };
  }

  if (project.currentStepIndex < project.program.steps.length - 1) {
    return {
      currentStepIndex: project.currentStepIndex + 1,
      currentBlockIndex: 0,
      completedAt: null
    };
  }

  return {
    currentStepIndex: project.currentStepIndex,
    currentBlockIndex: project.currentBlockIndex,
    completedAt: new Date().toISOString()
  };
}

export function blockLabel(block: ConstructBlock): string {
  switch (block.kind) {
    case "explain":
      return "Explain";
    case "edit":
    return "Code Step";
    case "recall":
      return "Recall Check";
    case "run":
      return "Run";
    case "expect":
      return "Expect";
    case "checkpoint":
      return "Checkpoint";
  }
}

export function emptyBlockAssistance(): BlockAssistance {
  return {
    revealLineCount: 0,
    revealBlockCount: 0,
    referenceCardsOpened: [],
    referenceCardsPinned: [],
    extraExplanationCount: 0,
    recallAttemptCount: 0,
    verificationFailureCount: 0
  };
}

export function assistanceLabel(assistance: BlockAssistance | undefined): string {
  if (!assistance) {
    return "unaided so far";
  }

  const parts: string[] = [];

  if (assistance.referenceCardsOpened.length > 0) {
    parts.push("with reference");
  }

  if (assistance.revealLineCount > 0) {
    parts.push(`${assistance.revealLineCount} line reveal${assistance.revealLineCount === 1 ? "" : "s"}`);
  }

  if (assistance.verificationFailureCount > 0) {
    parts.push(
      assistance.verificationFailureCount === 1
        ? "1 retry"
        : `${assistance.verificationFailureCount} retries`
    );
  }

  if (parts.length === 0) {
    return "unaided so far";
  }

  return parts.join(" · ");
}
