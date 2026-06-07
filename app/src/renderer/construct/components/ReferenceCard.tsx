import {
  ChevronDownIcon,
  ChevronUpIcon,
  LocateFixedIcon,
  PinIcon,
  PinOffIcon,
  XIcon
} from "lucide-react";
import { useState } from "react";

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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <article className="reference-card" data-pinned={pinned ? "true" : "false"}>
      <header className="reference-card__header">
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
      {!collapsed ? (
        <>
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
        </>
      ) : null}
    </article>
  );
}
