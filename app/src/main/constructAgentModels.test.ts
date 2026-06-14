import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConstructAgentModelFromSettings,
  resolveConstructOpenAiResponsesConfigFromSettings
} from "./constructAgentModels";
import type { StoredAiSettings } from "./constructAiSettings";

const settings: StoredAiSettings = {
  runtime: "mastra",
  provider: "openrouter",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openAiBaseUrl: "https://api.openai.com/v1",
  openRouterApiKey: "test-openrouter-key",
  openRouterModel: "deepseek/deepseek-chat",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  featureModels: {
    "construct-interact": "deepseek/deepseek-v4-flash"
  }
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
