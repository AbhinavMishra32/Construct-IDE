import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { rubricForLevel } from "@construct/domain";
import type { ConceptEvent, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { masteryColor } from "@/lib/mastery";

/**
 * How a concept got to where it is.
 *
 * Construct has recorded every reading it has ever taken — introduced, moved
 * up, moved down, come back to — since the first version, and until now nothing
 * read it back. So the entry could say the learner is practice-ready on
 * rasterisation and never that they were at guided understanding a week ago,
 * which is the more interesting sentence: it is the one that says they are
 * getting somewhere.
 *
 * Drawn as a log rather than as a table. A table of four columns is a database
 * view of somebody's own learning; a rail of commits reads the way the thing
 * actually happened — newest at the top, each entry saying what moved, why, and
 * which parts of the note were rewritten. The rail is what makes it one story
 * instead of five rows.
 */
export function ConceptHistory({
  api,
  conceptId,
  projectId,
}: {
  api: ConstructApi | undefined;
  conceptId: string;
  /** Absent in the atlas until a concept knows which project taught it, and the
   *  history is per project because mastery is. Nothing is drawn without it. */
  projectId: string | undefined;
}) {
  const [events, setEvents] = useState<ConceptEvent[] | null>(null);

  useEffect(() => {
    if (!api || !projectId) return;
    let alive = true;
    setEvents(null);
    void api
      .conceptHistory({ projectId, conceptId })
      .then((rows) => { if (alive) setEvents(rows); })
      /* A history that cannot be read is not worth an error in the entry: the
         concept itself is still there to read, which is what was asked for. */
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [api, conceptId, projectId]);

  /* One event is the concept being introduced, which the entry already says in
     "first seen". A log of one line is furniture. */
  if (!events || events.length < 2) return null;

  return (
    <section className="mt-5 border-t border-border/60 pt-3">
      <h2 className="mb-2 text-ui-sm font-semibold tracking-wide text-muted-foreground/60 uppercase">How this moved</h2>
      <ol className="relative">
        {/* The rail. Stops short at both ends so it reads as connecting the
            entries rather than running off past them. */}
        <span aria-hidden className="absolute top-2 bottom-2 left-[3.5px] w-px bg-border" />
        {events.map((event, index) => (
          <Entry event={event} key={event.eventId} newest={index === 0} />
        ))}
      </ol>
    </section>
  );
}

function Entry({ event, newest }: { event: ConceptEvent; newest: boolean }) {
  const rubric = rubricForLevel(event.masteryLevel);
  const moved = event.previousLevel !== null && event.previousLevel !== event.masteryLevel;

  return (
    <li className="relative flex min-w-0 gap-2.5 pb-2.5 last:pb-0">
      <span
        aria-hidden
        className={cn("mt-[0.3rem] size-2 shrink-0 rounded-full ring-[3px] ring-background", !newest && "opacity-70")}
        style={{ background: masteryColor(event.masteryLevel) }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {moved ? (
            <span className="flex shrink-0 items-baseline gap-1 text-ui tabular-nums text-muted-foreground">
              L{event.previousLevel}
              <ArrowRight className="size-2.5 translate-y-[1px]" />
              <span className="font-medium text-foreground">L{event.masteryLevel}</span>
            </span>
          ) : (
            <span className="shrink-0 text-ui tabular-nums text-muted-foreground">
              {event.kind === "introduced" ? `first taught at L${event.masteryLevel}` : `held at L${event.masteryLevel}`}
            </span>
          )}
          <span className="shrink-0 text-ui-sm text-muted-foreground/70">{rubric.title}</span>
          <span className="ml-auto shrink-0 text-ui-sm text-muted-foreground/50">{relativeTime(event.createdAt)}</span>
        </div>
        {event.reason && <p className="mt-0.5 text-ui leading-[1.5] text-foreground/80">{event.reason}</p>}
        {event.changed.length > 0 && (
          <p className="mt-0.5 text-ui-sm text-muted-foreground/60">
            <ChangedFields fields={event.changed} />
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Which parts of the note a call rewrote, in words.
 *
 * Shared with the transcript's concept card, because the card and the log are
 * answering the same question a minute apart and there is no version of this
 * where "content" and "note rewritten" should both be in the interface.
 *
 * The field names are the schema's; these are what happened to something the
 * learner owns.
 */
export function ChangedFields({ fields }: { fields: ConceptEvent["changed"] }) {
  const said = fields.map((field) => FIELD_WORDS[field]).filter(Boolean);
  if (said.length === 0) return null;
  return <span className="min-w-0">{said.join(" · ")}</span>;
}

const FIELD_WORDS: Record<ConceptEvent["changed"][number], string> = {
  title: "renamed",
  summary: "summary reworded",
  content: "note rewritten",
  note: "evidence added",
  docs: "references updated",
  tags: "tags changed",
  parent: "moved under another idea",
};
