import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { decodeInlineRefHref, renderInlineRefsAsMarkdown, type InlineFileRef } from "../lib/inlineRefs";
import { cn } from "../../lib/utils";

export function MarkdownBlock({
  content,
  theme,
  className,
  onOpenConcept,
  onOpenFile
}: {
  content: string;
  theme: "light" | "dark" | "system";
  className?: string;
  onOpenConcept?: (conceptId: string) => void;
  onOpenFile?: (reference: InlineFileRef) => void;
}) {
  const [isDark, setIsDark] = useState(() => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return theme === "dark";
  });

  useEffect(() => {
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (event: MediaQueryListEvent) => setIsDark(event.matches);
      mql.addEventListener("change", handler);
      setIsDark(mql.matches);
      return () => mql.removeEventListener("change", handler);
    }

    setIsDark(theme === "dark");
  }, [theme]);

  const codeTheme = isDark ? oneDark : oneLight;

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const languageMatch = /language-([\w-]+)/.exec(className ?? "");
      const rawCode = String(children);
      const code = rawCode.replace(/\n$/, "");
      const isInlineLike = !languageMatch && !rawCode.includes("\n");

      if (isInlineLike) {
        return (
          <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="my-3 overflow-hidden rounded-lg border bg-muted/30">
          <div className="border-b bg-muted/50 px-3 py-1.5">
            <span>{languageMatch?.[1] ?? "code"}</span>
          </div>
          <SyntaxHighlighter
            style={codeTheme}
            language={languageMatch?.[1] ?? "text"}
            PreTag="div"
            className="font-mono"
            customStyle={{
              margin: 0,
              padding: "12px 14px",
              background: "transparent",
              borderRadius: 0,
              fontSize: "12px",
              lineHeight: "1.6",
              overflowX: "auto"
            }}
            codeTagProps={{
              style: {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
              }
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    },
    a({ className, ...props }) {
      const href = typeof props.href === "string" ? props.href : "";
      const reference = decodeInlineRefHref(href);
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
