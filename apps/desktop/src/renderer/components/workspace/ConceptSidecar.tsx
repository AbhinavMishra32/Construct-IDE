import { ArrowLeft, ExternalLink, GraduationCap } from "lucide-react";
import { MASTERY_RUBRIC, rubricForLevel } from "@construct/domain";
import type { ConceptSummary, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Markdown } from "../agent/Markdown";

/**
 * One concept, in full, as a panel beside the work.
 *
 * A sidecar rather than a dialog, and the distinction is not cosmetic: a
 * concept note is something the learner reads *while* looking at the code it
 * describes. A modal covers the code and forces a choice between the
 * explanation and the thing being explained, which is exactly the wrong trade
 * for a teaching tool.
 *
 * The content is the point. v0.7's concept records carry a summary, why the
 * idea matters, a worked example and real references — a knowledge base the
 * learner accumulates — and a card showing only a level and a timestamp is the
 * shape of a concept with none of the substance.
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
  const empty = !concept.summary && !concept.why && !concept.example;

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
        <GraduationCap className={cn("size-3.5 shrink-0", rubric.taskReady ? "text-[var(--success)]" : "text-muted-foreground")} />
        <span className="truncate text-ui font-medium">{concept.title}</span>
      </header>

      <div className="app-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-ui-sm",
                rubric.taskReady ? "border-[var(--success)]/35 bg-[var(--success)]/10" : "border-border",
              )}
            >
              Level {concept.masteryLevel} · {rubric.title}
            </span>
            {concept.tags.map((tag) => (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-ui-sm text-muted-foreground" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p className="text-ui-sm text-muted-foreground">
            First seen {relativeTime(concept.firstSeenAt)} · last moved {relativeTime(concept.updatedAt)}
          </p>
        </div>

        {empty ? (
          /* Said plainly rather than dressed up. A concept the agent recorded
             before it wrote the explanation is a real state, and pretending
             otherwise with an empty card is what made this panel useless. */
          <p className="rounded-[var(--radius-lg)] border border-dashed border-border px-3 py-2 text-ui text-muted-foreground">
            Construct has tracked your level on this but has not written the explanation yet. Ask it to explain this concept and the note will fill in.
          </p>
        ) : (
          <>
            {concept.summary && <Section body={concept.summary} title="What it is" />}
            {concept.why && <Section body={concept.why} title="Why it matters" />}
            {concept.example && <Section body={concept.example} title="Example" />}
          </>
        )}

        {concept.note && (
          <section className="rounded-[var(--radius-lg)] border border-border bg-card/40 px-3 py-2">
            <h3 className="text-ui-sm font-medium text-muted-foreground">What your level is based on</h3>
            <p className="mt-1 text-content leading-[1.55]">{concept.note}</p>
          </section>
        )}

        {concept.docs.length > 0 && (
          <section>
            <h3 className="mb-1 text-ui-sm font-medium text-muted-foreground">Worth reading</h3>
            <ul className="space-y-0.5">
              {concept.docs.map((doc) => (
                <li key={doc.url}>
                  <button
                    className="group/doc flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-content text-foreground/85 hover:bg-accent hover:text-foreground"
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

        <section>
          <h3 className="mb-1.5 text-ui-sm font-medium text-muted-foreground">The ladder</h3>
          <ol className="space-y-0.5">
            {MASTERY_RUBRIC.map((step) => {
              const reached = step.level <= concept.masteryLevel;
              const current = step.level === concept.masteryLevel;
              return (
                <li
                  className={cn("flex gap-2 rounded-[var(--radius-md)] px-2 py-1.5", current && "bg-[var(--sidebar-accent-active)]")}
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
                      {/* Marked once, where it starts, rather than on every rung
                          above it: the boundary is the fact. */}
                      {step.level === 3 && <span className="ml-1.5 text-ui-sm font-normal text-[var(--success)]">tasks allowed from here</span>}
                    </span>
                    <span className="mt-0.5 block text-ui-sm leading-[1.5] text-muted-foreground">{step.text}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}

/** Rendered as Markdown, because the agent writes code fences into the example
 *  and a concept note without formatted code is a wall of text. */
function Section({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3 className="mb-1 text-ui-sm font-medium text-muted-foreground">{title}</h3>
      <div className="text-content leading-[1.55]">
        <Markdown source={body} />
      </div>
    </section>
  );
}
