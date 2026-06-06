import type {
  ConstructBlock,
  ConstructFile,
  ConstructProgram,
  ConstructStep
} from "../types";

type Cursor = {
  lines: string[];
  index: number;
};

export function parseConstructSource(source: string): ConstructProgram {
  const cursor: Cursor = {
    lines: source.replace(/\r\n/g, "\n").split("\n"),
    index: 0
  };
  const metadata: Record<string, string> = {};
  const files: ConstructFile[] = [];
  const steps: ConstructStep[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("@")) {
      const { key, value } = parseMetadataLine(line);
      metadata[key] = value;
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::files")) {
      cursor.index += 1;
      files.push(...parseFiles(cursor));
      continue;
    }

    if (line.startsWith("::step")) {
      steps.push(parseStep(cursor));
      continue;
    }

    throw new Error(`Unexpected .construct line ${cursor.index + 1}: ${line}`);
  }

  return {
    version: metadata.construct || "0.1",
    id: required(metadata, "id"),
    title: required(metadata, "title"),
    description: required(metadata, "description"),
    root: metadata.root || ".",
    source,
    files,
    steps
  };
}

function parseMetadataLine(line: string): { key: string; value: string } {
  if (line.startsWith("@construct")) {
    const attrs = parseAttributes(line.replace(/^@construct\s*/, ""));
    return { key: "construct", value: attrs.version || "0.1" };
  }

  const match = line.match(/^@([a-zA-Z0-9_-]+)\s+"([\s\S]*)"$/);
  if (!match) {
    throw new Error(`Invalid metadata line: ${line}`);
  }

  return { key: match[1], value: match[2] };
}

function parseFiles(cursor: Cursor): ConstructFile[] {
  const files: ConstructFile[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return files;
    }

    if (line.startsWith("::file")) {
      files.push(parseFile(cursor));
      continue;
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    throw new Error(`Unexpected files block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error("Unclosed ::files block.");
}

function parseFile(cursor: Cursor): ConstructFile {
  const attrs = parseAttributes(peek(cursor).replace(/^::file\s*/, ""));
  cursor.index += 1;
  const fenced = parseFencedBody(cursor);
  expectEnd(cursor, "::file");

  return {
    path: required(attrs, "path"),
    language: fenced.language,
    content: fenced.content
  };
}

function parseStep(cursor: Cursor): ConstructStep {
  const attrs = parseAttributes(peek(cursor).replace(/^::step\s*/, ""));
  cursor.index += 1;
  const blocks: ConstructBlock[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        id: required(attrs, "id"),
        title: required(attrs, "title"),
        blocks
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::explain")) {
      blocks.push({
        kind: "explain",
        id: `${required(attrs, "id")}:explain:${blocks.length + 1}`,
        content: parsePlainBody(cursor, "::explain")
      });
      continue;
    }

    if (line.startsWith("::edit")) {
      blocks.push(parseEdit(cursor));
      continue;
    }

    if (line.startsWith("::run")) {
      blocks.push(parseRun(cursor));
      continue;
    }

    if (line.startsWith("::expect")) {
      blocks.push(parseExpect(cursor));
      continue;
    }

    if (line.startsWith("::checkpoint")) {
      blocks.push(parseCheckpoint(cursor));
      continue;
    }

    throw new Error(`Unexpected step line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::step ${attrs.id || ""}.`);
}

function parseEdit(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::edit\s*/, ""));
  cursor.index += 1;
  const fenced = parseFencedBody(cursor);
  expectEnd(cursor, "::edit");

  return {
    kind: "edit",
    id: required(attrs, "id"),
    path: required(attrs, "path"),
    mode: parseEditMode(attrs.mode),
    typing: "ghost",
    language: fenced.language,
    content: fenced.content
  };
}

function parseRun(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::run\s*/, ""));

  return {
    kind: "run",
    id: required(attrs, "id"),
    cwd: attrs.cwd || ".",
    command: parsePlainBody(cursor, "::run")
  };
}

function parseExpect(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::expect\s*/, ""));

  return {
    kind: "expect",
    id: required(attrs, "id"),
    expectationType: "manual",
    content: parsePlainBody(cursor, "::expect")
  };
}

function parseCheckpoint(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::checkpoint\s*/, ""));

  return {
    kind: "checkpoint",
    id: required(attrs, "id"),
    content: parsePlainBody(cursor, "::checkpoint")
  };
}

function parseFencedBody(cursor: Cursor): { language: string; content: string } {
  skipBlankLines(cursor);
  const fence = peek(cursor).trim();
  const match = fence.match(/^```([a-zA-Z0-9_-]*)$/);
  if (!match) {
    throw new Error(`Expected code fence at line ${cursor.index + 1}.`);
  }

  cursor.index += 1;
  const body: string[] = [];
  while (!done(cursor)) {
    const line = peek(cursor);
    if (line.trim() === "```") {
      cursor.index += 1;
      return {
        language: match[1] || "text",
        content: trimOuterBlankLines(body).join("\n")
      };
    }

    body.push(line);
    cursor.index += 1;
  }

  throw new Error("Unclosed code fence.");
}

function parsePlainBody(cursor: Cursor, blockName: string): string {
  cursor.index += 1;
  const body: string[] = [];

  while (!done(cursor)) {
    const line = peek(cursor);
    if (line.trim() === "::end") {
      cursor.index += 1;
      return trimOuterBlankLines(body).join("\n");
    }

    body.push(line);
    cursor.index += 1;
  }

  throw new Error(`Unclosed ${blockName} block.`);
}

function expectEnd(cursor: Cursor, blockName: string): void {
  skipBlankLines(cursor);
  if (peek(cursor).trim() !== "::end") {
    throw new Error(`Expected ::end for ${blockName} at line ${cursor.index + 1}.`);
  }
  cursor.index += 1;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseEditMode(value: string | undefined): "create" | "append" | "replace" {
  if (value === "append" || value === "replace") {
    return value;
  }

  return "create";
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key]?.trim();
  if (!value) {
    throw new Error(`Missing required .construct value: ${key}`);
  }

  return value;
}

function skipBlankLines(cursor: Cursor): void {
  while (!done(cursor) && !peek(cursor).trim()) {
    cursor.index += 1;
  }
}

function trimOuterBlankLines(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && !copy[0].trim()) {
    copy.shift();
  }

  while (copy.length > 0 && !copy[copy.length - 1].trim()) {
    copy.pop();
  }

  return copy;
}

function peek(cursor: Cursor): string {
  return cursor.lines[cursor.index] ?? "";
}

function done(cursor: Cursor): boolean {
  return cursor.index >= cursor.lines.length;
}

