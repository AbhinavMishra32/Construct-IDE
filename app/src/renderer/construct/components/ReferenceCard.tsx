import { AdaptiveSidecarSurface } from "@opaline/ui/v2";
import { LocateFixedIcon } from "lucide-react";
import { useState } from "react";

import { MarkdownBlock } from "./MarkdownBlock";
import type { ReferenceCard as ReferenceCardModel } from "../types";
import type { InlineFileRef } from "../lib/inlineRefs";

export function ReferenceCard({
  card,
  pinned,
  theme,
  onClose,
  onPinChange,
  onOpenLink,
  onOpenFile
}: {
  card: ReferenceCardModel;
  pinned: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onPinChange: (pinned: boolean) => void;
  onOpenLink: (link: ReferenceCardModel["links"][number]) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AdaptiveSidecarSurface
      className="reference-card"
      data-construct-explainable="knowledge-card"
      data-construct-explainable-label={card.title}
      draggable
      eyebrow={card.kind}
      title={card.title}
      collapsed={collapsed}
      pinned={pinned}
      onCollapsedChange={setCollapsed}
      onPinnedChange={onPinChange}
      onClose={onClose}
      closeLabel="Close reference card"
      collapseLabel="Collapse reference card"
      expandLabel="Expand reference card"
      pinLabel="Pin reference card"
      unpinLabel="Unpin reference card"
    >
      <div className="reference-card__reveal">{card.reveal}</div>
      <MarkdownBlock content={card.body} theme={theme} onOpenFile={onOpenFile} />
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
    </AdaptiveSidecarSurface>
  );
}
