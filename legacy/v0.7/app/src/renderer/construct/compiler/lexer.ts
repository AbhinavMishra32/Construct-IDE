import type { ConstructToken } from "./types";
import { normalizeTapeSpec } from "../../../shared/tapeFeatures";

const attributePattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

export function lexConstruct(source: string): ConstructToken[] {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const tokens: ConstructToken[] = [];
  let offset = 0;
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const trimmed = text.trim();
    const start = offset;
    const end = start + text.length + (index < lines.length - 1 ? 1 : 0);
    const column = Math.max(1, text.search(/\S|$/) + 1);

    if (/^(```|~~~)/.test(trimmed)) {
      const marker = trimmed.slice(0, 3);
      fenceMarker = fenceMarker === marker ? null : fenceMarker ?? marker;
      tokens.push({ kind: "fence", text, line: index + 1, column, start, end });
    } else if (fenceMarker) {
      tokens.push({ kind: "text", text, line: index + 1, column, start, end });
    } else if (trimmed === "::end") {
      tokens.push({ kind: "end", text, line: index + 1, column, start, end });
    } else {
      const block = trimmed.match(/^::([a-zA-Z0-9_.-]+)\b(.*)$/);
      if (block) {
        tokens.push({
          kind: "block",
          name: block[1],
          attributes: parseAttributes(block[2]),
          text,
          line: index + 1,
          column,
          start,
          end
        });
      } else if (trimmed.startsWith("@")) {
        tokens.push({ kind: "metadata", text, line: index + 1, column, start, end });
      } else {
        tokens.push({ kind: "text", text, line: index + 1, column, start, end });
      }
    }

    offset = end;
  }

  return tokens;
}

export function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  attributePattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(raw)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

export function readDeclaredSpec(source: string): string {
  const line = source.replace(/\r\n/g, "\n").split("\n").find((entry) => entry.trim().startsWith("@construct"));
  if (!line) return "tape-0.1";
  const attributes = parseAttributes(line.replace(/^\s*@construct\s*/, ""));
  return normalizeSpec(attributes.spec || attributes.version || "tape-0.1");
}

export function normalizeSpec(value: string): string {
  return normalizeTapeSpec(value);
}
