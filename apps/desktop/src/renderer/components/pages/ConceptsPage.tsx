import { useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { ChevronRight, Orbit, Search, Share2, X } from "lucide-react";
import type { AtlasConcept, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { masteryTitle } from "@/lib/mastery";
import { useDark } from "../../hooks/use-dark";
import { conceptColor, topicColor } from "../concepts/palette";
import { ConceptAtlas } from "../concepts/ConceptAtlas";
import { topicOf, type AtlasMode } from "../concepts/atlas";
import { Segmented } from "@/components/ui/segmented";
import { PaneHandle } from "../workspace/PaneHandle";
import { ConceptEntry } from "../concepts/ConceptEntry";
import { EmptyState } from "../common/EmptyState";

/**
 * Everything the learner understands, as one page.
 *
 * Three columns, and the order of them is the argument: an index of what has
 * been learned, the entry itself, and the atlas beside it. v0.7 had exactly this
 * shape and it was right — the thing you came here to do is *read*, so the
 * reading gets the middle and the most room. A first cut of this page made the
 * atlas the whole surface with the entry as an overlay over it, which inverted
 * that: a beautiful map of a library you could not sit down in.
 *
 * The atlas stays because a list cannot answer the question the page is really
 * for — not "what have I covered" but "is any of it sinking in" — and it answers
 * it by spending its one interesting dimension on the one fact worth spending it
 * on: **distance from the core is mastery**. Concepts the learner can use orbit
 * close in; concepts they have merely been shown sit out at the rim. v0.7's graph
 * was force-directed, so a node's position was wherever the physics settled and
 * meant nothing at all.
 */
export function ConceptsPage({ api, onError }: { api: ConstructApi | undefined; onError(message: string): void }) {
  const [concepts, setConcepts] = useState<AtlasConcept[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /* The web leads. It is what v0.7 showed and what the page is first asked —
     what connects to what. Orbits are the second question, so they are the
     second view. */
  const [mode, setMode] = useState<AtlasMode>("web");
  const dark = useDark();

  useEffect(() => {
    if (!api) return;
    void api
      .conceptAtlas()
      .then((rows) => {
        setConcepts(rows);
        /* Opens on the most recently moved concept. The atlas read is ordered by
           that already, and an empty reading pane on a page whose subject is
           reading is a page that asks you to work before it shows you anything. */
        setSelectedId((current) => current ?? rows[0]?.conceptId ?? null);
      })
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : "Construct could not read your concepts.");
        setConcepts([]);
      });
  }, [api, onError]);

  const matched = useMemo(() => {
    const all = concepts ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((concept) =>
      [concept.title, concept.summary, concept.projectName, concept.tags.join(" ")].join(" ").toLowerCase().includes(needle),
    );
  }, [concepts, query]);

  const groups = useMemo(() => group(matched), [matched]);
  const selected = matched.find((concept) => concept.conceptId === selectedId) ?? null;

  if (concepts !== null && concepts.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          description="Construct records what you understand as it teaches you. Open a project and start a conversation — the atlas fills itself in."
          icon={Orbit}
          title="Nothing charted yet"
        />
      </div>
    );
  }

  return (
    /* Resizable, and remembered: how much of this page is index, how much is
       reading and how much is atlas is a matter of what you came to do, and
       nobody wants to answer that twice. */
    <PanelGroup autoSaveId="construct.concepts" className="flex h-full min-h-0" direction="horizontal">
      {/* --- the index ------------------------------------------------------
          Grouped by topic rather than listed flat, because a flat list of forty
          sentences is a wall. The group is the concept's own first tag: the
          agent files them, so the shelves are the ones it built. */}
      <Panel className="flex min-w-0 flex-col" defaultSize={19} maxSize={34} minSize={12} order={1}>
        <div className="hairline-b flex h-10 shrink-0 items-center gap-2 px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-source text-foreground outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            value={query}
          />
          {query && (
            <button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")} type="button">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto py-1.5">
          {groups.map(([topic, members]) => {
            const shut = collapsed.has(topic);
            return (
              <section key={topic}>
                <button
                  className="flex h-7 w-full items-center gap-1 px-2 text-left text-source-sm text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(topic)) next.delete(topic);
                      else next.add(topic);
                      return next;
                    })
                  }
                  type="button"
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !shut && "rotate-90")} />
                  <span className="min-w-0 flex-1 truncate font-medium">{topic}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground/60">{members.length}</span>
                </button>

                {!shut && (
                  <ul className="px-1.5 pb-1">
                    {members.map((concept) => (
                      <li key={`${concept.projectId}:${concept.conceptId}`}>
                        <button
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md py-1 pr-2 pl-3 text-left outline-none",
                            "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                            concept.conceptId === selectedId ? "bg-sidebar-accent-active" : "hover:bg-sidebar-accent",
                          )}
                          onClick={() => setSelectedId(concept.conceptId)}
                          type="button"
                        >
                          {/* The same dot the atlas draws, in the same colour:
                              its topic's hue at the depth its level earns. The
                              list and the map are one thing seen twice, and the
                              colour is what says so. */}
                          <span
                            aria-hidden
                            className="mt-[7px] size-2 shrink-0 rounded-full"
                            style={{ background: conceptColor(topic, concept.masteryLevel, dark) }}
                            title={masteryTitle(concept.masteryLevel)}
                          />
                          <span className="min-w-0 flex-1 truncate text-source leading-[1.35] text-foreground">{concept.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {groups.length === 0 && <p className="px-3 py-2 text-source-sm text-muted-foreground">Nothing matches that.</p>}
        </div>
      </Panel>

      <PaneHandle />

      {/* --- the entry ------------------------------------------------------
          The middle and the most room, because reading is what the page is for. */}
      <Panel className="app-scroll min-h-0 min-w-0 overflow-y-auto px-7 py-5" defaultSize={51} minSize={26} order={2}>
        {selected ? (
          <div className="mx-auto max-w-[46rem]">
            <ConceptEntry api={api} concept={selected} where={selected.projectName} />
          </div>
        ) : (
          <EmptyState className="mt-10" description="Pick one from the list, or from the atlas." icon={Orbit} title="Nothing open" />
        )}
      </Panel>

      <PaneHandle />

      {/* --- the atlas ------------------------------------------------------ */}
      <Panel
        className="flex min-w-0 flex-col bg-[color-mix(in_oklab,var(--foreground)_2.5%,transparent)]"
        defaultSize={30}
        minSize={16}
        order={3}
      >
        <div className="hairline-b flex h-10 shrink-0 items-center gap-1.5 px-2">
          <span className="px-1 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">Atlas</span>
          <Segmented<AtlasMode>
            ariaLabel="How to arrange the atlas"
            className="ml-auto"
            onChange={setMode}
            options={[
              { value: "web", label: "Web", icon: Share2 },
              { value: "solar", label: "Orbits", icon: Orbit },
            ]}
            value={mode}
          />
        </div>

        <div className="min-h-0 flex-1">
          {concepts && (
            <ConceptAtlas
              concepts={matched}
              mode={mode}
              onSelect={(concept) => setSelectedId(concept?.conceptId ?? selectedId)}
              selectedId={selectedId}
            />
          )}
        </div>

        {/* The legend, and it has two jobs because the map uses two channels:
            which hue is which topic, and what depth of that hue means. Both are
            things you learn once and then read for good, which is the only kind
            of legend worth the space it takes. */}
        <div className="hairline-t shrink-0 px-3 py-2.5">
          <p className="mb-1.5 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">Hue is the topic</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {groups.slice(0, 8).map(([topic, members]) => (
              <li className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground" key={topic}>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: topicColor(topic, Math.max(...members.map((member) => member.masteryLevel)), dark) }}
                />
                <span className="min-w-0 truncate">{topic}</span>
              </li>
            ))}
            {groups.length > 8 && <li className="text-ui-sm text-muted-foreground/60">+{groups.length - 8} more</li>}
          </ul>

          <p className="mt-2.5 mb-1 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">
            {dark ? "Brighter is further along" : "Deeper is further along"}
          </p>
          <div className="flex items-center gap-1.5">
            {/* The ramp drawn in one topic's own hue rather than in six unrelated
                colours, because that is exactly what it does on the map. */}
            <span aria-hidden className="flex flex-1 overflow-hidden rounded-full">
              {[0, 1, 2, 3, 4, 5].map((level) => (
                <span
                  className="h-1.5 flex-1"
                  key={level}
                  style={{ background: conceptColor(groups[0]?.[0] ?? "Types", level, dark) }}
                />
              ))}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-ui-sm text-muted-foreground/60">
            <span>{masteryTitle(0)}</span>
            <span>{masteryTitle(5)}</span>
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}

/**
 * Shelves the concepts by topic — the same rule the galaxy uses for its systems,
 * imported rather than restated, because a list and a map that disagree about
 * what belongs together are two answers to one question.
 *
 * Shelves are ordered by what is furthest along inside them, so the topics the
 * learner has actually got somewhere with lead — the same ordering the galaxy
 * draws as distance from its core.
 */
function group(concepts: AtlasConcept[]): Array<[string, AtlasConcept[]]> {
  const shelves = new Map<string, AtlasConcept[]>();
  for (const concept of concepts) {
    const shelf = shelves.get(topicOf(concept)) ?? [];
    shelf.push(concept);
    shelves.set(topicOf(concept), shelf);
  }

  const reach = (members: AtlasConcept[]) => Math.max(...members.map((member) => member.masteryLevel));
  return [...shelves.entries()]
    .map(([topic, members]) => [topic, [...members].sort((a, b) => b.masteryLevel - a.masteryLevel || a.title.localeCompare(b.title))] as [string, AtlasConcept[]])
    .sort((a, b) => reach(b[1]) - reach(a[1]) || a[0].localeCompare(b[0]));
}
