import {
  BookmarkCheckIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  XIcon
} from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
import type { ConceptCard } from "../types";

export function KnowledgeCard({
  concept,
  saved,
  theme,
  onClose,
  onOpenConcept,
  onSaveChange
}: {
  concept: ConceptCard;
  saved: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onOpenConcept: (conceptId: string) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startOffsetY: number;
    minOffsetY: number;
    maxOffsetY: number;
  } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button,a")) {
      return;
    }

    const card = cardRef.current;
    if (!card) {
      return;
    }

    const rect = card.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffsetY: offsetY,
      minOffsetY: offsetY + 16 - rect.top,
      maxOffsetY: offsetY + window.innerHeight - 32 - rect.bottom
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const nextOffset = drag.startOffsetY + event.clientY - drag.startY;
    setOffsetY(clamp(nextOffset, drag.minOffsetY, drag.maxOffsetY));
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <article
      ref={cardRef}
      className="reference-card knowledge-card"
      data-dragging={dragging ? "true" : "false"}
      data-saved={saved ? "true" : "false"}
      style={{ transform: `translateY(${offsetY}px)` }}
    >
      <header
        className="reference-card__header"
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerCancel={endDrag}
        onPointerUp={endDrag}
      >
        <div>
          <p>{concept.kind}</p>
          <h3>{concept.title}</h3>
        </div>
        <div className="reference-card__actions">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand knowledge card" : "Collapse knowledge card"}
          >
            {collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} />}
          </button>
          <button
            type="button"
            onClick={() => onSaveChange(!saved)}
            aria-label={saved ? "Remove saved concept" : "Save concept"}
          >
            {saved ? <BookmarkCheckIcon size={14} /> : <BookmarkIcon size={14} />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close knowledge card">
            <XIcon size={14} />
          </button>
        </div>
      </header>
      <div className="reference-card__body-shell" data-collapsed={collapsed ? "true" : "false"}>
        <div className="reference-card__body">
          {concept.summary ? <MarkdownBlock content={concept.summary} theme={theme} onOpenConcept={onOpenConcept} /> : null}
          {concept.why ? (
            <section className="knowledge-card__section">
              <p className="guide-panel__label">Why it matters</p>
              <MarkdownBlock content={concept.why} theme={theme} onOpenConcept={onOpenConcept} />
            </section>
          ) : null}
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
        </div>
      </div>
    </article>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
