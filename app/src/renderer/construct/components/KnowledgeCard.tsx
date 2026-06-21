import { BookmarkCheckIcon, BookmarkIcon, ChevronRightIcon, ExternalLinkIcon, FileTextIcon, FolderIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
import type { ConceptCard } from "../types";
import type { InlineFileRef } from "../lib/inlineRefs";
import { cn } from "../../lib/utils";

export function KnowledgeCard({
  concept,
  relatedConcepts = [],
  saved,
  theme,
  onClose,
  onOpenConcept,
  onOpenFile,
  onSaveChange
}: {
  concept: ConceptCard;
  relatedConcepts?: ConceptCard[];
  saved: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  const related = buildConceptFiles(concept, relatedConcepts);
  const history = concept.history?.length ? concept.history : buildFallbackHistory(concept);
  const guideBlocks = concept.guides.filter((guide) => guide.content || guide.sections.length);

  return (
    <section
      className="opaline-overlay-shadow flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[18px] border border-border/80 bg-popover/92 text-sm text-popover-foreground backdrop-blur-xl backdrop-saturate-150"
      data-construct-explainable="concept-card"
      data-construct-explainable-label={concept.title}
      data-saved={saved ? "true" : "false"}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 bg-background/35 px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">Concept</span>
            {concept.confidence ? <span className="rounded-full border px-1.5 py-0.5">{confidenceLabel(concept.confidence)}</span> : null}
            {concept.technology ? <span className="rounded-full border px-1.5 py-0.5">{concept.technology}</span> : null}
          </div>
          <h2 className="truncate text-base font-semibold tracking-tight">{concept.title}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{concept.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onSaveChange(!saved)}
            aria-label={saved ? "Remove saved concept" : "Save concept"}
            title={saved ? "Remove saved concept" : "Save concept"}
          >
            {saved ? <BookmarkCheckIcon size={15} /> : <BookmarkIcon size={15} />}
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label="Close concept"
            title="Close concept"
          >
            <XIcon size={15} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {concept.language ? <ConceptPill>{languageLabel(concept.language)}</ConceptPill> : null}
          {concept.authoredBy ? <ConceptPill>authored by {concept.authoredBy}</ConceptPill> : null}
          {typeof concept.agentContributionPercent === "number" ? <ConceptPill>agent {concept.agentContributionPercent}%</ConceptPill> : null}
          {concept.lastModifiedAt ? <ConceptPill>updated {formatShortDate(concept.lastModifiedAt)}</ConceptPill> : null}
        </div>

        {related.length ? (
          <ConceptBlock title="Concept files">
            <div className="flex flex-col gap-0.5">
              {related.map((item) => (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs hover:bg-muted",
                    item.id === concept.id && "bg-muted/60 text-foreground"
                  )}
                  style={{ paddingLeft: `${8 + item.depth * 14}px` }}
                  onClick={() => item.id !== concept.id && onOpenConcept(item.id)}
                >
                  {item.kind === "folder" ? <FolderIcon size={14} className="shrink-0 text-muted-foreground" /> : <FileTextIcon size={14} className="shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.id !== concept.id ? <ChevronRightIcon size={13} className="shrink-0 text-muted-foreground" /> : null}
                </button>
              ))}
            </div>
          </ConceptBlock>
        ) : null}

        {concept.summary ? (
          <ConceptBlock title="Summary">
            <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </ConceptBlock>
        ) : null}

        {guideBlocks.map((guide) => (
          <ConceptBlock key={guide.id} title={guideLabel(guide.guideKind)}>
            {guide.content ? <MarkdownBlock content={guide.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
            {guide.sections.map((section) => (
              <MarkdownBlock key={section.kind} content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
            ))}
          </ConceptBlock>
        ))}

        {concept.why ? (
          <ConceptBlock title="Why">
            <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </ConceptBlock>
        ) : null}

        {concept.commonMistake ? (
          <ConceptBlock title="Common mistake">
            <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </ConceptBlock>
        ) : null}

        {concept.example ? (
          <ConceptBlock title="Example">
            <MarkdownBlock content={`\`\`\`${exampleLanguage(concept)}\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          </ConceptBlock>
        ) : null}

        {(concept.learnerEvidence?.length || concept.confidenceReason || concept.lastChangeReason) ? (
          <ConceptBlock title="Evidence">
            <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              {concept.lastChangeReason ? <p><strong className="text-foreground">Why now:</strong> {concept.lastChangeReason}</p> : null}
              {concept.confidenceReason ? <p><strong className="text-foreground">Learning state:</strong> {concept.confidenceReason}</p> : null}
              {concept.learnerEvidence?.length ? (
                <ul className="flex flex-col gap-1">
                  {concept.learnerEvidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
                </ul>
              ) : null}
            </div>
          </ConceptBlock>
        ) : null}

        {history.length ? (
          <ConceptBlock title="History">
            <ol className="flex flex-col gap-3">
              {history.slice().reverse().map((event) => (
                <li key={event.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-xs">
                  <time className="pt-0.5 text-[11px] text-muted-foreground">{formatShortDate(event.createdAt)}</time>
                  <div className="min-w-0 border-l pl-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <strong className="capitalize text-foreground">{event.kind}</strong>
                      {event.changedFields?.length ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.changedFields.length} fields</span> : null}
                      {event.confidence ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{confidenceLabel(event.confidence)}</span> : null}
                      {event.authoredBy ? <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.authoredBy}</span> : null}
                    </div>
                    {event.reason ? <p className="mt-1 leading-relaxed text-muted-foreground">{event.reason}</p> : null}
                    {event.confidenceReason ? <p className="mt-1 leading-relaxed text-muted-foreground">{event.confidenceReason}</p> : null}
                    {(event.provenance || event.fieldChanges?.length) ? (
                      <details className="mt-2 rounded-[8px] border bg-muted/20 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Inspect change</summary>
                        {event.provenance ? (
                          <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
                            <p><strong className="text-foreground">Project:</strong> {event.provenance.projectTitle}</p>
                            {event.provenance.pathNodeTitle || event.provenance.pathNodeId ? <p><strong className="text-foreground">Path:</strong> {event.provenance.pathNodeTitle ?? event.provenance.pathNodeId}</p> : null}
                            {event.provenance.taskTitle || event.provenance.taskId ? <p><strong className="text-foreground">Task:</strong> {event.provenance.taskTitle ?? event.provenance.taskId}</p> : null}
                            {event.provenance.focusPath ? <p><strong className="text-foreground">Focus:</strong> <code>{event.provenance.focusPath}</code></p> : null}
                            {event.provenance.taskFiles?.length ? <p><strong className="text-foreground">Files:</strong> {event.provenance.taskFiles.join(", ")}</p> : null}
                          </div>
                        ) : null}
                        {event.fieldChanges?.length ? (
                          <div className="mt-2 flex flex-col gap-2">
                            {event.fieldChanges.map((change) => (
                              <div key={`${event.id}:${change.field}`} className="rounded-[6px] border bg-background/60 p-2">
                                <div className="text-[11px] font-medium text-foreground">{fieldLabel(change.field)}</div>
                                <div className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
                                  <AuditValue label="Before" value={change.before} />
                                  <AuditValue label="After" value={change.after} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </details>
                    ) : null}
                    {event.evidence.length ? (
                      <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                        {event.evidence.map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </ConceptBlock>
        ) : null}

        {concept.docs.length > 0 ? (
          <ConceptBlock title="Docs">
            <div className="flex flex-col gap-1">
              {concept.docs.map((link) => (
                <a className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" key={link.url} href={link.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon size={13} />
                  <span>{link.title}</span>
                </a>
              ))}
            </div>
          </ConceptBlock>
        ) : null}
      </div>
    </section>
  );
}

function ConceptBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ConceptPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

function AuditValue({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-[6px] bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{value ?? "not set"}</pre>
    </div>
  );
}

function buildConceptFiles(concept: ConceptCard, concepts: ConceptCard[]) {
  const rows: Array<{ id: string; title: string; depth: number; kind: "folder" | "file" }> = [];
  const segments = concept.id.split(".").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const id = segments.slice(0, index).join(".");
    rows.push({
      id,
      title: concepts.find((item) => item.id === id)?.title ?? conceptTitleFromId(id),
      depth: index - 1,
      kind: "folder"
    });
  }
  rows.push({ id: concept.id, title: concept.title, depth: Math.max(0, segments.length - 1), kind: "file" });

  const childPrefix = `${concept.id}.`;
  const directChildren = concepts
    .filter((item) => item.id.startsWith(childPrefix))
    .filter((item) => item.id.slice(childPrefix.length).split(".").filter(Boolean).length === 1)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const child of directChildren) {
    rows.push({
      id: child.id,
      title: child.title,
      depth: segments.length,
      kind: "file"
    });
  }

  for (const relatedId of concept.relatedConcepts ?? []) {
    if (rows.some((row) => row.id === relatedId)) continue;
    const related = concepts.find((item) => item.id === relatedId);
    rows.push({
      id: relatedId,
      title: related?.title ?? conceptTitleFromId(relatedId),
      depth: 0,
      kind: "file"
    });
  }

  return rows;
}

function buildFallbackHistory(concept: ConceptCard): NonNullable<ConceptCard["history"]> {
  if (!concept.lastChangeReason && !concept.savedAt && !concept.lastModifiedAt) return [];
  return [{
    id: `${concept.id}:latest`,
    kind: concept.savedAt === concept.lastModifiedAt ? "introduced" : "modified",
    reason: concept.lastChangeReason ?? "Concept record changed.",
    evidence: concept.learnerEvidence ?? [],
    changedFields: [],
    fieldChanges: [],
    confidence: concept.confidence,
    confidenceReason: concept.confidenceReason,
    authoredBy: concept.authoredBy,
    agentContributionPercent: concept.agentContributionPercent,
    createdAt: concept.lastModifiedAt ?? concept.savedAt ?? new Date().toISOString()
  }];
}

function conceptTitleFromId(id: string): string {
  return id
    .split(".")
    .filter(Boolean)
    .map((part) => part.replace(/-/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ") || id;
}

function confidenceLabel(value: string): string {
  return value.replace(/-/g, " ");
}

function fieldLabel(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function guideLabel(kind: string): string {
  return kind.replace(/^guide\./, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function exampleLanguage(concept: ConceptCard): string {
  if (concept.language === "swift") return "swift";
  if (concept.language === "python") return "python";
  if (concept.language === "javascript") return "javascript";
  if (concept.language === "cpp") return "cpp";
  return "ts";
}

function languageLabel(value: string): string {
  if (value === "swift") return "Swift";
  if (value === "python") return "Python";
  if (value === "typescript") return "TypeScript";
  if (value === "javascript") return "JavaScript";
  if (value === "cpp") return "C++";
  return "Language neutral";
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
