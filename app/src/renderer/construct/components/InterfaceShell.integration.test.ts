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
const rendererStylesSource = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
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
const opalineSidebarPresentationSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/sidebar-presentation.tsx", import.meta.url)),
  "utf8",
);
const opalineSearchInputSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/search-input.tsx", import.meta.url)),
  "utf8",
);
const opalineWindowControlsSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/components/desktop-window-controls.tsx", import.meta.url)),
  "utf8",
);
const constructWindowControlsSource = readFileSync(
  fileURLToPath(new URL("./ConstructDesktopWindowControls.tsx", import.meta.url)),
  "utf8",
);
const opalineSettingsSource = readFileSync(
  fileURLToPath(new URL("../../../../../opaline/packages/ui/src/settings/Settings.tsx", import.meta.url)),
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
    assert.match(appSource, /aria-label="Construct agent layout"/);
    assert.match(appSource, /render=\{\s*<DesktopChromeButton\s+aria-label="Project actions"/);
    assert.doesNotMatch(appSource, /<Tabs(?:\s|>)/);
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
    assert.doesNotMatch(shellControlsSource, /SidebarMenuButton/);
    assert.match(dashboardSidebarSource, /SidebarGroup/);
    assert.match(dashboardSidebarSource, /SidebarProjectButton/);
    assert.match(shellControlsSource, /SidebarPrimaryAction/);
    assert.match(opalineIndexSource, /export \{ Button \} from "\.\/components\/button"/);
  });

  it("uses the extracted sidebar DOM contract and material tokens", () => {
    assert.match(opalineShellSource, /h-\[46px\]/);
    assert.match(opalineShellSource, /desktop-top-bar-traffic-light-gutter/);
    assert.doesNotMatch(opalineShellSource, /left-\[83px\]|pl-\[83px\]|pl-52/);
    assert.match(opalineShellSource, /M216\.4 163\.7c5\.1 5/);
    assert.match(opalineStylesSource, /--desktop-top-bar-traffic-light-gutter, 90px/);
    assert.match(opalineShellSource, /pr-\[138px\]! sm:pr-\[138px\]!/);
    assert.match(opalineWindowControlsSource, /w-\[46px\]/);
    assert.match(opalineWindowControlsSource, /Segoe Fluent Icons/);
    assert.match(constructWindowControlsSource, /getCurrentWindow/);
    assert.match(constructWindowControlsSource, /<DesktopWindowControls/);
    assert.doesNotMatch(rendererStylesSource, /construct-win-titlebar-reserve|header > div:first-child/);
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
    assert.match(opalineShellSource, /<SidebarPrimaryAction/);
    assert.match(opalineShellSource, /<SidebarProjectButton/);
    assert.match(opalineShellSource, /<SidebarContent className="gap-0 font-system-ui">/);
    assert.match(opalineSidebarPresentationSource, /--app-density-row-height,1\.75rem/);
    assert.match(opalineSidebarPresentationSource, /export function SidebarPrimaryAction/);
    assert.match(opalineSidebarPresentationSource, /export function SidebarProjectButton/);
    assert.match(opalineSidebarPresentationSource, /size="sm"/);
    assert.match(opalineSearchInputSource, /\[&>\[data-slot=input\]\]:pl-8/);
    assert.match(opalineSettingsSource, /<SearchInput/);
    assert.match(opalineSettingsSource, /<SidebarProjectButton/);
    assert.doesNotMatch(opalineSettingsSource, /SidebarGroupLabel|SidebarSeparator/);
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
    assert.doesNotMatch(rendererStylesSource, /\.construct-flow-composer textarea/);
    assert.doesNotMatch(rendererStylesSource, /\.construct-flow-composer > div:last-child/);
    assert.doesNotMatch(rendererStylesSource, /\.construct-flow-composer \.agent-composer-submit-btn/);
    assert.doesNotMatch(rendererStylesSource, /\.construct-home-composer\.construct-flow-composer textarea/);
    assert.match(opalineStylesSource, /--app-content-card-radius: 0\.9rem/);
    assert.match(opalineStylesSource, /--seam-shadow-x: -6\.5px/);
    assert.match(opalineStylesSource, /blur\(8px\) saturate\(135%\)/);
    assert.match(opalineStylesSource, /--composer-radius: 1\.2rem/);
  });
});
