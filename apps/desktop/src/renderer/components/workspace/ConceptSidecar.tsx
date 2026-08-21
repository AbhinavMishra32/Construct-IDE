import { useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink } from "lucide-react";
import { MASTERY_RUBRIC, rubricForLevel } from "@construct/domain";
import type { ConceptSummary, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Markdown } from "../agent/Markdown";

/**
 * One concept, as an encyclopedia entry beside the work.
 *
 * A sidecar rather than a dialog, and that is not cosmetic: a concept note is
 * read *while* looking at the code it describes, and a modal forces a choice
 * between the explanation and the thing being explained.
 *
 * The note is one Markdown body rather than a set of titled fields. Asking the
 * agent to fill boxes for "why" and "common mistake" produced six stubs; asking
 * it for an entry produces an entry. The structure lives in the prompt and the
 * typography, which is where structure belongs when the author is writing
 * prose.
 */
export function ConceptSidecar({
  api,
  concept,
  onBack,
}: {
  api: ConstructApi | undefined;
  concept: ConceptSummary;
  onBack(): void;
}) {
  const rubric = rubricForLevel(concept.masteryLevel);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="hairline-b flex h-9 shrink-0 items-center gap-1.5 px-2">
        <button
          aria-label="Back to the conversation"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-4" />
        </button>
        {/* Labelled with what it is before it is named — what makes a panel read
            as a kind of thing rather than a one-off. */}
        <span className="shrink-0 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">Concept</span>
      </header>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* The entry's masthead: title, one-line gloss, and the level as a
            single quiet line. The note is what the panel is for; the level is
            context for it. */}
        <h1 className="text-title font-semibold leading-tight tracking-[-0.01em]">{concept.title}</h1>

        {concept.summary && <p className="mt-1 text-content leading-[1.55] text-muted-foreground">{concept.summary}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground">
          <span className="flex shrink-0 items-center gap-[2px]" aria-label={`Level ${concept.masteryLevel} of 5`}>
            {MASTERY_RUBRIC.slice(1).map((step) => (
              <span
                className={cn(
                  "h-2.5 w-[3px] rounded-full",
                  step.level <= concept.masteryLevel ? (rubric.taskReady ? "bg-[var(--success)]" : "bg-foreground/55") : "bg-foreground/15",
                )}
                key={step.level}
              />
            ))}
          </span>
          <span className="text-foreground/80">{rubric.title}</span>
          {rubric.taskReady && <span className="text-[var(--success)]">tasks allowed</span>}
          <span className="text-muted-foreground/60">· {relativeTime(concept.updatedAt)}</span>
        </div>

        {concept.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {concept.tags.map((tag) => (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-ui-sm text-muted-foreground" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <hr className="my-4 border-border/60" />

        {concept.content ? (
          /* The entry itself. `concept-entry` is where the encyclopedia look
             lives — heading rhythm, measure, code blocks — so the agent can
             write plain Markdown and have it typeset properly. */
          <div className="concept-entry">
            <Markdown source={concept.content} />
          </div>
        ) : (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-border px-3 py-2 text-ui text-muted-foreground">
            Construct is tracking your level on this but has not written the entry yet. Ask it to explain the concept and this will fill in.
          </p>
        )}

        {concept.docs.length > 0 && (
          <section className="mt-5 border-t border-border/60 pt-3">
            <h2 className="mb-1 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">Further reading</h2>
            <ul>
              {concept.docs.map((doc) => (
                <li key={doc.url}>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-ui text-foreground/85 hover:bg-accent hover:text-foreground"
                    onClick={() => void api?.openExternal(doc.url)}
                    type="button"
                  >
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{doc.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {concept.note && (
          <section className="mt-5 border-t border-border/60 pt-3">
            <h2 className="mb-1 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">Why this level</h2>
            <p className="text-ui leading-[1.6] text-muted-foreground">{concept.note}</p>
          </section>
        )}

        <Ladder level={concept.masteryLevel} />
      </div>
    </div>
  );
}

/**
 * The ladder, folded away.
 *
 * It was the loudest thing in the panel, which had it backwards: the six levels
 * are reference material you read once to learn what the numbers mean, not
 * something to re-read beside every concept. Folded, it is still there when the
 * number needs context.
 */
function Ladder({ level }: { level: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-5 border-t border-border/60 pt-2">
      <button
        className="flex items-center gap-1 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        What the levels mean
      </button>

      {open && (
        <ol className="mt-1.5 space-y-1.5 pl-4">
          {MASTERY_RUBRIC.map((step) => (
            <li className="text-ui-sm leading-[1.5]" key={step.level}>
              <span className={cn(step.level === level ? "font-medium text-foreground" : "text-muted-foreground")}>
                <span className="tabular-nums">{step.level}</span> · {step.title}
              </span>
              {step.level === 3 && <span className="text-[var(--success)]"> — tasks allowed from here</span>}
              <span className="block text-muted-foreground/75">{step.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
