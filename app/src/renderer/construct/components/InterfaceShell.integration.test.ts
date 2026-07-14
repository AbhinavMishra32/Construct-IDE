import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)),
  "utf8",
);
const dashboardSource = readFileSync(fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)), "utf8");
const opalineShellSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../opaline/packages/ui/src/opaline-v3/DesktopShell.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
const synaraSidebarSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../opaline/packages/ui/src/opaline-v3/SynaraSidebar.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
const opalineStylesSource = readFileSync(
  fileURLToPath(
    new URL("../../../../../opaline/packages/ui/src/styles.css", import.meta.url),
  ),
  "utf8",
);

describe("Construct interface shell boundary", () => {
  it("composes the desktop shell and sidebars through Opaline v3", () => {
    assert.match(appSource, /<DesktopShell/);
    assert.match(appSource, /<DesktopSidebar/);
    assert.doesNotMatch(appSource, /<AppShell(?:\s|>)/);
  });

  it("keeps the shell mounted while the active project changes", () => {
    assert.doesNotMatch(appSource, /<DesktopShell[\s\S]{0,180}key=\{activeProject/);
  });

  it("renders the Flow landing composition through Opaline", () => {
    assert.match(dashboardSource, /<DesktopHomeSurface/);
    assert.match(dashboardSource, /<AgentSessionComposer/);
  });

  it("keeps Opaline free of Construct runtime and persistence dependencies", () => {
    assert.doesNotMatch(opalineShellSource, /constructFlow|projectStore|tauriBridge|AiSettings/);
    assert.match(opalineShellSource, /<SynaraSidebarProvider/);
    assert.match(opalineShellSource, /<SynaraSidebarInset/);
    assert.match(opalineShellSource, /<SynaraSidebarRail placement="content-seam"/);
    assert.doesNotMatch(opalineShellSource, /return <AppShell/);
    assert.doesNotMatch(opalineShellSource, /<OpalineV2(?:Shell|Sidebar|NavigationControls|HeaderTab)/);
  });

  it("uses the extracted sidebar DOM contract and material tokens", () => {
    assert.match(opalineShellSource, /h-\[46px\]/);
    assert.match(synaraSidebarSource, /data-slot="sidebar-wrapper"/);
    assert.match(synaraSidebarSource, /data-slot="sidebar-gap"/);
    assert.match(synaraSidebarSource, /data-slot="sidebar-container"/);
    assert.match(synaraSidebarSource, /data-slot="sidebar-inset"/);
    assert.match(synaraSidebarSource, /data-placement=\{placement\}/);
    assert.match(opalineStylesSource, /--app-content-card-radius: 0\.9rem/);
    assert.match(opalineStylesSource, /--seam-shadow-x: -6\.5px/);
    assert.match(opalineStylesSource, /blur\(8px\) saturate\(135%\)/);
    assert.match(opalineStylesSource, /--composer-radius: 1\.2rem/);
  });
});
