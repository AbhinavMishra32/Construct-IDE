import { ArrowRightIcon, BookOpenIcon, ChevronRightIcon, ExternalLinkIcon, GitBranchIcon, HistoryIcon, NetworkIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ShadcnScrollArea } from "@opaline/ui";
import type { GraphData } from "react-force-graph-3d";

import { MarkdownBlock } from "./MarkdownBlock";
import { readKnowledgeRecords, subscribeKnowledgeRecords, removeKnowledgeConcept, type SavedKnowledgeRecord } from "../lib/knowledgeStore";
import type { AnyProjectRecord, ConceptCard } from "../types";
import { isFlowProjectRecord } from "../types";
import { cn } from "../../lib/utils";

type ConceptScope = "current" | "all";
type ConceptView = "detail" | "graph";
type KnowledgeGraphNode = {
  id: string;
  label: string;
  color: string;
  group: string;
  recordKey: string;
  title: string;
  summary: string;
  val: number;
};
type KnowledgeGraphLink = {
  source: string;
  target: string;
  kind: "parent" | "related";
  label: string;
};

const ForceGraph3D = lazy(() => import("react-force-graph-3d"));

export function KnowledgeBaseSurface({
  activeProject,
  theme,
  onOpenProject
}: {
  activeProject?: AnyProjectRecord | null;
  theme: "light" | "dark" | "system";
  onOpenProject: (projectId: string) => void;
}) {
  const [records, setRecords] = useState<SavedKnowledgeRecord[]>(() => readKnowledgeRecords());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ConceptScope>(() => isFlowProjectRecord(activeProject) ? "current" : "all");
  const [view, setView] = useState<ConceptView>("detail");
  const [selectedKey, setSelectedKey] = useState<string | null>(() => records[0] ? recordKey(records[0]) : null);

  useEffect(() => subscribeKnowledgeRecords(() => setRecords(readKnowledgeRecords())), []);
  useEffect(() => {
    setScope(isFlowProjectRecord(activeProject) ? "current" : "all");
  }, [activeProject?.id, activeProject?.kind]);

  const canUseProjectScope = isFlowProjectRecord(activeProject);
  const currentProjectRecords = useMemo(() => {
    if (!canUseProjectScope) return [];
    return records.filter((record) => recordBelongsToProject(record, activeProject.id));
  }, [activeProject?.id, canUseProjectScope, records]);

  const scopedRecords = canUseProjectScope && scope === "current" ? currentProjectRecords : records;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return scopedRecords;
    return scopedRecords.filter((record) => [
      record.id,
      record.title,
      record.summary,
      record.content,
      record.kind,
      record.language,
      record.technology,
      record.confidence,
      record.confidenceReason,
      record.lastChangeReason,
      (record.tags ?? []).join(" "),
      record.sourceProjectTitle
    ].filter(Boolean).join(" ").toLowerCase().includes(normalized));
  }, [query, scopedRecords]);

  useEffect(() => {
    if (!filtered.length) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    if (!selectedKey || !filtered.some((record) => recordKey(record) === selectedKey)) {
      setSelectedKey(recordKey(filtered[0]));
    }
  }, [filtered, selectedKey]);

  const selected = filtered.find((record) => recordKey(record) === selectedKey) ?? filtered[0] ?? null;
  const activeProjectTitle = isFlowProjectRecord(activeProject) ? activeProject.title : null;
  const scopeDescription = canUseProjectScope && scope === "current"
    ? `Concepts learned in ${activeProjectTitle ?? "this Flow project"}.`
    : "Every concept Construct has learned across projects.";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {canUseProjectScope && scope === "current" ? "Flow concept memory" : "Knowledge base"}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Concepts</h1>
          <p className="mt-1 max-w-2xl truncate text-sm text-muted-foreground">{scopeDescription}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border bg-muted/30 px-2.5 py-1">{records.length} total</span>
          {canUseProjectScope ? <span className="rounded-full border bg-muted/30 px-2.5 py-1">{currentProjectRecords.length} current</span> : null}
          <Button
            size="sm"
            variant={view === "graph" ? "default" : "outline"}
            className="gap-1.5"
            disabled={!scopedRecords.length}
            onClick={() => setView((current) => current === "graph" ? "detail" : "graph")}
          >
            <NetworkIcon size={14} />
            {view === "graph" ? "Concept details" : "Knowledge web"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/10">
          <div className="flex shrink-0 flex-col gap-3 border-b p-3">
            <div className="flex h-9 items-center gap-2 rounded-[8px] border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
              <SearchIcon size={15} />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search concepts..."
              />
            </div>
            {canUseProjectScope ? (
              <div className="grid grid-cols-2 gap-1 rounded-[8px] border bg-background p-1">
                <ScopeButton active={scope === "current"} onClick={() => setScope("current")}>
                  Current project
                </ScopeButton>
                <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>
                  All concepts
                </ScopeButton>
              </div>
            ) : null}
          </div>
          <ShadcnScrollArea className="min-h-0 flex-1">
            {filtered.length ? (
              <nav className="flex flex-col gap-2 p-3" aria-label="Concept cards">
                {filtered.map((record) => (
                  <ConceptListCard
                    key={recordKey(record)}
                    activeProjectId={canUseProjectScope ? activeProject.id : undefined}
                    record={record}
                    selectedKey={selected ? recordKey(selected) : null}
                    onSelect={() => setSelectedKey(recordKey(record))}
                  />
                ))}
              </nav>
            ) : (
              <div className="flex h-full min-h-[18rem] flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
                <BookOpenIcon size={28} />
                <p className="mt-3 font-medium text-foreground">
                  {canUseProjectScope && scope === "current" ? "No concepts in this project yet" : "No concepts yet"}
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {canUseProjectScope && scope === "current"
                    ? "Flow will list concepts here as this project introduces, practices, and reviews them."
                    : "Construct will add concepts here as projects introduce, modify, and review them."}
                </p>
              </div>
            )}
          </ShadcnScrollArea>
        </aside>

        <main className="min-h-0">
          {view === "graph" ? (
            <KnowledgeGraphPanel
              records={scopedRecords}
              selectedKey={selected ? recordKey(selected) : null}
              onSelectRecord={(record) => setSelectedKey(recordKey(record))}
            />
          ) : selected ? (
            <ConceptDetail
              record={selected}
              records={records}
              theme={theme}
              onOpenProject={onOpenProject}
              onSelectRecord={(record) => setSelectedKey(recordKey(record))}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ScopeButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-8 rounded-[7px] px-2.5 text-xs font-medium transition-none",
        active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ConceptListCard({
  record,
  selectedKey,
  activeProjectId,
  onSelect
}: {
  record: SavedKnowledgeRecord;
  selectedKey: string | null;
  activeProjectId?: string;
  onSelect: () => void;
}) {
  const relation = activeProjectId ? projectRelationForRecord(record, activeProjectId) : null;
  const active = recordKey(record) === selectedKey;
  const relationLabel = relation
    ? `${relation.lastEventKind} · L${relation.masteryLevel}`
    : record.sourceProjectTitle;
  const updatedAt = relation?.lastReferencedAt ?? record.lastModifiedAt ?? record.savedAt;

  return (
    <button
      type="button"
      className={cn(
        "group rounded-[8px] border bg-background/70 p-3 text-left transition-none hover:border-foreground/20 hover:bg-muted/45",
        active && "border-foreground/25 bg-muted shadow-sm"
      )}
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{record.title}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{record.summary || record.content || "No summary recorded yet."}</span>
        </span>
        <ChevronRightIcon size={15} className="mt-0.5 shrink-0 text-muted-foreground transition-none group-hover:text-foreground" />
      </span>
      <span className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">{relationLabel}</span>
        {record.confidence ? <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">{confidenceLabel(record.confidence)}</span> : null}
        {record.relatedConcepts?.length ? <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">{record.relatedConcepts.length} linked</span> : null}
        <span className="ml-auto truncate">{formatDate(updatedAt)}</span>
      </span>
    </button>
  );
}

function KnowledgeGraphPanel({
  records,
  selectedKey,
  onSelectRecord
}: {
  records: SavedKnowledgeRecord[];
  selectedKey: string | null;
  onSelectRecord: (record: SavedKnowledgeRecord) => void;
}) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const graphData = useMemo(() => buildKnowledgeGraph(records, selectedKey), [records, selectedKey]);
  const recordByKey = useMemo(() => new Map(records.map((record) => [recordKey(record), record])), [records]);

  if (!records.length) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 text-center text-sm text-muted-foreground">
        <NetworkIcon size={30} />
        <p className="mt-3 font-medium text-foreground">No graph yet</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed">Concept connections appear after this scope has saved concepts with parents or related links.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full min-h-0 overflow-hidden bg-background">
      {size.width > 0 && size.height > 0 ? (
        <Suspense fallback={<GraphLoadingState />}>
          <ForceGraph3D
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            nodeId="id"
            nodeLabel="label"
            nodeColor="color"
            nodeVal="val"
            nodeResolution={12}
            linkSource="source"
            linkTarget="target"
            linkLabel="label"
            linkColor={(link) => link.kind === "parent" ? "rgba(125, 211, 252, 0.62)" : "rgba(196, 181, 253, 0.52)"}
            linkOpacity={0.55}
            linkWidth={(link) => link.kind === "parent" ? 1.4 : 0.8}
            linkDirectionalParticles={(link) => link.kind === "parent" ? 1 : 0}
            linkDirectionalParticleWidth={1.2}
            cooldownTicks={80}
            warmupTicks={40}
            enableNodeDrag
            enableNavigationControls
            onNodeClick={(node) => {
              const key = typeof node.recordKey === "string" ? node.recordKey : null;
              const record = key ? recordByKey.get(key) : undefined;
              if (record) onSelectRecord(record);
            }}
          />
        </Suspense>
      ) : <GraphLoadingState />}

      <div className="pointer-events-none absolute left-4 top-4 max-w-[22rem] rounded-[8px] border bg-background/88 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <NetworkIcon size={15} />
          Knowledge web
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">{graphData.nodes.length} concepts</span>
          <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">{graphData.links.length} links</span>
          {selectedKey ? <span className="rounded-full border bg-muted/30 px-1.5 py-0.5">selected</span> : null}
        </div>
      </div>
    </div>
  );
}

function GraphLoadingState() {
  return (
    <div className="flex h-full min-h-[20rem] items-center justify-center text-xs text-muted-foreground">
      Loading knowledge web...
    </div>
  );
}

function ConceptDetail({
  record,
  records,
  theme,
  onOpenProject,
  onSelectRecord
}: {
  record: SavedKnowledgeRecord;
  records: SavedKnowledgeRecord[];
  theme: "light" | "dark" | "system";
  onOpenProject: (projectId: string) => void;
  onSelectRecord: (record: SavedKnowledgeRecord) => void;
}) {
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const relatedRecords = (record.relatedConcepts ?? [])
    .map((id) => records.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is SavedKnowledgeRecord => Boolean(candidate));
  const history = record.history?.length ? record.history : fallbackHistory(record);
  const orderedHistory = useMemo(() => history.slice().reverse(), [history]);
  const selectedHistory = orderedHistory.find((event) => event.id === selectedHistoryId) ?? orderedHistory[0] ?? null;
  const content = record.content || record.summary;

  useEffect(() => {
    setSelectedHistoryId(null);
  }, [record.id, record.sourceProjectId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-5 py-4">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded-full border bg-muted/30 px-2 py-0.5">{record.language ?? "concept"}</span>
          {record.technology ? <span className="rounded-full border bg-muted/30 px-2 py-0.5">{record.technology}</span> : null}
          {record.confidence ? <span className="rounded-full border bg-muted/30 px-2 py-0.5">{confidenceLabel(record.confidence)}</span> : null}
          {record.authoredBy ? <span className="rounded-full border bg-muted/30 px-2 py-0.5">authored by {record.authoredBy}</span> : null}
        </div>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">{record.title}</h2>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{record.id}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenProject(record.sourceProjectId)}>
              Open project
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
              onClick={() => {
                if (window.confirm(`Delete concept "${record.title}"? This cannot be undone.`)) {
                  removeKnowledgeConcept(record.sourceProjectId, record.id);
                }
              }}
            >
              <Trash2Icon size={14} className="mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <ShadcnScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <ConceptStat label="Source" value={record.sourceProjectTitle} />
            <ConceptStat label="Saved" value={formatDate(record.savedAt)} />
            <ConceptStat label="Updated" value={formatDate(record.lastModifiedAt ?? record.savedAt)} />
            <ConceptStat label="Opened" value={`${record.openCount} times`} />
          </div>

          <ConceptSection title="Summary">
            <MarkdownBlock content={record.summary || "No summary recorded yet."} theme={theme} sources={record.sources} />
          </ConceptSection>

          <ConceptSection title="Project relations">
            <div className="grid gap-2 md:grid-cols-2">
              {(record.projects?.length ? record.projects : [{
                projectId: record.sourceProjectId,
                projectTitle: record.sourceProjectTitle,
                conceptId: record.id,
                introducedAt: record.savedAt,
                firstReferencedAt: record.savedAt,
                lastReferencedAt: record.lastModifiedAt ?? record.savedAt,
                masteryLevel: record.masteryLevel ?? 0,
                lastEventKind: "introduced" as const,
                eventIds: []
              }]).map((relation) => (
                <button
                  key={`${relation.projectId}:${relation.conceptId}`}
                  type="button"
                  className="rounded-[8px] border bg-muted/15 p-3 text-left hover:bg-muted"
                  onClick={() => onOpenProject(relation.projectId)}
                >
                  <span className="block truncate text-sm font-medium">{relation.projectTitle}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {relation.lastEventKind} · L{relation.masteryLevel} · {formatDate(relation.lastReferencedAt)}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {projectEventSummary(record, relation.projectId)}
                  </span>
                </button>
              ))}
            </div>
          </ConceptSection>

          {content && content !== record.summary ? (
            <ConceptSection title="Concept text">
              <MarkdownBlock content={content} theme={theme} sources={record.sources} />
            </ConceptSection>
          ) : null}

          {record.why ? (
            <ConceptSection title="Why it matters">
              <MarkdownBlock content={record.why} theme={theme} sources={record.sources} />
            </ConceptSection>
          ) : null}

          {(record.lastChangeReason || record.confidenceReason || record.learnerEvidence?.length) ? (
            <ConceptSection title="Evidence and why">
              <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
                {record.lastChangeReason ? <p><strong className="text-foreground">Why updated:</strong> {record.lastChangeReason}</p> : null}
                {record.confidenceReason ? <p><strong className="text-foreground">Learning state:</strong> {record.confidenceReason}</p> : null}
                {record.learnerEvidence?.length ? (
                  <ul className="flex flex-col gap-1 text-xs">
                    {record.learnerEvidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
                  </ul>
                ) : null}
              </div>
            </ConceptSection>
          ) : null}

          {record.example || record.examples?.length ? (
            <ConceptSection title="Examples">
              <div className="flex flex-col gap-3">
                {(record.examples?.length ? record.examples : [record.example]).filter(Boolean).map((example, index) => (
                  <MarkdownBlock key={`${index}:${example}`} content={`\`\`\`${exampleLanguage(record)}\n${example}\n\`\`\``} theme={theme} />
                ))}
              </div>
            </ConceptSection>
          ) : null}

          {relatedRecords.length ? (
            <ConceptSection title="Related concepts">
              <div className="grid grid-cols-2 gap-2">
                {relatedRecords.map((related) => (
                  <button key={recordKey(related)} type="button" className="flex min-w-0 items-center gap-2 rounded-[8px] border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onSelectRecord(related)}>
                    <GitBranchIcon size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{related.title}</span>
                    <ChevronRightIcon size={14} className="shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </ConceptSection>
          ) : null}

          <ConceptSection title="History">
            <div className="grid gap-4 md:grid-cols-[13rem_1fr] lg:grid-cols-[14rem_1fr]">
              <div className="flex flex-col gap-1.5">
                {orderedHistory.map((event) => {
                  const active = selectedHistory?.id === event.id;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`flex min-w-0 items-start gap-3 rounded-[8px] border px-3 py-2 text-left text-sm hover:bg-muted ${active ? "border-foreground/25 bg-muted" : "bg-muted/10"}`}
                      onClick={() => setSelectedHistoryId(event.id)}
                    >
                      <HistoryIcon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <strong className="capitalize">{event.kind}</strong>
                          {event.changedFields?.length ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.changedFields.length} fields</span> : null}
                        </span>
                        <time className="mt-1 block text-xs text-muted-foreground">{formatDate(event.createdAt)}</time>
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedHistory ? <HistoryEventDetails event={selectedHistory} /> : null}
            </div>
          </ConceptSection>

          {record.docs.length ? (
            <ConceptSection title="Docs">
              <div className="flex flex-wrap gap-2">
                {record.docs.map((link) => (
                  <a key={link.url} className="inline-flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" href={link.url} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon size={14} />
                    {link.title}
                  </a>
                ))}
              </div>
            </ConceptSection>
          ) : null}

          {record.sources?.length ? (
            <ConceptSection title="Sources">
              <div className="grid gap-2 md:grid-cols-2">
                {record.sources.map((source) => (
                  <a key={`${source.id}:${source.url}`} className="rounded-[8px] border bg-muted/15 p-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" href={source.url} target="_blank" rel="noreferrer">
                    <span className="flex min-w-0 items-center gap-2">
                      <ExternalLinkIcon size={14} className="shrink-0" />
                      <strong className="truncate text-foreground">{source.title}</strong>
                    </span>
                    {(source.quote || source.snippet) ? <span className="mt-2 block text-xs leading-relaxed">{source.quote || source.snippet}</span> : null}
                  </a>
                ))}
              </div>
            </ConceptSection>
          ) : null}
        </div>
      </ShadcnScrollArea>
    </div>
  );
}

function ConceptSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ConceptStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[8px] border bg-muted/20 px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <strong className="mt-1 block truncate font-medium">{value}</strong>
    </div>
  );
}

function projectEventSummary(record: SavedKnowledgeRecord, projectId: string): string {
  const events = (record.projectEvents ?? []).filter((event) => event.projectId === projectId);
  if (!events.length) return "Introduced from legacy concept history";
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => `${kind} ${count}`).join(" · ");
}

function HistoryEventDetails({ event }: { event: NonNullable<ConceptCard["history"]>[number] }) {
  return (
    <div className="min-w-0 rounded-[8px] border bg-muted/10 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <strong className="capitalize">{event.kind}</strong>
        {event.confidence ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{confidenceLabel(event.confidence)}</span> : null}
        {event.authoredBy ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.authoredBy}</span> : null}
      </div>
      {event.reason ? <p className="mt-2 leading-relaxed text-muted-foreground"><strong className="text-foreground">Why:</strong> {event.reason}</p> : null}
      {event.confidenceReason ? <p className="mt-2 leading-relaxed text-muted-foreground"><strong className="text-foreground">Learning state:</strong> {event.confidenceReason}</p> : null}
      {event.provenance ? (
        <div className="mt-3 rounded-[8px] border bg-background/60 p-3 text-xs text-muted-foreground">
          <p><strong className="text-foreground">Project:</strong> {event.provenance.projectTitle}</p>
          {event.provenance.pathNodeTitle || event.provenance.pathNodeId ? <p className="mt-1"><strong className="text-foreground">Path:</strong> {event.provenance.pathNodeTitle ?? event.provenance.pathNodeId}</p> : null}
          {event.provenance.taskTitle || event.provenance.taskId ? <p className="mt-1"><strong className="text-foreground">Task:</strong> {event.provenance.taskTitle ?? event.provenance.taskId}</p> : null}
          {event.provenance.focusPath ? <p className="mt-1"><strong className="text-foreground">Focus:</strong> <code>{event.provenance.focusPath}</code></p> : null}
          {event.provenance.taskFiles?.length ? <p className="mt-1"><strong className="text-foreground">Files:</strong> {event.provenance.taskFiles.join(", ")}</p> : null}
        </div>
      ) : null}
      {event.fieldChanges?.length ? (
        <div className="mt-3 divide-y divide-border/60">
          {event.fieldChanges.map((change) => (
            <div key={`${event.id}:${change.field}`} className="py-3 first:pt-0 last:pb-0">
              <HistoryFieldChange change={change} />
            </div>
          ))}
        </div>
      ) : event.changedFields?.length ? (
        <p className="mt-3 text-xs text-muted-foreground"><strong className="text-foreground">Changed fields:</strong> {event.changedFields.map(fieldLabel).join(", ")}</p>
      ) : null}
      {event.evidence.length ? (
        <div className="mt-4 border-t pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Evidence</p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground/90">
            {event.evidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function HistoryFieldChange({ change }: { change: NonNullable<NonNullable<ConceptCard["history"]>[number]["fieldChanges"]>[number] }) {
  if (change.field === "masteryLevel") {
    return <HistoryMasteryChange before={change.before} after={change.after} />;
  }
  if (isConceptTextField(change.field)) {
    return <HistoryTextChange field={change.field} before={change.before} after={change.after} />;
  }
  return (
    <div>
      <div className="font-semibold text-foreground/90 mb-1.5 text-xs">{fieldLabel(change.field)}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <AuditValue label="Before" value={change.before} muted />
        <AuditValue label="After" value={change.after} />
      </div>
    </div>
  );
}

function HistoryMasteryChange({ before, after }: { before?: string; after?: string }) {
  return (
    <div className="rounded-[8px] bg-[color:var(--construct-success-soft)]/15 px-3 py-2.5 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-[color:var(--construct-success)]">
        <SparklesIcon size={12} />
        <span>Mastery Level Shifted</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <AuditValue label="Before" value={before} muted />
        <ArrowRightIcon size={12} className="text-muted-foreground/40 mt-4" />
        <AuditValue label="After" value={after} />
      </div>
    </div>
  );
}

function HistoryTextChange({ field, before, after }: { field: string; before?: string; after?: string }) {
  const beforeText = compactAuditText(before);
  const afterText = compactAuditText(after);
  const mode = beforeText && afterText ? "Replaced" : afterText ? "Added" : "Removed";
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="font-semibold text-foreground/90">{fieldLabel(field)}</div>
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border",
          mode === "Added" && "bg-[color:var(--construct-success-soft)]/20 border-[color:var(--construct-success)]/30 text-[color:var(--construct-success)]",
          mode === "Removed" && "bg-destructive/10 border-destructive/20 text-destructive",
          mode === "Replaced" && "bg-amber-500/10 border-amber-500/20 text-amber-500"
        )}>
          {mode}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {beforeText ? (
          <div className="rounded-[6px] bg-destructive/5 px-2 py-1.5 text-muted-foreground/80 line-through decoration-destructive/40 font-mono text-[10.5px] leading-relaxed">
            {beforeText}
          </div>
        ) : null}
        {afterText ? (
          <div className="rounded-[6px] bg-[color:var(--construct-success-soft)]/10 px-2 py-1.5 text-foreground/90 font-mono text-[10.5px] leading-relaxed">
            {afterText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AuditValue({ label, value, muted }: { label: string; value?: string; muted?: boolean }) {
  return (
    <div className="min-w-0 text-xs">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <div className={cn("mt-1 font-medium leading-relaxed", muted ? "text-muted-foreground/80 line-through" : "text-foreground/90")}>
        {compactAuditText(value) || "not set"}
      </div>
    </div>
  );
}

function isConceptTextField(field: string): boolean {
  return ["title", "summary", "content", "why", "commonMistake", "example", "examples", "masteryText", "masteryReason", "confidenceReason"].includes(field);
}

function compactAuditText(value?: string): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 208).trim()}...`;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      const height = Math.max(1, Math.floor(entry.contentRect.height));
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function buildKnowledgeGraph(records: SavedKnowledgeRecord[], selectedKey: string | null): GraphData<KnowledgeGraphNode, KnowledgeGraphLink> {
  const nodes: KnowledgeGraphNode[] = [];
  const links: KnowledgeGraphLink[] = [];
  const conceptIdToNodeId = new Map<string, string>();
  const linkIds = new Set<string>();

  for (const record of records) {
    const nodeId = recordKey(record);
    conceptIdToNodeId.set(record.id, nodeId);
    const group = record.technology ?? record.language ?? record.kind ?? "concept";
    nodes.push({
      id: nodeId,
      label: `${record.title}\n${record.summary || record.sourceProjectTitle}`,
      color: selectedKey === nodeId ? "#f8fafc" : colorForGraphGroup(group),
      group,
      recordKey: nodeId,
      title: record.title,
      summary: record.summary,
      val: selectedKey === nodeId ? 7 : Math.max(3, Math.min(8, (record.relatedConcepts?.length ?? 0) + 3))
    });
  }

  for (const record of records) {
    const source = recordKey(record);
    if (record.parentId) {
      addKnowledgeGraphLink({
        links,
        linkIds,
        source: conceptIdToNodeId.get(record.parentId),
        target: source,
        kind: "parent",
        label: "parent"
      });
    }
    for (const relatedId of record.relatedConcepts ?? []) {
      addKnowledgeGraphLink({
        links,
        linkIds,
        source,
        target: conceptIdToNodeId.get(relatedId),
        kind: "related",
        label: "related"
      });
    }
  }

  return { nodes, links };
}

function addKnowledgeGraphLink({
  links,
  linkIds,
  source,
  target,
  kind,
  label
}: {
  links: KnowledgeGraphLink[];
  linkIds: Set<string>;
  source?: string;
  target?: string;
  kind: KnowledgeGraphLink["kind"];
  label: string;
}) {
  if (!source || !target || source === target) return;
  const id = `${source}->${target}:${kind}`;
  if (linkIds.has(id)) return;
  linkIds.add(id);
  links.push({ source, target, kind, label });
}

function colorForGraphGroup(group: string): string {
  const colors = ["#38bdf8", "#a78bfa", "#34d399", "#f59e0b", "#f472b6", "#fb7185", "#22c55e", "#60a5fa"];
  let hash = 0;
  for (let index = 0; index < group.length; index += 1) {
    hash = (hash * 31 + group.charCodeAt(index)) >>> 0;
  }
  return colors[hash % colors.length];
}

function recordKey(record: SavedKnowledgeRecord): string {
  return `${record.sourceProjectId}:${record.id}`;
}

function recordBelongsToProject(record: SavedKnowledgeRecord, projectId: string): boolean {
  return record.sourceProjectId === projectId
    || record.projects?.some((relation) => relation.projectId === projectId) === true
    || record.projectEvents?.some((event) => event.projectId === projectId) === true;
}

function projectRelationForRecord(record: SavedKnowledgeRecord, projectId: string): NonNullable<SavedKnowledgeRecord["projects"]>[number] | null {
  const relation = record.projects?.find((candidate) => candidate.projectId === projectId);
  if (relation) return relation;
  if (record.sourceProjectId !== projectId) return null;
  return {
    projectId,
    projectTitle: record.sourceProjectTitle,
    conceptId: record.id,
    introducedAt: record.savedAt,
    firstReferencedAt: record.savedAt,
    lastReferencedAt: record.lastModifiedAt ?? record.savedAt,
    masteryLevel: record.masteryLevel ?? 0,
    lastEventKind: "introduced",
    eventIds: []
  };
}

function fallbackHistory(record: SavedKnowledgeRecord): NonNullable<ConceptCard["history"]> {
  return [{
    id: `${recordKey(record)}:latest`,
    kind: record.savedAt === record.lastModifiedAt ? "introduced" : "modified",
    reason: record.lastChangeReason ?? "Concept record saved.",
    evidence: record.learnerEvidence ?? [],
    changedFields: [],
    fieldChanges: [],
    provenance: {
      projectId: record.sourceProjectId,
      projectTitle: record.sourceProjectTitle
    },
    confidence: record.confidence,
    confidenceReason: record.confidenceReason,
    authoredBy: record.authoredBy,
    agentContributionPercent: record.agentContributionPercent,
    createdAt: record.lastModifiedAt ?? record.savedAt
  }];
}

function confidenceLabel(value: string): string {
  return value.replace(/-/g, " ");
}

function fieldLabel(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function exampleLanguage(record: SavedKnowledgeRecord): string {
  if (record.language === "swift") return "swift";
  if (record.language === "python") return "python";
  if (record.language === "javascript") return "javascript";
  if (record.language === "cpp") return "cpp";
  return "ts";
}
