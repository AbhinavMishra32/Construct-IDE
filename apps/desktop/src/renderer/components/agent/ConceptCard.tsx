import { ArrowRight, GraduationCap } from "lucide-react";
import { rubricForLevel } from "@construct/domain";
import type { ConceptEvent } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { masteryColor } from "@/lib/mastery";
import { ChangedFields } from "../concepts/ConceptHistory";

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
 *
 * What *else* happened is on the card too, because for most calls the level is
 * not what moved: the agent came back to an idea and rewrote the note, or
 * reworded the summary, or filed the concept under a parent. The card used to
 * show a level and a level only, so all of that read as nothing having happened
 * at all. Now the arrow says where the reading went, the marks under it say
 * which parts of the learner's own note were rewritten, and the reason — the
 * agent's own sentence on why — is the line that ties the two together.
 */
export function ConceptCard({
  title,
  level,
  previousLevel,
  note,
  reason,
  changed,
  onOpen,
}: {
  title: string;
  level: number;
  previousLevel?: number | undefined;
  note?: string | undefined;
  /** The agent's own sentence on why the reading moved. */
  reason?: string | undefined;
  /** Which written parts of the note this call rewrote. */
  changed?: ConceptEvent["changed"] | undefined;
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
        crossed && rubric.taskReady ? "hover:brightness-105" : "border-border bg-card/40 hover:bg-card/70",
      )}
      style={
        crossed && rubric.taskReady
          ? {
              borderColor: `color-mix(in oklab, ${masteryColor(level)} 40%, transparent)`,
              background: `color-mix(in oklab, ${masteryColor(level)} 10%, transparent)`,
            }
          : undefined
      }
      onClick={onOpen}
      type="button"
    >
      <GraduationCap className="mt-0.5 size-4 shrink-0" style={{ color: rubric.taskReady ? masteryColor(level) : "var(--muted-foreground)" }} />

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

        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui-sm text-muted-foreground">
          <span className="shrink-0">{rubric.title}</span>
          {changed && changed.length > 0 && (
            <>
              <span className="shrink-0 text-muted-foreground/50">·</span>
              <ChangedFields fields={changed} />
            </>
          )}
        </span>
        {reason && <span className="mt-1 block line-clamp-2 text-ui-sm leading-[1.5] text-foreground/75">{reason}</span>}
        {note && !reason && <span className="mt-1 block line-clamp-2 text-ui-sm leading-[1.5] text-foreground/75">{note}</span>}
      </span>
    </button>
  );
}

/** What the call actually did, read back out of the tool's own result.
 *
 *  The store answers with the change — the level it moved from, and the fields
 *  it rewrote — because that is the one part of a `record-concept` call its
 *  arguments cannot tell you: "level 3" means nothing without what it was
 *  before. Returns null for a turn stored before the tool answered with this,
 *  and the card falls back to showing the level alone. */
export function conceptChangeFromToolOutput(output: string): { previousLevel?: number; reason?: string; changed: ConceptEvent["changed"] } | null {
  try {
    const parsed = JSON.parse(output) as { previousLevel?: unknown; reason?: unknown; changed?: unknown };
    const previous = Number(parsed.previousLevel);
    return {
      ...(Number.isFinite(previous) && parsed.previousLevel !== null ? { previousLevel: Math.min(5, Math.max(0, Math.round(previous))) } : {}),
      ...(typeof parsed.reason === "string" && parsed.reason.trim() ? { reason: parsed.reason.trim() } : {}),
      changed: Array.isArray(parsed.changed) ? (parsed.changed.map(String) as ConceptEvent["changed"]) : [],
    };
  } catch {
    return null;
  }
}

/** Reads a record-concept call's arguments back out of the stored JSON.
 *
 *  Returns null rather than a partial card when the payload cannot be read: a
 *  concept card with no title is worse than the plain tool row it replaces. */
export function conceptFromToolInput(input: string): { conceptId: string; title: string; level: number; note?: string } | null {
  try {
    const parsed = JSON.parse(input) as { title?: unknown; conceptId?: unknown; masteryLevel?: unknown; note?: unknown };
    const title = String(parsed.title ?? parsed.conceptId ?? "").trim();
    const conceptId = String(parsed.conceptId ?? "").trim();
    const level = Number(parsed.masteryLevel);
    if (!title || !conceptId || !Number.isFinite(level)) return null;
    return {
      conceptId,
      title,
      level: Math.min(5, Math.max(0, Math.round(level))),
      ...(typeof parsed.note === "string" && parsed.note.trim() ? { note: parsed.note } : {}),
    };
  } catch {
    return null;
  }
}
