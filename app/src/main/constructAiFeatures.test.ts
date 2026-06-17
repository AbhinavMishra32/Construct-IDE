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
  provider: "openai",
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
  openCodeBaseUrl: "http://localhost:4096",
  openCodePort: 4096,
  openCodeManageServer: false,
  openCodeModel: "opencode/openai/gpt-5",
  githubCopilotModel: "github_copilot/gpt-4",
  featureModels: {}
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
    modelForAiFeature({ ...baseSettings, provider: "opencode" }, "verification"),
    "opencode/openai/gpt-5"
  );

  assert.equal(
    modelForAiFeature({ ...baseSettings, provider: "github-copilot" }, "verification"),
    "github_copilot/gpt-4"
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
