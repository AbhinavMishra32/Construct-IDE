import readline from "node:readline";
import { randomUUID } from "node:crypto";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createConstructAgentRuntime } from "./main/constructAgentRuntime";
import { FLOW_MAIN_AGENT_PROMPT } from "./main/flow/ConstructFlowService";

type RequestMessage = { kind: "request"; id: string; method: string; payload: any };
type ToolResultMessage = { kind: "tool-result"; id: string; ok: boolean; value?: unknown; error?: string };

const pendingTools = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => process.stderr.write(`[mastra:${level}] ${args.map(String).join(" ")}\n`);
}

function hostTool(name: string, description: string, schema: z.ZodTypeAny) {
  return createTool({
    id: name,
    description,
    inputSchema: schema,
    execute: async (input) => {
      const id = randomUUID();
      const result = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject }));
      send({ kind: "tool-call", id, name, input });
      return result;
    }
  });
}

const tools = {
  "read-file": hostTool("read-file", "Read a UTF-8 file in the active project.", z.object({ projectId: z.string(), path: z.string() })),
  "write-file": hostTool("write-file", "Write a UTF-8 file in the active project.", z.object({ projectId: z.string(), path: z.string(), content: z.string() })),
  "list-files": hostTool("list-files", "List the active project workspace tree.", z.object({ projectId: z.string() })),
  "run-terminal-command": hostTool("run-terminal-command", "Run an approved command inside the active project.", z.object({ projectId: z.string(), command: z.string() }))
};

async function execute(request: RequestMessage): Promise<unknown> {
  if (request.method !== "flow.run" && request.method !== "flow.research") {
    throw new Error(`Unsupported Mastra worker method: ${request.method}`);
  }
  const payload = request.payload ?? {};
  const runtime = createConstructAgentRuntime();
  const research = request.method === "flow.research";
  const instructions = research
    ? "Research the project goal and return a concise, sourced implementation briefing. Do not mutate files."
    : FLOW_MAIN_AGENT_PROMPT;
  const prompt = [
    `Project snapshot:\n${JSON.stringify(payload.project ?? {})}`,
    `Project memory:\n${JSON.stringify(payload.memory ?? {})}`,
    `Learner request:\n${String(payload.message ?? (research ? "Research this project." : "Continue."))}`
  ].join("\n\n");
  return runtime.runAgentic({
    id: research ? "construct-flow-research-agent" : "construct-flow-agent",
    name: research ? "Construct Flow Research" : "Construct Flow",
    purpose: research ? "research a Construct Flow project" : "mentor the learner inside Construct Flow",
    featureId: "construct-flow",
    instructions,
    prompt,
    messages: [{ role: "user", content: prompt }],
    tools: research ? undefined : tools,
    maxSteps: research ? 8 : 24,
    onTrace: (entry) => send({ kind: "event", requestId: request.id, event: "trace", payload: entry })
  });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message: RequestMessage | ToolResultMessage;
  try { message = JSON.parse(line); } catch { return; }
  if (message.kind === "tool-result") {
    const pending = pendingTools.get(message.id);
    if (!pending) return;
    pendingTools.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error ?? "Rust host tool failed"));
    return;
  }
  if (message.kind === "request") {
    void execute(message).then(
      (value) => send({ kind: "result", id: message.id, ok: true, value }),
      (error) => send({ kind: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    );
  }
});
