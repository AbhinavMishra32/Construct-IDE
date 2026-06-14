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
      openRouterApiKey: "test-openrouter-key",
      featureModels: {
        "construct-interact": "deepseek/deepseek-v4-flash"
      }
    }
  }, paths);

  const resolved = readConstructAiSettingsSync();
  assert.equal(resolved.provider, "openrouter");
  assert.equal(resolved.openRouterApiKey, "test-openrouter-key");
  assert.equal(resolved.featureModels["construct-interact"], "deepseek/deepseek-v4-flash");
});
