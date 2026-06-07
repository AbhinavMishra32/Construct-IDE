import * as Tabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import "./slot-panel.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single tab configuration for the SlotPanel.
 */
export type SlotTab = {
  /** Optional flag indicating whether the tab should start focused/active. */
  active?: boolean;
  /** Whether the tab is closable. If true, hovering swaps the icon with a close badge. */
  closable?: boolean;
  /** The content rendered when this tab is active. Any ReactNode. */
  content: ReactNode;
  /** Icon rendered on the left side of the tab title. */
  icon?: ReactNode;
  /** Unique identifier for the tab. */
  id: string;
  /** Optional keyboard shortcut label shown in the launcher menu. */
  shortcut?: string;
  /** The text title of the tab. */
  title: string;
};

/**
 * A launcher item shown in the empty state grid and the `+` dropdown.
 */
export type SlotLauncherItem = {
  /** Unique type key (e.g. "terminal", "files", "editor"). */
  type: string;
  /** Display title. */
  title: string;
  /** Description shown in the launcher card. */
  description?: string;
  /** Icon for the launcher card and dropdown row. */
  icon: ReactNode;
  /** Optional keyboard shortcut label. */
  shortcut?: string;
  /** Factory that returns the tab to open. Called when the user clicks the item. */
  createTab: () => SlotTab;
};

/**
 * Imperative handle for controlling the SlotPanel from outside.
 *
 * @example
 * ```tsx
 * const ref = useRef<SlotPanelHandle>(null);
 *
 * ref.current?.addTab({
 *   id: "file-app-tsx",
 *   title: "App.tsx",
 *   icon: <FileIcon size={14} />,
 *   closable: true,
 *   content: <CodeEditor file="src/App.tsx" />,
 * });
 * ```
 */
export type SlotPanelHandle = {
  /** Open a new tab with arbitrary content. If a tab with the same id exists, it is focused. */
  addTab: (tab: SlotTab) => void;
  /** Close a tab by id. */
  closeTab: (id: string) => void;
  /** Focus a tab by id. */
  setActiveTab: (id: string) => void;
  /** Get the current list of open tabs (snapshot). */
  getTabs: () => SlotTab[];
};

export interface SlotPanelProps {
  /** Controlled active tab id. Useful when external app state owns tab focus. */
  activeTabId?: string | null;
  /** Initial active tab id for uncontrolled panels. */
  defaultActiveTabId?: string | null;
  /** Initial tabs to populate the panel with. */
  tabs?: SlotTab[];
  /** Update incoming tab definitions by id on every render. Use for controlled file tabs. */
  syncTabs?: boolean;
  /** Items shown in the `+` dropdown and the empty-state launcher grid. */
  launcherItems?: SlotLauncherItem[];
  /** Optional CSS class name for the root element. */
  className?: string;
  /** Keep inactive content mounted so terminals and long-running tools continue. */
  keepMounted?: boolean;
  /** Optional close button handler. If provided, a close `×` button is shown in the tab bar. */
  onClose?: () => void;
  /** Callback fired when the active tab changes (user clicks a different tab). */
  onTabChange?: (tabId: string) => void;
  /** Callback fired when a tab changes. Preferred newer callback. */
  onActiveTabChange?: (tabId: string | null, tab: SlotTab | null) => void;
  /** Callback fired when a tab is closed. */
  onTabClose?: (tabId: string, nextTabs?: SlotTab[]) => void;
  /** Callback fired when a tab is opened or focused from launcher/ref. */
  onTabOpen?: (tab: SlotTab) => void;
  /** Callback fired when the internal tab list changes. */
  onTabsChange?: (tabs: SlotTab[]) => void;
  /** Accessible label for the tab list. */
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Generic slot-based tab panel. Drop this into any slot — bottom panel,
 * right panel, main area — to get a full tab system with:
 *
 * - Codex-style tab bar with close badges on hover
 * - `+` button dropdown for quick-adding launcher items
 * - Empty-state launcher grid when no tabs are open
 * - Imperative ref handle for programmatic control
 *
 * @example
 * ```tsx
 * <SlotPanel
 *   ref={panelRef}
 *   launcherItems={[
 *     { type: "terminal", title: "Terminal", icon: <TerminalIcon />, createTab: () => ({ ... }) },
 *   ]}
 * />
 * ```
 */
export const SlotPanel = React.forwardRef<SlotPanelHandle, SlotPanelProps>(
  function SlotPanel({
    activeTabId: controlledActiveTabId,
    defaultActiveTabId,
    tabs: initialTabs,
    syncTabs = false,
    launcherItems = [],
    className,
    keepMounted = true,
    onClose,
    onTabChange,
    onActiveTabChange,
    onTabClose,
    onTabOpen,
    onTabsChange,
    ariaLabel = "Panel tabs",
  }, ref) {
    const [openTabs, setOpenTabs] = useState<SlotTab[]>(() => initialTabs ?? []);
    const activeDefault = openTabs.find((t) => t.active) ?? openTabs.find((t) => t.id === defaultActiveTabId) ?? openTabs[0];
    const [uncontrolledActiveTabId, setUncontrolledActiveTabId] = useState<string | null>(
      controlledActiveTabId ?? defaultActiveTabId ?? activeDefault?.id ?? null,
    );
    const activeTabId = controlledActiveTabId !== undefined ? controlledActiveTabId : uncontrolledActiveTabId;
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const [tabOverflow, setTabOverflow] = useState({
      canScrollLeft: false,
      canScrollRight: false,
    });

    const initialTabsSignature = initialTabs?.map((tab) => tab.id).join("\u0000") ?? "";
    const commitActiveTabId = useCallback((id: string | null) => {
      if (controlledActiveTabId === undefined) {
        setUncontrolledActiveTabId(id);
      }

      if (id) {
        onTabChange?.(id);
      }

      onActiveTabChange?.(id, openTabs.find((tab) => tab.id === id) ?? null);
    }, [controlledActiveTabId, onActiveTabChange, onTabChange, openTabs]);

    // Treat inline `tabs` as initial input by default; controlled file-tab surfaces
    // can opt into by-id syncing without wiping launcher-created tabs.
    useEffect(() => {
      if (!initialTabs) {
        return;
      }

      setOpenTabs((previousTabs) => {
        const previousSignature = previousTabs
          .filter((tab) => initialTabs.some((incoming) => incoming.id === tab.id))
          .map((tab) => tab.id)
          .join("\u0000");

        if (!syncTabs && previousTabs.length > 0 && previousSignature === initialTabsSignature) {
          return previousTabs;
        }

        const incomingIds = new Set(initialTabs.map((tab) => tab.id));
        const previousById = new Map(previousTabs.map((tab) => [tab.id, tab] as const));
        const syncedTabs = syncTabs
          ? initialTabs.map((tab) => ({
              ...previousById.get(tab.id),
              ...tab,
            }))
          : initialTabs;
        const launcherTabs = syncTabs ? previousTabs.filter((tab) => !incomingIds.has(tab.id)) : [];
        return [...syncedTabs, ...launcherTabs];
      });
    }, [initialTabs, initialTabsSignature, syncTabs]);

    useEffect(() => {
      if (controlledActiveTabId !== undefined) {
        setUncontrolledActiveTabId(controlledActiveTabId);
      }
    }, [controlledActiveTabId]);

    useEffect(() => {
      if (activeTabId == null || openTabs.some((tab) => tab.id === activeTabId)) {
        return;
      }

      commitActiveTabId(openTabs[0]?.id ?? null);
    }, [activeTabId, commitActiveTabId, openTabs]);

    useEffect(() => {
      const tabList = tabsRef.current;
      if (!tabList) {
        return;
      }
      const currentTabList = tabList;

      function updateOverflow() {
        const scrollLeft = currentTabList.scrollLeft;
        const maxScrollLeft = currentTabList.scrollWidth - currentTabList.clientWidth;
        setTabOverflow({
          canScrollLeft: scrollLeft > 1,
          canScrollRight: maxScrollLeft - scrollLeft > 1,
        });
      }

      updateOverflow();
      const observer = new ResizeObserver(updateOverflow);
      observer.observe(currentTabList);
      currentTabList.addEventListener("scroll", updateOverflow, { passive: true });
      return () => {
        observer.disconnect();
        currentTabList.removeEventListener("scroll", updateOverflow);
      };
    }, [openTabs]);

    const scrollTabs = (direction: "left" | "right") => {
      tabsRef.current?.scrollBy({
        left: direction === "left" ? -180 : 180,
        behavior: "smooth",
      });
    };

    const handleCloseTab = (id: string) => {
      const nextTabs = openTabs.filter((t) => t.id !== id);
      setOpenTabs(nextTabs);
      onTabsChange?.(nextTabs);
      onTabClose?.(id, nextTabs);

      if (activeTabId === id) {
        if (nextTabs.length > 0) {
          const deletedIndex = openTabs.findIndex((t) => t.id === id);
          const nextActiveIndex = Math.min(deletedIndex, nextTabs.length - 1);
          commitActiveTabId(nextTabs[nextActiveIndex].id);
        } else {
          commitActiveTabId(null);
        }
      }
    };

    const handleAddTab = (tab: SlotTab) => {
      const existing = openTabs.find((t) => t.id === tab.id);
      if (existing) {
        commitActiveTabId(tab.id);
        onTabOpen?.(existing);
        return;
      }
      const nextTabs = [...openTabs, tab];
      setOpenTabs(nextTabs);
      onTabsChange?.(nextTabs);
      commitActiveTabId(tab.id);
      onTabOpen?.(tab);
    };

    const handleLauncherSelect = (item: SlotLauncherItem) => {
      handleAddTab(item.createTab());
    };

    // Imperative handle
    React.useImperativeHandle(ref, () => ({
      addTab: handleAddTab,
      closeTab: handleCloseTab,
      setActiveTab: (id: string) => commitActiveTabId(id),
      getTabs: () => [...openTabs],
    }));

    return (
      <Tabs.Root
        className={`codex-slot-panel${className ? ` ${className}` : ""}`}
        value={activeTabId || ""}
        onValueChange={(val) => commitActiveTabId(val || null)}
      >
        <div className="codex-slot-panel-tabbar">
          <div className="codex-slot-panel-tabs-container">
            {tabOverflow.canScrollLeft ? (
              <button
                className="codex-slot-panel-scroll-affordance is-left"
                type="button"
                aria-label="Scroll tabs left"
                onClick={() => scrollTabs("left")}
              >
                <ChevronLeft size={14} strokeWidth={1.9} />
              </button>
            ) : null}
            <Tabs.List
              ref={tabsRef}
              className="codex-slot-panel-tabs"
              aria-label={ariaLabel}
              data-overflow-left={tabOverflow.canScrollLeft ? "true" : undefined}
              data-overflow-right={tabOverflow.canScrollRight ? "true" : undefined}
            >
              {openTabs.map((tab) => (
                <Tabs.Trigger
                  key={tab.id}
                  value={tab.id}
                  className="codex-slot-panel-tab"
                  data-tab-id={tab.id}
                  data-closable={tab.closable === true ? "true" : undefined}
                >
                  <span className="codex-slot-panel-tab-icon-wrapper">
                    {tab.closable === true ? (
                      <span
                        className="codex-slot-panel-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseTab(tab.id);
                        }}
                        title="Close tab"
                        aria-label="Close tab"
                      >
                        <svg viewBox="0 0 10 10" width="8" height="8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" />
                          <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" />
                        </svg>
                      </span>
                    ) : null}
                    {tab.icon != null ? (
                      <span className="codex-slot-panel-tab-icon">{tab.icon}</span>
                    ) : null}
                  </span>
                  <span className="codex-slot-panel-tab-title">{tab.title}</span>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {tabOverflow.canScrollRight ? (
              <button
                className="codex-slot-panel-scroll-affordance is-right"
                type="button"
                aria-label="Scroll tabs right"
                onClick={() => scrollTabs("right")}
              >
                <ChevronRight size={14} strokeWidth={1.9} />
              </button>
            ) : null}
            {launcherItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="codex-slot-panel-add-action" type="button" aria-label="Add tab">
                    <Plus size={15} strokeWidth={1.8} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="codex-slot-panel-launcher-menu" side="bottom">
                  {launcherItems.map((item) => (
                    <DropdownMenuItem key={item.type} onSelect={() => handleLauncherSelect(item)}>
                      {item.icon}
                      <span>{item.title}</span>
                      {item.shortcut && <span className="codex-slot-panel-launcher-shortcut">{item.shortcut}</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {onClose && (
            <div className="codex-slot-panel-actions">
              <button
                className="codex-slot-panel-action codex-slot-panel-close-action"
                type="button"
                aria-label="Close panel"
                onClick={onClose}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {openTabs.length === 0 && launcherItems.length > 0 ? (
          <div className="codex-slot-panel-outlet codex-slot-panel-launcher-container">
            <div className="codex-slot-panel-launcher-grid">
              <div className="codex-slot-launcher-header">
                <h3>Select a tool to open</h3>
                <p>Click any option below to initialize the surface.</p>
              </div>
              <div className="codex-slot-launcher-cards">
                {launcherItems.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className="codex-slot-launcher-card"
                    onClick={() => handleLauncherSelect(item)}
                  >
                    <div className="codex-slot-launcher-card-icon">{item.icon}</div>
                    <div className="codex-slot-launcher-card-info">
                      <h4>{item.title}</h4>
                      {item.description && <p>{item.description}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : openTabs.length === 0 ? (
          <div className="codex-slot-panel-outlet codex-slot-panel-launcher-container">
            <div className="codex-slot-panel-launcher-grid">
              <div className="codex-slot-launcher-header">
                <h3>No tabs open</h3>
                <p>Use the ref handle to open a tab with any content.</p>
              </div>
            </div>
          </div>
        ) : (
          openTabs.map((tab) => (
            <Tabs.Content
              key={tab.id}
              value={tab.id}
              className="codex-slot-panel-outlet"
              forceMount={keepMounted ? true : undefined}
              hidden={keepMounted && activeTabId !== tab.id ? true : undefined}
            >
              {tab.content}
            </Tabs.Content>
          ))
        )}
      </Tabs.Root>
    );
  },
);
