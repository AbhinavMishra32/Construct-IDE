import type { ReactNode } from "react";

import { SparSidebarAction } from "../../components/spar";

export type ConstructSidebarAction = {
  active?: boolean;
  badge?: ReactNode;
  icon: ReactNode;
  id: string;
  label: ReactNode;
  onClick: () => void;
  shortcut?: string;
};

/**
 * The sidebar's body: primary actions, an optional view switch, whatever list
 * the surface is showing, and the account footer.
 *
 * Everything is a plain element on the window's own material. The sidebar paints
 * no fill of its own — `spar-shell.css` makes the shell's sidebar surface
 * transparent so the native vibrancy shows through, and anything with a
 * background here would sit on top of it and flatten the glass.
 *
 * The gutters are 10px rather than the 12px a web sidebar would take: the rows
 * are 28px, and a wider gutter than that makes a source list read as a card with
 * items in it.
 */
export function ConstructSidebarSurface({
  actions = [],
  nav = [],
  children,
  footer,
}: {
  /** Things you do — start something, search. */
  actions?: ConstructSidebarAction[];
  /** Places you go. Separated from the actions by a gap, the way Spar's is: a
   *  destination and a command look identical as rows, so the only thing telling
   *  you which is which is that they sit in different groups. */
  nav?: ConstructSidebarAction[];
  children: ReactNode;
  footer: ReactNode;
}) {
  const rows = (items: ConstructSidebarAction[]) =>
    items.map((action) => (
      <SparSidebarAction
        active={action.active}
        badge={action.badge}
        icon={action.icon}
        key={action.id}
        label={action.label}
        onClick={action.onClick}
        {...(action.shortcut ? { shortcut: action.shortcut } : {})}
      />
    ));

  return (
    <div className="app-sidebar app-drag flex h-full min-h-0 w-full flex-col font-system-ui">
      {actions.length > 0 ? (
        <div className="app-no-drag space-y-0.5 px-2.5">{rows(actions)}</div>
      ) : null}

      {nav.length > 0 ? (
        <nav className="app-no-drag mt-3 space-y-0.5 px-2.5">{rows(nav)}</nav>
      ) : null}

      {/* The list owns the scroll, not the sidebar: the footer has to stay put
          while the projects above it run past the fold. */}
      <div className="app-no-drag app-scroll mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2">
        {children}
      </div>

      {/* A hairline rather than a border, so the footer separates from the list
          without drawing a line across the window's material. */}
      <div className="app-no-drag border-t border-[var(--sidebar-border)] p-2.5">{footer}</div>
    </div>
  );
}
