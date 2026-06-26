import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConstructAgentModelFromSettings,
  resolveConstructOpenAiResponsesConfigFromSettings
} from "./constructAgentModels";
import type { StoredAiSettings } from "./constructAiSettings";

const settings: StoredAiSettings = {
  runtime: "mastra",
  source: "byok",
  provider: "openrouter",
  reasoningEffort: "auto",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openAiBaseUrl: "https://api.openai.com/v1",
  openRouterApiKey: "test-openrouter-key",
  openRouterModel: "deepseek/deepseek-chat",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  liteLlmApiKey: "test-litellm-key",
  liteLlmModel: "openai/gpt-5-mini",
  liteLlmBaseUrl: "http://localhost:4000/v1",
  liteLlmManageServer: false,
  opencodeZenApiKey: "",
  opencodeZenBaseUrl: "https://opencode.ai/zen/v1",
  opencodeZenModel: "gpt-5.1-codex",
  githubCopilotModel: "github_copilot/gpt-4",
  constructCloudBaseUrl: "https://cloud.tryconstruct.cc",
  constructCloudAccessToken: "",
  constructCloudModel: "deepseek/deepseek-v4-flash",
  tavilyApiKey: "",
  featureModels: {
    "construct-interact": "deepseek/deepseek-v4-flash"
  },
  codeGhostEnabled: true,
  conceptFirewallEnabled: true,
  flowSourceGroundingEnabled: true
};

test("agent model resolution uses the selected OpenRouter credentials and feature model", () => {
  assert.deepEqual(
    resolveConstructAgentModelFromSettings(settings, "Construct Interact evaluation", "construct-interact"),
    {
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-flash",
      url: "https://openrouter.ai/api/v1",
      apiKey: "test-openrouter-key"
    }
  );
});

test("hosted compute source resolves through the hosted proxy with a desktop token", () => {
  assert.deepEqual(
    resolveConstructAgentModelFromSettings(
      {
        ...settings,
        source: "construct-cloud",
        constructCloudBaseUrl: "http://localhost:8787",
        constructCloudAccessToken: "cct_test-token",
        constructCloudModel: "anthropic/claude-sonnet-4",
        featureModels: {}
      },
      "Construct Flow",
      "construct-flow"
    ),
    {
      providerId: "construct-cloud",
      modelId: "anthropic/claude-sonnet-4",
      id: "anthropic/claude-sonnet-4",
      url: "http://localhost:8787/v1",
      apiKey: "cct_test-token"
    }
  );
});

test("hosted compute source requires a desktop token", () => {
  assert.throws(
    () => resolveConstructAgentModelFromSettings(
      {
        ...settings,
        source: "construct-cloud",
        constructCloudAccessToken: "",
        featureModels: {}
      },
      "Construct Flow",
      "construct-flow"
    ),
    /Construct account hosted-compute token is required/
  );
});

test("agent model resolution reports the selected provider when its key is missing", () => {
  assert.throws(
    () => resolveConstructAgentModelFromSettings(
      { ...settings, openRouterApiKey: "" },
      "Code Ghost explanation",
      "code-explain"
    ),
    /OpenRouter API key is required/
  );
});

test("OpenRouter selection never falls through to a stored OpenAI key", () => {
  assert.equal(
    resolveConstructOpenAiResponsesConfigFromSettings({
      ...settings,
      openAiApiKey: "leftover-openai-key"
    }, "selection-explain"),
    null
  );
});

test("proxy-backed providers resolve through LiteLLM model config", () => {
  assert.deepEqual(
    resolveConstructAgentModelFromSettings(
      { ...settings, provider: "github-copilot", featureModels: {} },
      "Construct Interact evaluation",
      "construct-interact"
    ),
    {
      providerId: "github-copilot",
      modelId: "github_copilot/gpt-4",
      id: "github_copilot/gpt-4",
      url: "http://localhost:4000/v1",
      apiKey: "test-litellm-key"
    }
  );
});
