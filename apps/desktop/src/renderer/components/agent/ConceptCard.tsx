import { ArrowRight, GraduationCap } from "lucide-react";
import { rubricForLevel } from "@construct/domain";
import { cn } from "@/lib/utils";

/**
 * A mastery reading, as a card in the transcript.
 *
 * v0.7 showed these inline, and it was right to: when the agent decides the
 * learner has moved from guided understanding to practice-ready, that is the
 * most consequential thing in the turn — it changes what Construct will do next
 * — and it deserves more than a line saying a tool ran.
 *
 * The level change is the headline, not the concept name. The name says what was
 * discussed; the arrow says what happened.
 */
export function ConceptCard({
  title,
  level,
  previousLevel,
  note,
  onOpen,
}: {
  title: string;
  level: number;
  previousLevel?: number | undefined;
  note?: string | undefined;
  onOpen?(): void;
}) {
  const rubric = rubricForLevel(level);
  const moved = previousLevel !== undefined && previousLevel !== level;
  const crossed = moved && rubricForLevel(previousLevel).taskReady !== rubric.taskReady;

  return (
    <button
      className={cn(
        "group/concept flex w-full min-w-0 items-start gap-2.5 rounded-[var(--radius-lg)] border px-3 py-2 text-left transition-colors",
        /* Crossing into task-ready is the one change worth colouring: it is the
           moment the agent is allowed to set work on this idea. */
        crossed && rubric.taskReady
          ? "border-[var(--success)]/35 bg-[var(--success)]/8 hover:bg-[var(--success)]/12"
          : "border-border bg-card/40 hover:bg-card/70",
      )}
      onClick={onOpen}
      type="button"
    >
      <GraduationCap className={cn("mt-0.5 size-4 shrink-0", rubric.taskReady ? "text-[var(--success)]" : "text-muted-foreground")} />

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-ui font-medium text-foreground">{title}</span>
          {moved ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 text-ui-sm tabular-nums text-muted-foreground">
              L{previousLevel}
              <ArrowRight className="size-2.5" />
              <span className="font-medium text-foreground">L{level}</span>
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-border/60 bg-background/60 px-1.5 text-ui-sm tabular-nums text-muted-foreground">
              L{level}
            </span>
          )}
        </span>

        <span className="mt-0.5 block text-ui-sm text-muted-foreground">{rubric.title}</span>
        {note && <span className="mt-1 block line-clamp-2 text-ui-sm leading-[1.5] text-foreground/75">{note}</span>}
      </span>
    </button>
  );
}

/** Reads a record-concept call's arguments back out of the stored JSON.
 *
 *  Returns null rather than a partial card when the payload cannot be read: a
 *  concept card with no title is worse than the plain tool row it replaces. */
export function conceptFromToolInput(input: string): { title: string; level: number; note?: string } | null {
  try {
    const parsed = JSON.parse(input) as { title?: unknown; conceptId?: unknown; masteryLevel?: unknown; note?: unknown };
    const title = String(parsed.title ?? parsed.conceptId ?? "").trim();
    const level = Number(parsed.masteryLevel);
    if (!title || !Number.isFinite(level)) return null;
    return {
      title,
      level: Math.min(5, Math.max(0, Math.round(level))),
      ...(typeof parsed.note === "string" && parsed.note.trim() ? { note: parsed.note } : {}),
    };
  } catch {
    return null;
  }
}
