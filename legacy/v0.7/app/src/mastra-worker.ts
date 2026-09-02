import readline from "node:readline";
import { randomUUID } from "node:crypto";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentRuntimeMessage } from "./main/constructAgentRuntime";
import { configureConstructAiSettings, type StoredAiSettings } from "./main/config/constructConfig";
import {
  buildFlowModelMessages,
  FLOW_MAIN_AGENT_PROMPT,
  explicitFlowToolChoice
} from "./main/flow/ConstructFlowService";
import {
  fetchInternetPages,
  searchInternet
} from "./main/agent-tools/constructProtocolTools";
import { runConstructVerifierAgent } from "./main/constructVerifierAgent";
import { runConstructInteract } from "./main/constructInteractAgent";
import { runConstructAuthoringReviewAgent } from "./main/constructAuthoringReviewAgent";
import { runConstructSelectionExplainAgent } from "./main/constructSelectionExplainAgent";
import { fetchCodeGhostExplanation } from "./main/constructCodeGhostAgent";

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

const hostTools = {
  "read-file": hostTool("read-file", "Read a UTF-8 file in the active project.", z.object({ projectId: z.string(), path: z.string() })),
  "write-file": hostTool("write-file", "Write a UTF-8 file in the active project.", z.object({ projectId: z.string(), path: z.string(), content: z.string() })),
  "list-files": hostTool("list-files", "List the active project workspace tree.", z.object({ projectId: z.string() })),
  "run-terminal-command": hostTool("run-terminal-command", "Run an approved command inside the active project.", z.object({ projectId: z.string(), command: z.string() })),
  ask_user_question: hostTool(
    "ask_user_question",
    "Ask the learner one tracked question and pause until they answer. Use this instead of writing required learner questions as prose.",
    z.object({
      question: z.string().min(1).max(600),
      header: z.string().min(1).max(80).optional(),
      reason: z.string().min(1).max(240).optional(),
      choices: z.array(z.string().min(1).max(160)).max(6).optional(),
      allowOther: z.boolean().default(true),
      answerMode: z.enum(["text", "code"]).optional(),
      language: z.string().max(80).optional(),
      initialAnswer: z.string().max(12_000).optional(),
      allowSkip: z.boolean().default(false),
      blocksProgress: z.boolean().default(true),
      hideLearningMaterials: z.boolean().default(false)
    })
  )
};

// Flow's durable teaching state is owned by the native host. Keeping these
// tools in the worker registry is what gives the mentor permission to create
// and update real Construct concepts instead of merely describing a syllabus.
const flowConceptTools = {
  fetch_concepts: hostTool(
    "fetch-concepts",
    "Read the concepts introduced in this Construct project before teaching from, placing, or changing a concept.",
    z.object({ projectId: z.string(), ids: z.array(z.string()).max(30).optional(), query: z.string().max(240).optional(), includeTree: z.boolean().optional() })
  ),
  add_concept: hostTool(
    "add-concept",
    "Persist a new project-local Construct concept. Use this after teaching a new capability; concepts normally begin at mastery level 0.",
    z.object({
      projectId: z.string(), id: z.string().min(1), title: z.string().min(1), content: z.string().min(1),
      parentId: z.string().nullable().optional(), language: z.string().max(80).default("unknown"), technology: z.string().max(120).optional(),
      sources: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string().optional() })).max(10).optional(),
      examples: z.array(z.string()).max(12).optional(), relatedConcepts: z.array(z.string()).max(20).optional(),
      masteryLevel: z.number().int().min(0).max(5).default(0), masteryReason: z.string().max(700).optional(),
      reason: z.string().min(1), evidence: z.array(z.string().min(1)).min(1).max(8), pathNodeId: z.string().optional(), taskId: z.string().optional()
    })
  ),
  modify_concept: hostTool(
    "modify-concept",
    "Update an existing project-local Construct concept only after reading it with fetch-concepts.",
    z.object({
      projectId: z.string(), id: z.string().min(1), title: z.string().min(1).optional(), content: z.string().min(1).optional(),
      language: z.string().max(80).optional(), technology: z.string().max(120).optional(), sources: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string().optional() })).max(10).optional(),
      examples: z.array(z.string()).max(12).optional(), relatedConcepts: z.array(z.string()).max(20).optional(),
      masteryLevel: z.number().int().min(0).max(5).optional(), masteryReason: z.string().max(700).optional(),
      reason: z.string().min(1), evidence: z.array(z.string().min(1)).min(1).max(8)
    })
  ),
  remove_concept: hostTool(
    "remove-concept",
    "Remove a project-local Construct concept only when it is genuinely obsolete or incorrectly placed.",
    z.object({ projectId: z.string(), id: z.string().min(1), reason: z.string().min(1), evidence: z.array(z.string().min(1)).min(1).max(8) })
  )
};

function createFlowTools(settings: StoredAiSettings | undefined) {
  return {
    ...hostTools,
    ...flowConceptTools,
    internet_search: createTool({
      id: "internet_search",
      description: "Search the public web for current, source-grounded information. Prefer official documentation and primary sources.",
      inputSchema: z.object({
        query: z.string().min(2).max(380),
        limit: z.number().int().min(1).max(6).optional()
      }),
      execute: async ({ query, limit }) => searchInternet(query, limit ?? 4, settings?.tavilyApiKey)
    }),
    internet_fetch: createTool({
      id: "internet_fetch",
      description: "Fetch readable content from exact public URLs after internet_search identifies useful sources.",
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(4),
        query: z.string().max(180).optional(),
        maxChars: z.number().int().min(1_000).max(20_000).optional()
      }),
      execute: async ({ urls, query, maxChars }) => fetchInternetPages({
        urls,
        query,
        maxChars: maxChars ?? 6_000,
        extractDepth: "basic",
        format: "markdown",
        timeoutSeconds: 10,
        tavilyApiKey: settings?.tavilyApiKey
      })
    })
  };
}

async function execute(request: RequestMessage): Promise<unknown> {
  const payload = request.payload ?? {};
  configureConstructAiSettings((payload.settings as StoredAiSettings | undefined) ?? null);
  const trace = (entry: unknown) => send({ kind: "event", requestId: request.id, event: "trace", payload: entry });
  if (request.method === "verification.run") return runConstructVerifierAgent(payload, trace);
  if (request.method === "interact.run") return runConstructInteract(payload, trace, hostTools);
  if (request.method === "authoring.review") return runConstructAuthoringReviewAgent(payload, trace);
  if (request.method === "selection.explain") return runConstructSelectionExplainAgent(payload, (entry) => send({ kind: "event", requestId: request.id, event: "selection-progress", payload: entry }), trace);
  if (request.method === "code-ghost.run") return fetchCodeGhostExplanation(payload, undefined, trace);
  if (request.method !== "flow.run" && request.method !== "flow.research") throw new Error(`Unsupported Mastra worker method: ${request.method}`);
  const runtime = createConstructAgentRuntime();
  const research = request.method === "flow.research";
  const flowTools = createFlowTools(payload.settings as StoredAiSettings | undefined);
  const researchTools = {
    internet_search: flowTools.internet_search,
    internet_fetch: flowTools.internet_fetch
  };
  const instructions = research
    ? "Research the project goal and return a concise, sourced implementation briefing. Do not mutate files."
    : FLOW_MAIN_AGENT_PROMPT;
  const prompt = [
    `Project snapshot:\n${JSON.stringify(payload.project ?? {})}`,
    `Project concepts (the authoritative project-local teaching ledger):\n${JSON.stringify(payload.concepts ?? [])}`,
    `Project memory:\n${JSON.stringify(payload.memory ?? {})}`,
    `Learner request:\n${String(payload.message ?? (research ? "Research this project." : "Continue."))}`
  ].join("\n\n");
  const messages = flowConversationMessages(payload.project, prompt, research);
  return runtime.runAgentic({
    id: research ? "construct-flow-research-agent" : "construct-flow-agent",
    name: research ? "Construct Flow Research" : "Construct Flow",
    purpose: research ? "research a Construct Flow project" : "mentor the learner inside Construct Flow",
    featureId: "construct-flow",
    instructions,
    prompt,
    messages,
    tools: research ? researchTools : flowTools,
    toolChoice: research ? undefined : explicitFlowToolChoice(String(payload.message ?? ""), flowTools),
    maxSteps: research ? 8 : 24,
    onTrace: trace
  });
}

function flowConversationMessages(project: unknown, prompt: string, research: boolean): ConstructAgentRuntimeMessage[] {
  if (research) return [{ role: "user" as const, content: prompt }];
  if (!project || typeof project !== "object") return [{ role: "user", content: prompt }];
  const flowProject = project as Parameters<typeof buildFlowModelMessages>[0];
  const runningSessionIds = new Set(
    (flowProject.flow?.sessions ?? [])
      .filter((session) => session.status === "running")
      .map((session) => session.id),
  );
  // Reuse Flow's pre-migration transcript authority. It preserves visible
  // reasoning/tool activity, tracked answers, and compaction boundaries instead
  // of reducing continuity to the final assistant prose alone.
  const history = buildFlowModelMessages(flowProject)
    .filter((message) => !message.sessionId || !runningSessionIds.has(message.sessionId))
    .map(({ role, content }) => ({ role, content }));
  return [...history, { role: "user" as const, content: prompt }];
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
