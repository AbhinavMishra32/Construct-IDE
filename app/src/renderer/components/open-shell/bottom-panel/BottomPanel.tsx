import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import React, { useEffect, useRef, useState, useCallback } from "react";
import "./bottom-panel.css";

// Re-export SlotPanel types with Bottom-panel aliases for backwards compat
export type { SlotTab as BottomPanelTab, SlotPanelHandle as BottomPanelHandle, SlotLauncherItem } from "../slot-panel/SlotPanel";
import { SlotPanel } from "../slot-panel/SlotPanel";
import type { SlotTab, SlotPanelHandle, SlotLauncherItem } from "../slot-panel/SlotPanel";

export { SlotPanel };

const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;

/**
 * Clamps the bottom panel height between min/max limits based on current viewport height.
 */
export function clampBottomPanelHeight(height: number, mainContentHeight: number) {
  return Number.isFinite(height) ? Math.max(160, Math.min(height, mainContentHeight * 0.5)) : DEFAULT_BOTTOM_PANEL_HEIGHT;
}

export interface BottomPanelProps {
  /** Initial height of the bottom panel in pixels. Defaults to 280. */
  height?: number;
  /** Height of the main container viewport, used to clamp panel resizing to maximum 50% height. */
  mainContentHeight?: number;
  /** Callback fired when a drag-resize action commits a new height. */
  onHeightChange?: (height: number) => void;
  /** Initial tabs to populate the panel with. */
  tabs?: SlotTab[];
  /** Controlled active tab id. */
  activeTabId?: string | null;
  /** Initial active tab id for uncontrolled panels. */
  defaultActiveTabId?: string | null;
  /** Keep inactive tab contents mounted. */
  keepMounted?: boolean;
  /** Sync tabs on prop updates */
  syncTabs?: boolean;
  /** Launcher items shown in the `+` dropdown and empty-state grid. */
  launcherItems?: SlotLauncherItem[];
  /** Callback fired when the far-right panel close cross button is clicked. */
  onClose?: () => void;
  onActiveTabChange?: (id: string | null, tab: SlotTab | null) => void;
  onTabClose?: (id: string, nextTabs?: SlotTab[]) => void;
  onTabOpen?: (tab: SlotTab) => void;
  onTabsChange?: (tabs: SlotTab[]) => void;
}

/**
 * Resizable bottom panel — a thin wrapper around `SlotPanel` that adds
 * drag-resize and height clamping. Drop `SlotPanel` directly into other
 * slots (right panel, main area) where resize isn't needed.
 */
export const BottomPanel = React.forwardRef<SlotPanelHandle, BottomPanelProps>(
  function BottomPanel(
    {
      height = DEFAULT_BOTTOM_PANEL_HEIGHT,
      mainContentHeight = typeof window === "undefined" ? 720 : window.innerHeight,
      onHeightChange,
      tabs,
      activeTabId,
      defaultActiveTabId,
      keepMounted,
      syncTabs = false,
      launcherItems,
      onClose,
      onActiveTabChange,
      onTabClose,
      onTabOpen,
      onTabsChange,
    },
    ref,
  ) {
    const [panelHeight, setPanelHeight] = useState(() => clampBottomPanelHeight(height, mainContentHeight));

    useEffect(() => {
      setPanelHeight((h) => clampBottomPanelHeight(h, mainContentHeight));
    }, [mainContentHeight]);

    function commitHeight(next: number) {
      const clamped = clampBottomPanelHeight(next, mainContentHeight);
      setPanelHeight(clamped);
      onHeightChange?.(clamped);
    }

    const startResize = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const startY = event.clientY;
        const startHeight = panelHeight;
        document.documentElement.dataset.codexBottomPanelResizing = "true";

        function move(pointerEvent: PointerEvent) {
          commitHeight(startHeight + (startY - pointerEvent.clientY));
        }

        function stop() {
          document.documentElement.dataset.codexBottomPanelResizing = "false";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
        }

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
      },
      [mainContentHeight, onHeightChange, panelHeight]
    );

    return (
      <div
        className="codex-bottom-panel"
        data-app-shell-focus-area="bottom-panel"
        style={{ "--app-shell-bottom-panel-height": `${panelHeight}px` } as CSSProperties}
      >
        <div
          className="codex-bottom-panel-resize-handle"
          aria-label="Resize bottom panel"
          role="separator"
          onPointerDown={startResize}
        />
        <SlotPanel
          ref={ref}
          activeTabId={activeTabId}
          defaultActiveTabId={defaultActiveTabId}
          tabs={tabs}
          keepMounted={keepMounted}
          syncTabs={syncTabs}
          launcherItems={launcherItems}
          onClose={onClose}
          onActiveTabChange={onActiveTabChange}
          onTabClose={onTabClose}
          onTabOpen={onTabOpen}
          onTabsChange={onTabsChange}
          ariaLabel="Bottom panel tabs"
        />
      </div>
    );
  },
);

export interface TerminalSurfaceProps {
  /** Optional class name appended to the container. */
  className?: string;
  /** Any children to render inside (for backwards compat). */
  children?: ReactNode;
  /** Working directory label. */
  cwd?: string;
}

/**
 * Terminal surface — renders children inside a terminal-styled container.
 * For a real xterm.js terminal, use the construct TerminalPanel component instead.
 */
export function TerminalSurface({ children, className, cwd }: TerminalSurfaceProps) {
  return (
    <div
      className={`codex-terminal-surface${className ? ` ${className}` : ""}`}
      data-codex-terminal="true"
    >
      {children}
    </div>
  );
}
