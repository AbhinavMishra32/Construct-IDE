import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { OpenAIStructuredLanguageModel } from "./agentService";
import type { ApiUsageEvent } from "@construct/shared";

test("OpenAIStructuredLanguageModel falls back to JSON mode when structured output schema is incompatible", async () => {
  let structuredCalls = 0;
  let fallbackCalls = 0;

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            structuredCalls += 1;
            throw new Error(
              "Zod field at `#/properties/startLine` uses `.optional()` without `.nullable()` which is not supported by the API."
            );
          }
        };
      },
      async invoke() {
        fallbackCalls += 1;
        return {
          content: JSON.stringify({
            value: "recovered"
          })
        };
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload."
  });

  assert.equal(parsed.value, "recovered");
  assert.equal(structuredCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test("OpenAIStructuredLanguageModel forwards streaming tokens through callbacks", async () => {
  const streamedChunks: string[] = [];

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke(_messages, config) {
            const handler = (config?.callbacks?.[0] ?? null) as
              | { handleLLMNewToken?: (token: string) => void }
              | null;

            handler?.handleLLMNewToken?.("{");
            handler?.handleLLMNewToken?.("\"value\":\"streamed\"");
            handler?.handleLLMNewToken?.("}");

            return {
              value: "streamed"
            };
          }
        };
      },
      async invoke() {
        return {
          content: JSON.stringify({
            value: "unused"
          })
        };
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_stream_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload.",
    stream: {
      stage: "plan-generation",
      label: "plan generation",
      onToken: (chunk) => {
        streamedChunks.push(chunk);
      }
    }
  });

  assert.equal(parsed.value, "streamed");
  assert.deepEqual(streamedChunks, ["{", "\"value\":\"streamed\"", "}"]);
});

test("OpenAIStructuredLanguageModel repairs malformed JSON fallback output", async () => {
  let structuredCalls = 0;
  let fallbackCalls = 0;
  let repairCalls = 0;

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            structuredCalls += 1;
            throw new Error(
              "invalid schema for response_format 'test_schema': object schema missing properties"
            );
          }
        };
      },
      async invoke(messages, config) {
        const mode = String(config?.metadata?.mode ?? "");

        if (mode === "json-fallback") {
          fallbackCalls += 1;
          return {
            content: '{"value": fifty}'
          };
        }

        if (mode === "json-repair") {
          repairCalls += 1;
          return {
            content: JSON.stringify({
              value: 50
            })
          };
        }

        throw new Error(`Unexpected invoke mode: ${mode} :: ${JSON.stringify(messages)}`);
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.number()
    }),
    schemaName: "test_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload."
  });

  assert.equal(parsed.value, 50);
  assert.equal(structuredCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(repairCalls, 1);
});

test("OpenAIStructuredLanguageModel records usage metadata for successful calls", async () => {
  const recordedEvents: Array<Record<string, unknown>> = [];

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    persistence: {
      async getProjectByBlueprintPath() {
        return null;
      },
      async recordApiUsageEvent(event: ApiUsageEvent) {
        recordedEvents.push(event as unknown as Record<string, unknown>);
      }
    } as never,
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            return {
              raw: {
                content: JSON.stringify({
                  value: "counted"
                }),
                usage_metadata: {
                  input_tokens: 42,
                  output_tokens: 8,
                  total_tokens: 50,
                  input_token_details: {
                    cached_tokens: 5
                  }
                },
                response_metadata: {
                  billing: {
                    cost_usd: 0.0025,
                    currency: "USD"
                  }
                }
              },
              parsed: {
                value: "counted"
              }
            };
          }
        };
      },
      async invoke() {
        return {
          content: "{}"
        };
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_usage_schema",
    instructions: "Return test data.",
    prompt: "Generate a payload.",
    usage: {
      projectId: "project-1",
      projectName: "Usage project",
      projectGoal: "Measure usage",
      sessionId: "project-1",
      jobId: "job-1",
      operation: "usage test"
    }
  });

  assert.equal(parsed.value, "counted");
  assert.equal(recordedEvents.length, 1);
  assert.equal(recordedEvents[0]?.inputTokens, 42);
  assert.equal(recordedEvents[0]?.outputTokens, 8);
  assert.equal(recordedEvents[0]?.totalTokens, 50);
  assert.equal(recordedEvents[0]?.cachedInputTokens, 5);
  assert.equal(recordedEvents[0]?.costUsd, 0.0025);
  assert.equal(recordedEvents[0]?.provider, "openai");
});

test("OpenAIStructuredLanguageModel repairs malformed structured-output drafts without restarting the whole generation", async () => {
  let structuredCalls = 0;
  let fallbackCalls = 0;
  let repairCalls = 0;

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            structuredCalls += 1;
            throw new Error(
              'Failed to parse. Text: "{\\"value\\": broken}". Error: SyntaxError: Unexpected token b in JSON at position 10'
            );
          }
        };
      },
      async invoke(_messages, config) {
        const mode = String(config?.metadata?.mode ?? "");

        if (mode === "json-repair") {
          repairCalls += 1;
          return {
            content: JSON.stringify({
              value: "recovered"
            })
          };
        }

        if (mode === "json-fallback") {
          fallbackCalls += 1;
        }

        throw new Error(`Unexpected invoke mode: ${mode}`);
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_structured_repair",
    instructions: "Return test data.",
    prompt: "Generate a payload."
  });

  assert.equal(parsed.value, "recovered");
  assert.equal(structuredCalls, 1);
  assert.equal(repairCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test("OpenAIStructuredLanguageModel extracts the first valid JSON object when repair output has trailing text", async () => {
  let repairCalls = 0;

  const model = new OpenAIStructuredLanguageModel({
    apiKey: "test-key",
    model: "gpt-5-mini",
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    client: {
      withStructuredOutput() {
        return {
          async invoke() {
            throw new Error(
              'Failed to parse. Text: "{\\"value\\": broken}". Error: SyntaxError: Unexpected token b in JSON at position 10'
            );
          }
        };
      },
      async invoke(_messages, config) {
        const mode = String(config?.metadata?.mode ?? "");

        if (mode === "json-repair") {
          repairCalls += 1;
          return {
            content: '{"value":"recovered"}\nRecovered from malformed draft.'
          };
        }

        throw new Error(`Unexpected invoke mode: ${mode}`);
      }
    }
  });

  const parsed = await model.parse({
    schema: z.object({
      value: z.string().min(1)
    }),
    schemaName: "test_structured_repair_trailing_text",
    instructions: "Return test data.",
    prompt: "Generate a payload."
  });

  assert.equal(parsed.value, "recovered");
  assert.equal(repairCalls, 1);
});
