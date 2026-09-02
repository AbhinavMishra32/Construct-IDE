import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import type { ConceptSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { masteryColor } from "@/lib/mastery";
import { ConstructDots } from "../common/ConstructDots";
import { branchTo, buildConceptTree, type ConceptTreeNode } from "./conceptShelves";

/**
 * What the project has taught you, as the tree the agent built.
 *
 * The companion to the path: the path is where the teaching is going, this is
 * what it has already left behind. Every concept is a row and every concept can
 * hold others, as deep as the subject goes — the agent sets a parent when it
 * records one, so the nesting is what it decided the shape of the subject is
 * rather than a grouping this list invented.
 *
 * The open card is marked here. A floating panel with no tie back to the list it
 * came from is a card from nowhere; highlighting the row — and opening the
 * branch it sits on — is what makes the tree and the card one thing.
 */
export function ConceptTree({
  activeConceptId,
  concepts,
  onOpen,
}: {
  /** The concept whose card is open, if any. */
  activeConceptId: string | null;
  concepts: ConceptSummary[];
  onOpen(concept: ConceptSummary): void;
}) {
  const tree = useMemo(() => buildConceptTree(concepts), [concepts]);
  /* Everything open by default: a sidebar that starts collapsed hides the thing
     it exists to show, and the first click is always "open everything". */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  /* Opening a card reveals the branch it lives on. Reaching into `closed`
     rather than tracking an "open" set is what makes this safe to run on every
     change: it only ever un-hides, so it cannot fight the learner collapsing
     something themselves. */
  useEffect(() => {
    if (!activeConceptId) return;
    const trail = branchTo(tree, activeConceptId);
    if (trail.length === 0) return;
    setClosed((current) => {
      if (!trail.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of trail) next.delete(id);
      return next;
    });
  }, [activeConceptId, tree]);

  if (concepts.length === 0) {
    /* The mark, and nothing else — the same silence the path keeps before it is
       planned. A sentence explaining that nothing has been learned yet is an
       explanation nobody asked for, in the space the concepts will occupy. */
    return (
      <div className="flex justify-center py-4">
        <ConstructDots className="text-foreground/25" pattern="still" size={26} />
      </div>
    );
  }

  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = (nodes: ConceptTreeNode[]): React.ReactNode =>
    nodes.map((node) => {
      const concept = node.concept;
      const active = concept.conceptId === activeConceptId;
      const open = !closed.has(concept.conceptId);
      const parent = node.children.length > 0;

      return (
        <li key={concept.conceptId}>
          <div
            className={cn(
              "group/concept flex items-center rounded-md pr-1.5 transition-colors",
              active ? "bg-[var(--sidebar-accent-active)]" : "hover:bg-[var(--sidebar-accent)]",
            )}
            /* Indent is padding on the row rather than a nested margin, so the
               hover and selection fills still run the full width of the column
               at every depth. */
            style={{ paddingLeft: `${node.depth * 0.6875 + 0.125}rem` }}
          >
            {/* Disclosure and the concept itself are separate targets: opening a
                branch and reading its concept are different intentions, and one
                button doing both means you cannot do either deliberately. */}
            {parent ? (
              <button
                aria-expanded={open}
                aria-label={open ? `Collapse ${concept.title}` : `Expand ${concept.title}`}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 hover:text-foreground"
                onClick={() => toggle(concept.conceptId)}
                type="button"
              >
                <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
              </button>
            ) : (
              /* A leaf keeps the disclosure's width so titles line up down the
                 column rather than stepping in and out by depth. */
              <span aria-hidden className="size-5 shrink-0" />
            )}

            <button
              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
              onClick={() => onOpen(concept)}
              title={concept.summary || concept.title}
              type="button"
            >
              {/* Level as one tick rather than five: at sidebar scale a full
                  rubric is five specks nobody can count, and the colour already
                  carries the reading. */}
              <span
                aria-hidden
                className="h-3 w-[3px] shrink-0 rounded-full"
                style={{
                  background: concept.masteryLevel > 0 ? masteryColor(concept.masteryLevel) : "var(--mastery-0)",
                }}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-source-sm leading-[1.45]",
                  active ? "font-medium text-foreground" : "text-foreground/75",
                )}
              >
                {concept.title}
              </span>
            </button>

            {/* Only when it is closed: an open branch counts itself on screen,
                and a number beside every row is noise. */}
            {parent && !open && (
              <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">{node.total - 1}</span>
            )}
          </div>
          {parent && open && <ul>{rows(node.children)}</ul>}
        </li>
      );
    });

  return <ul className="px-1.5">{rows(tree)}</ul>;
}
