import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { EllipsisVertical, Orbit, Share2, Trash2 } from "lucide-react";
import type { AtlasConcept, ConstructApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { masteryTitle } from "@/lib/mastery";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { useDark } from "../../hooks/use-dark";
import { ConceptAtlas } from "../concepts/ConceptAtlas";
import { ConceptEntry } from "../concepts/ConceptEntry";
import { topicOf, type AtlasMode } from "../concepts/atlas";
import { conceptColor, topicColor } from "../concepts/palette";
import { EmptyState } from "../common/EmptyState";
import { PaneHandle } from "../workspace/PaneHandle";

/**
 * Everything the learner understands, as one page.
 *
 * Three blobs — an index of what has been learned, the entry itself, and the
 * atlas — and the order of them is the argument: you came here to *read*, so the
 * reading gets the middle and the most room. v0.7 had this shape and it was
 * right; a first cut of this page made the atlas the whole surface with the entry
 * as an overlay over it, which was a beautiful map of a library you could not sit
 * down in.
 *
 * The atlas stays because a list cannot answer the question the page is really
 * for — not "what have I covered" but "is any of it sinking in". How it answers
 * that is in `atlas.ts`.
 */
export function ConceptsPage({
  api,
  concepts,
  onChanged,
  onError,
  onSelect,
  selectedKey,
}: {
  api: ConstructApi | undefined;
  /** Null while the first read is in flight. Owned by the shell, because the
   *  sidebar lists these and this page reads them. */
  concepts: AtlasConcept[] | null;
  onChanged(): void;
  onError(message: string): void;
  onSelect(key: string | null): void;
  /** `projectId:conceptId`, since a concept id is only unique in its project. */
  selectedKey: string | null;
}) {
  const [pendingDelete, setPendingDelete] = useState<AtlasConcept | null>(null);
  /* The web leads. It is what v0.7 showed and what the page is first asked —
     what connects to what. Orbits are the second question, so the second view. */
  const [mode, setMode] = useState<AtlasMode>("web");
  const dark = useDark();

  const all = useMemo(() => concepts ?? [], [concepts]);
  const key = (concept: AtlasConcept) => `${concept.projectId}:${concept.conceptId}`;

  /* Opens on the most recently moved concept — the atlas read is ordered by
     that already. An empty reading pane on a page whose subject is reading is a
     page that asks you to work before it shows you anything. */
  useEffect(() => {
    if (all.length === 0) return;
    if (selectedKey && all.some((concept) => key(concept) === selectedKey)) return;
    onSelect(key(all[0]!));
  }, [all, onSelect, selectedKey]);

  /* Kept for the legend, which names the topics the map is painting. The index
     this used to feed now lives in the sidebar. */
  const groups = useMemo(() => group(all), [all]);
  const selected = all.find((concept) => key(concept) === selectedKey) ?? null;
  const siblings = selected
    ? all.filter((row) => key(row) !== key(selected) && topicOf(row) === topicOf(selected))
    : [];

  /* What the page can say about itself in one line. Task-ready is the one worth
     counting: it is the number that decides what Construct will set work on. */
  const totals = useMemo(() => {
    return {
      concepts: all.length,
      topics: new Set(all.map(topicOf)).size,
      ready: all.filter((concept) => concept.masteryLevel >= 3).length,
    };
  }, [all]);

  const forget = useCallback(
    async (concept: AtlasConcept) => {
      try {
        await api?.deleteConcept({ projectId: concept.projectId, conceptId: concept.conceptId });
        if (selectedKey === `${concept.projectId}:${concept.conceptId}`) onSelect(null);
        onChanged();
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Construct could not forget that concept.");
      }
    },
    [api, onChanged, onError, onSelect, selectedKey],
  );

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
    <div className="flex h-full min-h-0 flex-col">
      {/* One line of arithmetic about the learner, and no rule under it: the
          blobs below carry their own edges, so a border here would be a third
          horizontal line in forty pixels. */}
      <div className="flex h-9 shrink-0 items-center gap-4 px-4">
        <Total label={totals.concepts === 1 ? "concept" : "concepts"} value={totals.concepts} />
        <Total label={totals.topics === 1 ? "topic" : "topics"} value={totals.topics} />
        <Total label="task-ready" tone="var(--mastery-3)" value={totals.ready} />
        <p className="ml-auto min-w-0 truncate text-ui-sm text-muted-foreground/60">Everything Construct has taught you, in every project.</p>
      </div>

      {/* Resizable, and remembered: how much of this page is index, how much is
          reading and how much is atlas depends on what you came to do, and nobody
          wants to answer that twice.
          
          The index and the entry are plain columns on the pane's own surface,
          divided by a hairline. Only the atlas is a blob — and that asymmetry is
          the point rather than an oversight: a blob says "this is a thing sitting on the page", which is true of a turning three-dimensional map and false
          of a list and a page of prose. Carding those two up made the page look
          like three widgets that had been arranged rather than one document you
          read. */}
      <PanelGroup autoSaveId="construct.concepts" className="flex min-h-0 flex-1" direction="horizontal">
        {/* --- the entry --------------------------------------------------- */}
        {/* No hairline on this one: the atlas blob's own edge is already the
            boundary on that side, and a rule a few pixels from a ring reads as a
            mistake even to someone who could not say why. */}
        <Panel className="relative flex min-w-0 flex-col overflow-hidden" defaultSize={51} minSize={26} order={2}>
          {selected && (
            <ConceptMenu
              className="absolute top-2 right-3 z-10 opacity-60 hover:opacity-100 data-[state=open]:opacity-100"
              onDelete={() => setPendingDelete(selected)}
            />
          )}
          {/* The scroller is a child of the panel rather than the panel itself:
              a resizable panel owns its own overflow, so making it the scrolling
              box is how the entry ended up unscrollable however long it was. */}
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-7 py-5">
            {selected ? (
              <div className="mx-auto max-w-[46rem]">
                <ConceptEntry
                  api={api}
                  concept={selected}
                  onOpen={(concept) => onSelect(key(concept as AtlasConcept))}
                  projectId={selected.projectId}
                  siblings={siblings}
                  where={selected.projectName}
                />
              </div>
            ) : (
              <EmptyState className="mt-10" description="Pick one from the list, or from the atlas." icon={Orbit} title="Nothing open" />
            )}
          </div>
        </Panel>

        <PaneHandle />

        {/* --- the atlas --------------------------------------------------- */}
        <Panel className="flex min-w-0 flex-col p-1 pl-0" defaultSize={30} minSize={16} order={3}>
          <div className="app-blob flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center gap-1.5 px-2">
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
                concepts={all}
                mode={mode}
                onSelect={(concept) => onSelect(concept ? key(concept) : selectedKey)}
                selectedId={selected?.conceptId ?? null}
              />
            )}
          </div>

          {/* The legend, and it has two jobs because the map uses two channels:
              which hue is which topic, and what depth of that hue means. Both are
              learned once and then read for good, which is the only kind of
              legend worth the space it takes. */}
          <div className="shrink-0 px-3 pt-1 pb-2.5">
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
            {/* The ramp drawn in one topic's own hue rather than in six unrelated
                colours, because that is exactly what it does on the map. */}
            <span aria-hidden className="flex overflow-hidden rounded-full">
              {[0, 1, 2, 3, 4, 5].map((level) => (
                <span className="h-1.5 flex-1" key={level} style={{ background: conceptColor(groups[0]?.[0] ?? "Types", level, dark) }} />
              ))}
            </span>
            <div className="mt-1 flex justify-between text-ui-sm text-muted-foreground/60">
              <span>{masteryTitle(0)}</span>
              <span>{masteryTitle(5)}</span>
            </div>
          </div>
          </div>
        </Panel>
      </PanelGroup>

      <ForgetConceptDialog
        concept={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void forget(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

/** A number and what it counts, set so the number leads. */
function Total({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <p className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-content font-semibold tabular-nums text-foreground" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="text-ui-sm text-muted-foreground">{label}</span>
    </p>
  );
}

/** One concept's actions. A menu of one for now, and a menu rather than a bare
 *  delete button because a destructive action sitting a stray click away from a
 *  list row is how learners lose things. */
function ConceptMenu({ className, onDelete }: { className?: string; onDelete(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Concept actions"
        className={cn("grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground", className)}
      >
        <EllipsisVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <Trash2 />
          Forget this concept
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Confirming a deletion, because this one cannot be undone.
 *
 * Worth the extra click: the agent files concepts from the conversation, so the
 * wrong one is usually adjacent to the right one in the list, and the thing being
 * thrown away is a record of the learner's own progress.
 */
function ForgetConceptDialog({
  concept,
  onCancel,
  onConfirm,
}: {
  concept: AtlasConcept | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onCancel()} open={concept !== null}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Forget this concept?</DialogTitle>
          <DialogDescription>
            {concept ? `"${concept.title}" and its level history are removed from ${concept.projectName}.` : ""} Construct may record it
            again if it comes up in conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            Forget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    const topic = topicOf(concept);
    const shelf = shelves.get(topic) ?? [];
    shelf.push(concept);
    shelves.set(topic, shelf);
  }

  const reach = (members: AtlasConcept[]) => Math.max(...members.map((member) => member.masteryLevel));
  return [...shelves.entries()]
    .map(
      ([topic, members]) =>
        [topic, [...members].sort((a, b) => b.masteryLevel - a.masteryLevel || a.title.localeCompare(b.title))] as [string, AtlasConcept[]],
    )
    .sort((a, b) => reach(b[1]) - reach(a[1]) || a[0].localeCompare(b[0]));
}
