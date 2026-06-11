import { AdaptiveSidecarSurface } from "@opaline/ui";
import { BookmarkCheckIcon, BookmarkIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
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
      className="reference-card knowledge-card"
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
      {concept.summary ? <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
      {concept.why ? (
        <section className="knowledge-card__section">
          <p className="guide-panel__label">Why it matters</p>
          <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </section>
      ) : null}
      {concept.commonMistake ? (
        <section className="knowledge-card__section">
          <p className="guide-panel__label">Common mistake</p>
          <MarkdownBlock content={concept.commonMistake} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
        </section>
      ) : null}
      {concept.guides.map((guide) => (
        <section key={guide.id} className="knowledge-card__section">
          <p className="guide-panel__label">{guideLabel(guide.guideKind)}</p>
          {guide.content ? <MarkdownBlock content={guide.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} /> : null}
          {guide.sections.map((section) => (
            <MarkdownBlock key={section.kind} content={section.content} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          ))}
        </section>
      ))}
      {concept.example ? (
        <section className="knowledge-card__section">
          <p className="guide-panel__label">Example</p>
          <MarkdownBlock content={`\`\`\`ts\n${concept.example}\n\`\`\``} theme={theme} onOpenConcept={onOpenConcept} />
        </section>
      ) : null}
      {concept.docs.length > 0 ? (
        <div className="reference-card__links">
          {concept.docs.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon size={13} />
              <span>{link.title}</span>
            </a>
          ))}
        </div>
      ) : null}
    </AdaptiveSidecarSurface>
  );
}

function guideLabel(kind: string): string {
  return kind.replace(/^guide\./, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
