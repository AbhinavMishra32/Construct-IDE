"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ArrowLeft, Check, Search } from "lucide-react";
import "./settings.css";

export type SettingsNavItem = {
  badge?: ReactNode;
  icon?: ReactNode;
  id: string;
  label: ReactNode;
  muted?: boolean;
};

export type SettingsNavSection = {
  id: string;
  items: SettingsNavItem[];
  label?: ReactNode;
};

export type SettingsSidebarProps = HTMLAttributes<HTMLElement> & {
  activeItemId?: string;
  backLabel?: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  onItemSelect?: (item: SettingsNavItem) => void;
  onSearchChange?: (query: string) => void;
  query?: string;
  renderItem?: (item: SettingsNavItem, state: { active: boolean }) => ReactNode;
  searchPlaceholder?: string;
  sections: SettingsNavSection[];
};

export type SettingsPanelProps = HTMLAttributes<HTMLElement> & {
  subtitle?: ReactNode;
  title: ReactNode;
};

export type SettingsSectionProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
};

export type SettingsCardProps = HTMLAttributes<HTMLDivElement>;

export type SettingsRowProps = HTMLAttributes<HTMLDivElement> & {
  control?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export type SettingsToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export type SettingsOptionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  description?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  title: ReactNode;
};

export type SettingsSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function SettingsSidebar({
  activeItemId,
  backLabel = "Back to app",
  className,
  footer,
  onBack,
  onItemSelect,
  onSearchChange,
  query = "",
  renderItem,
  searchPlaceholder = "Search settings...",
  sections,
  ...props
}: SettingsSidebarProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = normalizedQuery
    ? sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => String(item.label).toLowerCase().includes(normalizedQuery)),
        }))
        .filter((section) => section.items.length > 0)
    : sections;

  return (
    <aside className={joinClassNames("codex-settings-sidebar", className)} {...props}>
      <button className="codex-settings-back" type="button" onClick={onBack}>
        <ArrowLeft size={18} strokeWidth={1.7} />
        <span>{backLabel}</span>
      </button>

      <label className="codex-settings-search">
        <Search size={17} strokeWidth={1.7} aria-hidden="true" />
        <input
          aria-label="Search settings"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => onSearchChange?.(event.currentTarget.value)}
        />
      </label>

      <div className="codex-settings-nav-scroll">
        {visibleSections.map((section) => (
          <section className="codex-settings-nav-section" key={section.id}>
            {section.label != null ? <div className="codex-settings-nav-label">{section.label}</div> : null}
            <div className="codex-settings-nav-list">
              {section.items.map((item) => {
                const active = item.id === activeItemId;
                return renderItem != null ? (
                  renderItem(item, { active })
                ) : (
                  <button
                    className="codex-settings-nav-item"
                    data-active={active ? "true" : undefined}
                    data-muted={item.muted ? "true" : undefined}
                    key={item.id}
                    type="button"
                    onClick={() => onItemSelect?.(item)}
                  >
                    {item.icon != null ? <span className="codex-settings-nav-icon">{item.icon}</span> : null}
                    <span className="codex-settings-nav-title">{item.label}</span>
                    {item.badge != null ? <span className="codex-settings-nav-badge">{item.badge}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {footer != null ? <div className="codex-settings-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

export function SettingsPanel({ children, className, subtitle, title, ...props }: SettingsPanelProps) {
  return (
    <main className={joinClassNames("codex-settings-panel", className)} {...props}>
      <div className="codex-settings-panel-inner">
        <header className="codex-settings-panel-header">
          <h1>{title}</h1>
          {subtitle != null ? <p>{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

export function SettingsSection({ children, className, title, ...props }: SettingsSectionProps) {
  return (
    <section className={joinClassNames("codex-settings-section", className)} {...props}>
      {title != null ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function SettingsCard({ children, className, ...props }: SettingsCardProps) {
  return (
    <div className={joinClassNames("codex-settings-card", className)} {...props}>
      {children}
    </div>
  );
}

export function SettingsRow({ children, className, control, description, title, ...props }: SettingsRowProps) {
  return (
    <div className={joinClassNames("codex-settings-row", className)} {...props}>
      <div className="codex-settings-row-copy">
        <span className="codex-settings-row-title">{title}</span>
        {description != null ? <p>{description}</p> : null}
        {children}
      </div>
      {control != null ? <div className="codex-settings-row-control">{control}</div> : null}
    </div>
  );
}

export function SettingsToggle({
  checked = false,
  className,
  onCheckedChange,
  onClick,
  type = "button",
  ...props
}: SettingsToggleProps) {
  return (
    <button
      aria-checked={checked}
      className={joinClassNames("codex-settings-toggle", className)}
      data-checked={checked ? "true" : "false"}
      role="switch"
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <span />
    </button>
  );
}

export function SettingsOptionCard({
  children,
  className,
  description,
  icon,
  selected = false,
  title,
  type = "button",
  ...props
}: SettingsOptionCardProps) {
  return (
    <button
      className={joinClassNames("codex-settings-option-card", className)}
      data-selected={selected ? "true" : "false"}
      type={type}
      {...props}
    >
      {icon != null ? <span className="codex-settings-option-icon">{icon}</span> : null}
      <span className="codex-settings-option-copy">
        <strong>{title}</strong>
        {description != null ? <span>{description}</span> : null}
        {children}
      </span>
      <span className="codex-settings-option-check" aria-hidden="true">
        <Check size={16} strokeWidth={2} />
      </span>
    </button>
  );
}

export function SettingsSelect({ className, ...props }: SettingsSelectProps) {
  return <select className={joinClassNames("codex-settings-select", className)} {...props} />;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}
