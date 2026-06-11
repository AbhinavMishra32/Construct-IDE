import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { decodeInlineRefHref, renderInlineRefsAsMarkdown, type InlineFileRef } from "../lib/inlineRefs";

export function MarkdownBlock({
  content,
  theme,
  onOpenConcept,
  onOpenFile
}: {
  content: string;
  theme: "light" | "dark" | "system";
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
          <code className="construct-markdown-inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="construct-markdown-code-frame">
          <div className="construct-markdown-code-header">
            <span>{languageMatch?.[1] ?? "code"}</span>
          </div>
          <SyntaxHighlighter
            style={codeTheme}
            language={languageMatch?.[1] ?? "text"}
            PreTag="div"
            className="construct-markdown-code-block"
            customStyle={{
              margin: 0,
              padding: "12px 14px",
              background: "transparent",
              borderRadius: 0,
              fontSize: "12.5px",
              lineHeight: "1.6",
              overflowX: "auto"
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--opaline-font-mono)"
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
            className="construct-concept-chip"
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
            className="construct-file-ref"
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
      return <a {...props} className={`construct-markdown-link ${className ?? ""}`.trim()} rel={external ? "noreferrer" : props.rel} target={external ? "_blank" : props.target} />;
    },
    ul({ className, ...props }) {
      return (
        <ul
          className={`construct-markdown-list construct-markdown-list--unordered ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    ol({ className, ...props }) {
      return (
        <ol
          className={`construct-markdown-list construct-markdown-list--ordered ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    li({ className, ...props }) {
      return (
        <li
          className={`construct-markdown-list-item ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    table({ className, ...props }) {
      return (
        <div className="construct-markdown-table-wrap">
          <table className={`construct-markdown-table ${className ?? ""}`.trim()} {...props} />
        </div>
      );
    },
    blockquote({ className, ...props }) {
      return (
        <blockquote
          className={`construct-markdown-quote ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    hr({ className, ...props }) {
      return <hr className={`construct-markdown-divider ${className ?? ""}`.trim()} {...props} />;
    }
  };

  return (
    <div className="construct-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {renderInlineRefsAsMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
