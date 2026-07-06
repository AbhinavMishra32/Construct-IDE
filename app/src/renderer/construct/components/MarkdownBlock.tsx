import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLinkIcon, GlobeIcon, QuoteIcon } from "lucide-react";
import { decodeInlineRefHref, renderInlineRefsAsMarkdown, type InlineFileRef } from "../lib/inlineRefs";
import { cn } from "../../lib/utils";
import type { ConstructCitationSource } from "../../../shared/constructLearning";
import { ConstructCodeBlock, ConstructInlineCode, normalizeConstructCodeLanguage } from "./ConstructCode";

export function MarkdownBlock({
  content,
  theme,
  className,
  sources,
  defaultCodeLanguage,
  onOpenConcept,
  onOpenFile
}: {
  content: string;
  theme: "light" | "dark" | "system";
  className?: string;
  sources?: ConstructCitationSource[];
  defaultCodeLanguage?: string;
  onOpenConcept?: (conceptId: string) => void;
  onOpenFile?: (reference: InlineFileRef) => void;
}) {
  const markdownComponents: Components = {
    code({ className, children }) {
      const languageMatch = /language-([\w-]+)/.exec(className ?? "");
      const rawCode = String(children);
      const code = rawCode.replace(/\n$/, "");
      const isInlineLike = !languageMatch && !rawCode.includes("\n");
      const codeLanguage = normalizeConstructCodeLanguage(languageMatch?.[1]) ?? normalizeConstructCodeLanguage(defaultCodeLanguage);

      if (isInlineLike) {
        return (
          <ConstructInlineCode code={code} language={codeLanguage} theme={theme} />
        );
      }

      return (
        <ConstructCodeBlock code={code} language={codeLanguage} theme={theme} />
      );
    },
    a({ className, ...props }) {
      const href = typeof props.href === "string" ? props.href : "";
      const reference = decodeInlineRefHref(href);
      if (reference?.kind === "source") {
        const source = findCitationSource(sources, reference.id);
        return (
          <CitationPill
            label={String(reference.label || source?.title || reference.id)}
            source={source ?? {
              id: reference.id,
              title: String(reference.label || reference.id),
              url: ""
            }}
          />
        );
      }
      if (reference?.kind === "concept") {
        return (
          <button
            className="inline-flex rounded-md bg-primary/10 px-1.5 py-0.5 text-sm font-medium text-primary hover:bg-primary/20"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenConcept?.(reference.id);
            }}
          >
            {props.children}
          </button>
        );
      }
      if (reference?.kind === "file") {
        return (
          <button
            className="inline-flex rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/80"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenFile?.(reference);
            }}
          >
            {props.children}
          </button>
        );
      }
      const external = /^https?:\/\//.test(href);
      const source = external ? findCitationSource(sources, href) : undefined;
      if (source) {
        return (
          <CitationPill
            label={childrenText(props.children) || source.publisher || source.title}
            source={source}
          />
        );
      }
      return <a {...props} className={`font-medium text-primary underline underline-offset-4 hover:opacity-80 ${className ?? ""}`.trim()} rel={external ? "noreferrer" : props.rel} target={external ? "_blank" : props.target} />;
    },
    ul({ className, ...props }) {
      return (
        <ul
          className={`my-2 list-disc space-y-1 pl-5 ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    ol({ className, ...props }) {
      return (
        <ol
          className={`my-2 list-decimal space-y-1 pl-5 ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    li({ className, ...props }) {
      return (
        <li
          className={`pl-1 ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    table({ className, ...props }) {
      return (
        <div className="my-3 overflow-x-auto rounded-lg border">
          <table className={`w-full border-collapse text-left text-[12px] [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium ${className ?? ""}`.trim()} {...props} />
        </div>
      );
    },
    blockquote({ className, ...props }) {
      return (
        <blockquote
          className={`my-3 border-l-2 pl-4 text-muted-foreground ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    hr({ className, ...props }) {
      return <hr className={`my-4 border-border ${className ?? ""}`.trim()} {...props} />;
    }
  };

  return (
    <div className={cn("space-y-3 text-[13px] leading-relaxed text-foreground [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold [&_p]:leading-relaxed [&_strong]:font-semibold", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {renderInlineRefsAsMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function CitationPill({ label, source }: { label: string; source: ConstructCitationSource }) {
  const [open, setOpen] = useState(false);
  const title = source.title || label;
  const publisher = source.publisher || publisherFromUrl(source.url);
  const detail = source.quote || source.snippet;
  const pillClassName = "mx-0.5 inline-flex translate-y-[2px] items-center gap-1 rounded-full border border-border/70 bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground no-underline shadow-sm hover:bg-muted/80 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <span
      className="relative inline-flex align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className={pillClassName}
        >
          <GlobeIcon size={11} />
          <span className="max-w-28 truncate">{label}</span>
        </a>
      ) : (
        <button
          type="button"
          className={pillClassName}
        >
          <GlobeIcon size={11} />
          <span className="max-w-28 truncate">{label}</span>
        </button>
      )}
      {open ? (
        <span className="absolute left-0 top-full z-50 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border bg-popover p-3 text-left text-popover-foreground shadow-xl">
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground">
              <GlobeIcon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-semibold">{title}</strong>
              {publisher ? <span className="block truncate text-xs text-muted-foreground">{publisher}</span> : null}
            </span>
            {source.url ? <ExternalLinkIcon size={14} className="mt-1 shrink-0 text-muted-foreground" /> : null}
          </span>
          {detail ? (
            <span className="flex gap-2 rounded-lg border bg-muted/35 p-2 text-xs leading-relaxed text-muted-foreground">
              <QuoteIcon size={13} className="mt-0.5 shrink-0" />
              <span>{detail}</span>
            </span>
          ) : null}
          {source.url ? <span className="truncate text-[11px] text-muted-foreground">{source.url}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

function findCitationSource(sources: ConstructCitationSource[] | undefined, key: string): ConstructCitationSource | undefined {
  if (!key) return undefined;
  return sources?.find((source) => source.id === key || source.url === key);
}

function publisherFromUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function childrenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(childrenText).join("");
  return "";
}
