import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(
  fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)),
  "utf8",
);
const dashboardSource = readFileSync(fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)), "utf8");
const dashboardSidebarSource = readFileSync(fileURLToPath(new URL("./DashboardSidebar.tsx", import.meta.url)), "utf8");
const shellControlsSource = readFileSync(fileURLToPath(new URL("../ShellControls.tsx", import.meta.url)), "utf8");
const opalineShellSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../opaline/packages/ui/src/opaline-v3/DesktopShell.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
const sourceSidebarSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../opaline/packages/ui/src/components/sidebar.tsx",
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
const opalineIndexSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/index.ts", import.meta.url)),
  "utf8",
);
const opalineComposerSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/agent-session/AgentSessionSurface.tsx", import.meta.url)),
  "utf8",
);
const opalineScrollAreaSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/scroll-area.tsx", import.meta.url)),
  "utf8",
);
const opalineButtonSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/button.tsx", import.meta.url)),
  "utf8",
);
const opalineHeaderControlsSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/desktop-header-controls.tsx", import.meta.url)),
  "utf8",
);
const opalineThemeSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/tokens/opaline-theme.css", import.meta.url)),
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
    assert.match(opalineShellSource, /<SidebarProvider/);
    assert.match(opalineShellSource, /<SidebarInset/);
    assert.match(opalineShellSource, /<SidebarRail placement="content-seam"/);
    assert.doesNotMatch(opalineShellSource, /return <AppShell/);
    assert.doesNotMatch(opalineShellSource, /<OpalineV2(?:Shell|Sidebar|NavigationControls|HeaderTab)/);
    assert.doesNotMatch(opalineShellSource, /opaline-v2/);
    assert.doesNotMatch(appSource, /AppShell(?:ChromeButton|HeaderToolButton)/);
    assert.doesNotMatch(shellControlsSource, /SidebarNavItemRow/);
    assert.doesNotMatch(dashboardSidebarSource, /SidebarSection|construct-sidebar-row/);
    assert.match(shellControlsSource, /SidebarMenuButton/);
    assert.match(dashboardSidebarSource, /SidebarGroup/);
    assert.match(dashboardSidebarSource, /SidebarMenuButton/);
    assert.match(opalineIndexSource, /export \{ Button \} from "\.\/components\/button"/);
  });

  it("uses the extracted sidebar DOM contract and material tokens", () => {
    assert.match(opalineShellSource, /h-\[46px\]/);
    assert.match(sourceSidebarSource, /data-slot="sidebar-wrapper"/);
    assert.match(sourceSidebarSource, /data-slot="sidebar-gap"/);
    assert.match(sourceSidebarSource, /data-slot="sidebar-container"/);
    assert.match(sourceSidebarSource, /data-slot="sidebar-inset"/);
    assert.match(sourceSidebarSource, /data-placement=\{placement\}/);
    assert.match(sourceSidebarSource, /flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-xl p-2 text-left/);
    assert.match(sourceSidebarSource, /default: "h-8 text-sm"/);
    assert.match(sourceSidebarSource, /relative flex w-full min-w-0 flex-col p-2/);
    assert.match(sourceSidebarSource, /export function SidebarGroupAction/);
    assert.match(sourceSidebarSource, /export function SidebarMenuSubButton/);
    assert.match(sourceSidebarSource, /useRender\.ComponentProps<"button">/);
    assert.match(sourceSidebarSource, /<SheetContent/);
    assert.match(sourceSidebarSource, /<ScrollArea hideScrollbars scrollFade/);
    assert.match(opalineScrollAreaSource, /hideScrollbars &&/);
    assert.match(opalineScrollAreaSource, /scrollFade &&/);
    assert.match(opalineButtonSource, /rounded-lg border font-medium text-\[length:var\(--app-font-size-ui,12px\)\]/);
    assert.match(opalineButtonSource, /variant: \{[\s\S]*chrome:/);
    assert.match(opalineHeaderControlsSource, /size="icon-xs"/);
    assert.match(opalineHeaderControlsSource, /variant=\{desktopHeaderControlVariant\(tone\)\}/);
    assert.match(opalineHeaderControlsSource, /!size-7 shrink-0 rounded-lg/);
    assert.match(opalineShellSource, /size="icon-sm"/);
    assert.match(opalineShellSource, /<DesktopHeaderIconButton/);
    assert.match(opalineThemeSource, /--color-text-foreground: var\(--foreground/);
    assert.match(opalineThemeSource, /--color-background-button-secondary-hover:/);
    assert.match(opalineThemeSource, /--app-font-size-ui: 12px/);
    assert.match(sourceSidebarSource, /window\.matchMedia\("\(max-width: 767px\)"\)/);
    assert.doesNotMatch(opalineStylesSource, /construct-sidebar-row|opaline-v2-sidebar-pane/);
    assert.match(opalineComposerSource, /chat-composer-shell chat-composer-surface/);
    assert.match(opalineComposerSource, /variant="prominent"/);
    assert.match(opalineComposerSource, /size="icon-xs"/);
    assert.match(opalineComposerSource, /--app-font-size-chat,12px/);
    assert.match(opalineThemeSource, /--app-font-size-chat: 12px/);
    assert.match(opalineStylesSource, /--app-content-card-radius: 0\.9rem/);
    assert.match(opalineStylesSource, /--seam-shadow-x: -6\.5px/);
    assert.match(opalineStylesSource, /blur\(8px\) saturate\(135%\)/);
    assert.match(opalineStylesSource, /--composer-radius: 1\.2rem/);
  });
});
