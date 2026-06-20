import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configureConstructDataPaths,
  createConstructDataPaths,
  defaultConstructSettings,
  readConstructAiSettingsSync,
  writeConstructSettings
} from "./constructConfig";

test("sync agent settings use the configured Electron user-data path", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "construct-config-"));
  const paths = createConstructDataPaths(root);
  configureConstructDataPaths(paths);
  t.after(() => {
    configureConstructDataPaths(null);
    rmSync(root, { recursive: true, force: true });
  });

  const settings = defaultConstructSettings(paths);
  await writeConstructSettings({
    ...settings,
    ai: {
      ...settings.ai,
      provider: "openrouter",
      reasoningEffort: "high",
      openRouterApiKey: "test-openrouter-key",
      tavilyApiKey: "tvly-test-key",
      featureModels: {
        "construct-interact": "deepseek/deepseek-v4-flash"
      }
    }
  }, paths);

  const resolved = readConstructAiSettingsSync();
  assert.equal(resolved.provider, "openrouter");
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.openRouterApiKey, "test-openrouter-key");
  assert.equal(resolved.tavilyApiKey, "tvly-test-key");
  assert.equal(resolved.featureModels["construct-interact"], "deepseek/deepseek-v4-flash");
});

test("settings normalize OpenCode Zen provider options", () => {
  const settings = defaultConstructSettings(createConstructDataPaths("/tmp/construct-test"));
  assert.equal(settings.ai.provider, "openai");
  assert.equal(settings.ai.reasoningEffort, "auto");
  assert.equal(settings.ai.liteLlmBaseUrl, "http://localhost:4000/v1");
  assert.equal(settings.ai.liteLlmModel, "openai/gpt-5-mini");
  assert.equal(settings.ai.githubCopilotModel, "github_copilot/gpt-4");
  assert.equal(settings.ai.opencodeZenModel, "gpt-5.1-codex");
  assert.equal(settings.ai.opencodeZenBaseUrl, "https://opencode.ai/zen/v1");
  assert.equal(settings.ai.tavilyApiKey, "");
});

test("settings preserve LiteLLM-backed provider selections", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "construct-config-"));
  const paths = createConstructDataPaths(root);
  configureConstructDataPaths(paths);
  t.after(() => {
    configureConstructDataPaths(null);
    rmSync(root, { recursive: true, force: true });
  });

  const settings = defaultConstructSettings(paths);
  await writeConstructSettings({
    ...settings,
    ai: {
      ...settings.ai,
      provider: "opencode-zen",
      liteLlmBaseUrl: "http://localhost:4000/v1",
      opencodeZenModel: "gpt-5.2-codex",
      githubCopilotModel: "github_copilot/gpt-4"
    }
  }, paths);

  const opencodeZen = readConstructAiSettingsSync();
  assert.equal(opencodeZen.provider, "opencode-zen");
  assert.equal(opencodeZen.opencodeZenModel, "gpt-5.2-codex");

  await writeConstructSettings({
    ...settings,
    ai: {
      ...settings.ai,
      provider: "github-copilot",
      liteLlmBaseUrl: "http://localhost:4000/v1",
      githubCopilotModel: "github_copilot/gpt-5.1-codex"
    }
  }, paths);

  const copilot = readConstructAiSettingsSync();
  assert.equal(copilot.provider, "github-copilot");
  assert.equal(copilot.githubCopilotModel, "github_copilot/gpt-5.1-codex");
});
