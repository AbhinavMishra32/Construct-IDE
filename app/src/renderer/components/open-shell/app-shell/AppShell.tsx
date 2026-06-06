import { useCallback, useEffect, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../primitives/ContextMenu";
import "./app-shell.css";

export type AppShellTabItem = {
  active?: boolean;
  dirty?: boolean;
  id: string;
  title: ReactNode;
};

export type AppShellState = {
  isBottomPanelOpen: boolean;
  isRightPanelOpen: boolean;
  isSidebarOpen: boolean;
  setBottomPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleBottomPanel: () => void;
  toggleRightPanel: () => void;
  toggleSidebar: () => void;
};

export type AppShellProps = {
  bottomPanel?: ReactNode;
  chromeControls?: ReactNode | ((state: AppShellState) => ReactNode);
  composer: ReactNode;
  collapsedSidebarTrigger?: ReactNode | ((state: AppShellState) => ReactNode);
  defaultBottomPanelOpen?: boolean;
  defaultRightPanelOpen?: boolean;
  defaultSidebarOpen?: boolean;
  defaultSidebarWidth?: number;
  headerActions?: ReactNode | ((state: AppShellState) => ReactNode);
  headerTabs?: AppShellTabItem[];
  main: ReactNode;
  renderHeaderTab?: (tab: AppShellTabItem, state: AppShellState) => ReactNode;
  renderHeaderTabActions?: (tab: AppShellTabItem, state: AppShellState) => ReactNode;
  renderHeaderTabMenu?: (tab: AppShellTabItem, state: AppShellState) => ReactNode;
  rightPanel?: ReactNode;
  sidebar: ReactNode;
  sidebarMaxWidth?: number;
  sidebarMinWidth?: number;
};

export type AppShellSlotProps = HTMLAttributes<HTMLDivElement>;
export type AppShellButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function AppShell({
  bottomPanel,
  chromeControls,
  composer,
  collapsedSidebarTrigger,
  defaultBottomPanelOpen,
  defaultRightPanelOpen,
  defaultSidebarOpen = true,
  defaultSidebarWidth = 300,
  headerActions,
  headerTabs = [],
  main,
  renderHeaderTab,
  renderHeaderTabActions,
  renderHeaderTabMenu,
  rightPanel,
  sidebar,
  sidebarMaxWidth = 520,
  sidebarMinWidth = 240,
}: AppShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(defaultSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(defaultRightPanelOpen ?? rightPanel != null);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(defaultBottomPanelOpen ?? bottomPanel != null);
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((value) => !value);
  }, []);
  const toggleRightPanel = useCallback(() => {
    setIsRightPanelOpen((value) => !value);
  }, []);
  const toggleBottomPanel = useCallback(() => {
    setIsBottomPanelOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (rightPanel != null) {
      setIsRightPanelOpen(true);
    }
  }, [rightPanel]);

  useEffect(() => {
    if (bottomPanel != null) {
      setIsBottomPanelOpen(true);
    }
  }, [bottomPanel]);

  const shellState: AppShellState = {
    isBottomPanelOpen,
    isRightPanelOpen,
    isSidebarOpen,
    setBottomPanelOpen: setIsBottomPanelOpen,
    setRightPanelOpen: setIsRightPanelOpen,
    setSidebarOpen: setIsSidebarOpen,
    toggleBottomPanel,
    toggleRightPanel,
    toggleSidebar,
  };
  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsSidebarResizing(true);
      const startX = event.clientX;
      const startWidth = sidebarWidth;

      function move(pointerEvent: PointerEvent) {
        const nextWidth = Math.max(0, Math.min(sidebarMaxWidth, startWidth + pointerEvent.clientX - startX));
        if (nextWidth < sidebarMinWidth) {
          setIsSidebarOpen(false);
          return;
        }
        setIsSidebarOpen(true);
        setSidebarWidth(nextWidth);
      }

      function stop() {
        setIsSidebarResizing(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    },
    [sidebarMaxWidth, sidebarMinWidth, sidebarWidth],
  );

  return (
    <div
      className="codex-app-shell"
      data-sidebar-open={isSidebarOpen ? "true" : "false"}
      style={
        {
          "--codex-left-panel-max-width": `${sidebarMaxWidth}px`,
          "--codex-left-panel-min-content": `${sidebarMinWidth + 80}px`,
          "--codex-left-panel-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      {chromeControls != null ? <AppShellChromeControls>{resolveSlot(chromeControls, shellState)}</AppShellChromeControls> : null}
      {!isSidebarOpen && collapsedSidebarTrigger != null ? (
        <div className="codex-sidebar-reopen-button">{resolveSlot(collapsedSidebarTrigger, shellState)}</div>
      ) : null}
      <aside
        className="codex-left-panel app-shell-left-panel"
        data-open={isSidebarOpen ? "true" : "false"}
        data-resizing={isSidebarResizing ? "true" : "false"}
      >
        <div className="codex-left-panel-inner">{sidebar}</div>
        <div
          className="codex-sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-disabled={!isSidebarOpen}
          onPointerDown={isSidebarOpen ? startSidebarResize : undefined}
        >
          <div className="codex-sidebar-resize-handle-line" />
        </div>
      </aside>
      <main className="codex-app-main">
        <AppShellHeader>
          <AppShellHeaderContextSurface>
            <AppShellTabStrip>
              {headerTabs.map((tab, index) => (
                <AppShellTabController data-tab-id={tab.id} key={tab.id}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      {renderHeaderTab?.(tab, shellState) ?? <AppShellTab tab={tab} />}
                    </ContextMenuTrigger>
                    {renderHeaderTabMenu != null ? (
                      <ContextMenuContent alignOffset={index === 0 ? 0 : -10}>
                        {renderHeaderTabMenu(tab, shellState)}
                      </ContextMenuContent>
                    ) : null}
                  </ContextMenu>
                  {renderHeaderTabActions != null ? renderHeaderTabActions(tab, shellState) : null}
                </AppShellTabController>
              ))}
            </AppShellTabStrip>
          </AppShellHeaderContextSurface>
          {headerActions != null ? (
            <AppShellHeaderActions>{resolveSlot(headerActions, shellState)}</AppShellHeaderActions>
          ) : null}
        </AppShellHeader>

        <section className="codex-workspace" data-right-panel-open={isRightPanelOpen && rightPanel != null ? "true" : "false"}>
          <section className="codex-main-content-viewport" data-app-shell-main-content-layout="main">
            <div className="codex-main-content-frame">
              <div
                aria-hidden="true"
                className="codex-app-shell-main-content-top-fade"
                data-app-shell-main-content-top-fade="false"
              />
              <AppShellContent>{main}</AppShellContent>
              <AppShellComposer>{composer}</AppShellComposer>
            </div>
          </section>
          {rightPanel != null ? (
            <aside
              className="codex-right-panel-slot"
              data-open={isRightPanelOpen ? "true" : "false"}
              data-app-shell-focus-area="right-panel"
            >
              <AppShellRightPanel>{rightPanel}</AppShellRightPanel>
            </aside>
          ) : null}
        </section>

        {bottomPanel != null ? (
          <section
            className="codex-bottom-panel-slot"
            data-open={isBottomPanelOpen ? "true" : "false"}
            data-app-shell-focus-area="bottom-panel"
          >
            <AppShellBottomPanel>{bottomPanel}</AppShellBottomPanel>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export function AppShellChromeControls({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-shell-chrome-controls", className)} {...props}>
      {children}
    </div>
  );
}

export function AppShellChromeButton({ className, type = "button", ...props }: AppShellButtonProps) {
  return <button className={joinClassNames("codex-shell-chrome-button", className)} type={type} {...props} />;
}

export function AppShellCollapsedSidebarTrigger({ className, type = "button", ...props }: AppShellButtonProps) {
  return <button className={joinClassNames("codex-sidebar-reopen-trigger", className)} type={type} {...props} />;
}

export function AppShellHeader({ children, className, ...props }: AppShellSlotProps) {
  return (
    <header className={joinClassNames("codex-app-header", className)} data-app-shell-header-edge-scroll="false" {...props}>
      {children}
    </header>
  );
}

export function AppShellHeaderContextSurface({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div
      className={joinClassNames("codex-app-header-context-surface", className)}
      data-testid="app-shell-header-context-menu-surface"
      {...props}
    >
      {children}
    </div>
  );
}

export function AppShellTabStrip({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-app-tab-strip", className)} data-app-shell-tab-strip-controller="main" {...props}>
      {children}
    </div>
  );
}

export function AppShellTabController({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-app-tab-controller", className)} data-app-shell-tab-controller="main" {...props}>
      {children}
    </div>
  );
}

export function AppShellTab({
  children,
  className,
  tab,
  type = "button",
  ...props
}: AppShellButtonProps & { tab?: AppShellTabItem }) {
  const active = tab?.active === true;
  const content = children ?? (
    <>
      {tab?.dirty === true ? <span className="codex-tab-dot" /> : null}
      <span className="codex-app-tab-title">{tab?.title}</span>
    </>
  );

  return (
    <button
      className={joinClassNames("codex-app-tab", className)}
      data-active={active ? "true" : undefined}
      type={type}
      {...props}
    >
      {content}
    </button>
  );
}

export function AppShellTabActions({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-app-tab-actions", className)} {...props}>
      {children}
    </div>
  );
}

export function AppShellTabActionButton({ className, type = "button", ...props }: AppShellButtonProps) {
  return <button className={joinClassNames("codex-app-tab-actions-button", className)} type={type} {...props} />;
}

export function AppShellHeaderActions({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-app-header-actions", className)} {...props}>
      {children}
    </div>
  );
}

export function AppShellHeaderToolButton({ className, type = "button", ...props }: AppShellButtonProps) {
  return <button className={joinClassNames("codex-header-tool-button", className)} type={type} {...props} />;
}

export function AppShellHeaderPillButton({ className, type = "button", ...props }: AppShellButtonProps) {
  return <button className={joinClassNames("codex-header-agent-button", className)} type={type} {...props} />;
}

export function AppShellContent({ children, className, ...props }: AppShellSlotProps) {
  return (
    <section className={joinClassNames("codex-content-frame", className)} {...props}>
      {children}
    </section>
  );
}

export function AppShellComposer({ children, className, ...props }: AppShellSlotProps) {
  return (
    <section className={joinClassNames("codex-composer-frame", className)} {...props}>
      {children}
    </section>
  );
}

export function AppShellRightPanel({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-right-panel", className)} {...props}>
      {children}
    </div>
  );
}

export function AppShellBottomPanel({ children, className, ...props }: AppShellSlotProps) {
  return (
    <div className={joinClassNames("codex-bottom-panel-slot-inner", className)} {...props}>
      {children}
    </div>
  );
}

function resolveSlot(slot: ReactNode | ((state: AppShellState) => ReactNode), state: AppShellState) {
  return typeof slot === "function" ? slot(state) : slot;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}
