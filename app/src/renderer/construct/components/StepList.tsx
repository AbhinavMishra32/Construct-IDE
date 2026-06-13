import { CheckCircle, Circle, DotOutline, Lightning } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

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

  return (
    <div className="step-timeline">
      {timeline.map((item) => {
        if (item.kind === "live") {
          const liveStep = item.step;
          const isActive = liveStep.id === activeLiveStepId;
          const isCompleted = liveStep.status === "completed";
          const isDismissed = liveStep.status === "dismissed";
          if (isDismissed) {
            return null;
          }

          return (
            <section
              key={liveStep.id}
              className={cn("step-timeline__step step-timeline__step--live", {
                "is-active": isActive,
                "is-complete": isCompleted,
                "is-clickable": !!onSelectLiveStep
              })}
              onClick={() => onSelectLiveStep?.(liveStep.id)}
            >
              <div className="step-timeline__rail" aria-hidden="true">
                {isCompleted ? <CheckCircle size={16} weight="fill" /> : <Lightning size={16} weight="duotone" />}
              </div>
              <div className="step-timeline__content">
                <div className="step-timeline__title-row">
                  <span>{liveStep.title}</span>
                  <small>Live</small>
                </div>
                <p className="step-timeline__live-reason">{liveStep.reason}</p>
                <div className="step-timeline__blocks">
                  <span className="step-timeline__block step-timeline__block--live">Generated Live</span>
                  {liveStep.blocks.map((block) => (
                    <span key={block.id} className="step-timeline__block">
                      {liveBlockLabel(block.kind)}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          );
        }

        const { step, stepIndex } = item;
        const isActiveStep = stepIndex === project.currentStepIndex;
        const completed = step.blocks.every((block) => completedBlocks[block.id]);
        const activeBlock = isActiveStep ? step.blocks[project.currentBlockIndex] : null;
        const isClickable = !!onSelectStep && stepIndex <= furthestUnlockedStepIndex;

        return (
          <section
            key={step.id}
            className={cn("step-timeline__step", {
              "is-active": isActiveStep,
              "is-complete": completed,
              "is-clickable": isClickable
            })}
            onClick={() => isClickable && onSelectStep?.(stepIndex)}
          >
            <div className="step-timeline__rail" aria-hidden="true">
              {completed ? (
                <CheckCircle size={16} weight="fill" />
              ) : isActiveStep ? (
                <DotOutline size={18} weight="fill" />
              ) : (
                <Circle size={14} weight="regular" />
              )}
            </div>
            <div className="step-timeline__content">
              <div className="step-timeline__title-row">
                <span>{step.title}</span>
                <small>{stepIndex + 1}</small>
              </div>
              <div className="step-timeline__blocks">
                {step.blocks.map((block) => (
                  <span
                    key={block.id}
                    className={cn("step-timeline__block", {
                      "is-active": activeBlock?.id === block.id,
                      "is-complete": completedBlocks[block.id]
                    })}
                  >
                    {blockLabel(block)}
                  </span>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
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
