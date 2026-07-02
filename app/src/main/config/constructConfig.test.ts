import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configureConstructCloudProductionEndpointLock,
  configureConstructDataPaths,
  createConstructDataPaths,
  defaultConstructSettings,
  enforceConstructCloudProductionEndpoint,
  normalizeSettings,
  readConstructAiSettingsSync,
  readConstructSettings,
  writeConstructSettings
} from "./constructConfig";

function withConstructCloudEndpointEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.CONSTRUCT_CLOUD_ENDPOINT;
  if (value === undefined) {
    delete process.env.CONSTRUCT_CLOUD_ENDPOINT;
  } else {
    process.env.CONSTRUCT_CLOUD_ENDPOINT = value;
  }

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.CONSTRUCT_CLOUD_ENDPOINT;
    } else {
      process.env.CONSTRUCT_CLOUD_ENDPOINT = previous;
    }
  }
}

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
  const settings = withConstructCloudEndpointEnv(undefined, () =>
    defaultConstructSettings(createConstructDataPaths("/tmp/construct-test"))
  );
  assert.equal(settings.app.showStatusBar, true);
  assert.equal(settings.ai.source, "byok");
  assert.equal(settings.ai.provider, "openai");
  assert.equal(settings.ai.reasoningEffort, "auto");
  assert.equal(settings.ai.liteLlmBaseUrl, "http://localhost:4000/v1");
  assert.equal(settings.ai.liteLlmModel, "openai/gpt-5-mini");
  assert.equal(settings.ai.githubCopilotModel, "github_copilot/gpt-4");
  assert.equal(settings.ai.opencodeZenModel, "gpt-5.1-codex");
  assert.equal(settings.ai.opencodeZenBaseUrl, "https://opencode.ai/zen/v1");
  assert.equal(settings.ai.constructCloudBaseUrl, "https://api.tryconstruct.cc");
  assert.equal(settings.ai.constructCloudAccessToken, "");
  assert.equal(settings.ai.constructCloudModel, "deepseek/deepseek-v4-flash");
  assert.equal(settings.ai.tavilyApiKey, "");
  assert.equal(settings.ai.conceptFirewallEnabled, true);
  assert.equal(settings.ai.flowSourceGroundingEnabled, true);
});

test("settings default Construct Cloud endpoint follows CONSTRUCT_CLOUD_ENDPOINT", () => {
  const settings = withConstructCloudEndpointEnv("http://localhost:8787/", () =>
    defaultConstructSettings(createConstructDataPaths("/tmp/construct-test"))
  );
  assert.equal(settings.ai.constructCloudBaseUrl, "http://localhost:8787");
});

test("settings normalize and persist hosted compute routing options", async (t) => {
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
      source: "construct-cloud",
      constructCloudBaseUrl: "http://localhost:8787/",
      constructCloudAccessToken: "cct_test-token",
      constructCloudModel: "anthropic/claude-sonnet-4"
    }
  }, paths);

  const cloud = readConstructAiSettingsSync();
  assert.equal(cloud.source, "construct-cloud");
  assert.equal(cloud.constructCloudBaseUrl, "http://localhost:8787");
  assert.equal(cloud.constructCloudAccessToken, "cct_test-token");
  assert.equal(cloud.constructCloudModel, "anthropic/claude-sonnet-4");
});

test("production endpoint lock forces Construct Cloud to the release API", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "construct-config-"));
  const paths = createConstructDataPaths(root);
  configureConstructDataPaths(paths);
  configureConstructCloudProductionEndpointLock(true);
  t.after(() => {
    configureConstructCloudProductionEndpointLock(false);
    configureConstructDataPaths(null);
    rmSync(root, { recursive: true, force: true });
  });

  withConstructCloudEndpointEnv("https://api.tryconstruct.cc", () => {
    const settings = defaultConstructSettings(paths);
    const custom = {
      ...settings,
      ai: {
        ...settings.ai,
        constructCloudBaseUrl: "http://localhost:8787",
        constructCloudAccessToken: "cct_test-token"
      }
    };

    assert.equal(
      enforceConstructCloudProductionEndpoint(custom, true).ai.constructCloudBaseUrl,
      "https://api.tryconstruct.cc"
    );
  });

  await withConstructCloudEndpointEnv("https://api.tryconstruct.cc", async () => {
    const settings = defaultConstructSettings(paths);
    const custom = {
      ...settings,
      ai: {
        ...settings.ai,
        constructCloudBaseUrl: "http://localhost:8787",
        constructCloudAccessToken: "cct_test-token"
      }
    };

    await writeConstructSettings(custom, paths);
    assert.equal(readConstructAiSettingsSync().constructCloudBaseUrl, "https://api.tryconstruct.cc");
    assert.equal(readConstructAiSettingsSync().constructCloudAccessToken, "cct_test-token");

    const unlocked = await readConstructSettings(paths);
    assert.equal(unlocked.ai.constructCloudBaseUrl, "https://api.tryconstruct.cc");
    assert.equal(
      enforceConstructCloudProductionEndpoint(unlocked, true).ai.constructCloudBaseUrl,
      "https://api.tryconstruct.cc"
    );
  });
});

test("settings normalize and persist source-grounded Flow preference", async (t) => {
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
      flowSourceGroundingEnabled: false
    }
  }, paths);

  const persisted = readConstructAiSettingsSync();
  assert.equal(normalizeSettings({}, paths).ai.flowSourceGroundingEnabled, true);
  assert.equal(persisted.flowSourceGroundingEnabled, false);
});

test("settings normalize Langfuse observability", () => {
  const paths = createConstructDataPaths("/tmp/construct-test");
  const normalized = normalizeSettings({
    observability: {
      enabled: true,
      langfuseBaseUrl: "localhost:3000/",
      langfusePublicKey: "pk-lf-test",
      langfuseSecretKey: "sk-lf-test",
      langfuseProjectName: "construct-local",
      langfuseEnvironment: "local",
      capturePayloads: false,
      batch: false
    }
  }, paths);

  assert.equal(normalized.observability.enabled, true);
  assert.equal(normalized.observability.langfuseBaseUrl, "http://localhost:3000");
  assert.equal(normalized.observability.langfusePublicKey, "pk-lf-test");
  assert.equal(normalized.observability.langfuseSecretKey, "sk-lf-test");
  assert.equal(normalized.observability.langfuseProjectName, "construct-local");
  assert.equal(normalized.observability.langfuseEnvironment, "local");
  assert.equal(normalized.observability.capturePayloads, false);
  assert.equal(normalized.observability.batch, false);
});

test("settings normalize and persist app chrome options", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "construct-config-"));
  const paths = createConstructDataPaths(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const defaults = defaultConstructSettings(paths);
  assert.equal(defaults.app.showStatusBar, true);
  assert.equal(normalizeSettings({}, paths).app.showStatusBar, true);
  assert.equal(normalizeSettings({ ...defaults, app: { showStatusBar: false } }, paths).app.showStatusBar, false);

  await writeConstructSettings({
    ...defaults,
    app: {
      showStatusBar: false
    }
  }, paths);

  const resolved = await readConstructSettings(paths);
  assert.equal(resolved.app.showStatusBar, false);
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
