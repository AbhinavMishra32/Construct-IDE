import { describe, expect, it } from "vitest";
import keytar from "keytar";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModels, registerFauxProvider } from "@mariozechner/pi-ai";
import { getOAuthApiKey, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { z } from "zod";
import { clineBaseUrl } from "../shared/clineCatalog.js";
import { createPiMastraModel, piTransportForApi } from "../workers/piMastraModel.js";

describe("Pi to Mastra model adapter", () => {
  it("uses SSE for ChatGPT subscription inference", () => {
    expect(piTransportForApi("openai-codex-responses")).toBe("sse");
    expect(piTransportForApi("openai-responses")).toBeUndefined();
  });

  it("preserves text, JSON tool calls, finish reason, and usage", async () => {
    const provider = registerFauxProvider({ api: "construct-faux", provider: "construct-faux", models: [{ id: "training-faux" }] });
    provider.setResponses([fauxAssistantMessage([fauxText("Inspecting evidence."), fauxToolCall("read_ability", { abilityId: "ability-1" }, { id: "call-1" })], { stopReason: "toolUse" })]);
    try {
      const model = createPiMastraModel({ provider: "construct-faux", model: "training-faux", api: "construct-faux", baseUrl: "http://localhost:0", apiKey: "test" });
      const result = await model.doGenerate({
        prompt: [
          { role: "system", content: "Use evidence." },
          { role: "user", content: [{ type: "text", text: "Choose the next target." }] },
        ],
        tools: [{ type: "function", name: "read_ability", description: "Read evidence", inputSchema: { type: "object", properties: { abilityId: { type: "string" } }, required: ["abilityId"] } }],
        toolChoice: { type: "required" },
      });
      expect(result.finishReason).toBe("tool-calls");
      expect(result.content).toEqual([
        { type: "text", text: "Inspecting evidence." },
        { type: "tool-call", toolCallId: "call-1", toolName: "read_ability", input: JSON.stringify({ abilityId: "ability-1" }) },
      ]);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
    } finally { provider.unregister(); }
  });

  it("executes one streamed provider tool call exactly once", async () => {
    const provider = registerFauxProvider({ api: "construct-stream-faux", provider: "construct-stream-faux", models: [{ id: "stream-faux" }] });
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("inspect", { path: "main.py" }, { id: "call-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
    ]);
    let calls = 0;
    try {
      const agent = new Agent({
        id: "stream-tool-regression",
        name: "Stream tool regression",
        instructions: "Inspect once.",
        model: createPiMastraModel({ provider: "construct-stream-faux", model: "stream-faux", api: "construct-stream-faux", baseUrl: "http://localhost:0", apiKey: "test" }),
        tools: {
          inspect: createTool({
            id: "inspect",
            description: "Inspect one file.",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => { calls += 1; return { ok: true }; },
          }),
        },
      });
      const run = await agent.stream([{ role: "user", content: "Inspect main.py." }], { maxSteps: 3 });
      for await (const _chunk of run.fullStream) { /* consume the run */ }
      await run.text;
      expect(calls).toBe(1);
    } finally {
      provider.unregister();
    }
  });

  it.runIf(process.env.CONSTRUCT_VERIFY_CHATGPT === "1")("calls a tool through the connected ChatGPT subscription", async () => {
    const raw = await keytar.getPassword("cc.construct.desktop", "provider-oauth:openai-codex");
    if (!raw) throw new Error("ChatGPT subscription credential is not connected");
    const credentials = JSON.parse(raw) as OAuthCredentials;
    const resolved = await getOAuthApiKey("openai-codex", { "openai-codex": credentials });
    if (!resolved) throw new Error("ChatGPT subscription credential could not be refreshed");
    const source = getModels("openai-codex").find((model) => model.id === "gpt-5.4-mini");
    if (!source) throw new Error("GPT-5.4 Mini is unavailable in the ChatGPT subscription catalog");
    const model = createPiMastraModel({ provider: source.provider, model: source.id, api: source.api, baseUrl: source.baseUrl, apiKey: resolved.apiKey });
    const result = await model.doGenerate({
      prompt: [
        { role: "system", content: "Call the supplied tool exactly once." },
        { role: "user", content: [{ type: "text", text: "Retrieve learner evidence." }] },
      ],
      tools: [{ type: "function", name: "search_learner_model", description: "Search learner evidence", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query", "limit"] } }],
      toolChoice: { type: "required" },
      maxOutputTokens: 128,
    });
    expect(result.finishReason).toBe("tool-calls");
    expect(result.content.some((part) => part.type === "tool-call" && part.toolName === "search_learner_model")).toBe(true);
  }, 60_000);

  /* The Cline half of the exchange is asserted against a loopback server in
     shared/clineCatalog.test.ts, which needs no key. This is the other half:
     that Cline itself accepts what Construct sends and calls the tool back. Run it
     with a Cline key connected — `CONSTRUCT_VERIFY_CLINE=1 pnpm --filter @construct/desktop test`
     — and it spends nothing, because DeepSeek V4 Flash is one of the models
     Cline currently bills at zero. */
  it.runIf(process.env.CONSTRUCT_VERIFY_CLINE === "1")("calls a tool through Cline's free DeepSeek V4 Flash", async () => {
    const apiKey = await keytar.getPassword("cc.construct.desktop", "provider:cline");
    if (!apiKey) throw new Error("Connect Cline in Settings before running this verification");
    const model = createPiMastraModel({ provider: "cline", model: "deepseek/deepseek-v4-flash", api: "openai-completions", baseUrl: clineBaseUrl, apiKey });
    const result = await model.doGenerate({
      prompt: [
        { role: "system", content: "Call the supplied tool exactly once." },
        { role: "user", content: [{ type: "text", text: "Retrieve learner evidence." }] },
      ],
      tools: [{ type: "function", name: "search_learner_model", description: "Search learner evidence", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query", "limit"] } }],
      toolChoice: { type: "required" },
      maxOutputTokens: 128,
    });
    expect(result.content.some((part) => part.type === "tool-call" && part.toolName === "search_learner_model")).toBe(true);
  }, 60_000);
});
