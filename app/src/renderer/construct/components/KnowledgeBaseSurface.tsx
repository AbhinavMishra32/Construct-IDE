import { BookOpenIcon, ChevronRightIcon, ExternalLinkIcon, GitBranchIcon, HistoryIcon, NetworkIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ShadcnScrollArea } from "@opaline/ui";
import type { ForceGraphMethods, GraphData, NodeObject } from "react-force-graph-3d";

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
type KnowledgeGraphRuntimeNode = NodeObject<KnowledgeGraphNode>;
type GraphCameraOrbitState = {
  startedAt: number;
  initialAngle: number;
  direction: 1 | -1;
  radius: number;
  yOffset: number;
  yAmplitude: number;
};
type ConceptTreeRecordNode = {
  id: string;
  path: string;
  label: string;
  record?: SavedKnowledgeRecord;
  children: ConceptTreeRecordNode[];
  count: number;
};

const ForceGraph3D = lazy(() => import("react-force-graph-3d"));
const GRAPH_CAMERA_FLIGHT_MS = 1200;
const GRAPH_CAMERA_ORBIT_DELAY_MS = GRAPH_CAMERA_FLIGHT_MS + 150;

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
  const [collapsedTreePaths, setCollapsedTreePaths] = useState<Set<string>>(() => new Set());

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
  const conceptTree = useMemo(() => buildConceptRecordTree(filtered), [filtered]);
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
        <div className="inline-flex h-8 items-center rounded-[8px] border bg-muted/15 p-0.5">
          <ViewModeButton active={view === "detail"} onClick={() => setView("detail")}>
            <BookOpenIcon size={13} />
            Concept tree
          </ViewModeButton>
          <ViewModeButton active={view === "graph"} disabled={!scopedRecords.length} onClick={() => setView("graph")}>
            <NetworkIcon size={13} />
            Knowledge web
          </ViewModeButton>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/10">
          <div className="flex shrink-0 flex-col gap-2 border-b p-2">
            <div className="flex h-8 items-center gap-2 rounded-[7px] border bg-background px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
              <SearchIcon size={15} />
              <input
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search concepts..."
              />
            </div>
            {canUseProjectScope ? (
              <div className="grid grid-cols-2 gap-1 rounded-[7px] border bg-background p-0.5">
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
              <nav className="flex flex-col px-3 py-2" aria-label="Concept tree">
                {conceptTree.map((node) => (
                  <ConceptTreeListNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedKey={selected ? recordKey(selected) : null}
                    collapsedTreePaths={collapsedTreePaths}
                    activeProjectId={canUseProjectScope ? activeProject.id : undefined}
                    onSelectRecord={(record) => setSelectedKey(recordKey(record))}
                    onTogglePath={(path) => {
                      setCollapsedTreePaths((current) => {
                        const next = new Set(current);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      });
                    }}
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

function ViewModeButton({
  active,
  children,
  disabled,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium transition-none",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        disabled && "pointer-events-none opacity-45"
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
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
        "h-7 rounded-[6px] px-2 text-xs font-medium transition-none",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ConceptTreeListNode({
  node,
  depth,
  selectedKey,
  collapsedTreePaths,
  activeProjectId,
  onSelectRecord,
  onTogglePath
}: {
  node: ConceptTreeRecordNode;
  depth: number;
  selectedKey: string | null;
  collapsedTreePaths: Set<string>;
  activeProjectId?: string;
  onSelectRecord: (record: SavedKnowledgeRecord) => void;
  onTogglePath: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedTreePaths.has(node.path);
  const active = node.record ? recordKey(node.record) === selectedKey : false;
  const content = node.record ? (
    <ConceptListCard
      record={node.record}
      selectedKey={selectedKey}
      depth={depth}
      hasChildren={hasChildren}
      collapsed={collapsed}
      onSelect={() => onSelectRecord(node.record!)}
      onToggle={hasChildren ? () => onTogglePath(node.path) : undefined}
    />
  ) : (
    <ConceptTreeGroupRow
      count={node.count}
      depth={depth}
      label={node.label}
      collapsed={collapsed}
      onToggle={() => onTogglePath(node.path)}
    />
  );

  return (
    <div className="min-w-0">
      {content}
      {hasChildren ? (
        <div className={cn("construct-concept-tree-accordion__content", !collapsed && "is-open")}>
          <div>
            <div className={cn("ml-[1.125rem] border-l border-border/70 pl-2", active && "border-foreground/25")}>
              {node.children.map((child) => (
                <ConceptTreeListNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedKey={selectedKey}
                  collapsedTreePaths={collapsedTreePaths}
                  activeProjectId={activeProjectId}
                  onSelectRecord={onSelectRecord}
                  onTogglePath={onTogglePath}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConceptTreeGroupRow({
  count,
  depth,
  label,
  collapsed,
  onToggle
}: {
  count: number;
  depth: number;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex h-8 w-full min-w-0 items-center gap-2 rounded-[6px] text-left text-sm text-muted-foreground hover:bg-muted/35 hover:text-foreground"
      style={{ paddingLeft: `${Math.min(depth, 5) * 0.55}rem` }}
      onClick={onToggle}
    >
      <ChevronRightIcon size={14} className={cn("shrink-0 transition-transform", !collapsed && "rotate-90")} />
      <GitBranchIcon size={14} className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{count}</span>
    </button>
  );
}

function ConceptListCard({
  record,
  selectedKey,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onSelect,
  onToggle
}: {
  record: SavedKnowledgeRecord;
  selectedKey: string | null;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onSelect: () => void;
  onToggle?: () => void;
}) {
  const active = recordKey(record) === selectedKey;

  return (
    <button
      type="button"
      className={cn(
        "group flex h-8 w-full min-w-0 items-center gap-2 rounded-[6px] pr-2 text-left transition-none hover:bg-muted/35",
        active && "bg-muted/65"
      )}
      style={{ paddingLeft: `${Math.min(depth, 5) * 0.35}rem` }}
      onClick={onSelect}
    >
      <span
        className={cn("grid size-5 shrink-0 place-items-center rounded text-muted-foreground", hasChildren && "hover:bg-background/80")}
        onClick={(event) => {
          if (!onToggle) return;
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
      >
        {hasChildren ? <ChevronRightIcon size={14} className={cn("transition-transform", !collapsed && "rotate-90")} /> : <BookOpenIcon size={13} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{record.title}</span>
      <ChevronRightIcon size={14} className="shrink-0 text-muted-foreground/60 transition-none group-hover:text-foreground" />
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
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const selectedPulseRef = useRef(0);
  const approachDirectionRef = useRef<1 | -1>(1);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const graphData = useMemo(() => buildKnowledgeGraph(records), [records]);
  const recordByKey = useMemo(() => new Map(records.map((record) => [recordKey(record), record])), [records]);
  const inspectedRecord = (hoveredKey ? recordByKey.get(hoveredKey) : undefined)
    ?? (selectedKey ? recordByKey.get(selectedKey) : undefined)
    ?? records[0];
  const inspectedConnections = inspectedRecord ? graphRecordConnections(inspectedRecord, records) : [];

  useEffect(() => {
    if (!selectedKey || size.width <= 0 || size.height <= 0) return undefined;
    let animationFrame = 0;
    let attempts = 0;
    const focusSelectedNode = () => {
      const graph = graphRef.current;
      const node = graphData.nodes.find((candidate) => candidate.recordKey === selectedKey);
      if (graph && node) {
        const direction = focusGraphCameraOnNode(graph, node, GRAPH_CAMERA_FLIGHT_MS, approachDirectionRef.current);
        if (direction) {
          approachDirectionRef.current = direction;
          return;
        }
      }
      attempts += 1;
      if (attempts < 80) {
        animationFrame = window.requestAnimationFrame(focusSelectedNode);
      }
    };
    animationFrame = window.requestAnimationFrame(focusSelectedNode);
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [graphData, selectedKey, size.height, size.width]);

  useEffect(() => {
    if (!selectedKey || size.width <= 0 || size.height <= 0) return undefined;
    let animationFrame = 0;
    let orbitDelay = 0;
    let orbitState: GraphCameraOrbitState | null = null;
    const orbit = () => {
      const graph = graphRef.current;
      const node = graphData.nodes.find((candidate) => candidate.recordKey === selectedKey);
      if (graph && node) {
        const now = performance.now();
        orbitState ??= createGraphCameraOrbitState(graph, node, now, approachDirectionRef.current);
        if (orbitState) orbitGraphCameraAroundNode(graph, node, orbitState, now);
      }
      animationFrame = window.requestAnimationFrame(orbit);
    };
    orbitDelay = window.setTimeout(() => {
      animationFrame = window.requestAnimationFrame(orbit);
    }, GRAPH_CAMERA_ORBIT_DELAY_MS);
    return () => {
      window.clearTimeout(orbitDelay);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [graphData, selectedKey, size.height, size.width]);

  useEffect(() => {
    if (!selectedKey) return undefined;
    let animationFrame = 0;
    const tick = () => {
      selectedPulseRef.current = (Math.sin(performance.now() / 280) + 1) / 2;
      graphRef.current?.refresh();
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedKey]);

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
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            nodeId="id"
            nodeLabel={(node) => graphNodeLabel(node as KnowledgeGraphNode)}
            nodeColor={(node) => graphNodeColor(node as KnowledgeGraphNode, selectedKey)}
            nodeVal={(node) => graphNodeValue(node as KnowledgeGraphNode, selectedKey, selectedPulseRef.current)}
            nodeResolution={12}
            linkSource="source"
            linkTarget="target"
            linkLabel="label"
            linkColor={(link) => graphLinkColor(link as KnowledgeGraphLink, selectedKey)}
            linkOpacity={0.55}
            linkWidth={(link) => graphLinkWidth(link as KnowledgeGraphLink, selectedKey)}
            linkDirectionalParticles={(link) => graphLinkParticles(link as KnowledgeGraphLink, selectedKey)}
            linkDirectionalParticleWidth={(link) => graphLinkParticleWidth(link as KnowledgeGraphLink, selectedKey)}
            linkDirectionalParticleColor={(link) => graphLinkColor(link as KnowledgeGraphLink, selectedKey)}
            cooldownTicks={80}
            warmupTicks={40}
            enableNodeDrag
            enableNavigationControls
            onNodeClick={(node) => {
              const key = typeof node.recordKey === "string" ? node.recordKey : null;
              const record = key ? recordByKey.get(key) : undefined;
              if (record) onSelectRecord(record);
            }}
            onNodeHover={(node) => {
              const key = node && typeof node.recordKey === "string" ? node.recordKey : null;
              setHoveredKey(key);
            }}
          />
        </Suspense>
      ) : <GraphLoadingState />}

      {inspectedRecord ? (
        <aside className="pointer-events-none absolute right-3 top-3 flex w-[min(22rem,calc(100%-1.5rem))] flex-col gap-2 rounded-[8px] border bg-background/92 px-3 py-2.5 text-sm shadow-sm backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", hoveredKey ? "bg-primary" : "bg-muted-foreground/50")} />
              <strong className="min-w-0 flex-1 truncate text-foreground">{inspectedRecord.title}</strong>
            </div>
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {inspectedRecord.summary || inspectedRecord.content || "No summary recorded yet."}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t pt-2 text-[11px]">
            <GraphMetric label="Level" value={`L${inspectedRecord.masteryLevel ?? 0}`} />
            <GraphMetric label="Links" value={`${(inspectedRecord.relatedConcepts?.length ?? 0) + records.filter((record) => record.parentId === inspectedRecord.id).length}`} />
            <GraphMetric label="Projects" value={`${inspectedRecord.projects?.length ?? 1}`} />
          </div>
          {inspectedConnections.length ? (
            <div className="border-t pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Connected</div>
              <div className="flex flex-col gap-1">
                {inspectedConnections.slice(0, 5).map((connection) => (
                  <div key={`${connection.kind}:${recordKey(connection.record)}`} className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 text-muted-foreground">{connection.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground/90">{connection.record.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function GraphMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium text-foreground">{value}</div>
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
  const relatedRecords = (record.relatedConcepts ?? [])
    .map((id) => records.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is SavedKnowledgeRecord => Boolean(candidate));
  const history = record.history?.length ? record.history : fallbackHistory(record);
  const orderedHistory = useMemo(() => history.slice().reverse(), [history]);
  const content = record.content?.trim();
  const projectRelations = record.projects?.length ? record.projects : [{
    projectId: record.sourceProjectId,
    projectTitle: record.sourceProjectTitle,
    conceptId: record.id,
    introducedAt: record.savedAt,
    firstReferencedAt: record.savedAt,
    lastReferencedAt: record.lastModifiedAt ?? record.savedAt,
    masteryLevel: record.masteryLevel ?? 0,
    lastEventKind: "introduced" as const,
    eventIds: []
  }];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{record.title}</h2>
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
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4">
          {content ? (
            <ConceptSection title="Concept text">
              <MarkdownBlock content={content} theme={theme} sources={record.sources} />
            </ConceptSection>
          ) : null}

          {record.why ? (
            <ConceptSection title="Why it matters">
              <MarkdownBlock content={record.why} theme={theme} sources={record.sources} />
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
              <div className="flex flex-col">
                {relatedRecords.map((related) => (
                  <button key={recordKey(related)} type="button" className="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-muted/45" onClick={() => onSelectRecord(related)}>
                    <GitBranchIcon size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{related.title}</span>
                    <ChevronRightIcon size={14} className="shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </ConceptSection>
          ) : null}

          <RecordDetails
            orderedHistory={orderedHistory}
            projectRelations={projectRelations}
            record={record}
            onOpenProject={onOpenProject}
          />
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

function RecordDetails({
  orderedHistory,
  projectRelations,
  record,
  onOpenProject
}: {
  orderedHistory: NonNullable<ConceptCard["history"]>;
  projectRelations: NonNullable<SavedKnowledgeRecord["projects"]>;
  record: SavedKnowledgeRecord;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        Record details
      </summary>
      <div className="mt-3 flex flex-col gap-4 text-sm text-muted-foreground">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <RecordDetailTerm label="Source" value={record.sourceProjectTitle} />
          <RecordDetailTerm label="Saved" value={formatDate(record.savedAt)} />
          <RecordDetailTerm label="Updated" value={formatDate(record.lastModifiedAt ?? record.savedAt)} />
          <RecordDetailTerm label="Opened" value={`${record.openCount} times`} />
        </dl>

        <RecordDetailGroup title="Projects">
          {projectRelations.map((relation) => (
            <button
              key={`${relation.projectId}:${relation.conceptId}`}
              type="button"
              className="block min-w-0 truncate rounded-[6px] px-2 py-1 text-left hover:bg-muted/45 hover:text-foreground"
              onClick={() => onOpenProject(relation.projectId)}
            >
              {relation.projectTitle}
              <span className="ml-2 text-xs text-muted-foreground">
                {relation.lastEventKind} · L{relation.masteryLevel}
              </span>
            </button>
          ))}
        </RecordDetailGroup>

        {(record.lastChangeReason || record.confidenceReason || record.learnerEvidence?.length) ? (
          <RecordDetailGroup title="Evidence">
            {record.lastChangeReason ? <p><span className="text-foreground">Why:</span> {record.lastChangeReason}</p> : null}
            {record.confidenceReason ? <p><span className="text-foreground">Learning state:</span> {record.confidenceReason}</p> : null}
            {record.learnerEvidence?.length ? (
              <ul className="flex flex-col gap-1 text-xs">
                {record.learnerEvidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
              </ul>
            ) : null}
          </RecordDetailGroup>
        ) : null}

        <RecordDetailGroup title="History">
          {orderedHistory.map((event) => (
            <div key={event.id} className="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1">
              <HistoryIcon size={13} className="shrink-0 text-muted-foreground" />
              <span className="capitalize text-foreground">{event.kind}</span>
              <time className="truncate text-xs">{formatDate(event.createdAt)}</time>
            </div>
          ))}
        </RecordDetailGroup>

        {(record.docs.length || record.sources?.length) ? (
          <RecordDetailGroup title="Links">
            {[...record.docs.map((link) => ({ title: link.title, url: link.url })), ...(record.sources ?? []).map((source) => ({ title: source.title, url: source.url }))].map((link) => (
              <a key={link.url} className="inline-flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1 text-sm hover:bg-muted/45 hover:text-foreground" href={link.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon size={13} className="shrink-0" />
                <span className="truncate">{link.title}</span>
              </a>
            ))}
          </RecordDetailGroup>
        ) : null}
      </div>
    </details>
  );
}

function RecordDetailTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

function RecordDetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
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

function buildConceptRecordTree(records: SavedKnowledgeRecord[]): ConceptTreeRecordNode[] {
  type MutableNode = ConceptTreeRecordNode & { childMap: Map<string, MutableNode> };
  const root = new Map<string, MutableNode>();

  const ensureNode = (siblings: Map<string, MutableNode>, path: string, label: string): MutableNode => {
    const existing = siblings.get(path);
    if (existing) return existing;
    const node: MutableNode = {
      id: path,
      path,
      label,
      children: [],
      childMap: new Map(),
      count: 0
    };
    siblings.set(path, node);
    return node;
  };

  for (const record of records) {
    const parts = conceptTreePath(record);
    let siblings = root;
    let path = "";
    parts.forEach((part, index) => {
      path = path ? `${path}.${part}` : part;
      const isLeaf = index === parts.length - 1;
      const label = isLeaf ? record.title : conceptSegmentLabel(part);
      const node = ensureNode(siblings, path, label);
      if (isLeaf) {
        node.record = record;
        node.label = record.title;
      }
      siblings = node.childMap;
    });
  }

  const freeze = (siblings: Map<string, MutableNode>): ConceptTreeRecordNode[] => (
    [...siblings.values()]
      .sort((a, b) => {
        if (a.record && !b.record) return 1;
        if (!a.record && b.record) return -1;
        return a.label.localeCompare(b.label);
      })
      .map((node) => {
        const children = freeze(node.childMap);
        const count = (node.record ? 1 : 0) + children.reduce((sum, child) => sum + child.count, 0);
        return {
          id: node.id,
          path: node.path,
          label: node.label,
          record: node.record,
          children,
          count
        };
      })
  );

  return freeze(root);
}

function conceptTreePath(record: SavedKnowledgeRecord): string[] {
  const idParts = record.id.split(".").map((part) => part.trim()).filter(Boolean);
  if (idParts.length) return idParts;
  return [recordKey(record)];
}

function conceptSegmentLabel(segment: string): string {
  const languageLabels: Record<string, string> = {
    cpp: "C++",
    c: "C",
    js: "JavaScript",
    ts: "TypeScript",
    swiftui: "SwiftUI"
  };
  const normalized = segment.toLowerCase();
  if (languageLabels[normalized]) return languageLabels[normalized];
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildKnowledgeGraph(records: SavedKnowledgeRecord[]): GraphData<KnowledgeGraphNode, KnowledgeGraphLink> {
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
      color: colorForGraphGroup(group),
      group,
      recordKey: nodeId,
      title: record.title,
      summary: record.summary,
      val: Math.max(3, Math.min(8, (record.relatedConcepts?.length ?? 0) + 3))
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

function graphNodeLabel(node: KnowledgeGraphNode): string {
  const summary = node.summary ? `\n${node.summary}` : "";
  return `${node.title}${summary}`;
}

function graphNodeColor(node: KnowledgeGraphNode, selectedKey: string | null): string {
  if (selectedKey !== node.recordKey) return node.color;
  return "#ff1744";
}

function graphNodeValue(node: KnowledgeGraphNode, selectedKey: string | null, selectedPulse: number): number {
  if (selectedKey !== node.recordKey) return node.val;
  return node.val + 10 + selectedPulse * 12;
}

function graphRecordConnections(
  record: SavedKnowledgeRecord,
  records: SavedKnowledgeRecord[]
): Array<{ kind: "parent" | "child" | "related"; record: SavedKnowledgeRecord }> {
  const byId = new Map(records.map((candidate) => [candidate.id, candidate]));
  const connections: Array<{ kind: "parent" | "child" | "related"; record: SavedKnowledgeRecord }> = [];
  const seen = new Set<string>();

  const add = (kind: "parent" | "child" | "related", candidate?: SavedKnowledgeRecord) => {
    if (!candidate || candidate.id === record.id || seen.has(`${kind}:${candidate.id}`)) return;
    seen.add(`${kind}:${candidate.id}`);
    connections.push({ kind, record: candidate });
  };

  add("parent", record.parentId ? byId.get(record.parentId) : undefined);
  for (const child of records) {
    if (child.parentId === record.id) add("child", child);
  }
  for (const relatedId of record.relatedConcepts ?? []) {
    add("related", byId.get(relatedId));
  }
  return connections;
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

function graphLinkTouchesSelected(link: { source?: unknown; target?: unknown }, selectedKey: string | null): boolean {
  if (!selectedKey) return false;
  return graphLinkEndpointId(link.source) === selectedKey || graphLinkEndpointId(link.target) === selectedKey;
}

function graphLinkColor(link: KnowledgeGraphLink, selectedKey: string | null): string {
  const selected = graphLinkTouchesSelected(link, selectedKey);
  return selected ? "rgba(255, 23, 68, 0.86)" : link.kind === "parent" ? "rgba(125, 211, 252, 0.62)" : "rgba(196, 181, 253, 0.52)";
}

function graphLinkWidth(link: KnowledgeGraphLink, selectedKey: string | null): number {
  const selected = graphLinkTouchesSelected(link, selectedKey);
  return selected ? 3.2 : link.kind === "parent" ? 1.4 : 0.8;
}

function graphLinkParticles(link: KnowledgeGraphLink, selectedKey: string | null): number {
  const selected = graphLinkTouchesSelected(link, selectedKey);
  return selected ? 3 : link.kind === "parent" ? 1 : 0;
}

function graphLinkParticleWidth(link: KnowledgeGraphLink, selectedKey: string | null): number {
  const selected = graphLinkTouchesSelected(link, selectedKey);
  return selected ? 2.4 : 1.2;
}

function graphLinkEndpointId(endpoint: unknown): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint && typeof endpoint.id === "string") return endpoint.id;
  return null;
}

function focusGraphCameraOnNode(
  graph: ForceGraphMethods,
  node: KnowledgeGraphRuntimeNode,
  transitionMs: number,
  fallbackDirection: 1 | -1
): 1 | -1 | null {
  const frame = graphCameraFocusFrame(node);
  if (!frame) return null;
  const direction = graphCameraApproachDirection(graph.camera().position, frame.position, frame.target, fallbackDirection);
  graph.cameraPosition(frame.position, frame.target, transitionMs);
  return direction;
}

function graphCameraFocusFrame(node: KnowledgeGraphRuntimeNode): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return null;
  const target = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    z: node.z ?? 0
  };
  const distance = graphCameraFocusDistance(node);
  const magnitude = Math.hypot(target.x, target.y, target.z);
  if (magnitude < 1) {
    return {
      position: { x: target.x, y: target.y, z: target.z + distance },
      target
    };
  }
  const ratio = 1 + distance / magnitude;
  return {
    position: {
      x: target.x * ratio,
      y: target.y * ratio,
      z: target.z * ratio
    },
    target
  };
}

function orbitGraphCameraAroundNode(
  graph: ForceGraphMethods,
  node: KnowledgeGraphRuntimeNode,
  orbitState: GraphCameraOrbitState,
  timestamp: number
): boolean {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return false;
  const target = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    z: node.z ?? 0
  };
  const elapsed = timestamp - orbitState.startedAt;
  const angle = orbitState.initialAngle + orbitState.direction * graphCameraOrbitAngleDelta(elapsed);
  graph.cameraPosition({
    x: target.x + Math.cos(angle) * orbitState.radius,
    y: target.y + orbitState.yOffset + Math.sin(elapsed * 0.00003) * orbitState.yAmplitude,
    z: target.z + Math.sin(angle) * orbitState.radius
  }, target, 0);
  return true;
}

function createGraphCameraOrbitState(
  graph: ForceGraphMethods,
  node: KnowledgeGraphRuntimeNode,
  startedAt: number,
  direction: 1 | -1
): GraphCameraOrbitState | null {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return null;
  const position = graph.camera().position;
  const target = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    z: node.z ?? 0
  };
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  const focusDistance = graphCameraFocusDistance(node);
  const radius = Math.max(focusDistance * 0.72, Math.hypot(dx, dz));
  return {
    startedAt,
    initialAngle: Math.atan2(dz, dx),
    direction,
    radius,
    yOffset: position.y - target.y,
    yAmplitude: Math.max(1.8, radius * 0.018)
  };
}

function graphCameraApproachDirection(
  start: { x: number; z: number },
  end: { x: number; z: number },
  target: { x: number; z: number },
  fallbackDirection: 1 | -1
): 1 | -1 {
  const startAngle = Math.atan2(start.z - target.z, start.x - target.x);
  const endAngle = Math.atan2(end.z - target.z, end.x - target.x);
  const delta = normalizeGraphCameraAngle(endAngle - startAngle);
  if (Math.abs(delta) < 0.02) return fallbackDirection;
  return delta > 0 ? 1 : -1;
}

function normalizeGraphCameraAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function graphCameraOrbitAngleDelta(elapsed: number): number {
  const baseSpeed = 0.000045;
  const rampMs = 2800;
  const slowFraction = 0.18;
  if (elapsed >= rampMs) {
    const rampDistance = baseSpeed * rampMs * (slowFraction + (1 - slowFraction) * 0.5);
    return rampDistance + baseSpeed * (elapsed - rampMs);
  }
  const progress = Math.max(0, Math.min(1, elapsed / rampMs));
  const smoothstepIntegral = progress ** 3 - 0.5 * progress ** 4;
  return baseSpeed * rampMs * (slowFraction * progress + (1 - slowFraction) * smoothstepIntegral);
}

function graphCameraFocusDistance(node: KnowledgeGraphRuntimeNode): number {
  const radius = Math.max(6, node.val ?? 4);
  return Math.max(180, radius * 28);
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
