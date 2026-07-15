import type { ReactNode } from "react";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarPrimaryAction,
} from "@opaline/ui";
import { cn } from "../../lib/utils";

export type ConstructSidebarAction = {
  active?: boolean;
  badge?: ReactNode;
  icon: ReactNode;
  id: string;
  label: ReactNode;
  onClick: () => void;
};

export type ConstructSidebarView = {
  id: string;
  label: string;
};

export function ConstructSidebarSurface({
  actions = [],
  activeView,
  children,
  footer,
  onSelectView,
  views = [],
}: {
  actions?: ConstructSidebarAction[];
  activeView?: string;
  children: ReactNode;
  footer: ReactNode;
  onSelectView?: (viewId: string) => void;
  views?: ConstructSidebarView[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col font-system-ui">
      <SidebarContent className="gap-0 font-system-ui">
        {views.length > 1 && activeView && onSelectView ? (
          <SidebarSegmentedPicker
            activeView={activeView}
            onSelectView={onSelectView}
            views={views}
          />
        ) : null}
        {actions.length > 0 ? (
          <SidebarGroup className="px-1.5 pt-1 pb-1.5">
            <SidebarMenu className="gap-0.5">
              {actions.map((action) => (
                <SidebarPrimaryAction
                  active={action.active}
                  badge={action.badge}
                  icon={action.icon}
                  key={action.id}
                  label={action.label}
                  onClick={action.onClick}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        <div className="sidebar-surface-enter flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </SidebarContent>

      <SidebarFooter className="gap-2 p-2 font-system-ui">
        {footer}
      </SidebarFooter>
    </div>
  );
}


/** Literal source segmented-picker geometry; only the view labels are Construct-owned. */
function SidebarSegmentedPicker({
  activeView,
  onSelectView,
  views,
}: {
  activeView: string;
  onSelectView: (viewId: string) => void;
  views: ConstructSidebarView[];
}) {
  const activeIndex = views.findIndex((view) => view.id === activeView);
  const activeSegment = Math.max(0, activeIndex);
  const isFirstActive = activeSegment === 0;
  const isLastActive = activeSegment === views.length - 1;
  const cell = `(100% - 0.25rem) / ${views.length}`;
  const overhang = "5px";
  const chipLeft = isFirstActive
    ? `calc(-1px - ${overhang})`
    : `calc(0.125rem + ${activeSegment} * (${cell}))`;
  const chipWidth = isFirstActive || isLastActive
    ? `calc(${cell} + 0.125rem + 1px + ${overhang})`
    : `calc(${cell})`;

  return (
    <div className="px-3 pt-0.5 pb-2.5">
      <div className="sidebar-segmented-picker relative isolate inline-flex w-full rounded-lg p-0.5">
        <div
          aria-hidden
          className="sidebar-segmented-thumb pointer-events-none absolute -inset-y-[1.5px] z-0 rounded-md transition-[left,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{ left: chipLeft, width: chipWidth }}
        />
        {views.map((view) => {
          const active = view.id === activeView;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative z-10 flex-1 rounded-md px-2.5 py-0.5 text-[11.5px] font-medium transition-colors duration-200",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              key={view.id}
              onClick={() => onSelectView(view.id)}
              type="button"
            >
              {view.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
