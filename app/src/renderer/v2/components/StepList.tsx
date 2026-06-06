import { CheckIcon, CircleDotIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { blockLabel } from "../lib/runtime";
import type { ProjectRecord } from "../types";

export function StepList({ project }: { project: ProjectRecord }) {
  return (
    <div className="step-list">
      {project.program.steps.map((step, stepIndex) => {
        const isActiveStep = stepIndex === project.currentStepIndex;
        const completed = step.blocks.every((block) => project.completedBlocks[block.id]);

        return (
          <section
            key={step.id}
            className={cn("step-list__step", {
              "is-active": isActiveStep,
              "is-complete": completed
            })}
          >
            <div className="step-list__step-title">
              {completed ? <CheckIcon size={14} /> : <CircleDotIcon size={14} />}
              <span>{step.title}</span>
            </div>
            <div className="step-list__blocks">
              {step.blocks.map((block, blockIndex) => (
                <div
                  key={block.id}
                  className={cn("step-list__block", {
                    "is-active":
                      isActiveStep && blockIndex === project.currentBlockIndex,
                    "is-complete": project.completedBlocks[block.id]
                  })}
                >
                  {blockLabel(block)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

