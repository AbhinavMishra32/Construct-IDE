import { BookOpenIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ShadcnScrollArea } from "@opaline/ui/v2";
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
    <div className="flex h-full min-h-0 flex-col bg-background p-6">
      <header className="flex shrink-0 items-end justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Local learning memory</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Knowledge Base</h1></div>
        <span className="text-xs text-muted-foreground">{records.length} saved concept{records.length === 1 ? "" : "s"}</span>
      </header>
      <div className="mt-5 flex h-9 shrink-0 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
        <SearchIcon className="size-4" /><input className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search concepts, tags, or projects" />
      </div>
      {filtered.length > 0 ? <div className="mt-5 grid min-h-0 flex-1 grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.4fr)] gap-4">
        <ShadcnScrollArea className="min-h-0 rounded-lg border"><nav className="space-y-1 p-2" aria-label="Saved concepts">
          {filtered.map((record) => <Button className="h-auto w-full justify-start px-2 py-2 text-left data-[active=true]:bg-muted" key={recordKey(record)} variant="ghost" data-active={recordKey(record) === recordKey(selected ?? record) ? "true" : undefined} onClick={() => setSelectedId(recordKey(record))}>
            <BookOpenIcon />
            <span className="min-w-0"><strong className="block truncate text-xs">{record.title}</strong><small className="block truncate text-[10px] font-normal text-muted-foreground">{record.sourceProjectTitle} · opened {record.openCount} times</small></span>
          </Button>)}
        </nav></ShadcnScrollArea>
        {selected ? <Card className="min-h-0 overflow-y-auto" size="sm">
          <CardHeader><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{selected.kind}</span><CardTitle>{selected.title}</CardTitle><CardDescription>{selected.summary}</CardDescription></CardHeader>
          <CardContent className="space-y-5"><section><h3 className="text-sm font-semibold">Why it matters</h3><p className="mt-1 text-sm text-muted-foreground">{selected.why}</p></section>
          {selected.example ? <section><h3 className="text-sm font-semibold">Example</h3><pre className="mt-2 overflow-auto rounded-md border bg-muted p-3 text-xs"><code>{selected.example}</code></pre></section> : null}
          <section className="grid grid-cols-3 gap-3 border-y py-4 text-xs">{[["Source", selected.sourceProjectTitle], ["Saved", formatDate(selected.savedAt)], ["Recall", selected.usedInRecall ? "Used" : "Not yet"]].map(([label, value]) => <div key={label}><span className="block text-muted-foreground">{label}</span><strong className="mt-0.5 block truncate font-medium">{value}</strong></div>)}</section>
          <div className="flex flex-wrap gap-2">
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
          </div></CardContent>
        </Card> : null}
      </div> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center text-muted-foreground"><BookOpenIcon className="size-8" /><h2 className="mt-3 text-sm font-semibold text-foreground">No saved concepts</h2><p className="mt-1 max-w-md text-sm">Save a concept from a project and it will appear here with its source, resources, and learning history.</p></div>}
    </div>
  );
}

function recordKey(record: SavedKnowledgeRecord): string { return `${record.sourceProjectId}:${record.id}`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
