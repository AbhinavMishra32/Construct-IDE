import {
  ChevronDownIcon,
  ChevronUpIcon,
  LocateFixedIcon,
  PinIcon,
  PinOffIcon,
  XIcon
} from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
import type { ReferenceCard as ReferenceCardModel } from "../types";

export function ReferenceCard({
  card,
  pinned,
  theme,
  onClose,
  onPinChange,
  onOpenLink
}: {
  card: ReferenceCardModel;
  pinned: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onPinChange: (pinned: boolean) => void;
  onOpenLink: (link: ReferenceCardModel["links"][number]) => void;
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
    if ((event.target as HTMLElement).closest("button")) {
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
      className="reference-card"
      data-construct-explainable="knowledge-card"
      data-construct-explainable-label={card.title}
      data-dragging={dragging ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
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
          <p>{card.kind}</p>
          <h3>{card.title}</h3>
        </div>
        <div className="reference-card__actions">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand reference card" : "Collapse reference card"}
          >
            {collapsed ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} />}
          </button>
          <button
            type="button"
            onClick={() => onPinChange(!pinned)}
            aria-label={pinned ? "Unpin reference card" : "Pin reference card"}
          >
            {pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close reference card">
            <XIcon size={14} />
          </button>
        </div>
      </header>
      <div className="reference-card__body-shell" data-collapsed={collapsed ? "true" : "false"}>
        <div className="reference-card__body">
          <div className="reference-card__reveal">{card.reveal}</div>
          <MarkdownBlock content={card.body} theme={theme} />
          {card.links.length > 0 ? (
            <div className="reference-card__links">
              {card.links.map((link, index) => (
                <button
                  key={`${link.anchor ?? link.file ?? "link"}:${index}`}
                  type="button"
                  onClick={() => onOpenLink(link)}
                >
                  <LocateFixedIcon size={13} />
                  <span>{link.label ?? link.anchor ?? link.file ?? "Open source"}</span>
                </button>
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
