import { BookOpenIcon, Code2Icon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ConceptCard } from "../types";

type ConceptSummaryCardProps = {
  concept: ConceptCard;
  compact?: boolean;
  variant?: "default" | "chat";
  actionLabel?: string;
  attention?: boolean;
  onOpen?: () => void;
};

export function ConceptSummaryCard({
  concept,
  compact = false,
  variant = "default",
  actionLabel = "Open concept",
  attention = false,
  onOpen
}: ConceptSummaryCardProps) {
  const language = languageLabel(concept);
  const showLanguageChip = variant !== "chat" || language !== "Concept";
  const summary = concept.summary || concept.guides[0]?.content || "A reusable concept in your learning memory.";
  const tagLine = concept.technology || (concept.tags.length ? concept.tags.slice(0, 3).join(" / ") : concept.id);
  const className = [
    "construct-concept-summary-card group flex w-full min-w-0 flex-col gap-2 rounded-[16px] border border-border/85 bg-card/95 text-left text-foreground transition-[background-color,border-color,box-shadow,transform] duration-200",
    compact ? "p-2.5 shadow-sm" : "shadow-sm",
    variant === "chat" ? "hover:border-border hover:bg-card hover:shadow-md active:translate-y-px" : "hover:border-border hover:bg-muted/20",
    variant === "chat" && !compact ? "p-3" : "",
    variant !== "chat" && !compact ? "p-2.5" : "",
    onOpen ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45" : ""
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2.5">
          <span className={`${compact ? "size-8 rounded-[10px]" : "size-8 rounded-[10px]"} mt-0.5 grid shrink-0 place-items-center border border-border/80 bg-background text-muted-foreground shadow-sm`}>
            <BookOpenIcon size={15} />
          </span>
          <span className="min-w-0">
            <span className="mb-1 flex min-w-0 flex-wrap items-center gap-1">
              {showLanguageChip ? <ConceptChip icon={<Code2Icon size={11} />} label={language} /> : null}
              {concept.technology ? <ConceptChip label={concept.technology} /> : null}
            </span>
            <strong className={`${compact ? "text-[13px]" : "text-sm"} block truncate font-semibold`}>{concept.title}</strong>
          </span>
        </span>
        {onOpen ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/80 bg-muted/55 px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-[background-color,color,border-color] group-hover:bg-muted">
            {actionLabel}
            <ExternalLinkIcon size={12} />
          </span>
        ) : null}
      </span>
      {!compact ? (
        <span className="line-clamp-3 text-xs leading-5 text-muted-foreground">{summary}</span>
      ) : null}
      <span className="truncate font-mono text-[10px] text-muted-foreground/80">{tagLine}</span>
    </>
  );

  if (onOpen) {
    return (
      <button type="button" className={className} data-attention={attention ? "true" : "false"} onClick={onOpen}>
        {content}
      </button>
    );
  }

  return <div className={className} data-attention={attention ? "true" : "false"}>{content}</div>;
}

function ConceptChip({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-[6px] border bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

function languageLabel(concept: ConceptCard): string {
  if (concept.language === "swift") return "Swift";
  if (concept.language === "python") return "Python";
  if (concept.language === "typescript") return "TypeScript";
  if (concept.language === "javascript") return "JavaScript";
  if (concept.language === "cpp") return "C++";
  const haystack = [concept.id, concept.title, ...concept.tags].join(" ").toLowerCase();
  if (haystack.includes("swift") || haystack.includes("swiftui")) return "Swift";
  if (haystack.includes("python")) return "Python";
  if (haystack.includes("typescript") || haystack.includes("ts.") || haystack.startsWith("ts")) return "TypeScript";
  if (haystack.includes("javascript") || haystack.includes("node")) return "JavaScript";
  if (haystack.includes("cpp") || haystack.includes("c++") || haystack.includes("opengl") || haystack.includes("glfw")) return "C++";
  return "Concept";
}
