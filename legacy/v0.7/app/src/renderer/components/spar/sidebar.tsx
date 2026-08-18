import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, EllipsisVertical, Search, X } from "lucide-react";

import { cn } from "../../lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * One sidebar row, everywhere.
 *
 * 28px tall at the app's chrome size, which is the AppKit source-list
 * proportion. Every row in the sidebar — nav, action, project, rename field —
 * is this same box, so the list reads as one column rather than as sections
 * built by different hands.
 *
 * No transition on the fill. A source list is the one surface where the pointer
 * is expected to travel fast, and a 150ms crossfade per row turns that into a
 * wake of half-lit rows trailing the cursor. AppKit paints the highlight on the
 * frame the pointer arrives — hovering here should feel like touching hardware,
 * not like waking a web page up.
 */
export const SPAR_SIDEBAR_ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui font-normal outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** The control cluster's buttons, in the order they sit in the row. */
const ICON_BUTTON =
  "grid size-5 shrink-0 place-items-center rounded-[var(--radius-sm)] text-muted-foreground/75 hover:bg-[var(--sidebar-accent-active)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

/** Width of the gradient that hides the overrun, matching `--sidebar-title-fade`. */
const TITLE_FADE = 22;

/**
 * A sidebar title that fades where it runs out of room, and walks the rest of
 * itself past the fade while its row is hovered.
 *
 * Both need the same measurement — how much of the title does not fit — and it
 * has to be taken live: the width changes when the sidebar is dragged, when the
 * hover controls claim their gutter, and when the title is renamed. The clipped
 * flag and the travel are handed to CSS, which owns the hover state; see
 * `.sidebar-title` in spar-shell.css.
 */
export function SparRowTitle({ children }: { children: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = viewport.current;
    const inner = text.current;
    if (!box || !inner) return;
    const measure = () => {
      const hidden = inner.scrollWidth - box.clientWidth;
      // Sub-pixel layout leaves a fraction over on titles that do fit, and a row
      // that marquees by half a pixel is a row that twitches under the cursor.
      setOverflow(hidden > 1 ? hidden : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [children]);

  /* Travel is the hidden part plus the fade, so the last character ends up clear
     of the gradient rather than arriving inside it. Pace is constant — a long
     title takes longer than a short one instead of moving faster — with a floor
     so a two-word overrun is not a flick. */
  const travel = overflow + TITLE_FADE;
  const seconds = Math.min(9, Math.max(2.6, travel / 38 + 1.4));

  return (
    <span
      ref={viewport}
      className="sidebar-title text-left"
      data-clipped={overflow > 0}
      style={
        overflow > 0
          ? ({
              "--sidebar-title-shift": `-${travel}px`,
              "--sidebar-title-duration": `${seconds}s`,
            } as CSSProperties)
          : undefined
      }
    >
      <span ref={text}>{children}</span>
    </span>
  );
}

/** A group heading. Sits above its rows in the same gutter, and is never a row
 *  itself — an 11px label at row height would read as a disabled item. */
export function SparSectionLabel({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-6 items-center justify-between px-2 pt-1", className)}>
      <span className="text-ui-sm font-medium text-muted-foreground/70">{children}</span>
      {action}
    </div>
  );
}

/** A collapsed section heading — the disclosure is the label, so the whole thing
 *  is one target rather than a caret beside a word. */
export function SparSectionToggle({
  children,
  count,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  count?: number;
  open: boolean;
  onToggle(): void;
}) {
  return (
    <button
      className="flex h-6 w-full items-center gap-1 px-2 pt-1 text-ui-sm font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
      onClick={onToggle}
      type="button"
    >
      <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      {children}
      {count != null && <span className="tabular-nums text-muted-foreground/50">{count}</span>}
    </button>
  );
}

/** A plain sidebar row: an icon, a label, and optionally a shortcut hint. */
export function SparSidebarAction({
  icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  title,
  badge,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  badge?: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        SPAR_SIDEBAR_ROW,
        active
          ? "bg-[var(--sidebar-accent-active)] text-foreground"
          : "text-foreground/85 hover:bg-[var(--sidebar-accent)]",
        disabled && "pointer-events-none opacity-45",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon && <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {badge}
      {shortcut && <kbd className="font-sans text-ui-sm text-muted-foreground/60">{shortcut}</kbd>}
    </button>
  );
}

export type SparRowMenuItem = {
  /** The letter that runs this item from the keyboard, and the hint shown for it. */
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run(): void;
  destructive?: boolean;
};

/** A row action promoted out of the menu onto the row itself. */
export type SparRowQuickAction = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run(): void;
};

/**
 * A list row with everything you can do to it behind ⋮ or a right-click — and
 * the one or two you actually reach for as their own icons on hover.
 *
 * No gutter is reserved for them. The old row paid for the ⋮ on every row it
 * drew, so titles ended in an ellipsis a word early even with nothing hovered;
 * here the controls take their room from the title only while they are visible,
 * and the title fades under them rather than being cut. What the fade hides,
 * hovering walks past — see {@link SparRowTitle}.
 */
export function SparSidebarRow({
  label,
  leading,
  active = false,
  dimmed = false,
  items = [],
  quick = [],
  onOpen,
  renaming = false,
  onRenameCommit,
  onRenameCancel,
  peek,
}: {
  label: string;
  leading?: React.ReactNode;
  active?: boolean;
  /** Filed away — archived, finished — so it reads as present but retired. */
  dimmed?: boolean;
  items?: SparRowMenuItem[];
  quick?: SparRowQuickAction[];
  onOpen(): void;
  renaming?: boolean;
  onRenameCommit?(value: string): void;
  onRenameCancel?(): void;
  /** What the row could not say in one line, shown beside it after a pause. */
  peek?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);

  if (renaming && onRenameCommit && onRenameCancel) {
    return (
      <SparRenameRow leading={leading} onCancel={onRenameCancel} onCommit={onRenameCommit} value={label} />
    );
  }

  /** Asking for the menu withdraws the peek. Both open off the same row, so the
   *  two of them up at once is two panels fighting over one anchor — and once the
   *  menu has been dismissed the pointer has to leave and come back before the
   *  peek is offered again, rather than springing up in the menu's place. */
  const openMenu = (next: boolean) => {
    setOpen(next);
    if (next) setPeeking(false);
  };

  const controls = items.length > 0 ? quick.length + 1 : quick.length;

  const row = (
    <div
      className="sidebar-row group/spar-row relative"
      onContextMenu={items.length > 0 ? (event) => { event.preventDefault(); openMenu(true); } : undefined}
      // The cluster is absolute, so the gutter it needs has to be stated: one
      // slot per quick action plus the ⋮, and the inset it sits in.
      style={
        controls > 0
          ? ({ "--sidebar-controls-width": `calc(${controls} * 1.25rem + 0.7rem)` } as CSSProperties)
          : undefined
      }
    >
      <button
        className={cn(
          SPAR_SIDEBAR_ROW,
          active
            ? "bg-[var(--sidebar-accent-active)] text-foreground"
            : "text-foreground/80 hover:bg-[var(--sidebar-accent)]",
          dimmed && !active && "text-foreground/55",
        )}
        onClick={onOpen}
        type="button"
      >
        {leading}
        <SparRowTitle>{label}</SparRowTitle>
      </button>

      {controls > 0 && (
        /* No `flex` utility here: display is CSS's to own, because it is the thing
           hover toggles, and a utility-layer `display` would outrank the rule
           that hides the cluster at rest. */
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 items-center gap-px"
          data-open={open}
          data-row-controls
        >
          {quick.map((action) => (
            <button
              key={action.label}
              aria-label={`${action.label}: ${label}`}
              className={ICON_BUTTON}
              onClick={action.run}
              title={action.label}
              type="button"
            >
              <action.icon className="size-3.5" />
            </button>
          ))}

          {items.length > 0 && (
            <DropdownMenu modal={false} onOpenChange={openMenu} open={open}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Options for ${label}`}
                  className={cn(ICON_BUTTON, open && "bg-[var(--sidebar-accent-active)] text-foreground")}
                  type="button"
                >
                  <EllipsisVertical className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* The letters are real: Radix would otherwise spend them on typeahead,
                  which moves the highlight and leaves the hint lying about what it does. */}
              <DropdownMenuContent
                align="start"
                className="min-w-[11.5rem]"
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  const item = items.find((entry) => entry.key === event.key.toLowerCase());
                  if (!item) return;
                  event.preventDefault();
                  setOpen(false);
                  item.run();
                }}
                side="right"
              >
                {items.map((item) => (
                  <Fragment key={item.key}>
                    {item.destructive && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={item.run} variant={item.destructive ? "destructive" : "default"}>
                      <item.icon />
                      <span className="flex-1">{item.label}</span>
                      <kbd className="font-sans text-ui-sm text-muted-foreground/60 uppercase">{item.key}</kbd>
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );

  if (!peek) return row;

  return (
    <HoverCard closeDelay={90} onOpenChange={setPeeking} open={peeking && !open} openDelay={420}>
      <HoverCardTrigger asChild>{row}</HoverCardTrigger>
      {/* Unmounted while the menu is up rather than only closed, so there is no
          panel left to animate out over the menu that replaced it.

          Not hoverable either: there is nothing in it to click, and a panel that
          kept itself alive under the pointer would swallow clicks on the page it
          is floating over. */}
      {!open && (
        <HoverCardContent align="start" className="pointer-events-none w-[18.5rem]" side="right" sideOffset={10}>
          {peek}
        </HoverCardContent>
      )}
    </HoverCard>
  );
}

/** Renaming happens in place. Enter and blur commit, Escape restores the old
 *  value — a dialog for one short string would be more ceremony than the edit. */
function SparRenameRow({
  value,
  leading,
  onCommit,
  onCancel,
}: {
  value: string;
  leading?: React.ReactNode;
  onCommit(next: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  /* Claimed twice: the menu that opened this row unmounts in the same commit, and
     the focus its overlay hands back can land after the first attempt. */
  useLayoutEffect(() => {
    const claim = () => {
      if (document.activeElement === input.current) return;
      input.current?.focus();
      input.current?.select();
    };
    claim();
    const frame = requestAnimationFrame(claim);
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = input.current?.value.trim() ?? "";
    if (next && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <div className={cn(SPAR_SIDEBAR_ROW, "bg-[var(--sidebar-accent-active)] text-foreground")}>
      {leading}
      <input
        ref={input}
        aria-label="Rename"
        className="min-w-0 flex-1 bg-transparent text-ui outline-none"
        defaultValue={value}
        maxLength={120}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            committed.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}

/** A 6px dot in a 14px box, so a row with a status marker and one without still
 *  line their labels up. */
export function SparStatusDot({ tone = "muted", className }: { tone?: "muted" | "active" | "success" | "warning"; className?: string }) {
  return (
    <span className={cn("grid size-3.5 shrink-0 place-items-center", className)}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "success"
            ? "bg-[var(--construct-success)]"
            : tone === "warning"
              ? "bg-[var(--construct-warning)]"
              : tone === "active"
                ? "bg-foreground/70"
                : "bg-muted-foreground/45",
        )}
      />
    </span>
  );
}

/**
 * The one search field the sidebar uses, wherever it filters a list.
 *
 * There were three of these — 44px, 32px, and Opaline's own — at three radii and
 * three text sizes, which is most of why the sidebar read as a different app on
 * every surface. This is a 28px row like everything else in the column, so a
 * field above a list of rows is the same height as the rows it filters.
 *
 * The clear button appears only once there is something to clear: a permanent ✕
 * in an empty field is a control that does nothing most of the time.
 */
export function SparSidebarSearch({
  value,
  onChange,
  placeholder = "Search",
  ariaLabel,
  className,
}: {
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2",
        "transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--border-strong)]",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground/60" />
      <input
        aria-label={ariaLabel ?? placeholder}
        className="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-muted-foreground/60"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value.length > 0 && (
        <button
          aria-label="Clear search"
          className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground"
          onClick={() => onChange("")}
          type="button"
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  );
}

/** The small square control that lives in a section header's hover gutter. */
export function SparSidebarHeaderButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "app-no-drag inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
        className,
      )}
      type="button"
      {...props}
    />
  );
}
