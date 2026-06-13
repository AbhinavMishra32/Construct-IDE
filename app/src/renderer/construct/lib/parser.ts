import type {
  ConceptCard,
  ConstructBlock,
  ConstructFile,
  ConstructLintWarning,
  ConstructProgram,
  ConstructStep,
  ConstructTarget,
  ConstructNote,
  GitMilestone,
  GuideBlock,
  ReferenceCard,
  ReferenceLink,
  SupportSection,
  VerificationBlock,
  VerificationEvidence,
  VerificationMessages
} from "../types";
import { collectInlineRefs } from "./inlineRefs";

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
  const guides: GuideBlock[] = [];
  const concepts: ConceptCard[] = [];
  const gitMilestones: GitMilestone[] = [];
  const references: ReferenceCard[] = [];
  const targets: ConstructTarget[] = [];
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

    if (isGuideLine(line)) {
      guides.push(parseGuideBlock(cursor, "project", guides.length));
      continue;
    }

    if (line.startsWith("::reference")) {
      references.push(parseReference(cursor));
      continue;
    }

    if (line.startsWith("::concept")) {
      concepts.push(parseConcept(cursor));
      continue;
    }

    if (line.startsWith("::git")) {
      gitMilestones.push(parseGitMilestone(cursor));
      continue;
    }

    if (line.startsWith("::target")) {
      targets.push(parseTarget(cursor));
      continue;
    }

    if (line.startsWith("::step")) {
      steps.push(parseStep(cursor));
      continue;
    }

    throw new Error(`Unexpected .construct line ${cursor.index + 1}: ${line}`);
  }

  const id = required(metadata, "id");
  const learningSteps: ConstructStep[] = guides.length > 0
    ? [{
        id: `${id}:project-guide`,
        title: guides[0].title || "System picture",
        kind: "orientation",
        teaches: [],
        requires: [],
        blocks: guides
      }, ...steps]
    : steps;
  const program: ConstructProgram = {
    spec: normalizeSpec(metadata.construct || "tape-0.1"),
    version: normalizeSpec(metadata.construct || "tape-0.1"),
    id,
    title: required(metadata, "title"),
    description: required(metadata, "description"),
    root: metadata.root || ".",
    requires: splitList(metadata.requires),
    audience: metadata.audience,
    teaching: splitList(metadata.teaching),
    source,
    files,
    guides,
    concepts,
    gitMilestones,
    warnings: [],
    references,
    targets,
    steps: learningSteps
  };
  program.warnings = lintProgram(program);
  return program;
}

function parseMetadataLine(line: string): { key: string; value: string } {
  if (line.startsWith("@construct")) {
    const attrs = parseAttributes(line.replace(/^@construct\s*/, ""));
    return { key: "construct", value: attrs.spec || attrs.version || "tape-0.1" };
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
        kind: attrs.kind,
        teaches: splitList(attrs.teaches),
        requires: splitList(attrs.requires),
        blocks
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::explain")) {
      const blockAttrs = parseAttributes(line.replace(/^::explain\s*/, ""));
      blocks.push({
        kind: "explain",
        id: `${required(attrs, "id")}:explain:${blocks.length + 1}`,
        focus: blockAttrs.focus,
        concepts: splitList(blockAttrs.concepts),
        content: parsePlainBody(cursor, "::explain")
      });
      continue;
    }

    if (isGuideLine(line)) {
      blocks.push(parseGuideBlock(cursor, required(attrs, "id"), blocks.length));
      continue;
    }

    if (line.startsWith("::edit")) {
      blocks.push(parseEdit(cursor));
      continue;
    }

    if (line.startsWith("::interact")) {
      blocks.push(parseInteract(cursor));
      continue;
    }

    if (line.startsWith("::recall")) {
      blocks.push(parseRecall(cursor));
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
  const notes: ConstructNote[] = [];
  const guides: GuideBlock[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::note")) {
      const noteAttrs = parseAttributes(line.replace(/^::note\s*/, ""));
      const when: ConstructNote["when"] =
        noteAttrs.when === "done" || noteAttrs.when === "progress" ? noteAttrs.when : "start";
      notes.push({
        when,
        content: parsePlainBody(cursor, "::note")
      });
      continue;
    }

    if (isGuideLine(line)) {
      guides.push(parseGuideBlock(cursor, required(attrs, "id"), guides.length));
      continue;
    }

    break;
  }

  const fenced = parseFencedBody(cursor);
  expectEnd(cursor, "::edit");

  return {
    kind: "edit",
    id: required(attrs, "id"),
    path: required(attrs, "path"),
    mode: parseEditMode(attrs.mode),
    typing: "ghost",
    anchor: attrs.anchor,
    notes,
    guides,
    language: fenced.language,
    content: fenced.content
  };
}

function parseInteract(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::interact\s*/, ""));
  cursor.index += 1;
  let prompt = "";
  let basis = "";
  let understanding = "";
  let assessment = "";
  let resources: { concepts: string[]; files: string[] } = { concepts: [], files: [] };

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        kind: "interact",
        id: required(attrs, "id"),
        interactKind: attrs.kind || "guided-contribution",
        uses: splitList(attrs.uses),
        prompt,
        basis,
        understanding,
        assessment,
        resources
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::prompt")) {
      prompt = parsePlainBody(cursor, "::prompt");
      continue;
    }

    if (line.startsWith("::basis")) {
      basis = parsePlainBody(cursor, "::basis");
      continue;
    }

    if (line.startsWith("::understanding")) {
      understanding = parsePlainBody(cursor, "::understanding");
      continue;
    }

    if (line.startsWith("::assessment")) {
      assessment = parsePlainBody(cursor, "::assessment");
      continue;
    }

    if (line.startsWith("::resources")) {
      const resourceAttrs = parseBlockAttributes(cursor, "::resources");
      resources = {
        concepts: splitList(resourceAttrs.concepts),
        files: splitList(resourceAttrs.files)
      };
      continue;
    }

    throw new Error(`Unexpected interact block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::interact ${attrs.id || ""}.`);
}

function parseRecall(cursor: Cursor): ConstructBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::recall\s*/, ""));
  cursor.index += 1;
  let task = "";
  let support = "";
  let supportSections: SupportSection[] = [];
  let verify: VerificationBlock | undefined;

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        kind: "recall",
        id: required(attrs, "id"),
        mode: parseRecallMode(attrs.mode),
        path: attrs.path,
        target: attrs.target,
        references: splitList(attrs.references),
        concepts: splitList(attrs.uses || attrs.concepts),
        difficulty: attrs.difficulty || "supported-recall",
        task,
        support,
        supportSections,
        verify
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::task")) {
      task = parsePlainBody(cursor, "::task");
      continue;
    }

    if (line.startsWith("::support")) {
      const parsed = parseSupport(cursor);
      support = parsed.content;
      supportSections = parsed.sections;
      continue;
    }

    if (line.startsWith("::verify")) {
      verify = parseVerify(cursor);
      continue;
    }

    throw new Error(`Unexpected recall block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::recall ${attrs.id || ""}.`);
}

function parseVerify(cursor: Cursor): VerificationBlock {
  const attrs = parseAttributes(peek(cursor).replace(/^::verify\s*/, ""));
  cursor.index += 1;
  let goal = "";
  let rubric = "";
  let evidence: VerificationEvidence = {
    files: []
  };
  let messages: VerificationMessages | undefined;

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        id: required(attrs, "id"),
        kind: attrs.kind || "agent",
        goal,
        evidence,
        rubric,
        messages
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::goal")) {
      goal = parsePlainBody(cursor, "::goal");
      continue;
    }

    if (line.startsWith("::evidence")) {
      evidence = parseEvidence(cursor);
      continue;
    }

    if (line.startsWith("::rubric")) {
      rubric = parsePlainBody(cursor, "::rubric");
      continue;
    }

    if (line.startsWith("::messages")) {
      messages = parseMessages(cursor);
      continue;
    }

    throw new Error(`Unexpected verify block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::verify ${attrs.id || ""}.`);
}

function parseEvidence(cursor: Cursor) {
  const attrs = parseAttributes(peek(cursor).replace(/^::evidence\s*/, ""));
  cursor.index += 1;
  const bodyAttrs = parseAttributeLines(cursor, "::evidence");
  const merged = {
    ...attrs,
    ...bodyAttrs
  };

  return {
    answer: merged.answer,
    files: splitList(merged.files),
    interaction: merged.interaction,
    terminalCommand: merged.terminal_command || merged.terminalCommand,
    terminalOutput: merged.terminal_output || merged.terminalOutput
  };
}

function parseMessages(cursor: Cursor) {
  const attrs = parseAttributes(peek(cursor).replace(/^::messages\s*/, ""));
  cursor.index += 1;
  const bodyAttrs = parseAttributeLines(cursor, "::messages");
  const merged = {
    ...attrs,
    ...bodyAttrs
  };

  return {
    success: merged.success || "",
    failure: merged.failure || ""
  };
}

function parseConcept(cursor: Cursor): ConceptCard {
  const attrs = parseAttributes(peek(cursor).replace(/^::concept\s*/, ""));
  cursor.index += 1;
  let summary = "";
  let why = "";
  let commonMistake = "";
  let example = "";
  const docs: ConceptCard["docs"] = [];
  const guides: GuideBlock[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        id: required(attrs, "id"),
        title: required(attrs, "title"),
        kind: attrs.kind || "concept",
        tags: splitList(attrs.tags),
        summary,
        why,
        commonMistake,
        example,
        docs,
        guides
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::summary")) {
      summary = parsePlainBody(cursor, "::summary");
      continue;
    }

    if (line.startsWith("::why")) {
      why = parsePlainBody(cursor, "::why");
      continue;
    }

    if (line.startsWith("::example")) {
      example = parseFlexibleBody(cursor, "::example");
      continue;
    }

    if (line.startsWith("::docs")) {
      docs.push(parseDocsLink(cursor));
      continue;
    }

    if (line.startsWith("::common-mistake")) {
      commonMistake = parsePlainBody(cursor, "::common-mistake");
      continue;
    }

    if (isGuideLine(line)) {
      guides.push(parseGuideBlock(cursor, required(attrs, "id"), guides.length));
      continue;
    }

    throw new Error(`Unexpected concept block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::concept ${attrs.id || ""}.`);
}

const legacyGuideAliases: Record<string, string> = {
  orientation: "guide.orientation",
  problem: "guide.problem",
  flow: "guide.flow",
  promise: "guide.promise",
  misconception: "guide.misconception",
  trace: "guide.trace",
  trusted: "guide.trusted",
  untrusted: "guide.untrusted",
  preflight: "guide.preflight",
  knows: "guide.knows",
  "can-explain": "guide.can-explain",
  "why-now": "guide.why-now",
  "mental-model": "guide.mental-model",
  analogy: "guide.analogy"
};

const legacyGuideNames = new Set(Object.keys(legacyGuideAliases));
const guideContainers = new Set(["guide.orientation", "guide.trace", "guide.preflight"]);

function isGuideLine(line: string): boolean {
  const name = line.match(/^::([a-zA-Z0-9_.-]+)\b/)?.[1];
  return Boolean(name && (name.startsWith("guide.") || legacyGuideNames.has(name)));
}

function parseGuideBlock(cursor: Cursor, parentId: string, ordinal: number): GuideBlock {
  const opener = peek(cursor).trim();
  const match = opener.match(/^::([a-zA-Z0-9_.-]+)\b(.*)$/);
  if (!match) throw new Error(`Invalid guide block at line ${cursor.index + 1}.`);
  const guideKind = legacyGuideAliases[match[1]] ?? match[1];
  const attrs = parseAttributes(match[2]);
  const id = attrs.id || `${parentId}:${guideKind}:${ordinal + 1}`;
  if (!guideContainers.has(guideKind)) {
    return { kind: "guide", id, guideKind, title: attrs.title, content: parsePlainBody(cursor, `::${guideKind}`), sections: [] };
  }

  cursor.index += 1;
  const sections: GuideBlock["sections"] = [];
  while (!done(cursor)) {
    const line = peek(cursor).trim();
    if (line === "::end") {
      cursor.index += 1;
      return { kind: "guide", id, guideKind, title: attrs.title, content: "", sections };
    }
    if (!line) {
      cursor.index += 1;
      continue;
    }
    if (isGuideLine(line)) {
      const nestedName = line.match(/^::([a-zA-Z0-9_.-]+)/)?.[1] ?? "guide.section";
      const nestedKind = legacyGuideAliases[nestedName] ?? nestedName;
      sections.push({ kind: nestedKind, content: parsePlainBody(cursor, `::${nestedName}`) });
      continue;
    }
    throw new Error(`Unexpected ${guideKind} line ${cursor.index + 1}: ${line}`);
  }
  throw new Error(`Unclosed ::${guideKind}.`);
}

function parseDocsLink(cursor: Cursor): ConceptCard["docs"][number] {
  const attrs = parseAttributes(peek(cursor).replace(/^::docs\s*/, ""));
  cursor.index += 1;
  const bodyAttrs = parseAttributeLines(cursor, "::docs");
  const merged = {
    ...attrs,
    ...bodyAttrs
  };

  return {
    title: merged.title || merged.url || "Documentation",
    url: required(merged, "url"),
    why: merged.why
  };
}

function parseGitMilestone(cursor: Cursor): GitMilestone {
  const attrs = parseAttributes(peek(cursor).replace(/^::git\s*/, ""));
  cursor.index += 1;
  let message = "";
  let description = "";
  let includePaths: string[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        id: required(attrs, "id"),
        after: required(attrs, "after"),
        message,
        description,
        includePaths
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::suggest")) {
      const suggestAttrs = parseBlockAttributes(cursor, "::suggest");
      message = suggestAttrs.message || "";
      description = suggestAttrs.description || "";
      continue;
    }

    if (line.startsWith("::include")) {
      const includeAttrs = parseBlockAttributes(cursor, "::include");
      includePaths = splitList(includeAttrs.paths);
      continue;
    }

    throw new Error(`Unexpected git block line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::git ${attrs.id || ""}.`);
}

function parseSupport(cursor: Cursor): { content: string; sections: SupportSection[] } {
  cursor.index += 1;
  const plain: string[] = [];
  const sections: SupportSection[] = [];

  while (!done(cursor)) {
    const line = peek(cursor);
    const trimmed = line.trim();

    if (trimmed === "::end") {
      cursor.index += 1;
      return {
        content: trimOuterBlankLines(plain).join("\n"),
        sections
      };
    }

    const sectionMatch = trimmed.match(/^::(intent|concepts|api|mental-model|common-mistake)\b/);
    if (sectionMatch) {
      sections.push({
        kind: sectionMatch[1],
        content: parsePlainBody(cursor, `::${sectionMatch[1]}`)
      });
      continue;
    }

    plain.push(line);
    cursor.index += 1;
  }

  throw new Error("Unclosed ::support block.");
}

function parseReference(cursor: Cursor): ReferenceCard {
  const attrs = parseAttributes(peek(cursor).replace(/^::reference\s*/, ""));
  cursor.index += 1;
  let body = "";
  const links: ReferenceLink[] = [];

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return {
        id: required(attrs, "id"),
        title: required(attrs, "title"),
        kind: attrs.kind || "reference-card",
        reveal: attrs.reveal || "concept",
        body,
        links
      };
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    if (line.startsWith("::body")) {
      body = parsePlainBody(cursor, "::body");
      continue;
    }

    if (line.startsWith("::links")) {
      links.push(...parseReferenceLinks(cursor));
      continue;
    }

    throw new Error(`Unexpected reference card line ${cursor.index + 1}: ${line}`);
  }

  throw new Error(`Unclosed ::reference ${attrs.id || ""}.`);
}

function parseBlockAttributes(cursor: Cursor, blockName: string): Record<string, string> {
  const attrs = parseAttributes(peek(cursor).replace(new RegExp(`^${blockName}\\s*`), ""));
  cursor.index += 1;
  return {
    ...attrs,
    ...parseAttributeLines(cursor, blockName)
  };
}

function parseReferenceLinks(cursor: Cursor): ReferenceLink[] {
  const attrs = parseAttributes(peek(cursor).replace(/^::links\s*/, ""));
  cursor.index += 1;
  const bodyAttrs = parseAttributeLines(cursor, "::links");
  const merged = {
    ...attrs,
    ...bodyAttrs
  };

  if (!merged.anchor && !merged.file) {
    return [];
  }

  return [
    {
      anchor: merged.anchor,
      file: merged.file,
      label: merged.label
    }
  ];
}

function parseTarget(cursor: Cursor): ConstructTarget {
  const attrs = parseAttributes(peek(cursor).replace(/^::target\s*/, ""));
  cursor.index += 1;
  expectEnd(cursor, "::target");

  return {
    id: required(attrs, "id"),
    path: required(attrs, "path"),
    find: attrs.find,
    line: attrs.line ? Number(attrs.line) : undefined,
    anchor: attrs.anchor
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

function parseFlexibleBody(cursor: Cursor, blockName: string): string {
  cursor.index += 1;
  skipBlankLines(cursor);
  if (!done(cursor) && peek(cursor).trim().startsWith("```")) {
    const fenced = parseFencedBody(cursor);
    expectEnd(cursor, blockName);
    return fenced.content;
  }

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

function parseAttributeLines(cursor: Cursor, blockName: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  while (!done(cursor)) {
    const line = peek(cursor).trim();

    if (line === "::end") {
      cursor.index += 1;
      return attrs;
    }

    if (!line) {
      cursor.index += 1;
      continue;
    }

    Object.assign(attrs, parseAttributes(line));
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

function parseRecallMode(value: string | undefined): "code" | "reply" {
  return value === "reply" ? "reply" : "code";
}

function normalizeSpec(value: string): string {
  const trimmed = value.trim();
  if (/^0\.(?:1|2|3|4)(?:\.\d+)?$/.test(trimmed)) {
    return `tape-${trimmed}`;
  }

  return trimmed;
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key]?.trim();
  if (!value) {
    const present = Object.keys(values).filter((k) => values[k]?.trim());
    const hint = present.length > 0 ? ` (found: ${present.join(", ")})` : "";
    throw new Error(`Missing required .construct value: ${key}${hint}`);
  }

  return value;
}

function lintProgram(program: ConstructProgram): ConstructLintWarning[] {
  const warnings: ConstructLintWarning[] = [];
  const conceptIds = new Set(program.concepts.map((concept) => concept.id));
  const completableIds = new Set<string>();
  const introducedConceptIds = new Set<string>();
  const knownFiles = new Set(program.files.map((file) => file.path));
  const knownAnchorsByPath = new Map<string, Set<string>>();

  for (const target of program.targets) {
    knownFiles.add(target.path);
    const anchors = knownAnchorsByPath.get(target.path) ?? new Set<string>();
    if (target.anchor) anchors.add(target.anchor);
    anchors.add(target.id);
    knownAnchorsByPath.set(target.path, anchors);
  }
  for (const step of program.steps) {
    for (const block of step.blocks) {
      if (block.kind !== "edit") continue;
      knownFiles.add(block.path);
      if (!block.anchor) continue;
      const anchors = knownAnchorsByPath.get(block.path) ?? new Set<string>();
      anchors.add(block.anchor);
      knownAnchorsByPath.set(block.path, anchors);
    }
  }

  if (program.audience === "zero-prerequisite") {
    const hasOrientation = program.guides.some((guide) => guide.guideKind === "guide.orientation")
      || program.steps[0]?.blocks.some((block) => block.kind === "guide" && ["guide.trace", "guide.mental-model", "guide.orientation"].includes(block.guideKind));
    if (!hasOrientation) {
      warnings.push({
        id: "orientation-missing",
        severity: "warning",
        message: "Zero-prerequisite tapes should begin with a system picture, trace, or mental model."
      });
    }
  }

  for (const step of program.steps) {
    for (const conceptId of step.requires) {
      if (!conceptIds.has(conceptId)) {
        warnings.push({
          id: `step-requires-missing:${step.id}:${conceptId}`,
          severity: "warning",
          target: step.id,
          message: `Step "${step.title}" requires concept "${conceptId}" but no ::concept card exists.`
        });
      } else if (!introducedConceptIds.has(conceptId)) {
        warnings.push({
          id: `step-requires-not-yet-introduced:${step.id}:${conceptId}`,
          severity: "warning",
          target: step.id,
          message: `Step "${step.title}" requires concept "${conceptId}" before an earlier step teaches it.`
        });
      }
    }
    for (const conceptId of step.teaches) {
      if (!conceptIds.has(conceptId)) {
        warnings.push({
          id: `step-teaches-missing-concept:${step.id}:${conceptId}`,
          severity: "warning",
          target: step.id,
          message: `Step "${step.title}" teaches concept "${conceptId}" but no ::concept card exists.`
        });
      }
    }
    if (/\b(Reveal why|Picture before plumbing|Problem before tool|Mental model before code|Teach the|Introduce concept)\b/i.test(step.title)) {
      warnings.push({
        id: `title-pedagogy-leak:${step.id}`,
        severity: "warning",
        target: step.id,
        message: `Step title "${step.title}" exposes an authoring rule. Use a natural engineering milestone title.`
      });
    }

    for (const block of step.blocks) {
      completableIds.add(block.id);

      if (block.kind === "guide" && block.guideKind.startsWith("guide.")) {
        warnings.push({
          id: `deprecated-guide:${block.id}`,
          severity: "warning",
          target: block.id,
          message: `${block.guideKind} is deprecated. Prefer ::explain, ::interact, or ::recall mode="reply" for new tape-0.4 content.`
        });
      }

      if (block.kind === "interact") {
        if (!block.basis.trim() || !block.understanding.trim()) {
          warnings.push({
            id: `interact-context-missing:${block.id}`,
            severity: "warning",
            target: block.id,
            message: "Construct Interact should include ::basis and ::understanding so the agent can evaluate grounded answers."
          });
        }
      }

      if (block.kind === "recall") {
        if (block.mode === "reply" && !block.verify) {
          warnings.push({
            id: `reply-recall-missing-verifier:${block.id}`,
            severity: "warning",
            target: block.id,
            message: `Reply recall "${block.id}" should include an agent ::verify block.`
          });
        }

        for (const conceptId of block.concepts) {
          if (!conceptIds.has(conceptId)) {
            warnings.push({
              id: `missing-concept:${block.id}:${conceptId}`,
              severity: "warning",
              target: block.id,
              message: `Recall uses concept "${conceptId}" but no ::concept card introduces it.`
            });
          }
        }

        if (block.supportSections.length === 0 && /z\.object|z\.number|defineTool|KV cache|Server Actions|QKV/.test(block.support)) {
          warnings.push({
            id: `compressed-support:${block.id}`,
            severity: "info",
            target: block.id,
            message: "Support text includes compressed API snippets. tape-0.3 support sections can make this easier to learn."
          });
        }

        if (block.verify) {
          completableIds.add(block.verify.id);
          const hasEvidence = block.verify.evidence.files.length > 0 || Boolean(block.verify.evidence.answer || block.verify.evidence.interaction || block.verify.evidence.terminalCommand || block.verify.evidence.terminalOutput);
          const needsLegacyMessages = program.spec !== "tape-0.4" && !block.verify.messages?.success && !block.verify.messages?.failure;
          if (!block.verify.goal || !block.verify.rubric || !hasEvidence || needsLegacyMessages) {
            warnings.push({
              id: `incomplete-verify:${block.verify.id}`,
              severity: "warning",
              target: block.verify.id,
              message: program.spec === "tape-0.4"
                ? "::verify kind=\"agent\" should include goal, evidence, and rubric."
                : "::verify kind=\"agent\" should include goal, evidence files, rubric, and messages."
            });
          }
        }
      }

      if (block.kind === "edit" && block.content.split("\n").length > 120) {
        warnings.push({
          id: `large-ghost-edit:${block.id}`,
          severity: "warning",
          target: block.id,
          message: "Code step is large. Consider splitting it into smaller implementation steps."
        });
      }

      for (const text of learnerTextForBlock(block)) {
        lintInlineFileRefs(text, block.id, knownFiles, knownAnchorsByPath, warnings);
      }
    }
    step.teaches.forEach((conceptId) => introducedConceptIds.add(conceptId));
  }

  for (const concept of program.concepts) {
    for (const text of [concept.summary, concept.why, concept.commonMistake ?? "", concept.example, ...concept.guides.flatMap(guideText)]) {
      lintInlineFileRefs(text, concept.id, knownFiles, knownAnchorsByPath, warnings);
    }
    if (concept.kind.includes("library") && concept.docs.length === 0) {
      warnings.push({
        id: `concept-docs:${concept.id}`,
        severity: "info",
        target: concept.id,
        message: `External/library concept "${concept.title}" has no docs link.`
      });
    }
  }

  for (const milestone of program.gitMilestones) {
    if (!completableIds.has(milestone.after)) {
      warnings.push({
        id: `git-after:${milestone.id}`,
        severity: "warning",
        target: milestone.id,
        message: `Git milestone "${milestone.id}" references unknown block "${milestone.after}".`
      });
    }
  }

  return warnings;
}

function learnerTextForBlock(block: ConstructBlock): string[] {
  switch (block.kind) {
    case "guide":
      return guideText(block);
    case "edit":
      return [...block.notes.map((note) => note.content), ...block.guides.flatMap(guideText)];
    case "recall":
      return [block.task, block.support, ...block.supportSections.map((section) => section.content)];
    case "interact":
      return [block.prompt];
    case "run":
      return [];
    default:
      return [block.content];
  }
}

function guideText(guide: GuideBlock): string[] {
  return [guide.content, ...guide.sections.map((section) => section.content)];
}

function lintInlineFileRefs(
  content: string,
  target: string,
  knownFiles: Set<string>,
  knownAnchorsByPath: Map<string, Set<string>>,
  warnings: ConstructLintWarning[]
) {
  for (const reference of collectInlineRefs(content)) {
    if (reference.kind !== "file") continue;
    if (!knownFiles.has(reference.path)) {
      warnings.push({
        id: `file-ref-missing:${target}:${reference.path}`,
        severity: "warning",
        target,
        message: `${reference.raw} points to a file that is not created by ::files or ::edit.`
      });
      continue;
    }
    if (reference.anchor && !knownAnchorsByPath.get(reference.path)?.has(reference.anchor)) {
      warnings.push({
        id: `file-ref-anchor-missing:${target}:${reference.path}:${reference.anchor}`,
        severity: "warning",
        target,
        message: `${reference.raw} points to an unknown anchor in "${reference.path}".`
      });
    }
  }
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
