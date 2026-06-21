import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct project advanced settings", () => {
  it("edits and validates the real project tape through a dedicated API", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructProjectIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /id: "project-advanced"/);
    assert.match(source, /Edit project tape/);
    assert.match(source, /validateConstructSource\(tapeSource\)/);
    assert.match(source, /updateProjectTape\(/);
    assert.match(source, /Save and reload tape/);
    assert.match(preload, /construct:project:read-tape/);
    assert.match(preload, /construct:project:update-tape/);
    assert.match(controller, /Tape project id must remain/);
    assert.match(controller, /await writeFile\(project\.sourcePath, project\.source/);
    assert.match(controller, /materializeInitialFiles\(project\)/);
  });

  it("wires the bottom status bar preference through durable app settings", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const app = readFileSync(fileURLToPath(new URL("./ConstructApplication.tsx", import.meta.url)), "utf8");
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructSettingsIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /Bottom status bar/);
    assert.match(source, /updateAppSettings\(\{\s*app:\s*\{\s*showStatusBar: showStatusBarNext/s);
    assert.match(app, /getSettings\(\)\s*\.then\(\(settings\)/);
    assert.match(app, /setShowStatusBar\(settings\.app\?\.showStatusBar !== false\)/);
    assert.match(app, /\{showStatusBar \? <StatusBar theme=\{theme\} onThemeChange=\{setTheme\} \/> : null\}/);
    assert.match(preload, /construct:settings:update-app/);
    assert.match(controller, /ipcMain\.handle\("construct:settings:update-app"/);
  });

  it("wires Construct Cloud account UI through durable AI settings", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const aiSection = readFileSync(
      fileURLToPath(new URL("./components/settings/ConstructAiSettingsSection.tsx", import.meta.url)),
      "utf8",
    );
    const cloudPanel = readFileSync(
      fileURLToPath(new URL("./components/settings/ConstructCloudAccountPanel.tsx", import.meta.url)),
      "utf8",
    );
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructSettingsIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /onSourceChange=\{updateAiSource\}/);
    assert.match(source, /onConstructCloudAccessTokenChange=\{\(constructCloudAccessToken: string\) => setAiSettingsDraft/);
    assert.match(aiSection, /LLM calls/);
    assert.match(aiSection, /ConstructCloudAccountPanel/);
    assert.match(cloudPanel, /createAuthClient\(\{ baseURL: normalizedBaseUrl \}\)/);
    assert.match(cloudPanel, /<Auth view=\{authView\} socialLayout="vertical" \/>/);
    assert.match(cloudPanel, /api\/cloud\/tokens/);
    assert.match(controller, /input\?\.provider === "construct-cloud"/);
  });
});
