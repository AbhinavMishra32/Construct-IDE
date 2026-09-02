import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import type { AtlasConcept } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { conceptColor } from "./palette";
import { topicOf } from "./atlas";
import { useDark } from "@/hooks/use-dark";
import { buildConceptTree, type ConceptTreeNode } from "../workspace/conceptShelves";

/**
 * Every concept Construct has taught, as the Atlas page's sidebar.
 *
 * The page used to carry this as its own leftmost column, which meant the
 * window had two indexes side by side: the shell's list of projects, which is
 * no use while reading about a concept, and the page's list of concepts. Moving
 * it into the sidebar gives the reading and the map the whole page and leaves
 * one index where an index belongs.
 *
 * It is the same tree the workspace draws, with one difference that matters:
 * concept ids are only unique *within* a project, so across the Atlas two
 * projects can both hold `typescript-basics`. The ids are namespaced by project
 * before the tree is built, which also keeps a parent link from reaching out of
 * the project that recorded it — the agent sets parents per project, so a link
 * that crossed one would be a link it never meant.
 */
export function AtlasTree({
  concepts,
  onSelect,
  selectedKey,
}: {
  concepts: AtlasConcept[];
  onSelect(concept: AtlasConcept): void;
  /** `projectId:conceptId` — see above. */
  selectedKey: string | null;
}) {
  const [query, setQuery] = useState("");
  const dark = useDark();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const needle = query.trim().toLocaleLowerCase();

  const { tree, byKey } = useMemo(() => {
    const namespaced = concepts.map((concept) => ({
      ...concept,
      conceptId: `${concept.projectId}:${concept.conceptId}`,
      parentId: concept.parentId ? `${concept.projectId}:${concept.parentId}` : null,
    }));
    return {
      tree: buildConceptTree(namespaced),
      byKey: new Map(namespaced.map((concept, index) => [concept.conceptId, concepts[index]!])),
    };
  }, [concepts]);

  /* Searching flattens. Filtering a tree in place means either hiding matches
     whose parents do not match, or keeping parents that do not — both make the
     result read as a tree that is lying about its shape, and neither is what
     somebody typing a name is asking for. */
  const matches = useMemo(
    () => (needle ? concepts.filter((concept) => concept.title.toLocaleLowerCase().includes(needle)) : []),
    [concepts, needle],
  );

  const toggle = (key: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const row = (concept: AtlasConcept, key: string, depth: number, expandable: boolean, open: boolean, count: number) => (
    <div
      className={cn(
        "group/row flex items-center rounded-md pr-1.5 transition-colors",
        key === selectedKey ? "bg-[var(--sidebar-accent-active)]" : "hover:bg-[var(--sidebar-accent)]",
      )}
      style={{ paddingLeft: `${depth * 0.6875 + 0.125}rem` }}
    >
      {expandable ? (
        <button
          aria-expanded={open}
          aria-label={open ? `Collapse ${concept.title}` : `Expand ${concept.title}`}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 hover:text-foreground"
          onClick={() => toggle(key)}
          type="button"
        >
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        </button>
      ) : (
        <span aria-hidden className="size-5 shrink-0" />
      )}

      <button className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => onSelect(concept)} title={concept.projectName} type="button">
        {/* The topic's own colour, the same one the atlas paints that concept
            with — so a dot in the list and a node in the map are recognisably
            the same thing. */}
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: conceptColor(topicOf(concept), concept.masteryLevel, dark) }} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-source-sm leading-[1.45]",
            key === selectedKey ? "font-medium text-foreground" : "text-foreground/75",
          )}
        >
          {concept.title}
        </span>
      </button>

      {expandable && !open && <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">{count}</span>}
    </div>
  );

  const rows = (nodes: ConceptTreeNode[]): React.ReactNode =>
    nodes.map((node) => {
      const key = node.concept.conceptId;
      const concept = byKey.get(key);
      if (!concept) return null;
      const open = !closed.has(key);
      const expandable = node.children.length > 0;
      return (
        <li key={key}>
          {row(concept, key, node.depth, expandable, open, node.total - 1)}
          {expandable && open && <ul>{rows(node.children)}</ul>}
        </li>
      );
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-2 mb-1 flex h-7 shrink-0 items-center gap-2 rounded-md bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] px-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-source-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search concepts"
          value={query}
        />
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {needle ? (
          matches.length === 0 ? (
            <p className="px-3 py-2 text-source-sm text-muted-foreground">Nothing matches “{query}”.</p>
          ) : (
            <ul className="px-1.5">
              {matches.map((concept) => {
                const key = `${concept.projectId}:${concept.conceptId}`;
                return <li key={key}>{row(concept, key, 0, false, false, 0)}</li>;
              })}
            </ul>
          )
        ) : (
          <ul className="px-1.5">{rows(tree)}</ul>
        )}
      </div>
    </div>
  );
}
