import { useEffect, useState } from "react";
import type { EvidenceRecord } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import type { ConstructApi } from "../../../shared/api";

/**
 * What a level is actually based on.
 *
 * A mastery level is a conclusion, and until now it was a conclusion with
 * nothing visible under it: the entry could say practice-ready and the learner
 * had no way to ask why, or when, or on the strength of what. That asymmetry is
 * the wrong way round for a record about a person — they are the one who did
 * the work, and they should be the one who can check the reading.
 *
 * Read across every project rather than the current one, because the answer to
 * "have I ever written one of these" does not change with which window is open.
 */
const DID: Record<EvidenceRecord["kind"], string> = {
  answered: "answered a question",
  "wrote-code": "wrote code",
  debugged: "debugged it",
  "taught-back": "explained it back",
  observed: "was shown it",
};

/* The demand is the part a level cannot tell you. Recognising a closure and
   writing one are different abilities, and a record that collapses them is how
   a system convinces itself somebody is ready. */
const ASKED: Record<EvidenceRecord["demand"], string> = {
  recall: "from memory",
  recognise: "on sight",
  produce: "from scratch",
  debug: "under a fault",
  transfer: "somewhere new",
};

const OUTCOME: Record<EvidenceRecord["outcome"], { label: string; className: string }> = {
  held: { label: "held", className: "text-success" },
  partial: { label: "partly", className: "text-muted-foreground" },
  missed: { label: "missed", className: "text-warning" },
  unjudged: { label: "not yet judged", className: "text-muted-foreground/60" },
};

export function ConceptEvidence({ api, conceptId }: { api: ConstructApi | undefined; conceptId: string }) {
  const [rows, setRows] = useState<EvidenceRecord[] | null>(null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setRows(null);
    void api
      .conceptEvidence({ conceptId })
      .then((found) => { if (alive) setRows(found); })
      /* Same rule the history follows: the concept is still readable without
         this, so a failure here is silence rather than an error. */
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [api, conceptId]);

  /* Nothing recorded is a real state and not an empty one. It means the level
     is a guess, and saying so plainly is the whole point of this section. */
  if (!rows) return null;

  return (
    <section className="mt-5 border-t border-border/60 pt-3">
      <h2 className="mb-2 text-ui-sm font-semibold tracking-wide text-muted-foreground uppercase">What this is based on</h2>
      {rows.length === 0 ? (
        <p className="text-ui leading-[1.5] text-muted-foreground">
          Nothing yet. This level is Construct&rsquo;s reading of the conversation, not something you have been asked to do.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li className="flex min-w-0 items-baseline gap-2 text-ui leading-[1.5]" key={row.id}>
              <span className="min-w-0 flex-1 text-foreground/85">
                {DID[row.kind]} <span className="text-muted-foreground">{ASKED[row.demand]}</span>
              </span>
              <span className={cn("shrink-0 text-ui-sm", OUTCOME[row.outcome].className)}>{OUTCOME[row.outcome].label}</span>
              <span className="shrink-0 text-ui-sm text-muted-foreground/60">{relativeTime(row.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
