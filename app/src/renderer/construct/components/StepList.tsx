import { CheckCircle, Circle, DotOutline, Lightning } from "@phosphor-icons/react";
import { Badge, Button, Timeline, type TimelineItem } from "@opaline/ui/v2";

import { blockLabel } from "../lib/runtime";
import type { ProjectRecord } from "../types";
import type { GeneratedLiveStep } from "../../../shared/constructLearning";

export function StepList({
  project,
  onSelectStep,
  generatedLiveSteps = [],
  activeLiveStepId = null,
  onSelectLiveStep,
  furthestUnlockedStepIndex
}: {
  project: ProjectRecord;
  onSelectStep?: (stepIndex: number) => void;
  generatedLiveSteps?: GeneratedLiveStep[];
  activeLiveStepId?: string | null;
  onSelectLiveStep?: (stepId: string) => void;
  furthestUnlockedStepIndex: number;
}) {
  const completedBlocks = project.completedBlocks ?? {};
  const timeline = mergeStaticAndLiveSteps(project, generatedLiveSteps);
  const items = timeline.flatMap<TimelineItem>((item) => {
    if (item.kind === "live") {
      const liveStep = item.step;
      if (liveStep.status === "dismissed") {
        return [];
      }

      const isActive = liveStep.id === activeLiveStepId;
      const isCompleted = liveStep.status === "completed";
      return [{
        id: liveStep.id,
        title: (
          <Button
            variant="ghost"
            size="small"
            disabled={!onSelectLiveStep}
            onClick={() => onSelectLiveStep?.(liveStep.id)}
          >
            {liveStep.title}
          </Button>
        ),
        meta: <Badge variant="secondary">Generated Live</Badge>,
        description: liveStep.reason,
        status: isCompleted ? "completed" : isActive ? "active" : "warning",
        icon: isCompleted ? <CheckCircle weight="fill" /> : <Lightning weight="duotone" />,
        content: (
          <div className="flex flex-wrap gap-1">
            {liveStep.blocks.map((block) => (
              <Badge key={block.id} variant="outline">{liveBlockLabel(block.kind)}</Badge>
            ))}
          </div>
        )
      }];
    }

    const { step, stepIndex } = item;
    const isActiveStep = stepIndex === project.currentStepIndex;
    const completed = step.blocks.every((block) => completedBlocks[block.id]);
    const activeBlock = isActiveStep ? step.blocks[project.currentBlockIndex] : null;
    const isClickable = Boolean(onSelectStep) && stepIndex <= furthestUnlockedStepIndex;

    return [{
      id: step.id,
      title: (
        <Button
          variant="ghost"
          size="small"
          disabled={!isClickable}
          onClick={() => onSelectStep?.(stepIndex)}
        >
          {step.title}
        </Button>
      ),
      meta: <Badge variant="outline">{stepIndex + 1}</Badge>,
      status: completed ? "completed" : isActiveStep ? "active" : "pending",
      icon: completed ? <CheckCircle weight="fill" /> : isActiveStep ? <DotOutline weight="fill" /> : <Circle />,
      content: (
        <div className="flex flex-wrap gap-1">
          {step.blocks.map((block) => (
            <Badge
              key={block.id}
              variant={activeBlock?.id === block.id ? "default" : completedBlocks[block.id] ? "secondary" : "outline"}
            >
              {blockLabel(block)}
            </Badge>
          ))}
        </div>
      )
    }];
  });

  return <Timeline className="h-full overflow-y-auto" density="compact" items={items} />;
}

function mergeStaticAndLiveSteps(project: ProjectRecord, generatedLiveSteps: GeneratedLiveStep[]) {
  const items: Array<
    | { kind: "static"; step: ProjectRecord["program"]["steps"][number]; stepIndex: number }
    | { kind: "live"; step: GeneratedLiveStep }
  > = [];
  const liveByAfter = new Map<string, GeneratedLiveStep[]>();
  const liveByBefore = new Map<string, GeneratedLiveStep[]>();

  for (const liveStep of generatedLiveSteps) {
    if (liveStep.status === "dismissed") continue;
    if (liveStep.insertBeforeStepId) {
      liveByBefore.set(liveStep.insertBeforeStepId, [...(liveByBefore.get(liveStep.insertBeforeStepId) ?? []), liveStep]);
    } else if (liveStep.insertAfterStepId) {
      liveByAfter.set(liveStep.insertAfterStepId, [...(liveByAfter.get(liveStep.insertAfterStepId) ?? []), liveStep]);
    } else {
      const currentStepId = project.program.steps[project.currentStepIndex]?.id;
      liveByAfter.set(currentStepId ?? "__end__", [...(liveByAfter.get(currentStepId ?? "__end__") ?? []), liveStep]);
    }
  }

  project.program.steps.forEach((step, stepIndex) => {
    const stepId = step.id;
    items.push(...(liveByBefore.get(stepId) ?? []).map((liveStep) => ({ kind: "live" as const, step: liveStep })));
    items.push({ kind: "static", step, stepIndex });
    items.push(...(liveByAfter.get(stepId) ?? []).map((liveStep) => ({ kind: "live" as const, step: liveStep })));
  });

  const knownStepIds = new Set(project.program.steps.map((step) => step.id));
  for (const liveStep of generatedLiveSteps) {
    if (
      liveStep.status !== "dismissed" &&
      !knownStepIds.has(liveStep.insertAfterStepId ?? "") &&
      !knownStepIds.has(liveStep.insertBeforeStepId ?? "")
    ) {
      items.push({ kind: "live", step: liveStep });
    }
  }

  return items;
}

function liveBlockLabel(kind: GeneratedLiveStep["blocks"][number]["kind"]): string {
  switch (kind) {
    case "explain":
      return "Explain";
    case "interact":
      return "Construct Interact";
    case "recall":
      return "Reply Recall";
  }
}
