import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const pickerSource = readFileSync(fileURLToPath(new URL("./ProviderModelPicker.tsx", import.meta.url)), "utf8");
const dashboardSource = readFileSync(fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)), "utf8");
const flowWorkspaceSource = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");
const tauriBridgeSource = readFileSync(fileURLToPath(new URL("../lib/tauriBridge.ts", import.meta.url)), "utf8");

describe("Provider model picker", () => {
  it("ports Synara's provider submenus and model radio groups", () => {
    assert.match(pickerSource, /PROVIDER_OPTIONS\.map/);
    assert.match(pickerSource, /<DropdownMenuSub/);
    assert.match(pickerSource, /<DropdownMenuSubTrigger>/);
    assert.match(pickerSource, /<DropdownMenuSubContent/);
    assert.match(pickerSource, /<DropdownMenuRadioGroup/);
    assert.match(pickerSource, /<DropdownMenuRadioItem/);
    assert.match(pickerSource, /onProviderModelChange\(provider, value\)/);
    assert.doesNotMatch(pickerSource, /GPT-5\.5|Claude Sonnet|Gemini 3/);
  });

  it("stays behind the existing settings and model-catalog adapters", () => {
    assert.match(flowWorkspaceSource, /<ProviderModelPicker/);
    assert.match(dashboardSource, /const updateProviderModel/);
    assert.match(dashboardSource, /await updateAiSettings\(\{ ai: patch \}\)/);
    assert.match(dashboardSource, /await refreshModels\(settings\.ai\)/);
    assert.match(dashboardSource, /listModels\(\{/);
    assert.match(tauriBridgeSource, /throw normalizeNativeCommandError\(error\)/);
    assert.match(tauriBridgeSource, /code \? `\$\{code\}: \$\{message\}` : message/);
  });
});
