import { CheckCircle, Circle, DotOutline } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

import { blockLabel } from "../lib/runtime";
import type { ProjectRecord } from "../types";

export function StepList({
  project,
  onSelectStep,
  furthestUnlockedStepIndex
}: {
  project: ProjectRecord;
  onSelectStep?: (stepIndex: number) => void;
  furthestUnlockedStepIndex: number;
}) {
  const completedBlocks = project.completedBlocks ?? {};

  return (
    <div className="step-timeline">
      {project.program.steps.map((step, stepIndex) => {
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
