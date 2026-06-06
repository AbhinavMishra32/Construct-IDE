import { CheckCircle, Circle, DotOutline } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

import { blockLabel } from "../lib/runtime";
import type { ProjectRecord } from "../types";

export function StepList({ project }: { project: ProjectRecord }) {
  return (
    <div className="step-timeline">
      {project.program.steps.map((step, stepIndex) => {
        const isActiveStep = stepIndex === project.currentStepIndex;
        const completed = step.blocks.every((block) => project.completedBlocks[block.id]);
        const activeBlock = isActiveStep ? step.blocks[project.currentBlockIndex] : null;

        return (
          <section
            key={step.id}
            className={cn("step-timeline__step", {
              "is-active": isActiveStep,
              "is-complete": completed
            })}
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
                      "is-complete": project.completedBlocks[block.id]
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
