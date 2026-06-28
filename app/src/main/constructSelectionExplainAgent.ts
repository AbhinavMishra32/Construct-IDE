import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";
import { aiGateway } from "./ai/AIGateway";
import { createConstructAgentRuntime, type ConstructAgentTraceEntry } from "./constructAgentRuntime";
import { resolveConstructAiSettings } from "./constructAiSettings";

const execFileAsync = promisify(execFile);

export const CONSTRUCT_SELECTION_EXPLAIN_AGENT_ID = "construct-selection-explain-agent";

export type SelectionExplanationLogEntry = {
  at: string;
  status: "pending" | "running" | "done" | "failed" | "warning";
  message: string;
  detail?: string;
  tool?: "codebase" | "web" | "agent";
};

export type SelectionExplanationSource = {
  id: string;
  kind: "code" | "web";
  title: string;
  url?: string;
  path?: string;
  line?: number;
  domain?: string;
};

export type SelectionExplanationInput = {
  projectId: string;
  workspacePath: string;
  selection: {
    text: string;
    source: string;
    sourceLabel: string;
    contextText: string;
    filePath?: string;
    language?: string;
    lineStart?: number;
    lineEnd?: number;
  };
  learningContext?: {
    projectTitle?: string;
    stepTitle?: string;
    blockKind?: string;
    blockText?: string;
    concepts?: Array<{ id: string; title: string; summary: string }>;
  };
};

export type SelectionExplanationResult = {
  title: string;
  summary: string;
  explanation: string;
  sources: SelectionExplanationSource[];
  researchMode: "web-and-codebase" | "codebase-only";
};

type Progress = (entry: Omit<SelectionExplanationLogEntry, "at">) => void;

export async function runConstructSelectionExplainAgent(
  input: SelectionExplanationInput,
  onProgress: Progress,
  onTrace?: (entry: ConstructAgentTraceEntry) => void
): Promise<SelectionExplanationResult> {
  onTrace?.({
    title: "Selection explanation request",
    level: "debug",
    detail: JSON.stringify({
      selection: input.selection,
      learningContext: input.learningContext ?? {}
    }, null, 2)
  });
  onProgress({ status: "running", message: "Inspecting the selected text", detail: input.selection.sourceLabel, tool: "agent" });
  const codebase = await collectCodebaseContext(input, onProgress, onTrace);
  onProgress({ status: "done", message: "Selection context is ready", detail: `${input.selection.text.length} selected characters`, tool: "agent" });

  const responsesConfig = aiGateway.resolveOpenAiResponses("selection-explain");
  if (responsesConfig) {
    try {
      onProgress({ status: "running", message: "Researching relevant sources", detail: "Using hosted web search when outside context is useful", tool: "web" });
      const researched = await runOpenAiWebExplanation(input, codebase, onTrace);
      onTrace?.({
        title: "Selection explanation result",
        level: "debug",
        detail: JSON.stringify(researched, null, 2)
      });
      onProgress({
        status: "done",
        message: researched.sources.some((source) => source.kind === "web") ? "Web research complete" : "No outside sources were needed",
        detail: `${researched.sources.length} source${researched.sources.length === 1 ? "" : "s"} connected`,
        tool: "web"
      });
      return researched;
    } catch (error) {
      onProgress({
        status: "warning",
        message: "Web research was unavailable",
        detail: error instanceof Error ? error.message : String(error),
        tool: "web"
      });
    }
  } else {
    const provider = resolveConstructAiSettings().provider;
    onProgress({
      status: "warning",
      message: "Hosted web research is unavailable",
      detail: provider === "openrouter"
        ? "Continuing with the selected OpenRouter model and project context."
        : "Add an OpenAI key in Settings to enable hosted research.",
      tool: "web"
    });
  }

  onProgress({ status: "running", message: "Connecting it to this project", detail: "Synthesizing from selected text and workspace matches", tool: "agent" });
  const fallback = await runCodebaseOnlyExplanation(input, codebase, onTrace);
  onTrace?.({
    title: "Selection explanation result",
    level: "debug",
    detail: JSON.stringify(fallback, null, 2)
  });
  onProgress({ status: "done", message: "Explanation ready", detail: "Grounded in the current project", tool: "agent" });
  return fallback;
}

async function collectCodebaseContext(
  input: SelectionExplanationInput,
  onProgress: Progress,
  onTrace?: (entry: ConstructAgentTraceEntry) => void
) {
  onProgress({ status: "running", message: "Searching the project", detail: "Looking for related symbols and usage", tool: "codebase" });
  const needles = searchNeedles(input.selection.text);
  onTrace?.({
    title: "Codebase search needles",
    level: "debug",
    detail: JSON.stringify(needles, null, 2)
  });
  const chunks: string[] = [];
  const sources: SelectionExplanationSource[] = [];

  for (const needle of needles) {
    try {
      const { stdout } = await execFileAsync("rg", [
        "-n",
        "-F",
        "--max-count",
        "4",
        "--glob",
        "!.git/**",
        "--glob",
        "!.construct/**",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!dist/**",
        "--",
        needle,
        "."
      ], { cwd: input.workspacePath, maxBuffer: 512 * 1024 });

      for (const line of stdout.split(/\r?\n/).filter(Boolean).slice(0, 8)) {
        const match = /^\.\/(.*?):(\d+):(.*)$/.exec(line) ?? /^(.*?):(\d+):(.*)$/.exec(line);
        if (!match) continue;
        const relativePath = match[1];
        const lineNumber = Number(match[2]);
        const sourceId = `code:${relativePath}:${lineNumber}`;
        if (!sources.some((source) => source.id === sourceId)) {
          sources.push({ id: sourceId, kind: "code", title: `${relativePath}:${lineNumber}`, path: relativePath, line: lineNumber });
          chunks.push(`${relativePath}:${lineNumber}: ${match[3].trim()}`);
        }
      }
    } catch (error) {
      const exitCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (exitCode !== "1") console.warn("[selection explain] project search failed", { needle, error });
    }
  }

  if (input.selection.filePath) {
    const currentId = `code:${input.selection.filePath}:${input.selection.lineStart ?? 1}`;
    if (!sources.some((source) => source.id === currentId)) {
      sources.unshift({
        id: currentId,
        kind: "code",
        title: `${input.selection.filePath}:${input.selection.lineStart ?? 1}`,
        path: input.selection.filePath,
        line: input.selection.lineStart ?? 1
      });
    }
  }

  onProgress({
    status: "done",
    message: "Project search complete",
    detail: chunks.length > 0 ? `${chunks.length} related location${chunks.length === 1 ? "" : "s"} found` : "The nearby selection context is the strongest local signal",
    tool: "codebase"
  });
  const matches = chunks.join("\n").slice(0, 12_000);
  const selectedSources = sources.slice(0, 12);
  onTrace?.({
    title: "Codebase search matches",
    level: "debug",
    detail: JSON.stringify({ matches, sources: selectedSources }, null, 2)
  });
  return { matches, sources: selectedSources };
}

async function runOpenAiWebExplanation(
  input: SelectionExplanationInput,
  codebase: Awaited<ReturnType<typeof collectCodebaseContext>>,
  onTrace?: (entry: ConstructAgentTraceEntry) => void
): Promise<SelectionExplanationResult> {
  const { response } = await aiGateway.openAiResponses({
    purpose: "selection web research",
    featureId: "selection-explain",
    trace: onTrace,
    body: {
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      input: buildExplanationPrompt(input, codebase.matches)
    }
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`Web search request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json() as OpenAiResponse;
  const extracted = extractOpenAiExplanation(payload);
  if (!extracted.text.trim()) throw new Error("The research agent returned no explanation.");
  const webSources = extracted.citations.map((citation, index) => ({
    id: `web:${index}:${citation.url}`,
    kind: "web" as const,
    title: citation.title || domainForUrl(citation.url),
    url: citation.url,
    domain: domainForUrl(citation.url)
  }));
  const sources = dedupeSources([...codebase.sources, ...webSources]);
  return {
    title: explanationTitle(input.selection.text),
    summary: firstMeaningfulParagraph(extracted.text),
    explanation: addInlineCitationLinks(extracted.text, extracted.citations),
    sources,
    researchMode: webSources.length > 0 ? "web-and-codebase" : "codebase-only"
  };
}

const FallbackExplanationSchema = z.object({
  summary: z.string().min(1),
  explanation: z.string().min(1)
});

async function runCodebaseOnlyExplanation(
  input: SelectionExplanationInput,
  codebase: Awaited<ReturnType<typeof collectCodebaseContext>>,
  onTrace?: (entry: ConstructAgentTraceEntry) => void
): Promise<SelectionExplanationResult> {
  const runtime = createConstructAgentRuntime();
  const result = await runtime.generateStructured({
    id: CONSTRUCT_SELECTION_EXPLAIN_AGENT_ID,
    featureId: "selection-explain",
    name: "Construct Selection Explanation Agent",
    purpose: "selection explanations",
    instructions: [
      "Explain selected code or learning text in the context of the current Construct project.",
      "Use only the supplied selection, nearby context, learning context, and workspace matches.",
      "Connect the idea to how it is used here, then give the mental model and one practical caution when relevant.",
      "Do not invent web sources or claim that web research occurred.",
      "Return concise Markdown suitable for a small floating explanation card."
    ].join("\n"),
    prompt: buildExplanationPrompt(input, codebase.matches),
    schema: FallbackExplanationSchema,
    maxRetries: 1,
    onTrace
  });

  return {
    title: explanationTitle(input.selection.text),
    summary: result.summary,
    explanation: result.explanation,
    sources: codebase.sources,
    researchMode: "codebase-only"
  };
}

function buildExplanationPrompt(input: SelectionExplanationInput, matches: string): string {
  return [
    "Explain the selected text to the learner in the context of this project.",
    "Use web search only when it adds authoritative or current context. Prefer primary documentation and official sources.",
    "Start directly with what it means here. Then connect it to the surrounding code or lesson, give a useful mental model, and mention a practical caveat if one exists.",
    "Keep the answer compact but substantive. Use Markdown. Do not repeat the selected text as a heading.",
    "",
    `Selected text:\n${input.selection.text}`,
    "",
    `Selected from: ${input.selection.sourceLabel} (${input.selection.source})`,
    input.selection.filePath ? `File: ${input.selection.filePath}${input.selection.lineStart ? `:${input.selection.lineStart}` : ""}` : "",
    input.selection.language ? `Language: ${input.selection.language}` : "",
    "",
    `Nearby context:\n${input.selection.contextText}`,
    "",
    `Related workspace matches:\n${matches || "(none found)"}`,
    "",
    `Learning context:\n${JSON.stringify(input.learningContext ?? {}, null, 2)}`
  ].filter(Boolean).join("\n");
}

type UrlCitation = { url: string; title: string; startIndex: number; endIndex: number };
type OpenAiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }>;
    }>;
  }>;
};

export function extractOpenAiExplanation(payload: OpenAiResponse): { text: string; citations: UrlCitation[] } {
  const texts: string[] = [];
  const citations: UrlCitation[] = [];
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type !== "output_text" || !content.text) continue;
      const offset = texts.join("\n\n").length + (texts.length > 0 ? 2 : 0);
      texts.push(content.text);
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        citations.push({
          url: annotation.url,
          title: annotation.title ?? "",
          startIndex: offset + (annotation.start_index ?? 0),
          endIndex: offset + (annotation.end_index ?? annotation.start_index ?? 0)
        });
      }
    }
  }
  return { text: texts.join("\n\n"), citations };
}

export function addInlineCitationLinks(text: string, citations: UrlCitation[]): string {
  const unique = new Map<string, number>();
  for (const citation of citations) if (!unique.has(citation.url)) unique.set(citation.url, unique.size + 1);
  const insertions = citations
    .filter((citation) => citation.endIndex >= 0 && citation.endIndex <= text.length)
    .map((citation) => ({ index: citation.endIndex, suffix: ` [${unique.get(citation.url)}](${citation.url})` }))
    .sort((a, b) => b.index - a.index);
  let result = text;
  const used = new Set<string>();
  for (const insertion of insertions) {
    if (used.has(insertion.suffix)) continue;
    result = `${result.slice(0, insertion.index)}${insertion.suffix}${result.slice(insertion.index)}`;
    used.add(insertion.suffix);
  }
  return result;
}

export function searchNeedles(selection: string): string[] {
  const words = selection.match(/[A-Za-z_$][\w$.-]{2,}/g) ?? [];
  const candidates = [selection.trim(), ...words.sort((a, b) => b.length - a.length)];
  return [...new Set(candidates.filter((value) => value.length >= 3 && value.length <= 80))].slice(0, 3);
}

function explanationTitle(selection: string): string {
  const compact = selection.replace(/\s+/g, " ").trim();
  return compact.length <= 58 ? compact : `${compact.slice(0, 57).trimEnd()}…`;
}

function firstMeaningfulParagraph(text: string): string {
  const paragraph = text.split(/\n\s*\n/).map((value) => value.replace(/^#+\s*/, "").trim()).find(Boolean) ?? text;
  return paragraph.length <= 220 ? paragraph : `${paragraph.slice(0, 219).trimEnd()}…`;
}

function domainForUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function dedupeSources(sources: SelectionExplanationSource[]): SelectionExplanationSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url ?? `${path.normalize(source.path ?? "")}:${source.line ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}
