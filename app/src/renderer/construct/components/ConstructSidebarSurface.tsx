import type { ReactNode } from "react";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarPrimaryAction,
} from "@opaline/ui";

export type ConstructSidebarAction = {
  active?: boolean;
  badge?: ReactNode;
  icon: ReactNode;
  id: string;
  label: ReactNode;
  onClick: () => void;
};

export function ConstructSidebarSurface({
  actions = [],
  children,
  footer,
}: {
  actions?: ConstructSidebarAction[];
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col font-system-ui">
      <SidebarContent className="gap-0 font-system-ui">
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
