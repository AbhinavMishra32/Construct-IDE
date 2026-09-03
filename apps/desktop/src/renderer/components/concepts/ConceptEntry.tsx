import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { MASTERY_RUBRIC, rubricForLevel } from "@construct/domain";
import type { ConceptSummary, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { masteryColor } from "@/lib/mastery";
import { Markdown } from "../agent/Markdown";
import { ConceptHistory } from "./ConceptHistory";

/**
 * One concept, as an encyclopedia entry.
 *
 * Shared by the workspace sidecar and the atlas, because they are the same
 * reading of the same thing at two sizes — and an entry with two implementations
 * is an entry that says two different things about the same concept within a
 * release or two.
 *
 * The note is one Markdown body rather than a set of titled fields. Asking the
 * agent to fill boxes for "why" and "common mistake" produced six stubs; asking
 * it for an entry produces an entry. The structure lives in the prompt and in
 * the typography, which is where structure belongs when the author is writing
 * prose.
 */
export function ConceptEntry({
  api,
  concept,
  siblings,
  where,
  projectId,
  onOpen,
}: {
  api: ConstructApi | undefined;
  concept: ConceptSummary;
  /** The rest of its topic, for the trail at the foot of the entry. An
   *  encyclopedia entry that ends in nothing is a dead end; one that ends in
   *  "see also" is a place to keep reading. */
  siblings?: ConceptSummary[] | undefined;
  /** Where the concept was learned. Shown only in the atlas, which spans
   *  projects; inside a project it would name the project you are in. */
  where?: string | undefined;
  /** The project whose reading of this concept is being shown. Mastery is per
   *  project, and so is the history: absent leaves the log out rather than
   *  showing another project's. */
  projectId?: string | undefined;
  onOpen?: ((concept: ConceptSummary) => void) | undefined;
}) {
  const rubric = rubricForLevel(concept.masteryLevel);

  return (
    <>
      <h1 className="text-title font-semibold leading-tight tracking-[-0.01em]">{concept.title}</h1>

      {concept.summary && <p className="mt-1 text-content leading-[1.55] text-muted-foreground">{concept.summary}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground">
        <span aria-label={`Level ${concept.masteryLevel} of 5`} className="flex shrink-0 items-center gap-[2px]">
          {MASTERY_RUBRIC.slice(1).map((step) => (
            <span
              className="h-2.5 w-[3px] rounded-full"
              key={step.level}
              style={{
                background: step.level <= concept.masteryLevel ? masteryColor(concept.masteryLevel) : "var(--mastery-0)",
              }}
            />
          ))}
        </span>
        <span className="text-foreground/80">{rubric.title}</span>
        {rubric.taskReady && <span style={{ color: masteryColor(concept.masteryLevel) }}>tasks allowed</span>}
        <span className="text-muted-foreground/60">· {relativeTime(concept.updatedAt)}</span>
        {where && <span className="text-muted-foreground/60">· {where}</span>}
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
        /* The entry itself. `concept-entry` is where the encyclopedia look lives
           — heading rhythm, measure, code blocks — so the agent can write plain
           Markdown and have it typeset properly. */
        <div className="concept-entry">
          <Markdown source={concept.content} />
        </div>
      ) : (
        /* No body yet. This used to be a small dashed box adrift in a tall empty
           column, which read as a page that had failed to load rather than a
           concept Construct has met but not yet written up. So the space says
           what *is* known — the level, the evidence, when it was seen — and what
           to do about the part that is not. */
        <section className="rounded-[var(--radius-xl)] border border-dashed border-border/80 px-4 py-3.5">
          <h2 className="text-content font-medium text-foreground">No entry written yet</h2>
          <p className="mt-1 text-ui leading-[1.6] text-muted-foreground">
            Construct has been tracking your level on this, but has not written it up. Ask it about {`"${concept.title}"`} in the
            project and the entry appears here.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3">
            <Fact label="Level">{`${rubric.title} · ${concept.masteryLevel} of 5`}</Fact>
            <Fact label="Confidence">{concept.confidence || "not recorded"}</Fact>
            <Fact label="First seen">{relativeTime(concept.firstSeenAt)}</Fact>
            <Fact label="Last moved">{relativeTime(concept.updatedAt)}</Fact>
          </dl>
        </section>
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

      <ConceptHistory api={api} conceptId={concept.conceptId} projectId={projectId} />

      {siblings && siblings.length > 0 && (
        <section className="mt-5 border-t border-border/60 pt-3">
          <h2 className="mb-1.5 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">The rest of this topic</h2>
          <ul className="grid gap-1">
            {siblings.map((sibling) => (
              <li key={sibling.conceptId}>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                  onClick={() => onOpen?.(sibling)}
                  type="button"
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: masteryColor(sibling.masteryLevel) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-ui text-foreground/85">{sibling.title}</span>
                  <span className="shrink-0 text-ui-sm text-muted-foreground/70">{rubricForLevel(sibling.masteryLevel).title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Ladder level={concept.masteryLevel} />
    </>
  );
}

/** One labelled fact. Two columns of these read as a record; the same strings in
 *  a sentence read as an apology. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ui-sm uppercase tracking-wide text-muted-foreground/60">{label}</dt>
      <dd className="truncate text-ui text-foreground/85">{children}</dd>
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
                <span className="tabular-nums" style={{ color: step.level === level ? masteryColor(level) : undefined }}>
                  {step.level}
                </span>{" "}
                · {step.title}
              </span>
              {step.level === 3 && <span style={{ color: "var(--mastery-3)" }}> — tasks allowed from here</span>}
              <span className="block text-muted-foreground/75">{step.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
