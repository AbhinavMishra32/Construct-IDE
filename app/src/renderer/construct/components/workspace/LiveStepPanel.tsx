import { Lightning } from "@phosphor-icons/react";

import { Button } from "@opaline/ui";
import type { GeneratedLiveStep } from "../../../../shared/constructLearning";
import type { InlineFileRef } from "../../lib/inlineRefs";
import { MarkdownBlock } from "../MarkdownBlock";

export function LiveStepPanel({
  liveStep,
  theme,
  onOpenConcept,
  onOpenFile,
  onComplete,
  onDismiss,
  onBack
}: {
  liveStep: GeneratedLiveStep;
  theme: "light" | "dark" | "system";
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onComplete: () => void;
  onDismiss: () => void;
  onBack: () => void;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4" data-construct-explainable="generated-live-step" data-construct-explainable-label="Generated live step">
      <div className="mb-3 flex items-center gap-2 rounded-md border bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
        <Lightning size={15} weight="duotone" />
        <span>Generated live by Construct Interact</span>
      </div>
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Adaptive live step</span>
        <span>{liveStep.status}</span>
      </div>
      <h2 className="mt-2 text-lg font-semibold">{liveStep.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{liveStep.reason}</p>
      <div className="mt-4 space-y-4">
        {liveStep.blocks.map((block) => {
          if (block.kind === "explain") {
            return (
              <section key={block.id} className="border-t pt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Explain</p>
                <MarkdownBlock content={block.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
              </section>
            );
          }

          if (block.kind === "interact") {
            return (
              <section key={block.id} className="border-t pt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Construct Interact</p>
                <MarkdownBlock content={block.prompt} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
                <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
                  <strong className="font-medium">What to check</strong>
                  <span>{block.understanding}</span>
                </div>
              </section>
            );
          }

          return (
            <section key={block.id} className="border-t pt-4">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Reply Recall</p>
              <MarkdownBlock content={block.task} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
              {block.support ? (
                <div className="mt-3 rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Support</p>
                  <MarkdownBlock content={block.support} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="secondary" onClick={onBack}>Back to tape</Button>
        <Button type="button" variant="secondary" onClick={onDismiss}>Dismiss</Button>
        <Button type="button" onClick={onComplete}>Complete live step</Button>
      </div>
    </aside>
  );
}
