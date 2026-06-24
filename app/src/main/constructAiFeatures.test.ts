import assert from "node:assert/strict";
import test from "node:test";

import {
  constructAiFeatures,
  featureSettingsView,
  modelForAiFeature
} from "./constructAiFeatures";
import type { StoredAiSettings } from "./constructAiSettings";

const baseSettings: StoredAiSettings = {
  runtime: "mastra",
  source: "byok",
  provider: "openai",
  reasoningEffort: "auto",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openAiBaseUrl: "https://api.openai.com/v1",
  openRouterApiKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  liteLlmApiKey: "",
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
  featureModels: {},
  codeGhostEnabled: true,
  conceptFirewallEnabled: true
};

test("registered AI features expose user-facing metadata", () => {
  assert.ok(constructAiFeatures.length >= 4);
  assert.deepEqual(
    constructAiFeatures.map((feature) => feature.id),
    ["construct-interact", "construct-flow", "verification", "authoring-review", "selection-explain", "code-explain"]
  );
  assert.ok(constructAiFeatures.every((feature) => feature.title && feature.description));
});

test("feature models use provider defaults and saved per-feature overrides", () => {
  assert.equal(modelForAiFeature(baseSettings, "verification"), "gpt-5-mini");

  assert.equal(
    modelForAiFeature({ ...baseSettings, provider: "openrouter" }, "verification"),
    "deepseek/deepseek-v4-flash"
  );

  assert.equal(
    modelForAiFeature({ ...baseSettings, provider: "opencode-zen" }, "verification"),
    "gpt-5.1-codex"
  );

  assert.equal(
    modelForAiFeature({ ...baseSettings, provider: "github-copilot" }, "verification"),
    "github_copilot/gpt-4"
  );

  assert.equal(
    modelForAiFeature({
      ...baseSettings,
      source: "construct-cloud",
      constructCloudModel: "anthropic/claude-sonnet-4"
    }, "verification"),
    "anthropic/claude-sonnet-4"
  );

  assert.equal(
    modelForAiFeature({
      ...baseSettings,
      featureModels: { verification: "gpt-5.1" }
    }, "verification"),
    "gpt-5.1"
  );
});

test("settings view returns the active model for each feature", () => {
  const rows = featureSettingsView({
    ...baseSettings,
    featureModels: { "selection-explain": "gpt-5.1-mini" }
  });

  assert.equal(rows.find((row) => row.id === "selection-explain")?.model, "gpt-5.1-mini");
  assert.equal(rows.find((row) => row.id === "code-explain")?.model, "gpt-5-mini");
});
