import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { appActionAttributes } from "./appActionAttributes";
import "./sidebar.css";

export type SidebarItem = {
  active?: boolean;
  hostId?: string | null;
  id: string;
  label?: string;
  kind?: "local" | "remote";
  meta?: ReactNode;
  pinned?: boolean;
  time?: ReactNode;
  title: ReactNode;
};

export type SidebarProject = {
  active?: boolean;
  collapsed?: boolean;
  icon?: ReactNode;
  id: string;
  label: ReactNode;
  labelForAttributes?: string;
  muted?: boolean;
  threads?: SidebarItem[];
};

export type SidebarNavItem = {
  active?: boolean;
  icon?: ReactNode;
  id: string;
  label: ReactNode;
  onClick?: () => void;
};

export type SidebarProps = {
  children?: ReactNode;
  footer?: ReactNode;
  items?: SidebarItem[];
  onProjectSelect?: (projectId: string) => void;
  primaryItems?: SidebarNavItem[];
  projects?: SidebarProject[];
  renderItem?: (item: SidebarItem, options: { inset: boolean }) => ReactNode;
  renderNavItem?: (item: SidebarNavItem) => ReactNode;
  renderProject?: (project: SidebarProject) => ReactNode;
  sectionLabels?: {
    items?: string;
    projects?: string;
  };
};

export function Sidebar({
  children,
  footer,
  items = [],
  onProjectSelect,
  primaryItems = [],
  projects = [],
  renderItem,
  renderNavItem,
  renderProject,
  sectionLabels = { items: "Items", projects: "Projects" },
}: SidebarProps) {
  return (
    <aside className="codex-sidebar">
      {primaryItems.length > 0 ? (
        <SidebarPrimary>
          {primaryItems.map((item) => renderNavItem?.(item) ?? <SidebarNavItemRow item={item} key={item.id} />)}
        </SidebarPrimary>
      ) : null}

      <SidebarScroll>
        {projects.length > 0 ? (
          <SidebarSection heading={sectionLabels.projects ?? "Projects"}>
            {projects.map((project) => (
              renderProject?.(project) ?? (
                <SidebarProjectRow
                  key={project.id}
                  project={project}
                  renderItem={renderItem}
                  onSelect={onProjectSelect}
                />
              )
            ))}
          </SidebarSection>
        ) : null}

        {items.length > 0 ? (
          <SidebarSection heading={sectionLabels.items ?? "Items"}>
            <nav className="codex-sidebar-list" aria-label={sectionLabels.items ?? "Items"}>
              {items.map((item) => (
                renderItem?.(item, { inset: false }) ?? <SidebarThreadRow key={item.id} item={item} />
              ))}
            </nav>
          </SidebarSection>
        ) : null}
        {children}
      </SidebarScroll>

      {footer != null ? <SidebarFooter>{footer}</SidebarFooter> : null}
    </aside>
  );
}

export function SidebarPrimary({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={joinClassNames("codex-sidebar-primary", className)} role="navigation" aria-label="Primary" {...props}>
      {children}
    </div>
  );
}

export function SidebarScroll({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={joinClassNames("codex-sidebar-scroll", className)} {...appActionAttributes.sidebarScroll} {...props}>
      {children}
    </div>
  );
}

export function SidebarFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={joinClassNames("codex-sidebar-footer", className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarNavItemRow({
  className,
  item,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { item: SidebarNavItem }) {
  return (
    <button
      className={joinClassNames("codex-sidebar-nav-item", className)}
      data-active={item.active === true ? "true" : undefined}
      onClick={item.onClick}
      type={type}
      {...props}
    >
      {item.icon != null ? (
        <span className="codex-sidebar-nav-icon" aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      {item.label}
    </button>
  );
}

export function SidebarSection({ children, heading }: { children: ReactNode; heading: string }) {
  return (
    <section className="codex-sidebar-section" {...appActionAttributes.sidebarSection({ collapsed: false, heading })}>
      <button className="codex-sidebar-section-header" {...appActionAttributes.sidebarSectionToggle}>
        <span className="codex-sidebar-section-label">{heading}</span>
      </button>
      {children}
    </section>
  );
}

export function SidebarProjectRow({
  onSelect,
  project,
  renderItem,
}: {
  onSelect?: (projectId: string) => void;
  project: SidebarProject;
  renderItem?: (item: SidebarItem, options: { inset: boolean }) => ReactNode;
}) {
  const label = typeof project.label === "string" ? project.label : project.labelForAttributes ?? project.id;

  return (
    <div
      className="codex-sidebar-project"
      data-active={project.active === true ? "true" : "false"}
      data-muted={project.muted === true ? "true" : "false"}
      {...appActionAttributes.sidebarProjectRow({
        collapsed: project.collapsed === true,
        label,
        projectId: project.id,
      })}
    >
      <button
        className="codex-sidebar-project-select"
        onClick={() => onSelect?.(project.id)}
        {...appActionAttributes.sidebarProjectSelect}
      >
        {project.icon != null ? (
          <span className="codex-sidebar-project-icon" aria-hidden="true">
            {project.icon}
          </span>
        ) : null}
        <span className="codex-sidebar-project-title">{project.label}</span>
      </button>
      {project.collapsed === true || project.threads == null ? null : (
        <div
          className="codex-sidebar-project-list"
          {...appActionAttributes.sidebarProjectList({ projectId: project.id, showAll: false })}
        >
          {project.threads.map((item) => (
            renderItem?.(item, { inset: true }) ?? <SidebarThreadRow key={item.id} item={item} inset />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarThreadRow({ inset = false, item }: { inset?: boolean; item: SidebarItem }) {
  const trailing = item.time ?? item.meta;
  const trailingKind = typeof trailing === "string" && trailing.startsWith("⌘") ? "shortcut" : "time";
  const title = typeof item.title === "string" ? item.title : item.label ?? item.id;

  return (
    <button
      className="codex-sidebar-item"
      data-active={item.active === true ? "true" : "false"}
      data-inset={inset === true ? "true" : "false"}
      {...appActionAttributes.sidebarThreadRow({
        active: item.active === true,
        hostId: item.hostId,
        id: item.id,
        kind: item.kind ?? "local",
        pinned: item.pinned === true,
        title,
      })}
    >
      <span className="codex-sidebar-item-title">{item.title}</span>
      {trailing != null ? (
        <span className="codex-sidebar-item-meta" data-kind={trailingKind}>
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}
