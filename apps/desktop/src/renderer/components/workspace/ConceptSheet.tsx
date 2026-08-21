import { GraduationCap } from "lucide-react";
import { MASTERY_RUBRIC, rubricForLevel } from "@construct/domain";
import type { ConceptSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/format";

/**
 * One concept, in full.
 *
 * The rail can only say a title and a level; this is where the learner reads
 * what that level means, what evidence the agent based it on, and — the part
 * that matters most — the whole ladder, so a level is a position on a scale
 * rather than a number out of context.
 *
 * Every rung is shown, not just the current one. Seeing that level 3 is where
 * scoped work becomes fair, and that two rungs remain above it, is what makes
 * the number mean anything.
 */
export function ConceptSheet({ concept, onClose }: { concept: ConceptSummary | null; onClose(): void }) {
  const rubric = concept ? rubricForLevel(concept.masteryLevel) : null;

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(concept)}>
      <DialogContent className="sm:max-w-[32rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className={cn("size-4 shrink-0", rubric?.taskReady ? "text-[var(--success)]" : "text-muted-foreground")} />
            {concept?.title}
          </DialogTitle>
          <DialogDescription>
            {concept && rubric ? (
              <>
                Level {concept.masteryLevel} · {rubric.title} · last moved {relativeTime(concept.updatedAt)}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {concept && (
          <div className="space-y-3">
            {concept.note && (
              <div className="rounded-[var(--radius-lg)] border border-border bg-card/40 px-3 py-2">
                <p className="text-ui-sm font-medium text-muted-foreground">What this is based on</p>
                <p className="mt-1 text-content leading-[1.55]">{concept.note}</p>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-ui-sm font-medium text-muted-foreground">The ladder</p>
              <ol className="space-y-0.5">
                {MASTERY_RUBRIC.map((step) => {
                  const reached = step.level <= concept.masteryLevel;
                  const current = step.level === concept.masteryLevel;
                  return (
                    <li
                      className={cn(
                        "flex gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5",
                        current && "bg-[var(--sidebar-accent-active)]",
                      )}
                      key={step.level}
                    >
                      <span
                        className={cn(
                          "mt-[3px] grid size-4 shrink-0 place-items-center rounded-full text-[10px] tabular-nums",
                          reached ? (step.taskReady ? "bg-[var(--success)]/20 text-foreground" : "bg-foreground/12 text-foreground") : "bg-foreground/6 text-muted-foreground/70",
                        )}
                      >
                        {step.level}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("block text-ui", reached ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {step.title}
                          {/* Marked once, on the rung where it starts, rather than
                              on every rung above it — the boundary is the fact,
                              not the property. */}
                          {step.level === 3 && <span className="ml-1.5 text-ui-sm font-normal text-[var(--success)]">tasks allowed from here</span>}
                        </span>
                        <span className="mt-0.5 block text-ui-sm leading-[1.5] text-muted-foreground">{step.text}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <p className="text-ui-sm text-muted-foreground/70">
              First seen {relativeTime(concept.firstSeenAt)} · reading: {concept.confidence}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
