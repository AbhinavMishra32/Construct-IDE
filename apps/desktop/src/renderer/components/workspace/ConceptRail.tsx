import { MASTERY_RUBRIC, rubricForLevel } from "@construct/domain";
import type { ConceptSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

/**
 * What this project has taught, and how far the learner has got with each.
 *
 * This is the one surface no editor has, and the reason Construct's chrome is
 * not a title bar: an IDE's toolbar is about files, and files are already named
 * by the tabs and the tree. What is not visible anywhere else is what the
 * learner now understands — so that is what the top of the window carries.
 *
 * Ordered by most recently moved, so the concept currently being taught leads.
 * Only a few fit; the rest are a count, because a rail that wraps is a list and
 * a list belongs on its own page.
 */
export function ConceptRail({ concepts, className }: { concepts: ConceptSummary[]; className?: string }) {
  if (concepts.length === 0) return null;

  const shown = concepts.slice(0, 4);
  const rest = concepts.length - shown.length;

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      {shown.map((concept) => (
        <ConceptChip concept={concept} key={concept.conceptId} />
      ))}
      {rest > 0 && <span className="shrink-0 px-1 text-ui-sm tabular-nums text-muted-foreground">+{rest}</span>}
    </div>
  );
}

function ConceptChip({ concept }: { concept: ConceptSummary }) {
  const rubric = rubricForLevel(concept.masteryLevel);

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          className={cn(
            "app-no-drag flex h-6 min-w-0 shrink items-center gap-1.5 rounded-full border px-2 text-ui-sm transition-colors",
            /* Task-ready is the only distinction the chip draws, because it is
               the only one that changes what Construct will do next: below
               level 3 the agent may explain but not set work. */
            rubric.taskReady
              ? "border-[var(--success)]/35 bg-[var(--success)]/10 text-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
          type="button"
        >
          <MasteryDots level={concept.masteryLevel} ready={rubric.taskReady} />
          <span className="truncate">{concept.title}</span>
        </button>
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-72 space-y-2" side="bottom">
        <div className="space-y-0.5">
          <p className="text-ui font-medium">{concept.title}</p>
          <p className="text-ui-sm text-muted-foreground">
            Level {concept.masteryLevel} · {rubric.title}
          </p>
        </div>

        {/* The rubric's own words, because the agent is judging against exactly
            this text — showing a paraphrase would let the two drift. */}
        <p className="text-ui-sm leading-[1.5] text-muted-foreground">{rubric.text}</p>

        {concept.note && (
          <p className="border-t border-border/60 pt-2 text-ui-sm leading-[1.5] text-foreground/80">{concept.note}</p>
        )}

        <p className="text-ui-sm text-muted-foreground/70">
          {rubric.taskReady ? "Construct may set scoped tasks on this." : "Construct will explain this rather than set work on it."}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Mastery as five marks rather than a number or a bar.
 *
 * A bar implies a continuous quantity, and mastery is six named states from a
 * rubric. Five discrete marks read as "three of five" at a glance without
 * suggesting 62%.
 */
function MasteryDots({ level, ready }: { level: number; ready: boolean }) {
  return (
    <span aria-label={`Level ${level} of 5`} className="flex shrink-0 items-center gap-[1.5px]">
      {MASTERY_RUBRIC.slice(1).map((step) => (
        <span
          className={cn(
            "h-2 w-[2px] rounded-full",
            step.level <= level ? (ready ? "bg-[var(--success)]" : "bg-foreground/55") : "bg-foreground/15",
          )}
          key={step.level}
        />
      ))}
    </span>
  );
}
