import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./DashboardSidebar.tsx", import.meta.url)), "utf8");
const surfaceSource = readFileSync(fileURLToPath(new URL("./ConstructSidebarSurface.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)), "utf8");

describe("Dashboard Projects sidebar", () => {
  it("uses the Projects list contract for Construct projects", () => {
    assert.match(source, />Projects</);
    assert.match(source, /aria-label="New project"/);
    assert.match(source, /Last user message/);
    assert.match(source, /Created at/);
    assert.match(source, /Pin to top/);
    assert.match(source, /Archive/);
    // The header's controls appear on hover, in a gutter the label's own padding
    // reserves — revealing them must never reflow the word "Projects".
    assert.match(source, /group\/projects-header/);
    assert.match(source, /group-hover\/projects-header:opacity-100/);
    assert.match(source, /SparSectionLabel className="pr-14"/);
    assert.match(appSource, /activeView=\{projectsViewOpen \? "projects" : "home"\}/);
    assert.match(appSource, /label: "New project"/);
    assert.match(appSource, /label: "Search"/);
    assert.match(appSource, /label: "Concepts"/);
  });

  it("draws every row from the shared sidebar primitives", () => {
    // One row geometry for the whole sidebar. A project row that builds its own
    // box is how the list stops reading as a single column.
    assert.match(source, /from "\.\.\/\.\.\/components\/spar"/);
    assert.match(source, /<SparSidebarRow/);
    assert.match(surfaceSource, /<SparSidebarAction/);
    assert.match(surfaceSource, /<SparViewSwitch/);
    // The sidebar is a hole onto the window's material: it must not paint a fill
    // of its own, or the native vibrancy behind it is flattened.
    assert.doesNotMatch(surfaceSource, /bg-(?:card|background|sidebar)\b/);
    assert.match(surfaceSource, /app-sidebar/);
  });

  it("keeps project data separate from persisted sidebar presentation state", () => {
    assert.match(source, /getUiState<StudioSidebarState>/);
    assert.match(source, /setUiState\(\{ key: STUDIO_SIDEBAR_STATE_KEY, value: next \}\)/);
    assert.doesNotMatch(source, /updateProject|deleteProject/);
  });

  it("gives each sidebar surface its own remembered width", () => {
    // Settings and the dashboard hold lists of different shapes, so one shared
    // measurement means dragging one to fit resizes the other.
    assert.match(
      appSource,
      /sidebarResizeStorageKey=\{settingsSurface \? "construct\.settings\.sidebar\.width" : isDashboardHome \? "construct\.dashboard\.sidebar\.width" : undefined\}/,
    );
    assert.match(appSource, /onSidebarWidthChange=\{settingsSurface \? setSettingsSidebarWidth : isDashboardHome \? setDashboardSidebarWidth : setSidebarWidth\}/);
    // Draggable at all: a remembered width for a sidebar pinned to one value is
    // a key nothing ever writes to.
    assert.match(appSource, /sidebarMaxWidth=\{520\}/);
  });
});
