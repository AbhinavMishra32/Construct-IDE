import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  PlayIcon,
  TerminalIcon
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";

import { Button } from "@/components/open-shell";

import { blockLabel, currentBlockNumber, totalBlocks } from "../lib/runtime";
import type { ConstructBlock, ProjectRecord } from "../types";

function MarkdownBlock({ content, theme }: { content: string; theme: "light" | "dark" | "system" }) {
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
    } else {
      setIsDark(theme === "dark");
    }
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
                fontFamily: "var(--codex-font-mono)"
              }
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    },
    a({ className, ...props }) {
      return <a className={`construct-markdown-link ${className ?? ""}`.trim()} {...props} />;
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
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function GuidePanel({
  project,
  block,
  theme,
  editComplete,
  onNext,
  onRunCommand
}: {
  project: ProjectRecord;
  block: ConstructBlock | null;
  theme: "light" | "dark" | "system";
  editComplete: boolean;
  onNext: () => void;
  onRunCommand: (command: string, cwd: string) => void;
}) {
  if (!block) {
    return (
      <aside className="guide-panel">
        <p className="eyebrow">Complete</p>
        <h2>Project finished</h2>
      </aside>
    );
  }

  const canContinue = block.kind !== "edit" || editComplete;

  return (
    <aside className="guide-panel">
      <div className="guide-panel__meta">
        <span>{blockLabel(block)}</span>
        <span>
          {currentBlockNumber(project)} / {totalBlocks(project.program)}
        </span>
      </div>
      <h2>{project.program.steps[project.currentStepIndex]?.title}</h2>
      <GuideBlock block={block} theme={theme} onRunCommand={onRunCommand} />
      <div className="guide-panel__actions">
        {block.kind === "run" ? (
          <Button variant="secondary" onClick={() => onRunCommand(block.command, block.cwd)}>
            <PlayIcon size={15} />
            Run
          </Button>
        ) : null}
        <Button onClick={onNext} disabled={!canContinue}>
          {block.kind === "checkpoint" ? (
            <CheckCircle2Icon size={15} />
          ) : (
            <ChevronRightIcon size={15} />
          )}
          Continue
        </Button>
      </div>
    </aside>
  );
}

function GuideBlock({
  block,
  theme,
  onRunCommand
}: {
  block: ConstructBlock;
  theme: "light" | "dark" | "system";
  onRunCommand: (command: string, cwd: string) => void;
}) {
  if (block.kind === "run") {
    return (
      <div className="guide-block">
        <div className="run-command">
          <TerminalIcon size={15} />
          <code>{block.command}</code>
        </div>
        <p className="guide-panel__copy">cwd: {block.cwd}</p>
      </div>
    );
  }

  if (block.kind === "edit") {
    return (
      <div className="guide-block">
        <p className="guide-panel__copy">
          Type the ghost text in <code>{block.path}</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="guide-block">
      <MarkdownBlock content={block.content} theme={theme} />
    </div>
  );
}
