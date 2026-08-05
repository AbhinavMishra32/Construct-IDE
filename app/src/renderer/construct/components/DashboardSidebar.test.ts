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
    // Home and Projects are destinations, so they are rows in a nav group rather
    // than a segmented switch — a switch reads as a filter over the list under it.
    assert.match(surfaceSource, /nav\?: ConstructSidebarAction\[\]/);
    assert.doesNotMatch(surfaceSource, /ViewSwitch/);
    assert.match(appSource, /label: "Home"/);
    assert.match(appSource, /label: "Projects"/);
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

  it("keeps one sidebar width for the whole app", () => {
    // A source list is a fixed edge of the window, not a per-page measurement.
    // Three widths and a fourth persisted per project is what made the sidebar
    // resize itself on every navigation.
    assert.match(appSource, /sidebarResizeStorageKey="construct\.sidebar\.width"/);
    assert.match(appSource, /sidebarWidth=\{sidebarWidth\}/);
    assert.match(appSource, /onSidebarWidthChange=\{setSidebarWidth\}/);
    assert.match(appSource, /sidebarMinWidth=\{240\}/);
    assert.match(appSource, /sidebarMaxWidth=\{520\}/);
    assert.doesNotMatch(appSource, /settingsSidebarWidth|dashboardSidebarWidth/);
    // Opening a project must not restore a project-scoped width over it.
    assert.doesNotMatch(appSource, /setSidebarWidth\(state\.sidebarWidth\)/);
  });
});
