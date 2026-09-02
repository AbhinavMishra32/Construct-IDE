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

/** Only the chunks this worker reads. Mastra's own union covers a few dozen
 *  types — network routing, workflow steps, output schemas — none of which this
 *  turn subscribes to, and naming them all here would be a copy of their types
 *  that goes stale the next time they add one. */
type StreamChunk = { type: string; payload?: { text?: string } };

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
      /* Carried on both events, not just the start.
         
         The live row merges start and end by callId, so it had the arguments;
         the *stored* step is built from the end event alone, and so every tool
         call ever written to a project's history had `input: ""`. Nothing
         showed it until the detail views started reading the arguments to draw
         a file's path or a command's text — and then every one of them fell
         back to raw output with no way to know why. */
      const shown = format(inputData);
      /* Two stream events per call, correlated by callId, because the
         transcript draws one row and updates it in place — a start and an end
         without the correlation would be two rows for one call. */
      send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "start", input: shown });
      send({ kind: "tool-call", id, requestId: requestId(), name, input: inputData });

      try {
        const value = await settled;
        send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "end", ok: true, input: shown, output: format(value) });
        return value;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        send({ kind: "event", requestId: requestId(), type: "tool", tool: name, callId: id, phase: "end", ok: false, detail, input: shown, output: detail });
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
      "Concepts form a tree. Set `parentId` to the concept this one sits *inside* — virtual dispatch under polymorphism, polymorphism under object orientation — and nest as deep as the subject really goes. Record the parent first when you can, but naming one that does not exist yet is fine; it links up when you record it. Leave `parentId` out on later calls to keep the concept where it is, or send null to move it back to the top.",
      "Call this when you introduce an idea, see evidence of understanding, or find a gap.",
      "Levels: 0 unseen, 1 recognises pieces, 2 guided understanding, 3 practice ready, 4 applies reliably, 5 transfers and teaches. A scoped task is only fair at level 3 or above.",
      "On a later call you may send only the level and note; leaving `content` out keeps the note already written.",
    ].join("\n"),
    z.object({
      conceptId: z.string().min(1).max(120).describe("A stable slug, e.g. 'rasterisation' or 'function-types'"),
      parentId: z.string().max(120).nullable().optional().describe("The concept slug this one sits under, or null for a top-level concept"),
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
  "set-practice-task": hostTool(
    "set-practice-task",
    [
      "Set the learner a piece of work to do themselves, or update the one you already set.",
      "This is how a task exists at all — describing one in prose leaves nothing on screen once the message scrolls away, and nothing for you to check against later.",
      "",
      "`criteria` is what finished means, one short checkable line each. The learner ticks them off and you judge against them, so write things you can actually verify by reading their code — not \"understands closures\".",
      "Only set a task for concepts you have already recorded at level 3 or above. A task on an idea you have only introduced is a guessing game.",
      "Call it again with the same taskId to correct or extend a task; use a new taskId for genuinely new work.",
    ].join("\n"),
    z.object({
      taskId: z.string().min(1).max(120).describe("A stable slug, e.g. 'saxpy-kernel'"),
      title: z.string().min(1).max(120),
      brief: z.string().max(4_000).describe("What to build and why, in Markdown"),
      criteria: z.array(z.string().max(200)).min(1).max(8).describe("What done means — checkable, one line each"),
      concepts: z.array(z.string().max(120)).max(8).optional().describe("Concept ids this exercises"),
      files: z.array(z.string().max(300)).max(8).optional().describe("Project-relative paths the work belongs in"),
    }),
    requestId,
  ),
  "judge-practice-task": hostTool(
    "judge-practice-task",
    [
      "Record your verdict on a task the learner has submitted.",
      "Read their files first. Pass it only when every criterion is genuinely met; otherwise send it back with `passed: false` and say plainly which criterion is not met and what to look at.",
      "`outcome` is shown to the learner under the task, so write it to them.",
    ].join("\n"),
    z.object({
      taskId: z.string().min(1).max(120),
      passed: z.boolean(),
      outcome: z.string().max(1_000).describe("What you found, written to the learner"),
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
    "Ask the learner one tracked question and pause until they answer. Use this instead of writing required learner questions as prose. Write the question and the choices the way you would say them out loud: plain words, no em dashes or en dashes, no dash holding two clauses together. Markdown and [[file:path|label]] references render, so point at real files by reference. Offer choices only when you genuinely have candidates in mind; leave them out when the honest answer is whatever the learner writes.",
    z.object({
      question: z.string().min(1).max(600),
      header: z.string().min(1).max(80).optional(),
      choices: z.array(z.string().min(1).max(160)).max(6).optional(),
      allowOther: z.boolean().default(true),
    }),
    requestId,
  ),
};

/**
 * The stop switch for each turn in flight, by request id.
 *
 * Mastra's loop takes an `AbortSignal` and stops between steps as well as
 * mid-stream, so this is a real cancellation rather than the window hiding a
 * turn that keeps running — which matters because a turn that keeps running
 * keeps calling tools, and a tool call writes to the learner's project.
 */
const running = new Map<string, AbortController>();

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

async function runTurn(payload: TurnPayload): Promise<{ text: string; lastText: string; stopped?: boolean }> {
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

  /* Streamed, not generated.
     
     This used to call `agent.generate` and emit text from `onStepFinish`, which
     is a callback that fires once a whole *step* has finished — a step being the
     model call plus every tool it invoked. Three separate complaints came out of
     that one choice:
     
       - Nothing streamed. Text arrived one step at a time, in paragraph-sized
         lumps, however fast the model produced it.
       - The transcript ran backwards. Tool rows are emitted live from `hostTool`
         the moment a tool is called, but the prose that introduced them
         ("let me see where we are") only arrived when the step ended — so the
         reader saw the actions first and the sentence explaining them after.
       - A turn that ended on a question lost its preamble. The step never
         finished, so `onStepFinish` never fired, and the learner got a bare
         question with the passage it referred to nowhere on screen.
     
     Reading `fullStream` fixes all three: deltas go out as the model writes
     them, in the order it writes them, and nothing is buffered behind a step
     boundary. Tool events keep coming from `hostTool` — it holds the real input,
     output and error detail, and the stream's own tool chunks would be a second
     source for the same row. */
  const control = new AbortController();
  running.set(payload.requestId, control);
  const run = await agent.stream(payload.messages, { maxSteps: 40, abortSignal: control.signal });

  /* The text of the current assistant block, so `lastText` is the final answer
     rather than every narration line glued together. Reset when the model
     starts a new one. */
  let block = "";

  /* Wrapped, because a signal firing mid-iteration rejects the async iterator.
     That is the ordinary way a stop arrives, and it is not an error: whatever
     was streamed before it is kept and returned by the check below. */
  try {
    for await (const chunk of run.fullStream as AsyncIterable<StreamChunk>) {
    switch (chunk.type) {
      case "text-start":
        block = "";
        break;

      case "text-delta": {
        const delta = chunk.payload?.text ?? "";
        if (!delta) break;
        block += delta;
        send({ kind: "event", requestId: payload.requestId, type: "text", text: delta });
        break;
      }

      case "text-end":
        if (block.trim()) lastText = block.trim();
        break;

      /* The model's reasoning and its prose are separate rows in the transcript:
         one is the answer, the other is how it got there, and collapsing them
         would make the reasoning read as part of the reply. */
      case "reasoning-delta": {
        const delta = chunk.payload?.text ?? "";
        if (delta) send({ kind: "event", requestId: payload.requestId, type: "reasoning", text: delta });
        break;
      }

      /* No `reasoning-end` is forwarded, deliberately.
         
         Providers emit a start/delta/end triple per *reasoning part*, and a
         single turn produces dozens of them — so closing the transcript's
         thinking block on every one drew a separate "Thought for 1s" row per
         fragment, each holding two or three words. The reducer already closes
         the block at the right moment: when the first word of the answer
         arrives. Consecutive reasoning therefore accumulates into one thought,
         and thinking that resumes after a tool call starts a second. */

      default:
        break;
      }
    }
  } catch (cause) {
    if (!control.signal.aborted) throw cause;
  } finally {
    running.delete(payload.requestId);
  }

  /* A turn that ends on a question never sees `text-end` for its last block —
     the model stops mid-step waiting for an answer — so the preamble is captured
     here as well. Without this the question's own introduction streamed to the
     screen and then vanished when the thread was stored and re-read. */
  if (block.trim()) lastText = block.trim();

  send({ kind: "event", requestId: payload.requestId, type: "done" });

  /* Stopped on purpose: return what was said rather than throwing.
     
     `run.text` rejects once the signal fires, and a stop is not a failure — the
     learner asked for it, and everything the model wrote up to that point is
     still theirs. Reading it behind the check also avoids awaiting a promise
     that is already rejected. */
  if (control.signal.aborted) return { text: lastText, lastText, stopped: true };

  /* Normalised: the resolved text has been a string and an array of content
     parts depending on the provider, and a reply stored as "[object Object]" is
     a lost turn. */
  const text = textOf(await run.text);
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

  /**
   * A single model call with no tools, no memory and no project.
   *
   * Naming a project happens before the project exists, so it cannot go through
   * `turn` — that builds an agent around a project's directory, prompt and
   * state. This is the plain path: one instruction, one message, one string
   * back.
   */
  if (message.kind === "request" && message.method === "complete") {
    const payload = message.payload as unknown as {
      provider: PiProviderInput;
      instructions: string;
      input: string;
    };
    void (async () => {
      const agent = new Agent({
        id: "construct-oneshot",
        name: "Construct",
        instructions: payload.instructions,
        model: createPiMastraModel(payload.provider),
      });
      const result = await agent.generate([{ role: "user" as const, content: payload.input }]);
      return textOf((result as { text?: unknown }).text);
    })()
      .then((value) => send({ kind: "result", id: message.id, ok: true, value }))
      .catch((error: unknown) => send({ kind: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  /* Stopping a turn. Resolves either way: a request to stop something that has
     already finished is not an error, it is a race the window cannot avoid. */
  if (message.kind === "request" && message.method === "abort") {
    const requestId = String((message.payload as { requestId?: unknown }).requestId ?? "");
    const control = running.get(requestId);
    control?.abort();
    send({ kind: "result", id: message.id, ok: true, value: { stopped: Boolean(control) } });
    return;
  }

  if (message.kind === "request" && message.method === "turn") {
    void runTurn(message.payload as unknown as TurnPayload)
      .then((value) => send({ kind: "result", id: message.id, ok: true, value }))
      .catch((error: unknown) => send({ kind: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
});
