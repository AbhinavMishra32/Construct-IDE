import { ChevronLeft, PanelLeftOpen } from "lucide-react";

import { cn } from "../../lib/utils";

/**
 * Inset macOS toolbar: one title-bar row tall, hairline base, draggable but for
 * the controls.
 *
 * The row height and the window-control insets both come from tokens rather than
 * measurements, so the traffic lights keep their clearance if the platform ever
 * moves them.
 */
export function SparToolbar({
  title,
  subtitle,
  onBack,
  onExpandSidebar,
  actions,
  leading,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?(): void;
  /** Present only while the sidebar is hidden, so the traffic lights get their inset. */
  onExpandSidebar?: (() => void) | undefined;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "app-drag hairline-b flex h-[var(--titlebar-height)] shrink-0 items-center gap-2 px-2.5",
        // The OS draws its window buttons over this row: on Windows they are
        // always on the trailing edge, and on macOS they land here only once the
        // sidebar (which normally hosts them) is hidden.
        "pr-[max(0.625rem,var(--window-controls-trailing))]",
        onExpandSidebar && "pl-[max(0.625rem,var(--window-controls-leading))]",
        className,
      )}
      data-tauri-drag-region
    >
      {onExpandSidebar && (
        <SparToolbarIconButton icon={PanelLeftOpen} onClick={onExpandSidebar} title="Show sidebar  ⌘B" />
      )}
      {onBack && <SparToolbarIconButton icon={ChevronLeft} onClick={onBack} title="Back" />}
      {leading}
      {(title != null || subtitle != null) && (
        <div className="flex min-w-0 items-baseline gap-2">
          {title != null && <span className="truncate text-ui font-medium">{title}</span>}
          {subtitle != null && <span className="truncate text-ui-sm text-muted-foreground/80">{subtitle}</span>}
        </div>
      )}
      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}

/** 24px square: the AppKit toolbar proportion, not a web touch target. */
export function SparToolbarIconButton({
  icon: Icon,
  onClick,
  title,
  active,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  /** The event is passed through for the rows that have to stop it reaching a
   *  clickable container — a stepper inside a "jump back to here" strip. */
  onClick?(event: React.MouseEvent<HTMLButtonElement>): void;
  title: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={title}
      className={cn(
        "app-no-drag grid size-6 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-45",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/** Compact toolbar control that matches the native segmented look. */
export function SparToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?(): void;
  title?: string;
}) {
  return (
    <button
      className={cn(
        "app-no-drag inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-ui transition-colors disabled:pointer-events-none disabled:opacity-45",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <Icon className="size-3.5" />
      {label && <span>{label}</span>}
    </button>
  );
}
