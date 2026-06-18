export type InlineConceptRef = { kind: "concept"; id: string; label: string; raw: string };
export type InlineFileRef = { kind: "file"; path: string; label: string; line?: number; endLine?: number; anchor?: string; raw: string };
export type InlineDocsRef = { kind: "docs"; url: string; label: string; raw: string };
export type InlineRef = InlineConceptRef | InlineFileRef | InlineDocsRef;

const inlinePattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function parseInlineRef(rawTarget: string, rawLabel?: string, raw = `[[${rawTarget}${rawLabel ? `|${rawLabel}` : ""}]]`): InlineRef {
  const target = rawTarget.trim();
  const requestedLabel = rawLabel?.trim();

  if (target.startsWith("file:") || looksLikeLegacyFileTarget(target)) {
    let locator = target.startsWith("file:") ? target.slice(5) : target;
    let anchor: string | undefined;
    let line: number | undefined;
    let endLine: number | undefined;
    const anchorIndex = locator.lastIndexOf("#");
    if (anchorIndex >= 0) {
      anchor = locator.slice(anchorIndex + 1) || undefined;
      locator = locator.slice(0, anchorIndex);
    } else {
      const lineMatch = locator.match(/:(\d+)(?:-(\d+))?$/);
      if (lineMatch) {
        line = Number(lineMatch[1]);
        endLine = lineMatch[2] ? Number(lineMatch[2]) : undefined;
        locator = locator.slice(0, -lineMatch[0].length);
      }
    }
    return { kind: "file", path: locator, label: requestedLabel || locator, line, endLine, anchor, raw };
  }

  if (target.startsWith("docs:")) {
    const url = target.slice(5);
    return { kind: "docs", url, label: requestedLabel || url, raw };
  }

  const id = target.startsWith("concept:") ? target.slice(8) : target;
  return { kind: "concept", id, label: requestedLabel || id, raw };
}

export function parseInlineFileRef(rawTarget: string, rawLabel?: string): InlineFileRef | null {
  const target = rawTarget.trim();
  if (!target.startsWith("file:") && !looksLikeLegacyFileTarget(target)) return null;
  const reference = parseInlineRef(target, rawLabel);
  return reference.kind === "file" ? reference : null;
}

function looksLikeLegacyFileTarget(target: string): boolean {
  if (target.startsWith("docs:") || target.startsWith("concept:")) return false;
  if (/\s/.test(target)) return false;
  return /(?:^|\/)[^/]+\.[a-zA-Z0-9]{1,8}(?::\d+(?:-\d+)?|#[a-zA-Z0-9_.-]+)?$/.test(target);
}

export function renderInlineRefsAsMarkdown(content: string): string {
  const lines = content.split("\n");
  let fence: string | null = null;
  return lines.map((line) => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      const marker = trimmed.slice(0, 3);
      fence = fence === marker ? null : fence ?? marker;
      return line;
    }
    if (fence) return line;
    return line.replace(inlinePattern, (raw, target: string, label?: string) => {
      const ref = parseInlineRef(target, label, raw);
      if (ref.kind === "docs") return `[${ref.label}](${ref.url})`;
      return `[${ref.label}](#construct-ref=${encodeURIComponent(JSON.stringify(ref))})`;
    });
  }).join("\n");
}

export function collectInlineRefs(content: string): InlineRef[] {
  const references: InlineRef[] = [];
  const lines = content.split("\n");
  let fence: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      const marker = trimmed.slice(0, 3);
      fence = fence === marker ? null : fence ?? marker;
      continue;
    }
    if (fence) continue;

    for (const match of line.matchAll(inlinePattern)) {
      references.push(parseInlineRef(match[1], match[2], match[0]));
    }
  }

  return references;
}

export function decodeInlineRefHref(href: string): InlineRef | null {
  if (!href.startsWith("#construct-ref=")) return null;
  try {
    return JSON.parse(decodeURIComponent(href.slice("#construct-ref=".length))) as InlineRef;
  } catch {
    return null;
  }
}
