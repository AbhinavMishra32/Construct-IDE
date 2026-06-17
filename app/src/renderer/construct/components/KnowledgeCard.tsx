import { AdaptiveSidecarSurface } from "@opaline/ui";
import { BookmarkCheckIcon, BookmarkIcon, ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
import { ConceptSummaryCard } from "./ConceptSummaryCard";
import type { ConceptCard } from "../types";
import type { InlineFileRef } from "../lib/inlineRefs";

export function KnowledgeCard({
  concept,
  saved,
  theme,
  onClose,
  onOpenConcept,
  onOpenFile,
  onSaveChange
}: {
  concept: ConceptCard;
  saved: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AdaptiveSidecarSurface
      data-construct-explainable="knowledge-card"
      data-construct-explainable-label={concept.title}
      data-saved={saved ? "true" : "false"}
      draggable
      eyebrow={concept.kind}
      title={concept.title}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onClose={onClose}
      closeLabel="Close knowledge card"
      collapseLabel="Collapse knowledge card"
      expandLabel="Expand knowledge card"
      actions={(
        <button
          type="button"
          onClick={() => onSaveChange(!saved)}
          aria-label={saved ? "Remove saved concept" : "Save concept"}
          title={saved ? "Remove saved concept" : "Save concept"}
        >
          {saved ? <BookmarkCheckIcon size={14} /> : <BookmarkIcon size={14} />}
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <ConceptSummaryCard concept={concept} />
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {concept.language ? (
            <span className="rounded-full border bg-background/70 px-2 py-0.5 font-medium text-muted-foreground">{concept.language}</span>
          ) : null}
          {concept.technology ? (
            <span className="rounded-full border bg-background/70 px-2 py-0.5 font-medium text-muted-foreground">{concept.technology}</span>
          ) : null}
          <span className="rounded-full border bg-background/70 px-2 py-0.5 font-mono text-muted-foreground">{concept.id}</span>
        </div>
      </div>
      {concept.summary ? (
        <ConceptSidecarSection title="Summary" defaultOpen>
          <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </ConceptSidecarSection>
      ) : null}
      {concept.why ? (
        <ConceptSidecarSection title="Why it matters">
          <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </ConceptSidecarSection>
      ) : null}
      {concept.commonMistake ? (
        <ConceptSidecarSection title="Common mistake">
          <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </ConceptSidecarSection>
      ) : null}
      {concept.guides.map((guide) => (
        <ConceptSidecarSection key={guide.id} title={guideLabel(guide.guideKind)} defaultOpen>
          {guide.content ? <MarkdownBlock content={guide.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
          {guide.sections.map((section) => (
            <MarkdownBlock key={section.kind} content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          ))}
        </ConceptSidecarSection>
      ))}
      {concept.example ? (
        <ConceptSidecarSection title="Example">
          <MarkdownBlock content={`\`\`\`${exampleLanguage(concept)}\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={onOpenConcept} />
        </ConceptSidecarSection>
      ) : null}
      {concept.docs.length > 0 ? (
        <ConceptSidecarSection title="Docs">
          {concept.docs.map((link) => (
            <a className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" key={link.url} href={link.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon size={13} />
              <span>{link.title}</span>
            </a>
          ))}
        </ConceptSidecarSection>
      ) : null}
    </AdaptiveSidecarSurface>
  );
}

function ConceptSidecarSection({
  title,
  defaultOpen = false,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="construct-sidecar-accordion" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <ChevronDownIcon size={14} />
      </summary>
      <div className="construct-sidecar-accordion__content">
        {children}
      </div>
    </details>
  );
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
