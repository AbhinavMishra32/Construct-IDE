import { BookOpenIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@opaline/ui";
import { readKnowledgeRecords, subscribeKnowledgeRecords, type SavedKnowledgeRecord } from "../lib/knowledgeStore";

export function KnowledgeBaseSurface({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const [records, setRecords] = useState<SavedKnowledgeRecord[]>(() => readKnowledgeRecords());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => records[0] ? recordKey(records[0]) : null);

  useEffect(() => subscribeKnowledgeRecords(() => setRecords(readKnowledgeRecords())), []);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) => [record.title, record.summary, record.kind, record.tags.join(" "), record.sourceProjectTitle].join(" ").toLowerCase().includes(normalized));
  }, [query, records]);
  const selected = filtered.find((record) => recordKey(record) === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="knowledge-base-surface">
      <header className="knowledge-base-surface__header">
        <div><p>Local learning memory</p><h1>Knowledge Base</h1></div>
        <span>{records.length} saved concept{records.length === 1 ? "" : "s"}</span>
      </header>
      <div className="knowledge-base-surface__search">
        <SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search concepts, tags, or projects" />
      </div>
      {filtered.length > 0 ? <div className="knowledge-base-surface__layout">
        <nav className="knowledge-base-surface__list" aria-label="Saved concepts">
          {filtered.map((record) => <button key={recordKey(record)} data-active={recordKey(record) === recordKey(selected ?? record) ? "true" : undefined} onClick={() => setSelectedId(recordKey(record))}>
            <BookOpenIcon />
            <span><strong>{record.title}</strong><small>{record.sourceProjectTitle} · opened {record.openCount} times</small></span>
          </button>)}
        </nav>
        {selected ? <article className="knowledge-base-surface__detail">
          <div className="knowledge-base-surface__detail-heading"><span>{selected.kind}</span><h2>{selected.title}</h2><p>{selected.summary}</p></div>
          <section><h3>Why it matters</h3><p>{selected.why}</p></section>
          {selected.example ? <section><h3>Example</h3><pre><code>{selected.example}</code></pre></section> : null}
          <section className="knowledge-base-surface__metadata"><div><span>Source</span><strong>{selected.sourceProjectTitle}</strong></div><div><span>Saved</span><strong>{formatDate(selected.savedAt)}</strong></div><div><span>Recall</span><strong>{selected.usedInRecall ? "Used" : "Not yet"}</strong></div></section>
          <div className="knowledge-base-surface__actions">
            <Button variant="secondary" onClick={() => onOpenProject(selected.sourceProjectId)}>Open project</Button>
            {selected.docs[0] ? (
              <Button
                variant="secondary"
                onClick={() => window.open(selected.docs[0]?.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLinkIcon />
                Open docs
              </Button>
            ) : null}
          </div>
        </article> : null}
      </div> : <div className="knowledge-base-surface__empty"><BookOpenIcon /><h2>No saved concepts</h2><p>Save a concept from a project and it will appear here with its source, resources, and learning history.</p></div>}
    </div>
  );
}

function recordKey(record: SavedKnowledgeRecord): string { return `${record.sourceProjectId}:${record.id}`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
