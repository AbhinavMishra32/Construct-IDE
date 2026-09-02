import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavButtons } from "./NavButtons";
import { ExpandSidebar } from "./ExpandSidebar";
import { NAV_BUTTONS_WIDTH, SidebarReveal } from "./SidebarReveal";
import { SIDEBAR_SLIDE_CSS } from "./sidebarMotion";

/** Inset macOS toolbar: one title-bar row tall, hairline base, draggable but for the controls. */
export function Toolbar({
  title,
  subtitle,
  onBack,
  onExpandSidebar,
  nav,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  onBack?(): void;
  /** Present only while the sidebar is hidden, so the traffic lights get their inset. */
  onExpandSidebar?: (() => void) | undefined;
  /** Supplied only while the sidebar is hidden — it carries this pair the rest
   *  of the time, and two of them on screen would be one too many. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  actions?: React.ReactNode;
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
        /* Eased rather than switched, on the sidebar's own curve: the inset
           appears as the column vacates the space it needs. */
        "transition-[padding-left]",
        SIDEBAR_SLIDE_CSS,
        onExpandSidebar && "pl-[max(0.625rem,var(--window-controls-leading))]",
        className,
      )}
    >
      <ExpandSidebar gap={8} onExpand={onExpandSidebar} />
      {/* Revealed, not mounted. The history pair lives in the sidebar while there
          is one, so it arrives in this row at the moment the column leaves — and
          arriving at full width in one frame is what used to shove the title
          sideways before the sidebar had moved at all. */}
      <SidebarReveal gap={8} show={nav !== undefined} width={NAV_BUTTONS_WIDTH}>
        {nav && <NavButtons canBack={nav.canBack} canForward={nav.canForward} onBack={nav.onBack} onForward={nav.onForward} />}
      </SidebarReveal>
      {onBack && (
        <button
          className="app-no-drag grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}
          title="Back"
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      <div className="flex min-w-0 items-baseline gap-2">
        {/* Set with the sidebar, not with the toolbar's controls: this is the name
            of the page the nav row points at, and a heading smaller than the row
            that leads to it inverts the hierarchy. */}
        <span className="truncate text-source font-medium">{title}</span>
        {subtitle && <span className="truncate text-ui-sm text-muted-foreground/80">{subtitle}</span>}
      </div>
      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}

/** Compact toolbar control that matches the native segmented look. */
export function ToolbarButton({
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
        "inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-ui transition-colors disabled:pointer-events-none disabled:opacity-45",
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
