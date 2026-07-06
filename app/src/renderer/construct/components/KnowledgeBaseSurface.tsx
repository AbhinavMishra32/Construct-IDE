import { BookOpenIcon, ChevronRightIcon, ExternalLinkIcon, GitBranchIcon, HistoryIcon, NetworkIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, FileTree as OpalineFileTree, ShadcnScrollArea, type FileTreeItem } from "@opaline/ui";
import ForceGraph3D, { type ForceGraphMethods, type GraphData, type NodeObject } from "react-force-graph-3d";

import { ConstructAuthLogo } from "../../components/auth/construct-auth-logo";
import { MarkdownBlock } from "./MarkdownBlock";
import { readKnowledgeRecords, subscribeKnowledgeRecords, removeKnowledgeConcept, type SavedKnowledgeRecord } from "../lib/knowledgeStore";
import type { AnyProjectRecord, ConceptCard } from "../types";
import { isFlowProjectRecord } from "../types";
import { cn } from "../../lib/utils";

type ConceptScope = "current" | "all";
type ConceptsMainView = "content" | "web";
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
type GraphCameraFlight = {
  cancel: () => void;
  direction: 1 | -1;
};
type ConceptTreeRecordNode = {
  id: string;
  path: string;
  label: string;
  record?: SavedKnowledgeRecord;
  children: ConceptTreeRecordNode[];
  count: number;
  color: string;
};

const GRAPH_CAMERA_FLIGHT_MS = 1850;
const GRAPH_CAMERA_ORBIT_DELAY_MS = GRAPH_CAMERA_FLIGHT_MS + 350;
const KNOWLEDGE_GRAPH_LINK_DISTANCE = 72;
const KNOWLEDGE_GRAPH_CHARGE_STRENGTH = -130;
const KNOWLEDGE_GRAPH_CENTER_STRENGTH = 0.18;

export function KnowledgeBaseSurface({
  activeProject,
  theme,
  onSidebarPanelChange,
  onOpenProject
}: {
  activeProject?: AnyProjectRecord | null;
  theme: "light" | "dark" | "system";
  onSidebarPanelChange?: (panel: ReactNode | null) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [records, setRecords] = useState<SavedKnowledgeRecord[]>(() => readKnowledgeRecords());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ConceptScope>(() => isFlowProjectRecord(activeProject) ? "current" : "all");
  const [mainView, setMainView] = useState<ConceptsMainView>("content");
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [graphPaneWidth, setGraphPaneWidth] = useState(540);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() => new Set());
  const [mainRef, mainSize] = useElementSize<HTMLDivElement>();

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
      if (selectedTreePath !== null) setSelectedTreePath(null);
      return;
    }
    if (selectedKey && !filtered.some((record) => recordKey(record) === selectedKey)) {
      setSelectedKey(recordKey(filtered[0]));
      setSelectedTreePath(conceptRecordTreePath(filtered[0]));
    }
  }, [filtered, selectedKey, selectedTreePath]);

  const selected = selectedKey ? filtered.find((record) => recordKey(record) === selectedKey) ?? null : null;
  const conceptTree = useMemo(() => buildConceptRecordTree(filtered), [filtered]);
  const selectedTreeNode = selectedTreePath ? findConceptTreeNodeByPath(conceptTree, selectedTreePath) : null;
  const selectedGroupNode = selectedTreeNode && isConceptTreeContainerNode(selectedTreeNode) ? selectedTreeNode : null;
  const selectedConceptRecord = selected && !selectedGroupNode ? selected : null;
  const headerTitle = selectedConceptRecord?.title ?? selectedGroupNode?.label ?? (filtered.length ? "Select a concept" : "No concepts");
  const headerDetail = selectedConceptRecord
    ? selectedConceptRecord.sourceProjectTitle
    : selectedGroupNode
      ? `${selectedGroupNode.count} child concept${selectedGroupNode.count === 1 ? "" : "s"}`
      : `${filtered.length} concept${filtered.length === 1 ? "" : "s"}`;
  const isCompactMain = mainSize.width > 0 && mainSize.width < 820;
  const clampedGraphPaneWidth = Math.max(360, Math.min(graphPaneWidth, Math.max(360, mainSize.width - 360)));
  const showGraphPane = !graphCollapsed && (!isCompactMain || mainView === "web");
  const showContentPane = !isCompactMain || mainView === "content";
  const toggleTreePath = (path: string) => {
    setExpandedTreePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  useEffect(() => {
    if (!onSidebarPanelChange) return;
    onSidebarPanelChange(
      <ConceptsSidebarPanel
        canUseProjectScope={canUseProjectScope}
        conceptTree={conceptTree}
        expandedTreePaths={expandedTreePaths}
        filteredCount={filtered.length}
        query={query}
        scope={scope}
        selectedTreePath={selectedTreePath}
        onQueryChange={setQuery}
        onScopeChange={setScope}
        onSelectNode={(node) => {
          setSelectedTreePath(node.path);
          setSelectedKey(node.record && !isConceptTreeContainerNode(node) ? recordKey(node.record) : null);
        }}
        onTogglePath={toggleTreePath}
      />
    );
  }, [canUseProjectScope, conceptTree, expandedTreePaths, filtered.length, onSidebarPanelChange, query, scope, selectedTreePath]);

  useEffect(() => () => onSidebarPanelChange?.(null), [onSidebarPanelChange]);

  const startGraphResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const container = mainRef.current;
    if (!container) return;
    const resize = (pointerEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nextWidth = rect.right - pointerEvent.clientX;
      setGraphPaneWidth(Math.max(360, Math.min(nextWidth, Math.max(360, rect.width - 360))));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0">
            {selectedGroupNode ? (
              <ConceptGroupIcon color={selectedGroupNode.color} />
            ) : selectedConceptRecord ? (
              <ConceptColorIcon color={colorForGraphGroup(graphGroupForRecord(selectedConceptRecord))} />
            ) : (
              <BookOpenIcon size={14} className="text-muted-foreground" />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-tight text-foreground">{headerTitle}</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{headerDetail}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectedConceptRecord ? (
            <div className="flex items-center gap-1.5 border-r pr-2">
              <Button
                size="sm"
                variant="outline"
                className="size-7 p-0"
                onClick={() => onOpenProject(selectedConceptRecord.sourceProjectId)}
                title="Open project"
                aria-label="Open project"
              >
                <ExternalLinkIcon size={13} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="size-7 p-0 text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  if (window.confirm(`Delete concept "${selectedConceptRecord.title}"? This cannot be undone.`)) {
                    removeKnowledgeConcept(selectedConceptRecord.sourceProjectId, selectedConceptRecord.id);
                  }
                }}
                title="Delete concept"
                aria-label="Delete concept"
              >
                <Trash2Icon size={13} />
              </Button>
            </div>
          ) : null}
          {isCompactMain ? (
            <div className="inline-flex h-8 items-center rounded-[8px] border bg-muted/15 p-0.5">
              <ViewModeButton active={mainView === "content"} onClick={() => setMainView("content")}>
                <BookOpenIcon size={13} />
                Content
              </ViewModeButton>
              <ViewModeButton active={mainView === "web"} disabled={!scopedRecords.length} onClick={() => {
                setGraphCollapsed(false);
                setMainView("web");
              }}>
                <NetworkIcon size={13} />
                Web
              </ViewModeButton>
            </div>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="size-7 p-0"
            onClick={() => setGraphCollapsed((current) => !current)}
            title={graphCollapsed ? "Show web" : "Hide web"}
            aria-label={graphCollapsed ? "Show web" : "Hide web"}
          >
            <NetworkIcon size={13} />
          </Button>
        </div>
      </header>

      <div
        ref={mainRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: isCompactMain
            ? "minmax(0,1fr)"
            : graphCollapsed
              ? "minmax(0,1fr)"
              : `minmax(0,1fr) 0.375rem ${clampedGraphPaneWidth}px`
        }}
      >
        {showContentPane ? (
          selected && !selectedGroupNode ? (
            <ConceptDetail
              record={selected}
              records={records}
              theme={theme}
              onOpenProject={onOpenProject}
              onSelectRecord={(record) => {
                setSelectedKey(recordKey(record));
                setSelectedTreePath(conceptRecordTreePath(record));
              }}
            />
          ) : selectedGroupNode ? (
            <ConceptGroupDetail
              node={selectedGroupNode}
              onSelectRecord={(record) => {
                setSelectedKey(recordKey(record));
                setSelectedTreePath(conceptRecordTreePath(record));
              }}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 text-center text-sm text-muted-foreground">
              <BookOpenIcon size={30} />
              <p className="mt-3 font-medium text-foreground">No concept selected</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed">Choose a concept from the sidebar to inspect its text, evidence, projects, and history.</p>
            </div>
          )
        ) : null}

        {!isCompactMain && !graphCollapsed ? (
          <button
            type="button"
            className="group relative cursor-col-resize border-x bg-border/30 hover:bg-primary/10"
            aria-label="Resize knowledge web"
            onPointerDown={startGraphResize}
          >
            <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/35 group-hover:bg-primary/70" />
          </button>
        ) : null}

        {showGraphPane ? (
          <div className="min-h-0 border-l">
            <KnowledgeGraphPanel
              records={scopedRecords}
              selectedKey={selectedKey}
              onSelectRecord={(record) => {
                setSelectedKey(recordKey(record));
                setSelectedTreePath(conceptRecordTreePath(record));
                if (isCompactMain) setMainView("content");
              }}
              onClearSelection={() => {
                setSelectedKey(null);
                setSelectedTreePath(null);
              }}
            />
          </div>
        ) : null}
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

function ConceptsSidebarPanel({
  canUseProjectScope,
  conceptTree,
  expandedTreePaths,
  filteredCount,
  query,
  scope,
  selectedTreePath,
  onQueryChange,
  onScopeChange,
  onSelectNode,
  onTogglePath
}: {
  canUseProjectScope: boolean;
  conceptTree: ConceptTreeRecordNode[];
  expandedTreePaths: Set<string>;
  filteredCount: number;
  query: string;
  scope: ConceptScope;
  selectedTreePath: string | null;
  onQueryChange: (value: string) => void;
  onScopeChange: (scope: ConceptScope) => void;
  onSelectNode: (node: ConceptTreeRecordNode) => void;
  onTogglePath: (path: string) => void;
}) {
  const treeItems = useMemo(() => conceptTree.map((node) => conceptTreeNodeToFileTreeItem(node, selectedTreePath, expandedTreePaths)), [conceptTree, expandedTreePaths, selectedTreePath]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b pb-2 pt-0.5">
        <label className="flex h-11 flex-1 items-center gap-2.5 rounded-[8px] border bg-background/70 px-3 ring-offset-background transition-colors focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-ring/25">
          <SearchIcon size={16} className="shrink-0 text-muted-foreground/55" />
          <input
            type="text"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45"
            value={query}
            placeholder="Search concepts..."
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        {canUseProjectScope ? (
          <div className="grid grid-cols-2 gap-1 rounded-[6px] border bg-background/60 p-0.5">
            <ScopeButton active={scope === "current"} title="Current project" onClick={() => onScopeChange("current")}>
              Project
            </ScopeButton>
            <ScopeButton active={scope === "all"} title="All concepts" onClick={() => onScopeChange("all")}>
              All
            </ScopeButton>
          </div>
        ) : null}
      </div>
      {filteredCount ? (
        <div className="min-h-0 flex-1">
          <OpalineFileTree
            className="[&_[data-file-tree-virtualized-list=true]]:pb-9"
            gitLane={false}
            items={treeItems}
            onSelectPath={(path, item) => {
              const node = findConceptTreeNodeByPath(conceptTree, path);
              if (!node) return;
              onSelectNode(node);
              if (item.type === "directory") onTogglePath(path);
            }}
            search={false}
            showActions={false}
            variant="sidebar"
          />
        </div>
      ) : (
        <ShadcnScrollArea className="min-h-0 flex-1">
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
        </ShadcnScrollArea>
      )}
    </div>
  );
}

function ScopeButton({
  active,
  children,
  title,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 rounded-[5px] px-2 text-[11.5px] font-medium leading-none transition-colors",
        active ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function conceptTreeNodeToFileTreeItem(node: ConceptTreeRecordNode, selectedTreePath: string | null, expandedTreePaths: Set<string>): FileTreeItem {
  const hasChildren = node.children.length > 0;
  const isContainer = isConceptTreeContainerNode(node);
  const record = node.record;
  const isConceptRecord = record != null && !isParentConceptStub(record);
  const expanded = hasChildren && (expandedTreePaths.has(node.path) || conceptTreeNodeContainsSelectedDescendant(node, selectedTreePath));
  return {
    name: node.label,
    path: node.path,
    type: hasChildren ? "directory" : "file",
    selected: node.path === selectedTreePath,
    expanded,
    hideChevron: isConceptRecord ? true : undefined,
    icon: isContainer ? <ConceptGroupIcon color={node.color} /> : <ConceptColorIcon color={node.color} />,
    decoration: isContainer ? <span className="text-[10px] tabular-nums text-muted-foreground/70">{node.count}</span> : undefined,
    children: hasChildren ? node.children.map((child) => conceptTreeNodeToFileTreeItem(child, selectedTreePath, expandedTreePaths)) : undefined
  };
}

function isConceptTreeContainerNode(node: ConceptTreeRecordNode): boolean {
  return node.children.length > 0 && (!node.record || isParentConceptStub(node.record));
}

function isParentConceptStub(record: SavedKnowledgeRecord): boolean {
  return record.authoredBy === "system" && record.summary.trim().toLowerCase().startsWith("parent concept stub for ");
}

function conceptTreeNodeContainsSelectedDescendant(node: ConceptTreeRecordNode, selectedTreePath: string | null): boolean {
  if (!selectedTreePath) return false;
  return node.children.some((child) => child.path === selectedTreePath || conceptTreeNodeContainsSelectedDescendant(child, selectedTreePath));
}

function findConceptTreeNodeByPath(nodes: ConceptTreeRecordNode[], path: string): ConceptTreeRecordNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findConceptTreeNodeByPath(node.children, path);
    if (child) return child;
  }
  return null;
}

function collectConceptRecords(node: ConceptTreeRecordNode): SavedKnowledgeRecord[] {
  const records = node.record && !isParentConceptStub(node.record) ? [node.record] : [];
  for (const child of node.children) records.push(...collectConceptRecords(child));
  return records;
}

function ConceptColorIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-2.5 shrink-0 place-items-center rounded-full border border-background/70"
      style={{ backgroundColor: color }}
    >
      <span className="size-1 rounded-full bg-white/35" />
    </span>
  );
}

function ConceptGroupIcon({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-4 shrink-0 place-items-center rounded-[5px] border bg-muted/35"
      style={{ borderColor: color }}
    >
      <span className="h-1.5 w-2 rounded-sm" style={{ backgroundColor: color }} />
    </span>
  );
}

export function KnowledgeGraphPanel({
  records,
  selectedKey,
  onSelectRecord,
  onClearSelection
}: {
  records: SavedKnowledgeRecord[];
  selectedKey: string | null;
  onSelectRecord: (record: SavedKnowledgeRecord) => void;
  onClearSelection: () => void;
}) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const cameraFlightCancelRef = useRef<(() => void) | null>(null);
  const selectedPulseRef = useRef(0);
  const approachDirectionRef = useRef<1 | -1>(1);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const graphData = useMemo(() => buildKnowledgeGraph(records), [records]);
  const recordByKey = useMemo(() => new Map(records.map((record) => [recordKey(record), record])), [records]);
  const hoveredRecord = hoveredKey ? recordByKey.get(hoveredKey) : undefined;
  const hoveredConnections = hoveredRecord ? graphRecordConnections(hoveredRecord, records) : [];
  const graphWidth = size.width;
  const graphHeight = size.height;
  const graphCanMount = graphWidth > 0 && graphHeight > 0;
  const clearGraphSelection = () => {
    cameraFlightCancelRef.current?.();
    cameraFlightCancelRef.current = null;
    setHoveredKey(null);
    onClearSelection();
  };

  useEffect(() => {
    const graph = graphRef.current as (ForceGraphMethods & {
      d3Force?: (name: string, force?: unknown) => unknown;
      d3ReheatSimulation?: () => void;
    }) | undefined;
    if (!graph?.d3Force) return;

    const linkForce = graph.d3Force("link") as { distance?: (distance: number) => unknown } | undefined;
    const chargeForce = graph.d3Force("charge") as { strength?: (strength: number) => unknown } | undefined;
    const centerForce = graph.d3Force("center") as { strength?: (strength: number) => unknown } | undefined;

    linkForce?.distance?.(KNOWLEDGE_GRAPH_LINK_DISTANCE);
    chargeForce?.strength?.(KNOWLEDGE_GRAPH_CHARGE_STRENGTH);
    centerForce?.strength?.(KNOWLEDGE_GRAPH_CENTER_STRENGTH);
    graph.d3ReheatSimulation?.();
  }, [graphData]);

  useEffect(() => {
    if (!selectedKey || graphWidth <= 0 || graphHeight <= 0) return undefined;
    let animationFrame = 0;
    let attempts = 0;
    cameraFlightCancelRef.current?.();
    const focusSelectedNode = () => {
      const graph = graphRef.current;
      const node = graphData.nodes.find((candidate) => candidate.recordKey === selectedKey);
      if (graph && node) {
        const flight = focusGraphCameraOnNode(graph, node, GRAPH_CAMERA_FLIGHT_MS, approachDirectionRef.current);
        if (flight) {
          cameraFlightCancelRef.current = flight.cancel;
          approachDirectionRef.current = flight.direction;
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
      cameraFlightCancelRef.current?.();
      cameraFlightCancelRef.current = null;
    };
  }, [graphData, graphHeight, graphWidth, selectedKey]);

  useEffect(() => {
    if (selectedKey || !graphData.nodes.length || graphWidth <= 0 || graphHeight <= 0) return undefined;
    const fitGraph = () => graphRef.current?.zoomToFit?.(650, 80);
    const firstFit = window.setTimeout(fitGraph, 260);
    const settledFit = window.setTimeout(fitGraph, 1150);
    return () => {
      window.clearTimeout(firstFit);
      window.clearTimeout(settledFit);
    };
  }, [graphData, graphHeight, graphWidth, selectedKey]);

  useEffect(() => {
    if (!selectedKey || graphWidth <= 0 || graphHeight <= 0) return undefined;
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
  }, [graphData, graphHeight, graphWidth, selectedKey]);

  useEffect(() => {
    if (!graphData.nodes.length || graphWidth <= 0 || graphHeight <= 0) return undefined;
    let animationFrame = 0;
    const tick = () => {
      selectedPulseRef.current = (Math.sin(performance.now() / 280) + 1) / 2;
      graphRef.current?.refresh();
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [graphData, graphHeight, graphWidth]);

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
      {graphCanMount ? (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          width={graphWidth}
          height={graphHeight}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeId="id"
          nodeLabel={(node) => graphNodeLabel(node as KnowledgeGraphNode)}
          nodeColor={(node) => graphNodeColor(node as KnowledgeGraphNode, selectedKey)}
          nodeVal={(node) => graphNodeValue(node as KnowledgeGraphNode, selectedKey, selectedPulseRef.current)}
          nodeResolution={18}
          nodeRelSize={4.8}
          linkSource="source"
          linkTarget="target"
          linkLabel="label"
          linkColor={(link) => graphLinkColor(link as KnowledgeGraphLink, selectedKey)}
          linkOpacity={0.46}
          linkWidth={(link) => graphLinkWidth(link as KnowledgeGraphLink, selectedKey)}
          linkDirectionalParticles={(link) => graphLinkParticles(link as KnowledgeGraphLink, selectedKey)}
          linkDirectionalParticleWidth={(link) => graphLinkParticleWidth(link as KnowledgeGraphLink, selectedKey)}
          linkDirectionalParticleColor={(link) => graphLinkColor(link as KnowledgeGraphLink, selectedKey)}
          cooldownTicks={160}
          cooldownTime={15000}
          warmupTicks={70}
          d3AlphaDecay={0.016}
          d3VelocityDecay={0.24}
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
          onLinkClick={clearGraphSelection}
          onBackgroundClick={clearGraphSelection}
        />
      ) : <GraphLoadingState />}

      {hoveredRecord ? (
        <aside className="pointer-events-none absolute right-3 top-3 flex w-[min(22rem,calc(100%-1.5rem))] flex-col gap-2 rounded-[8px] border bg-background/92 px-3 py-2.5 text-sm shadow-sm backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-primary" />
              <strong className="min-w-0 flex-1 truncate text-foreground">{hoveredRecord.title}</strong>
            </div>
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {hoveredRecord.summary || hoveredRecord.content || "No summary recorded yet."}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t pt-2 text-[11px]">
            <GraphMetric label="Level" value={`L${hoveredRecord.masteryLevel ?? 0}`} />
            <GraphMetric label="Links" value={`${(hoveredRecord.relatedConcepts?.length ?? 0) + records.filter((record) => record.parentId === hoveredRecord.id).length}`} />
            <GraphMetric label="Projects" value={`${hoveredRecord.projects?.length ?? 1}`} />
          </div>
          {hoveredConnections.length ? (
            <div className="border-t pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Connected</div>
              <div className="flex flex-col gap-1">
                {hoveredConnections.slice(0, 5).map((connection) => (
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
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <ConstructAuthLogo markClassName="construct-auth-logo__mark--knowledge-web-loading" />
    </div>
  );
}

function ConceptGroupDetail({
  node,
  onSelectRecord
}: {
  node: ConceptTreeRecordNode;
  onSelectRecord: (record: SavedKnowledgeRecord) => void;
}) {
  const childConcepts = useMemo(() => node.children.flatMap(collectConceptRecords).slice(0, 48), [node]);
  const directGroups = node.children.filter((child) => child.children.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ConceptColorIcon color={node.color} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug tracking-tight">{node.label}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {node.count} child concept{node.count === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>
      <ShadcnScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4">
          {directGroups.length ? (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Subgroups</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {directGroups.map((group) => (
                  <div key={group.path} className="rounded-[8px] border bg-muted/15 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ConceptColorIcon color={group.color} />
                      <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">{group.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{group.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Child Concepts</h3>
            <div className="flex flex-col gap-1.5">
              {childConcepts.map((record) => (
                <button
                  key={recordKey(record)}
                  type="button"
                  className="group flex min-w-0 items-start gap-2 rounded-[8px] border border-transparent px-2.5 py-2 text-left hover:border-border hover:bg-muted/30"
                  onClick={() => onSelectRecord(record)}
                >
                  <span className="mt-1">
                    <ConceptColorIcon color={colorForGraphGroup(graphGroupForRecord(record))} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug text-foreground">{record.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {record.summary || record.content || record.id}
                    </span>
                  </span>
                  <ChevronRightIcon size={14} className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </ShadcnScrollArea>
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
      <ShadcnScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4">
          {content ? (
            <section>
              <MarkdownBlock content={content} theme={theme} sources={record.sources} defaultCodeLanguage={record.language} />
            </section>
          ) : null}

          {record.why ? (
            <ConceptSection title="Why it matters">
              <MarkdownBlock content={record.why} theme={theme} sources={record.sources} defaultCodeLanguage={record.language} />
            </ConceptSection>
          ) : null}

          {record.example || record.examples?.length ? (
            <ConceptSection title="Examples">
              <div className="flex flex-col gap-3">
                {(record.examples?.length ? record.examples : [record.example]).filter(Boolean).map((example, index) => (
                  <MarkdownBlock key={`${index}:${example}`} content={`\`\`\`${exampleLanguage(record)}\n${example}\n\`\`\``} theme={theme} defaultCodeLanguage={record.language} />
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
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t pt-3">
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-xs font-medium text-muted-foreground hover:border-border hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronRightIcon size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        Details
      </button>
      {expanded ? (
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
      ) : null}
    </section>
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

    let animationFrame = 0;
    const commitSize = (width: number, height: number) => {
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    const measureElementSize = () => {
      const rect = element.getBoundingClientRect();
      commitSize(Math.max(0, Math.floor(rect.width)), Math.max(0, Math.floor(rect.height)));
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureElementSize);
    };

    const observer = new ResizeObserver(([entry]) => {
      commitSize(Math.max(0, Math.floor(entry.contentRect.width)), Math.max(0, Math.floor(entry.contentRect.height)));
      scheduleMeasure();
    });

    observer.observe(element);
    measureElementSize();
    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasure);
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
}

function buildConceptRecordTree(records: SavedKnowledgeRecord[]): ConceptTreeRecordNode[] {
  type MutableNode = ConceptTreeRecordNode & { childMap: Map<string, MutableNode>; order: number };
  const root = new Map<string, MutableNode>();
  const recordNodes = new Map<string, MutableNode>();
  const recordsById = new Map<string, SavedKnowledgeRecord[]>();

  records.forEach((record) => {
    const list = recordsById.get(record.id) ?? [];
    list.push(record);
    recordsById.set(record.id, list);
  });

  const ensureNode = (siblings: Map<string, MutableNode>, path: string, label: string, color: string, order = 0): MutableNode => {
    const existing = siblings.get(path);
    if (existing) return existing;
    const node: MutableNode = {
      id: path,
      path,
      label,
      children: [],
      childMap: new Map(),
      count: 0,
      color,
      order
    };
    siblings.set(path, node);
    return node;
  };

  const ensureRecordNode = (record: SavedKnowledgeRecord): MutableNode => {
    const path = conceptRecordTreePath(record);
    const existing = recordNodes.get(path);
    if (existing) return existing;
    const node: MutableNode = {
      id: path,
      path,
      label: record.title,
      record,
      children: [],
      childMap: new Map(),
      count: 0,
      color: colorForGraphGroup(graphGroupForRecord(record)),
      order: records.indexOf(record)
    };
    recordNodes.set(path, node);
    return node;
  };

  const findParentRecord = (record: SavedKnowledgeRecord): SavedKnowledgeRecord | null => {
    if (record.parentId) {
      const sameProject = records.find((candidate) => candidate.id === record.parentId && candidate.sourceProjectId === record.sourceProjectId);
      if (sameProject) return sameProject;
      const crossProject = recordsById.get(record.parentId)?.[0];
      if (crossProject) return crossProject;
    }

    const parts = conceptTreePath(record);
    for (let index = parts.length - 1; index > 0; index -= 1) {
      const parentId = parts.slice(0, index).join(".");
      const sameProject = records.find((candidate) => candidate.id === parentId && candidate.sourceProjectId === record.sourceProjectId);
      if (sameProject) return sameProject;
      const crossProject = recordsById.get(parentId)?.[0];
      if (crossProject) return crossProject;
    }

    return null;
  };

  const parentRecordPaths = new Set<string>();
  for (const record of records) {
    const parent = findParentRecord(record);
    if (parent && parent !== record) parentRecordPaths.add(conceptRecordTreePath(parent));
  }

  const attachSyntheticPath = (record: SavedKnowledgeRecord, node: MutableNode) => {
    const parts = conceptTreePath(record);
    let siblings = root;
    let path = "";
    parts.slice(0, -1).forEach((part, index) => {
      path = path ? `${path}.${part}` : part;
      const label = conceptSegmentLabel(part);
      const color = colorForGraphGroup(index === 0 ? graphGroupForRecord(record) : part);
      const groupNode = ensureNode(siblings, path, label, color, index);
      siblings = groupNode.childMap;
    });
    siblings.set(node.path, node);
  };

  for (const record of records) ensureRecordNode(record);

  for (const record of records) {
    const node = ensureRecordNode(record);
    const parentRecord = findParentRecord(record);
    if (parentRecord && parentRecord !== record) {
      ensureRecordNode(parentRecord).childMap.set(node.path, node);
      continue;
    }

    if (parentRecordPaths.has(node.path)) {
      root.set(node.path, node);
      continue;
    }

    if (conceptTreePath(record).length > 1) {
      attachSyntheticPath(record, node);
      continue;
    }

    const groupPath = `group:${graphGroupForRecord(record).toLowerCase()}`;
    const groupNode = ensureNode(root, groupPath, conceptSegmentLabel(graphGroupForRecord(record)), colorForGraphGroup(graphGroupForRecord(record)));
    groupNode.childMap.set(node.path, node);
  }

  const freeze = (siblings: Map<string, MutableNode>): ConceptTreeRecordNode[] => (
    [...siblings.values()]
      .sort((a, b) => {
        if (a.record && !b.record) return 1;
        if (!a.record && b.record) return -1;
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label);
      })
      .map((node) => {
        const children = freeze(node.childMap);
        const count = (node.record && !isParentConceptStub(node.record) ? 1 : 0) + children.reduce((sum, child) => sum + child.count, 0);
        return {
          id: node.id,
          path: node.path,
          label: node.label,
          record: node.record,
          children,
          count,
          color: node.color
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

function conceptRecordTreePath(record: SavedKnowledgeRecord): string {
  return `concept:${record.sourceProjectId}:${record.id}`;
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
    const group = graphGroupForRecord(record);
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

function graphNodeValue(
  node: KnowledgeGraphNode,
  selectedKey: string | null,
  selectedPulse: number
): number {
  const selectedBoost = selectedKey === node.recordKey ? 10 + selectedPulse * 12 : 0;
  return node.val + selectedBoost;
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
): GraphCameraFlight | null {
  const initialFrame = graphCameraFocusFrame(node);
  if (!initialFrame) return null;
  const startPosition = {
    x: graph.camera().position.x,
    y: graph.camera().position.y,
    z: graph.camera().position.z
  };
  const controlsTarget = graphCameraControlsTarget(graph.controls?.());
  const startTarget = controlsTarget
    ? {
        x: controlsTarget.x,
        y: controlsTarget.y,
        z: controlsTarget.z
      }
    : { x: 0, y: 0, z: 0 };
  const direction = graphCameraApproachDirection(startPosition, initialFrame.position, initialFrame.target, fallbackDirection);
  const startedAt = performance.now();
  let animationFrame = 0;
  let canceled = false;
  const tick = () => {
    if (canceled) return;
    const frame = graphCameraFocusFrame(node);
    if (!frame) return;
    const elapsed = performance.now() - startedAt;
    const progress = Math.min(1, elapsed / transitionMs);
    const eased = graphCameraFlightEase(progress);
    graph.cameraPosition({
      x: interpolateNumber(startPosition.x, frame.position.x, eased),
      y: interpolateNumber(startPosition.y, frame.position.y, eased),
      z: interpolateNumber(startPosition.z, frame.position.z, eased)
    }, {
      x: interpolateNumber(startTarget.x, frame.target.x, eased),
      y: interpolateNumber(startTarget.y, frame.target.y, eased),
      z: interpolateNumber(startTarget.z, frame.target.z, eased)
    }, 0);
    if (progress < 1) animationFrame = window.requestAnimationFrame(tick);
  };
  animationFrame = window.requestAnimationFrame(tick);
  return {
    direction,
    cancel: () => {
      canceled = true;
      window.cancelAnimationFrame(animationFrame);
    }
  };
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

function graphCameraFlightEase(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function graphCameraControlsTarget(controls: object | undefined): { x: number; y: number; z: number } | null {
  if (!controls || !("target" in controls)) return null;
  const target = controls.target;
  if (!target || typeof target !== "object") return null;
  if (!("x" in target) || !("y" in target) || !("z" in target)) return null;
  const x = Number(target.x);
  const y = Number(target.y);
  const z = Number(target.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function interpolateNumber(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
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

function graphGroupForRecord(record: SavedKnowledgeRecord): string {
  return record.technology ?? record.language ?? record.kind ?? "concept";
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
