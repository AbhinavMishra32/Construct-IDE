import { BookOpenIcon, Code2Icon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ConceptCard } from "../types";

type ConceptSummaryCardProps = {
  concept: ConceptCard;
  compact?: boolean;
  variant?: "default" | "chat";
  actionLabel?: string;
  onOpen?: () => void;
};

export function ConceptSummaryCard({
  concept,
  compact = false,
  variant = "default",
  actionLabel = "Open concept",
  onOpen
}: ConceptSummaryCardProps) {
  const language = languageLabel(concept);
  const summary = concept.summary || concept.guides[0]?.content || "A reusable concept in your learning memory.";
  const tagLine = concept.technology || (concept.tags.length ? concept.tags.slice(0, 3).join(" / ") : concept.id);
  const className = [
    "group flex w-full min-w-0 flex-col gap-2 rounded-[8px] border border-border/70 bg-card/82 text-left text-foreground transition-[background-color,border-color,box-shadow] duration-200",
    compact ? "p-2 shadow-none" : "shadow-sm",
    variant === "chat" ? "hover:border-border hover:bg-card" : "hover:border-border hover:bg-muted/20",
    variant === "chat" && !compact ? "p-3" : "",
    variant !== "chat" && !compact ? "p-2.5" : "",
    onOpen ? "cursor-pointer hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45" : ""
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2.5">
          <span className={`${compact ? "size-7 rounded-[7px]" : "size-8 rounded-[8px]"} mt-0.5 grid shrink-0 place-items-center border bg-background text-muted-foreground`}>
            <BookOpenIcon size={15} />
          </span>
          <span className="min-w-0">
            <span className="mb-1 flex min-w-0 flex-wrap items-center gap-1">
              <ConceptChip icon={<Code2Icon size={11} />} label={language} />
              {concept.technology ? <ConceptChip label={concept.technology} /> : null}
            </span>
            <strong className={`${compact ? "text-[13px]" : "text-sm"} block truncate font-semibold`}>{concept.title}</strong>
          </span>
        </span>
        {onOpen ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-[background-color,color,border-color] group-hover:border-border group-hover:bg-muted group-hover:text-foreground">
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
      <button type="button" className={className} onClick={onOpen}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
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
