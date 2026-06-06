import * as Tabs from "@radix-ui/react-tabs";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu";
import "./bottom-panel.css";

export type BottomPanelTab = {
  active?: boolean;
  closable?: boolean;
  content: ReactNode;
  icon?: ReactNode;
  id: string;
  shortcut?: string;
  title: string;
};

const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;

export function clampBottomPanelHeight(height: number, mainContentHeight: number) {
  return Number.isFinite(height) ? Math.max(160, Math.min(height, mainContentHeight * 0.5)) : DEFAULT_BOTTOM_PANEL_HEIGHT;
}

export function BottomPanel({
  height = DEFAULT_BOTTOM_PANEL_HEIGHT,
  mainContentHeight = typeof window === "undefined" ? 720 : window.innerHeight,
  onHeightChange,
  tabs,
}: {
  height?: number;
  mainContentHeight?: number;
  onHeightChange?: (height: number) => void;
  tabs: BottomPanelTab[];
}) {
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const [activeTabId, setActiveTabId] = useState(activeTab?.id);
  const [panelHeight, setPanelHeight] = useState(() => clampBottomPanelHeight(height, mainContentHeight));
  const dragStateRef = useRef<{ pointerId: number; startHeight: number; startY: number } | null>(null);

  useEffect(() => {
    setPanelHeight((currentHeight) => clampBottomPanelHeight(currentHeight, mainContentHeight));
  }, [mainContentHeight]);

  useEffect(() => {
    setActiveTabId(activeTab?.id);
  }, [activeTab?.id]);

  if (activeTab == null || activeTabId == null) {
    return null;
  }

  function commitHeight(nextHeight: number) {
    const clampedHeight = clampBottomPanelHeight(nextHeight, mainContentHeight);
    setPanelHeight(clampedHeight);
    onHeightChange?.(clampedHeight);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startHeight: panelHeight,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.dataset.codexBottomPanelResizing = "true";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (dragState == null || dragState.pointerId !== event.pointerId) {
      return;
    }

    commitHeight(dragState.startHeight + (dragState.startY - event.clientY));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      document.documentElement.dataset.codexBottomPanelResizing = "false";
    }
  }

  return (
    <Tabs.Root
      className="codex-bottom-panel"
      data-app-shell-focus-area="bottom-panel"
      style={{ "--app-shell-bottom-panel-height": `${panelHeight}px` } as CSSProperties}
      value={activeTabId}
      onValueChange={setActiveTabId}
    >
      <div
        className="codex-bottom-panel-resize-handle"
        aria-label="Resize bottom panel"
        role="separator"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="codex-bottom-panel-inner">
        <div className="codex-bottom-panel-tabbar">
          <Tabs.List className="codex-bottom-panel-tabs" aria-label="Bottom panel tabs">
            {tabs.map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                className="codex-bottom-panel-tab"
                data-tab-id={tab.id}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.icon != null ? <span className="codex-bottom-panel-tab-icon">{tab.icon}</span> : null}
                <span className="codex-bottom-panel-tab-title">{tab.title}</span>
                {tab.closable === true ? <span className="codex-bottom-panel-tab-close">×</span> : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="codex-bottom-panel-actions">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="codex-bottom-panel-action codex-bottom-panel-add-action" type="button" aria-label="Open bottom panel launcher">
                  +
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="codex-bottom-panel-launcher-menu" side="bottom">
                <DropdownMenuItem>
                  <span className="codex-bottom-panel-launcher-icon">▣</span>
                  <span>Files</span>
                  <span className="codex-bottom-panel-launcher-shortcut">⌘P</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <span className="codex-bottom-panel-launcher-icon">⊕</span>
                  <span>Side chat</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <span className="codex-bottom-panel-launcher-icon">▹</span>
                  <span>Terminal</span>
                  <span className="codex-bottom-panel-launcher-shortcut">⌃`</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button className="codex-bottom-panel-action codex-bottom-panel-close-action" type="button" aria-label="Close bottom panel">
              ×
            </button>
          </div>
        </div>
        {tabs.map((tab) => (
          <Tabs.Content key={tab.id} value={tab.id} className="codex-bottom-panel-outlet">
            {tab.content}
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}

export function TerminalSurface({ children, cwd }: { children: ReactNode; cwd?: string }) {
  const content =
    typeof children === "string" || typeof children === "number" ? (
      <pre className="codex-terminal-buffer">{children}</pre>
    ) : (
      <div className="codex-terminal-buffer codex-terminal-buffer-live">{children}</div>
    );

  return (
    <div className="codex-terminal-surface" data-codex-terminal="true">
      <div className="codex-terminal-header">
        <span className="codex-terminal-dot" />
        <span>{cwd ?? "~/solin/general/desktop-agent-app"}</span>
      </div>
      {content}
    </div>
  );
}
