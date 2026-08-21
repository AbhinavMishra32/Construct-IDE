import { rubricForLevel } from "@construct/domain";
import type { ConceptSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { masteryColor } from "@/lib/mastery";

/**
 * The project's concepts, as a section of the sidebar.
 *
 * They were a rail across the top bar, and that was wrong twice over. Concept
 * titles are sentences — "Testing with assertions and Node's built-in test
 * runner" — so four of them across a toolbar is four truncations and no
 * information, while the sidebar had a column of empty space doing nothing.
 *
 * A list also lets mastery be a mark per level without becoming a barcode: in a
 * vertical list the marks line up under each other and read as a column of
 * progress, which is the thing they are.
 */
export function ConceptList({
  concepts,
  activeConceptId,
  onOpen,
}: {
  concepts: ConceptSummary[];
  activeConceptId: string | null;
  onOpen(concept: ConceptSummary): void;
}) {
  if (concepts.length === 0) {
    return (
      <p className="px-2.5 py-1 text-source-sm leading-[1.45] text-foreground/45">
        Nothing yet. Concepts appear here as Construct teaches them.
      </p>
    );
  }

  return (
    <ul className="px-1.5">
      {concepts.map((concept) => {
        const rubric = rubricForLevel(concept.masteryLevel);
        return (
          <li key={concept.conceptId}>
            <button
              aria-current={concept.conceptId === activeConceptId ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                concept.conceptId === activeConceptId ? "bg-sidebar-accent-active" : "hover:bg-sidebar-accent",
              )}
              onClick={() => onOpen(concept)}
              type="button"
            >
              {/* Vertical marks, aligned with the first line of the title. Five
                  of them in a column read as a level; five in a row read as a
                  barcode, which is what the toolbar version looked like. */}
              <span aria-label={`Level ${concept.masteryLevel} of 5`} className="mt-[5px] flex shrink-0 flex-col-reverse gap-[2px]">
                {[1, 2, 3, 4, 5].map((step) => (
                  <span
                    className="h-[3px] w-2.5 rounded-full"
                    key={step}
                    /* The level's own colour on every filled mark, from the one
                       ramp the atlas also draws — so a concept is the same colour
                       wherever in the app you meet it. */
                    style={{ background: step <= concept.masteryLevel ? masteryColor(concept.masteryLevel) : "var(--mastery-0)" }}
                  />
                ))}
              </span>

              <span className="min-w-0 flex-1">
                {/* Wrapped to two lines rather than truncated. A concept's title
                    is the only handle the learner has on it, and half a title is
                    not a handle. */}
                <span className="line-clamp-2 text-source leading-[1.35] text-foreground">{concept.title}</span>
                <span className="mt-0.5 block truncate text-source-sm text-foreground/45">{rubric.title}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
