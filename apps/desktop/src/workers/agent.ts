import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CONSTRUCT_AGENT_PROMPT } from "../main/agent/prompt.js";
import { createPiMastraModel, type PiProviderInput } from "./piMastraModel.js";

/**
 * The Construct agent, in its own process.
 *
 * It runs here rather than in the main process for one reason: a turn is a long
 * stretch of CPU-bound work — schema validation, tool orchestration, streaming
 * — and doing it on the main process would block the window's IPC. That is the
 * same arrangement v0.7 used, and the worker keeps the same message protocol so
 * the main process side is unchanged.
 *
 * Tools do not execute here. The worker has no filesystem or terminal access of
 * its own; every tool call is forwarded to the main process, which owns the
 * project directory and the containment checks that go with it. A worker that
 * could read files would be a second place those checks had to be right.
 */

type RequestMessage = { kind: "request"; id: string; method: string; payload: Record<string, unknown> };
type ToolResultMessage = { kind: "tool-result"; id: string; ok: boolean; value?: unknown; error?: string };

const pendingTools = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const send = (value: unknown) => process.parentPort?.postMessage(value);

/* The worker's stdout is the process's, not a channel — anything written there
   is invisible. Console output is routed to stderr so a crash still explains
   itself in the terminal running the app. */
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => process.stderr.write(`[agent:${level}] ${args.map(String).join(" ")}\n`);
}

/** A tool the main process executes on the worker's behalf. */
function hostTool(name: string, description: string, schema: z.ZodTypeAny, requestId: () => string) {
  return createTool({
    id: name,
    description,
    inputSchema: schema,
    /* Mastra v1 tools receive the validated input as the FIRST argument and the
       execution context as the second — `execute(inputData, context)`. This
       destructured `{ context }` off the first argument instead, so every tool
       call arrived with an empty object: read-file asked for path "", and
       ask_user_question put an empty question to the learner. */
    execute: async (inputData: unknown) => {
      const id = randomUUID();
      const settled = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject }));
      /* Two stream events per call, correlated by callId, because the
         transcript draws one row and updates it in place — a start and an end
         without the correlation would be two rows for one call. */
      send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "start", input: format(inputData) });
      send({ kind: "tool-call", id, requestId: requestId(), name, input: inputData });

      try {
        const value = await settled;
        send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "end", ok: true, output: format(value) });
        return value;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "end", ok: false, detail, output: detail });
        throw error;
      }
    },
  });
}

/** Arguments and results as the transcript shows them: formatted JSON when the
 *  value is structured, the string itself when it already is one. Capped,
 *  because a file's whole contents as a tool result would be a wall of text in
 *  a row meant to be glanced at and opened deliberately. */
function format(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > 4_000 ? `${text.slice(0, 4_000)}\n… truncated` : text;
}

/**
 * Pulls text out of whatever shape a step field arrives in.
 *
 * `step.reasoning` is not a string. Across AI SDK and Mastra versions it has
 * been a string, an array of reasoning parts, and an array of plain strings —
 * and calling .trim() on the array shape threw "step.reasoning?.trim is not a
 * function", which killed every turn before a reply was produced.
 *
 * Normalising is the right fix rather than pinning to one shape: the worker
 * only wants the words, and being wrong here costs a whole conversation.
 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const record = value as { text?: unknown; reasoning?: unknown; content?: unknown };
    return textOf(record.text ?? record.reasoning ?? record.content);
  }
  return "";
}

let currentRequestId = "";
const requestId = () => currentRequestId;

const tools = {
  "read-file": hostTool(
    "read-file",
    "Read a UTF-8 file in the active project.",
    z.object({ path: z.string().describe("Path relative to the project root") }),
    requestId,
  ),
  "write-file": hostTool(
    "write-file",
    "Write a UTF-8 file in the active project. Never use this to write the learner's implementation for them.",
    z.object({ path: z.string(), content: z.string() }),
    requestId,
  ),
  "list-files": hostTool(
    "list-files",
    "List a directory in the active project. Omit the directory to list the project root.",
    z.object({ directory: z.string().optional() }),
    requestId,
  ),
  "run-terminal-command": hostTool(
    "run-terminal-command",
    "Run a command inside the active project and return its output.",
    z.object({ command: z.string() }),
    requestId,
  ),
  "record-concept": hostTool(
    "record-concept",
    [
      "Write or update the learner's note for one concept, and record how well they understand it.",
      "This is the learner's own encyclopedia: they will reopen these notes months later, so write for them to read, not for you to remember.",
      "",
      "`content` is the whole note, in Markdown. Write it as an encyclopedia entry: open with a short paragraph saying what the idea is, then use `## ` headings for the parts that earn one — why it matters, how it is usually got wrong, a worked example, how it relates to what they already know. Put code in fenced blocks with a language. Prefer examples from this learner's own project over generic ones. No heading above the opening paragraph, and no restating the title.",
      "",
      "Call this when you introduce an idea, see evidence of understanding, or find a gap.",
      "Levels: 0 unseen, 1 recognises pieces, 2 guided understanding, 3 practice ready, 4 applies reliably, 5 transfers and teaches. A scoped task is only fair at level 3 or above.",
      "On a later call you may send only the level and note; leaving `content` out keeps the note already written.",
    ].join("\n"),
    z.object({
      conceptId: z.string().min(1).max(120).describe("A stable slug, e.g. 'rasterisation' or 'function-types'"),
      title: z.string().min(1).max(120),
      masteryLevel: z.number().int().min(0).max(5),
      confidence: z.string().min(1).max(40).describe("One word for the reading, e.g. introduced, fragile, practicing, solid"),
      content: z.string().max(8_000).optional().describe("The whole note, in Markdown — see above"),
      summary: z.string().max(300).optional().describe("One line for the rail and the cards"),
      docs: z.array(z.object({ title: z.string().max(160), url: z.string().max(500) })).max(5).optional().describe("Real references worth reading"),
      tags: z.array(z.string().max(40)).max(8).optional(),
      note: z.string().max(600).optional().describe("What the learner said or did that supports this level"),
      reason: z.string().max(300).optional().describe("Why the level changed"),
    }),
    requestId,
  ),
  "flow-memory-fetch": hostTool(
    "flow-memory-fetch",
    [
      "Read Flow Memory: what Construct remembers about this project between turns.",
      "research.md is the project background gathered before teaching started. project.md is the goal, stack, important files and commands. path.md is where the teaching has got to. learner.md is how this person learns and what they already know.",
      "Say why you need it and ask only for the files that bear on it — fetching all four every turn spends the context on things you are not about to use.",
    ].join("\n"),
    z.object({
      purpose: z.string().min(1).max(500).describe("Why you need memory right now"),
      files: z.array(z.enum(["research.md", "project.md", "path.md", "learner.md"])).min(1).max(4),
    }),
    requestId,
  ),
  "flow-memory-patch": hostTool(
    "flow-memory-patch",
    [
      "Record a durable change to Flow Memory. Prefer this over rewriting a whole file: a patch says what changed, and the learner sees the diff.",
      "append adds a note at the end; prepend puts one at the top; replace swaps exact text, and needs `find` to match once and only once.",
      "Patch when something is worth knowing next session: a decision made, a preference observed, a file that turned out to matter. Not for every message.",
    ].join("\n"),
    z.object({
      patches: z
        .array(
          z.object({
            file: z.enum(["research.md", "project.md", "path.md", "learner.md"]),
            mode: z.enum(["append", "prepend", "replace"]),
            content: z.string().min(1).max(4_000),
            find: z.string().max(4_000).optional().describe("Required by replace: the exact text to swap out"),
            reason: z.string().min(1).max(500).describe("Why this is worth remembering"),
          }),
        )
        .min(1)
        .max(6),
    }),
    requestId,
  ),
  "plan-learning-path": hostTool(
    "plan-learning-path",
    [
      "Set or revise the path: the ordered steps between where this learner is now and the project they set out to build.",
      "This is the teaching plan, not a filesystem path. Plan it once you know enough about the learner and the project, and revise it whenever what they can do changes.",
      "Steps the learner has already finished stay finished across a revision. Order matters: the first unfinished step becomes the current one unless you name another.",
    ].join("\n"),
    z.object({
      reason: z.string().min(1).max(800).describe("Why the path is being set or revised now"),
      currentNodeId: z.string().max(120).optional(),
      nodes: z
        .array(
          z.object({
            id: z.string().min(1).max(120).describe("A stable slug, e.g. 'first-triangle'"),
            title: z.string().min(1).max(120),
            summary: z.string().min(1).max(500),
            kind: z.enum(["profile", "foundation", "build", "connect", "polish", "ship", "custom"]).optional(),
            status: z.enum(["planned", "active", "completed", "blocked", "revising"]).optional(),
            concepts: z.array(z.string().max(120)).max(16).optional().describe("Concept ids this step teaches"),
            exitCriteria: z.array(z.string().max(220)).max(8).optional().describe("What the learner can do once this step is done"),
          }),
        )
        .min(1)
        .max(14),
    }),
    requestId,
  ),
  "web-search": hostTool(
    "web-search",
    "Search the web. Short queries and few results: this is for finding pages worth reading, not for pulling the web into the conversation.",
    z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(10).default(5) }),
    requestId,
  ),
  "web-fetch": hostTool(
    "web-fetch",
    "Read named URLs in full. Use once you know which pages you want.",
    z.object({ urls: z.array(z.string().max(500)).min(1).max(5) }),
    requestId,
  ),
  ask_user_question: hostTool(
    "ask_user_question",
    "Ask the learner one tracked question and pause until they answer. Use this instead of writing required learner questions as prose.",
    z.object({
      question: z.string().min(1).max(600),
      header: z.string().min(1).max(80).optional(),
      choices: z.array(z.string().min(1).max(160)).max(6).optional(),
      allowOther: z.boolean().default(true),
    }),
    requestId,
  ),
};

type TurnPayload = {
  requestId: string;
  provider: PiProviderInput;
  /** Flow state and run mode, appended to the prompt exactly as v0.7 did. */
  stateSuffix?: string;
  /** Replaces the mentor prompt. The research pass runs on the same worker with
   *  its own instructions and a narrower tool set, rather than in a second
   *  process — it is the same model doing a different job. */
  systemPrompt?: string;
  /** Restricts which tools this run may call. Omitted means all of them. */
  tools?: string[];
  /* A discriminated union rather than `role: "user" | "assistant"`. Mastra's
     message type is itself a union, and a single object typed with a union
     role matches none of its members — the compiler cannot tell which one is
     meant until the role is fixed per element. */
  messages: Array<{ role: "user"; content: string } | { role: "assistant"; content: string }>;
};

async function runTurn(payload: TurnPayload): Promise<{ text: string; lastText: string }> {
  currentRequestId = payload.requestId;
  /* The final step's prose, kept separately from the aggregate.
     
     `result.text` concatenates the text of every step, so a run that narrated
     "let me look at that file" before each tool call comes back with those
     fragments glued to the actual answer — mid-sentence, since none of them
     ended in a full stop. The transcript already streams them as their own
     lines, so anything that wants *the answer* wants only the last one. */
  let lastText = "";

  const base = payload.systemPrompt ?? CONSTRUCT_AGENT_PROMPT;
  /* A run that names its tools gets exactly those. Withholding tools rather than
     asking the prompt not to use them is the difference between a research pass
     that cannot write to the learner's files and one that has been told not to. */
  const available = payload.tools
    ? Object.fromEntries(Object.entries(tools).filter(([name]) => payload.tools?.includes(name)))
    : tools;

  const agent = new Agent({
    id: "construct-flow",
    name: "Construct Flow",
    /* The prompt is used as-is, with state appended rather than interpolated —
       the same shape v0.7 used, so behaviour does not shift with the port. */
    instructions: payload.stateSuffix ? `${base}\n\n${payload.stateSuffix}` : base,
    model: createPiMastraModel(payload.provider),
    tools: available,
  });

  const result = await agent.generate(payload.messages, {
    maxSteps: 40,
    onStepFinish: ((step: Record<string, unknown>) => {
      /* The model's prose and its reasoning are separate rows in the
         transcript: one is the answer, the other is how it got there, and
         collapsing them would make the reasoning read as part of the reply. */
      const reasoning = textOf(step.reasoning ?? step.reasoningText).trim();
      const text = textOf(step.text).trim();
      if (reasoning) send({ kind: "event", requestId: payload.requestId, type: "reasoning", text: reasoning });
      if (text) {
        lastText = text;
        send({ kind: "event", requestId: payload.requestId, type: "text", text });
      }
    }) as never,
  });

  send({ kind: "event", requestId: payload.requestId, type: "done" });
  /* Normalised for the same reason: `result.text` has been a string and an
     array of content parts depending on the provider, and a reply stored as
     "[object Object]" is a lost turn. */
  const text = textOf(result.text) || textOf((result as unknown as { content?: unknown }).content);
  return { text, lastText: lastText || text };
}

process.parentPort?.on("message", (event: { data: unknown }) => {
  const message = event.data as RequestMessage | ToolResultMessage;

  if (message.kind === "tool-result") {
    const pending = pendingTools.get(message.id);
    pendingTools.delete(message.id);
    if (!pending) return;
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error ?? "Tool failed"));
    return;
  }

  if (message.kind === "request" && message.method === "turn") {
    void runTurn(message.payload as unknown as TurnPayload)
      .then((value) => send({ kind: "result", id: message.id, ok: true, value }))
      .catch((error: unknown) => send({ kind: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
});
