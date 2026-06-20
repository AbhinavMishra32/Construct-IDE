import { BookOpenIcon, ChevronRightIcon, ExternalLinkIcon, FileTextIcon, FolderIcon, GitBranchIcon, HistoryIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, ShadcnScrollArea } from "@opaline/ui";

import { MarkdownBlock } from "./MarkdownBlock";
import { readKnowledgeRecords, subscribeKnowledgeRecords, type SavedKnowledgeRecord } from "../lib/knowledgeStore";
import type { AnyProjectRecord, ConceptCard } from "../types";
import { isFlowProjectRecord } from "../types";

type ConceptTreeNode = {
  id: string;
  label: string;
  children: Map<string, ConceptTreeNode>;
  records: SavedKnowledgeRecord[];
};

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
  const [selectedKey, setSelectedKey] = useState<string | null>(() => records[0] ? recordKey(records[0]) : null);

  useEffect(() => subscribeKnowledgeRecords(() => setRecords(readKnowledgeRecords())), []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) => [
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
      record.tags.join(" "),
      record.sourceProjectTitle
    ].filter(Boolean).join(" ").toLowerCase().includes(normalized));
  }, [query, records]);

  const selected = filtered.find((record) => recordKey(record) === selectedKey) ?? filtered[0] ?? null;
  const tree = useMemo(() => buildConceptTree(filtered), [filtered]);
  const flowProjectCount = isFlowProjectRecord(activeProject) ? records.filter((record) => record.sourceProjectId === activeProject.id).length : 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Global concept memory</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Concepts</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border bg-muted/30 px-2 py-1">{records.length} total</span>
          {isFlowProjectRecord(activeProject) ? <span className="rounded-full border bg-muted/30 px-2 py-1">{flowProjectCount} in this Flow</span> : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/10">
          <div className="shrink-0 border-b p-3">
            <div className="flex h-9 items-center gap-2 rounded-[8px] border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
              <SearchIcon size={15} />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search concepts..."
              />
            </div>
          </div>
          <ShadcnScrollArea className="min-h-0 flex-1">
            {filtered.length ? (
              <nav className="p-2" aria-label="Concept file tree">
                <ConceptTreeRows
                  nodes={[...tree.children.values()]}
                  selectedKey={selected ? recordKey(selected) : null}
                  onSelect={(record) => setSelectedKey(recordKey(record))}
                />
              </nav>
            ) : (
              <div className="flex h-full min-h-[18rem] flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
                <BookOpenIcon size={28} />
                <p className="mt-3 font-medium text-foreground">No concepts yet</p>
                <p className="mt-1 text-xs leading-relaxed">Flow will add concepts here as it introduces, modifies, and reviews them.</p>
              </div>
            )}
          </ShadcnScrollArea>
        </aside>

        <main className="min-h-0">
          {selected ? (
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

function ConceptTreeRows({
  nodes,
  selectedKey,
  depth = 0,
  onSelect
}: {
  nodes: ConceptTreeNode[];
  selectedKey: string | null;
  depth?: number;
  onSelect: (record: SavedKnowledgeRecord) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {nodes.sort(sortConceptNodes).map((node) => {
        const primaryRecord = newestRecord(node.records);
        const active = primaryRecord ? recordKey(primaryRecord) === selectedKey : false;
        return (
          <div key={node.id}>
            <button
              type="button"
              className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-[7px] px-2 text-left text-xs hover:bg-muted ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => primaryRecord && onSelect(primaryRecord)}
              disabled={!primaryRecord}
            >
              {node.children.size ? <FolderIcon size={14} className="shrink-0" /> : <FileTextIcon size={14} className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate font-medium">{primaryRecord?.title ?? node.label}</span>
              {node.records.length > 1 ? <span className="rounded-full border px-1.5 py-0.5 text-[10px]">{node.records.length}</span> : null}
            </button>
            {node.children.size ? (
              <ConceptTreeRows nodes={[...node.children.values()]} selectedKey={selectedKey} depth={depth + 1} onSelect={onSelect} />
            ) : null}
          </div>
        );
      })}
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
  const content = record.content || record.summary;

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
          <Button className="shrink-0" size="sm" variant="outline" onClick={() => onOpenProject(record.sourceProjectId)}>
            Open project
          </Button>
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
            <MarkdownBlock content={record.summary || "No summary recorded yet."} theme={theme} />
          </ConceptSection>

          {content && content !== record.summary ? (
            <ConceptSection title="Concept text">
              <MarkdownBlock content={content} theme={theme} />
            </ConceptSection>
          ) : null}

          {record.why ? (
            <ConceptSection title="Why it matters">
              <MarkdownBlock content={record.why} theme={theme} />
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
            <ol className="flex flex-col gap-4">
              {history.slice().reverse().map((event) => (
                <li key={event.id} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 text-sm">
                  <time className="pt-0.5 text-xs text-muted-foreground">{formatDate(event.createdAt)}</time>
                  <div className="min-w-0 border-l pl-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <HistoryIcon size={14} className="text-muted-foreground" />
                      <strong className="capitalize">{event.kind}</strong>
                      {event.confidence ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{confidenceLabel(event.confidence)}</span> : null}
                      {event.authoredBy ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.authoredBy}</span> : null}
                    </div>
                    {event.reason ? <p className="mt-1 leading-relaxed text-muted-foreground">{event.reason}</p> : null}
                    {event.confidenceReason ? <p className="mt-1 leading-relaxed text-muted-foreground">{event.confidenceReason}</p> : null}
                    {event.evidence.length ? (
                      <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        {event.evidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
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

function buildConceptTree(records: SavedKnowledgeRecord[]): ConceptTreeNode {
  const root: ConceptTreeNode = { id: "", label: "", children: new Map(), records: [] };
  for (const record of records) {
    const parts = record.id.split(".").filter(Boolean);
    let node = root;
    let id = "";
    for (const part of parts) {
      id = id ? `${id}.${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { id, label: part.replace(/-/g, " "), children: new Map(), records: [] };
        node.children.set(part, child);
      }
      node = child;
    }
    node.records.push(record);
  }
  return root;
}

function sortConceptNodes(a: ConceptTreeNode, b: ConceptTreeNode): number {
  if (a.children.size && !b.children.size) return -1;
  if (!a.children.size && b.children.size) return 1;
  return a.label.localeCompare(b.label);
}

function newestRecord(records: SavedKnowledgeRecord[]): SavedKnowledgeRecord | null {
  if (!records.length) return null;
  return records.slice().sort((a, b) => Date.parse(b.lastModifiedAt ?? b.savedAt) - Date.parse(a.lastModifiedAt ?? a.savedAt))[0] ?? null;
}

function recordKey(record: SavedKnowledgeRecord): string {
  return `${record.sourceProjectId}:${record.id}`;
}

function fallbackHistory(record: SavedKnowledgeRecord): NonNullable<ConceptCard["history"]> {
  return [{
    id: `${recordKey(record)}:latest`,
    kind: record.savedAt === record.lastModifiedAt ? "introduced" : "modified",
    reason: record.lastChangeReason ?? "Concept record saved.",
    evidence: record.learnerEvidence ?? [],
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
