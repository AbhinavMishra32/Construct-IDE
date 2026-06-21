import { BookOpenIcon, Code2Icon, ExternalLinkIcon, ChevronRightIcon, LightbulbIcon, BrainCircuitIcon, RouteIcon, AtomIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ConceptCard } from "../types";
import { cn } from "../../lib/utils";

type ConceptSummaryCardProps = {
  concept: ConceptCard;
  compact?: boolean;
  variant?: "default" | "chat";
  actionLabel?: string;
  attention?: boolean;
  onOpen?: () => void;
};

function ConceptStatusChip({ label, tone }: { label: string; tone?: "added" | "modified" | "removed" }) {
  const isAdded = label.toLowerCase().includes("introduc");
  const isRemoved = label.toLowerCase().includes("remov");
  const isModified = label.toLowerCase().includes("modif");

  const toneClass =
    tone === "added" ? "border-[color:var(--construct-success)]/35 bg-[color:var(--construct-success-soft)] text-[color:var(--construct-success)]" :
    tone === "modified" ? "border-[color:var(--construct-warning)]/35 bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]" :
    tone === "removed" ? "border-destructive/30 bg-destructive/10 text-destructive" :
    "border-border/80 bg-foreground text-background";

  return (
    <span className={cn(
      "inline-flex max-w-full items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium border",
      toneClass
    )}>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function ConceptSummaryCard({
  concept,
  compact = false,
  variant = "default",
  actionLabel = "Open concept",
  attention = false,
  onOpen
}: ConceptSummaryCardProps) {
  const language = languageLabel(concept);

  if (variant === "chat") {
    const isAdded = actionLabel.toLowerCase().includes("introduc") || actionLabel.toLowerCase().includes("added");
    const isRemoved = actionLabel.toLowerCase().includes("remov");
    const isModified = actionLabel.toLowerCase().includes("modif");

    const statusText = isAdded ? "New" : isModified ? "Updated" : isRemoved ? "Removed" : "";
    const statusColor = isAdded ? "text-[color:var(--construct-success)] font-medium" : isModified ? "text-[color:var(--construct-warning)] font-medium" : isRemoved ? "text-destructive font-medium" : "";

    const iconClass = "border-border/70 bg-background/80 text-muted-foreground";

    return (
      <button
        type="button"
        className={cn(
          "construct-concept-summary-card group flex w-full max-w-[32rem] min-w-0 items-center justify-between gap-2.5 rounded-[12px] border border-border/60 bg-muted/30 p-2.5 text-left text-foreground hover:bg-muted/65 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 cursor-default"
        )}
        data-attention={attention ? "true" : "false"}
        onClick={onOpen}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-[8px] border shadow-sm group-hover:scale-95", iconClass)}>
            <AtomIcon size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <span>{language} Concept</span>
              {statusText ? (
                <>
                  <span>·</span>
                  <span className={statusColor}>{statusText}</span>
                </>
              ) : null}
            </div>
            <strong className="block truncate text-sm font-semibold text-foreground tracking-tight group-hover:text-foreground/90">
              {concept.title}
            </strong>
          </div>
        </div>
        {onOpen ? (
          <ChevronRightIcon size={15} className="shrink-0 text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:text-foreground" />
        ) : null}
      </button>
    );
  }

  const showLanguageChip = language !== "Concept";
  const summary = concept.summary || concept.guides[0]?.content || "A reusable concept in your learning memory.";
  const tagLine = concept.technology || (concept.tags.length ? concept.tags.slice(0, 3).join(" / ") : concept.id);
  const className = [
    "construct-concept-summary-card group flex w-full min-w-0 flex-col gap-2 rounded-[8px] border border-border/70 bg-card/82 text-left text-foreground transition-[background-color,border-color,box-shadow] duration-200",
    compact ? "p-2.5 shadow-sm" : "shadow-sm",
    "hover:border-border hover:bg-muted/20",
    !compact ? "p-2.5" : "",
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
