import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

import { cn } from "../../lib/utils";

type ConstructTheme = "light" | "dark" | "system";

export function useResolvedConstructTheme(theme: ConstructTheme): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  });

  useEffect(() => {
    if (theme !== "system") {
      setResolved(theme);
      return;
    }

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setResolved(event.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    setResolved(mql.matches ? "dark" : "light");
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  return resolved;
}

export function ConstructCodeBlock({
  code,
  language,
  theme,
  className,
  compact = false
}: {
  code: string;
  language?: string;
  theme: ConstructTheme;
  className?: string;
  compact?: boolean;
}) {
  const resolvedTheme = useResolvedConstructTheme(theme);
  const normalizedLanguage = normalizeConstructCodeLanguage(language) ?? "text";
  const palette = useMemo(() => constructSyntaxTheme(resolvedTheme), [resolvedTheme]);

  return (
    <div className={cn("construct-code-block my-3 overflow-hidden rounded-[8px] border", className)}>
      <div className="construct-code-block__header border-b px-3 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{normalizedLanguage}</span>
      </div>
      <SyntaxHighlighter
        style={palette}
        language={normalizedLanguage}
        PreTag="div"
        className="font-mono"
        customStyle={{
          margin: 0,
          padding: compact ? "10px 12px" : "12px 14px",
          background: "transparent",
          borderRadius: 0,
          fontSize: compact ? "12px" : "12.5px",
          lineHeight: compact ? "1.5" : "1.6",
          overflowX: "auto"
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)"
          }
        }}
      >
        {code.replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}

export function ConstructInlineCode({
  code,
  language,
  theme,
  className
}: {
  code: string;
  language?: string;
  theme: ConstructTheme;
  className?: string;
}) {
  const resolvedTheme = useResolvedConstructTheme(theme);
  const normalizedLanguage = normalizeConstructCodeLanguage(language) ?? inferInlineCodeLanguage(code) ?? "typescript";
  const tokens = tokenizeInlineCode(code);
  const palette = inlinePalette(resolvedTheme);

  return (
    <code className={cn("construct-inline-code font-mono text-[0.9em]", className)} data-language={normalizedLanguage}>
      {tokens.map((token, index) => (
        <span key={`${index}:${token.text}`} style={{ color: palette[token.kind] }}>
          {token.text}
        </span>
      ))}
    </code>
  );
}

type InlineTokenKind = "plain" | "keyword" | "type" | "property" | "function" | "operator" | "number" | "string" | "punctuation";

function tokenizeInlineCode(code: string): Array<{ text: string; kind: InlineTokenKind }> {
  const tokens: Array<{ text: string; kind: InlineTokenKind }> = [];
  const pattern = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w]*|[&|!=<>+\-*/%:]+|[{}()[\].,;])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    if (match.index > cursor) {
      tokens.push({ text: code.slice(cursor, match.index), kind: "plain" });
    }
    const text = match[0];
    const previous = code.slice(0, match.index);
    const next = code.slice(match.index + text.length);
    tokens.push({ text, kind: inlineTokenKind(text, previous, next) });
    cursor = match.index + text.length;
  }

  if (cursor < code.length) {
    tokens.push({ text: code.slice(cursor), kind: "plain" });
  }

  return tokens.length ? tokens : [{ text: code, kind: "plain" }];
}

function inlineTokenKind(text: string, previous: string, next: string): InlineTokenKind {
  if (/^["'`]/.test(text)) return "string";
  if (/^\d/.test(text)) return "number";
  if (/^[{}()[\].,;]$/.test(text)) return "punctuation";
  if (/^[&|!=<>+\-*/%:]+$/.test(text)) return "operator";
  if (/\b(?:as|async|await|break|case|class|const|continue|else|enum|export|extends|false|fn|for|from|function|if|impl|import|in|interface|let|match|mod|mut|new|null|pub|return|self|struct|throw|trait|true|type|undefined|use|where|while)\b/.test(text)) return "keyword";
  if (/^[A-Z]/.test(text) || /\b(?:bool|boolean|char|f32|f64|i32|i64|number|string|str|u32|u64|usize|void)\b/.test(text)) return "type";
  if (previous.endsWith(".")) return "property";
  if (/^\s*\(/.test(next)) return "function";
  return "plain";
}

function inferInlineCodeLanguage(code: string): string | undefined {
  if (/\b(?:impl|fn|self|mut|pub|trait|struct|u32|usize)\b|&(?:mut\s+)?self/.test(code)) return "rust";
  if (/\b(?:const|let|function|interface|type|undefined)\b|=>/.test(code)) return "typescript";
  if (/\b(?:def|None|True|False|self)\b/.test(code)) return "python";
  return undefined;
}

export function normalizeConstructCodeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "language neutral") return undefined;
  if (normalized === "ts" || normalized === "tsx") return "typescript";
  if (normalized === "js" || normalized === "jsx") return "javascript";
  if (normalized === "py") return "python";
  if (normalized === "rs") return "rust";
  if (normalized === "c++") return "cpp";
  if (normalized === "c#") return "csharp";
  if (normalized === "sh" || normalized === "bash" || normalized === "zsh") return "shell";
  if (normalized === "md") return "markdown";
  return normalized;
}

function constructSyntaxTheme(theme: "light" | "dark"): Record<string, CSSProperties> {
  return {
    'code[class*="language-"]': baseStyle(theme),
    'pre[class*="language-"]': baseStyle(theme),
    comment: { color: "var(--construct-code-comment)", fontStyle: "italic" },
    prolog: { color: "var(--construct-code-comment)" },
    doctype: { color: "var(--construct-code-comment)" },
    cdata: { color: "var(--construct-code-comment)" },
    punctuation: { color: "var(--construct-code-punctuation)" },
    namespace: { opacity: 0.72 },
    property: { color: "var(--construct-code-property)" },
    tag: { color: "var(--construct-code-keyword)" },
    boolean: { color: "var(--construct-code-constant)" },
    number: { color: "var(--construct-code-number)" },
    constant: { color: "var(--construct-code-constant)" },
    symbol: { color: "var(--construct-code-constant)" },
    deleted: { color: "var(--destructive)" },
    selector: { color: "var(--construct-code-string)" },
    "attr-name": { color: "var(--construct-code-property)" },
    string: { color: "var(--construct-code-string)" },
    char: { color: "var(--construct-code-string)" },
    builtin: { color: "var(--construct-code-type)" },
    inserted: { color: "var(--construct-success)" },
    operator: { color: "var(--construct-code-operator)" },
    entity: { color: "var(--construct-code-operator)", cursor: "help" },
    url: { color: "var(--construct-code-string)" },
    variable: { color: "var(--construct-code-variable)" },
    atrule: { color: "var(--construct-code-keyword)" },
    "attr-value": { color: "var(--construct-code-string)" },
    function: { color: "var(--construct-code-function)" },
    "class-name": { color: "var(--construct-code-type)" },
    keyword: { color: "var(--construct-code-keyword)" },
    regex: { color: "var(--construct-code-string)" },
    important: { color: "var(--construct-code-keyword)", fontWeight: 600 },
    bold: { fontWeight: 600 },
    italic: { fontStyle: "italic" }
  };
}

function baseStyle(theme: "light" | "dark"): CSSProperties {
  return {
    color: theme === "dark" ? "var(--construct-code-foreground)" : "var(--construct-code-foreground)",
    background: "transparent",
    fontFamily: "var(--font-mono)",
    textShadow: "none"
  };
}

function inlinePalette(_theme: "light" | "dark"): Record<InlineTokenKind, string> {
  return {
    plain: "var(--construct-code-foreground)",
    keyword: "var(--construct-code-keyword)",
    type: "var(--construct-code-type)",
    property: "var(--construct-code-property)",
    function: "var(--construct-code-function)",
    operator: "var(--construct-code-operator)",
    number: "var(--construct-code-number)",
    string: "var(--construct-code-string)",
    punctuation: "var(--construct-code-punctuation)"
  };
}
