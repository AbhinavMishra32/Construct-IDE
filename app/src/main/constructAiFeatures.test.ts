import assert from "node:assert/strict";
import test from "node:test";

import {
  constructAiFeatures,
  featureSettingsView,
  modelForAiFeature
} from "./constructAiFeatures";
import type { StoredAiSettings } from "./constructAiSettings";

const baseSettings: StoredAiSettings = {
  provider: "openai",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openRouterApiKey: "",
  openRouterModel: "openai/gpt-5-mini",
  featureModels: {}
};

test("registered AI features expose user-facing metadata", () => {
  assert.ok(constructAiFeatures.length >= 4);
  assert.deepEqual(
    constructAiFeatures.map((feature) => feature.id),
    ["verification", "authoring-review", "selection-explain", "code-explain"]
  );
  assert.ok(constructAiFeatures.every((feature) => feature.title && feature.description));
});

test("feature models use provider defaults and saved per-feature overrides", () => {
  assert.equal(modelForAiFeature(baseSettings, "verification"), "gpt-5-mini");

  assert.equal(
    modelForAiFeature({ ...baseSettings, provider: "openrouter" }, "verification"),
    "openai/gpt-5-mini"
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
