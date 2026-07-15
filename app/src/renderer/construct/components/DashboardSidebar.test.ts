import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./DashboardSidebar.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)), "utf8");

describe("Dashboard Studio sidebar", () => {
  it("uses the Synara Studio list contract for Construct projects", () => {
    assert.match(source, />Studio</);
    assert.match(source, /aria-label="New project"/);
    assert.match(source, /Last user message/);
    assert.match(source, /Created at/);
    assert.match(source, /STUDIO_SIDEBAR_STATE_KEY/);
    assert.match(source, /Pin project/);
    assert.match(source, /Archive project/);
    assert.match(source, /<TooltipPrimitive\.Popup/);
    assert.match(appSource, /activeView=\{projectsViewOpen \? "projects" : "home"\}/);
    assert.match(appSource, /label: "New project"/);
    assert.match(appSource, /label: "Search"/);
    assert.match(appSource, /label: "Concepts"/);
  });

  it("keeps project data separate from persisted sidebar presentation state", () => {
    assert.match(source, /getUiState<StudioSidebarState>/);
    assert.match(source, /setUiState\(\{ key: STUDIO_SIDEBAR_STATE_KEY, value: next \}\)/);
    assert.doesNotMatch(source, /updateProject|deleteProject/);
  });
});
