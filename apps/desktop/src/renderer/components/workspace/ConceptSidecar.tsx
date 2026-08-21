import { ArrowLeft } from "lucide-react";
import type { ConceptSummary, ConstructApi } from "../../../shared/api";
import { ConceptEntry } from "../concepts/ConceptEntry";

/**
 * One concept, beside the work.
 *
 * A sidecar rather than a dialog, and that is not cosmetic: a concept note is
 * read *while* looking at the code it describes, and a modal forces a choice
 * between the explanation and the thing being explained.
 *
 * The entry itself is `ConceptEntry`, shared with the atlas — this file is the
 * panel around it and nothing more.
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
        <ConceptEntry api={api} concept={concept} />
      </div>
    </div>
  );
}
