import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { useCodeTheme } from "@/hooks/use-code-theme";
import { highlight, type Span } from "@/lib/highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseReference, Reference, useMarkdownLinks } from "./MarkdownLinks";
import { parse, type Block } from "./markdownBlocks";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";

/** Inline spans: `code`, **bold**, *italic*, and bare links rendered as plain text.
 *
 *  Exported because the thread is not the only place agent prose appears. A
 *  question the agent asks is written in the same language as the message
 *  before it, references and all, and rendering it as a bare string is what
 *  made `[[file:main.py|main.py]]` show up literally in the question card. */
export function Inline({ text }: { text: string }) {
  const nodes = useMemo(() => {
    /* References first, so a `[[file:a_b.c|x]]` is not torn apart by the
       emphasis rule looking at its underscores. */
    const pattern = /(\[\[(?:concept|file):[^\]]+\]\])|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
    const result: Array<{ key: string; node: React.ReactNode }> = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        result.push({ key: `t${cursor}`, node: text.slice(cursor, match.index) });
      }
      const value = match[0];
      const reference = value.startsWith("[[") ? parseReference(value) : null;
      if (reference) {
        result.push({
          key: `r${match.index}`,
          node: <Reference kind={reference.kind} label={reference.label} target={reference.target} />,
        });
      } else if (value.startsWith("`")) {
        result.push({ key: `c${match.index}`, node: <InlineCode body={value.slice(1, -1)} /> });
      } else if (value.startsWith("**")) {
        /* Recursed, not printed. Emphasis wins the match at its own index, so a
           reference or a code span inside it was consumed whole and rendered as
           the raw string — which is why `[[file:main.py|main.py]]` showed as
           itself the moment it appeared inside a bold sentence. The inner text
           is strictly shorter and its delimiters are stripped, so this
           terminates. */
        result.push({
          key: `b${match.index}`,
          node: (
            <strong className="font-semibold">
              <Inline text={value.slice(2, -2)} />
            </strong>
          ),
        });
      } else {
        result.push({
          key: `i${match.index}`,
          node: (
            <em>
              <Inline text={value.slice(1, -1)} />
            </em>
          ),
        });
      }
      cursor = match.index + value.length;
    }
    if (cursor < text.length) result.push({ key: `t${cursor}`, node: text.slice(cursor) });
    return result;
  }, [text]);

  return (
    <>
      {nodes.map((item) => (
        <Fragment key={item.key}>{item.node}</Fragment>
      ))}
    </>
  );
}

/**
 * Inline code, coloured by the same theme the editor uses.
 *
 * A fenced block names its language; an inline span cannot, so this takes the
 * project's — a snippet in a Python project is Python. When there is no
 * language to guess with, or the fragment does not parse as one, the spans come
 * back uncoloured and it renders exactly as it did before: a plain chip. That
 * fallback is why this is safe to run on every `torch.zeros` in a transcript.
 */
function InlineCode({ body }: { body: string }) {
  const { language } = useMarkdownLinks();
  const { theme } = useCodeTheme();
  const [spans, setSpans] = useState<Span[] | null>(null);

  useEffect(() => {
    if (!language) return;
    let alive = true;
    void highlight(body, language).then((next) => {
      if (alive) setSpans(next);
    });
    return () => {
      alive = false;
    };
  }, [body, language]);

  return (
    <code className="code-inline">
      {spans
        ? spans.map((span, index) => (
            <span key={index} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>
              {span.text}
            </span>
          ))
        : body}
    </code>
  );
}

/**
 * A fenced block, coloured by the shared code theme.
 *
 * The plain text renders first and is replaced when the grammar resolves, so a
 * block that is still streaming is readable rather than blank. Rendered as
 * elements rather than as HTML — there is no markup to inject, only text and a
 * colour.
 */
function Colorized({ body, language }: { body: string; language: string }) {
  const { theme } = useCodeTheme();
  const [spans, setSpans] = useState<Span[] | null>(null);

  useEffect(() => {
    let alive = true;
    void highlight(body, language).then((next) => { if (alive) setSpans(next); });
    return () => { alive = false; };
  }, [body, language]);

  return (
    <pre className="app-scroll overflow-x-auto px-2.5 py-2 text-[0.75rem] leading-[1.55] text-[var(--code-foreground)]">
      {/* Plain until the grammar resolves, so a block that is still streaming is
          readable rather than blank. Rendered as elements rather than as HTML —
          there is no markup to inject, only text and a colour. */}
      <code>
        {spans
          ? spans.map((span, index) => (
              <span key={index} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>
                {span.text}
              </span>
            ))
          : body}
      </code>
    </pre>
  );
}

function CodeBlock({ language, body }: { language: string; body: string }) {
  const [copied, setCopied] = useState(false);
  // A fence can say anything — `bash`, `json`, `text`. Only the three Construct trains
  // in have a mark; the rest keep the tag they were written with.
  const marked = languageOf(language);
  const copy = () => {
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="code-block group/code my-2 overflow-hidden">
      <div className="flex h-7 items-center justify-between border-b border-border/70 px-2.5">
        {marked
          ? <LanguageGlyph className="size-3 text-muted-foreground" language={marked} />
          : <span className="font-mono text-ui-sm text-muted-foreground">{language}</span>}
        <button
          className="grid size-5 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover/code:opacity-100 hover:bg-accent hover:text-foreground"
          onClick={copy}
          title="Copy"
          type="button"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <Colorized body={body} language={language} />
    </div>
  );
}

export const Markdown = memo(function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parse(source), [source]);

  return (
    <div
      /* The scale lives in `.md-prose` — ChatGPT's own, lifted from its
         stylesheet. Sizing and spacing are not set here so that every surface
         rendering agent prose shares one system rather than each carrying its
         own guesses. */
      className={cn("md-prose min-w-0", className)}
    >
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={index} body={block.body} language={block.language} />;
          case "heading": {
            /* A real heading element, not a bolded paragraph: the scale keys off
               the tag, and a screen reader has nothing to go on otherwise. */
            const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[Math.min(5, Math.max(1, block.level)) - 1]!;
            return (
              <Tag key={index}>
                <Inline text={block.body} />
              </Tag>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={index}>
                <Inline text={block.body} />
              </blockquote>
            );
          case "table":
            /* Scrolls inside its own box rather than widening the column. A
               table in a chat panel is nearly always wider than the panel, and
               a message that pushes the whole transcript sideways is worse than
               one you drag two inches. */
            return (
              <div className="app-scroll -mx-1 my-2 overflow-x-auto px-1" key={index}>
                <table className="w-full min-w-max border-collapse text-left">
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th
                          className="hairline-b px-2 py-1 font-semibold whitespace-nowrap text-foreground"
                          key={cellIndex}
                          scope="col"
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            className={cn(
                              "px-2 py-1 align-top text-foreground/85",
                              rowIndex < block.rows.length - 1 && "hairline-b",
                            )}
                            key={cellIndex}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "rule":
            return <hr key={index} />;
          default:
            return (
              <p key={index}>
                <Inline text={block.body} />
              </p>
            );
        }
      })}
    </div>
  );
});
