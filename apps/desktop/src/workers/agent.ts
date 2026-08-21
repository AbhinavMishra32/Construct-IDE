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
    "Record what the learner now understands about one concept, and at what mastery level. Call this whenever you introduce an idea, see evidence of understanding, or find a gap. Levels: 0 unseen, 1 recognises pieces, 2 guided understanding, 3 practice ready, 4 applies reliably, 5 transfers and teaches. A scoped task is only fair at level 3 or above.",
    z.object({
      conceptId: z.string().min(1).max(120).describe("A stable slug, e.g. 'rasterisation' or 'array-destructuring'"),
      title: z.string().min(1).max(120),
      masteryLevel: z.number().int().min(0).max(5),
      confidence: z.string().min(1).max(40).describe("One word for the reading, e.g. introduced, fragile, practicing, solid"),
      note: z.string().max(600).optional().describe("What the learner said or did that supports this level"),
      reason: z.string().max(300).optional().describe("Why the level changed"),
    }),
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
  /* A discriminated union rather than `role: "user" | "assistant"`. Mastra's
     message type is itself a union, and a single object typed with a union
     role matches none of its members — the compiler cannot tell which one is
     meant until the role is fixed per element. */
  messages: Array<{ role: "user"; content: string } | { role: "assistant"; content: string }>;
};

async function runTurn(payload: TurnPayload): Promise<{ text: string }> {
  currentRequestId = payload.requestId;

  const agent = new Agent({
    id: "construct-flow",
    name: "Construct Flow",
    /* The prompt is used as-is, with state appended rather than interpolated —
       the same shape v0.7 used, so behaviour does not shift with the port. */
    instructions: payload.stateSuffix ? `${CONSTRUCT_AGENT_PROMPT}\n\n${payload.stateSuffix}` : CONSTRUCT_AGENT_PROMPT,
    model: createPiMastraModel(payload.provider),
    tools,
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
      if (text) send({ kind: "event", requestId: payload.requestId, type: "text", text });
    }) as never,
  });

  send({ kind: "event", requestId: payload.requestId, type: "done" });
  /* Normalised for the same reason: `result.text` has been a string and an
     array of content parts depending on the provider, and a reply stored as
     "[object Object]" is a lost turn. */
  return { text: textOf(result.text) || textOf((result as unknown as { content?: unknown }).content) };
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
