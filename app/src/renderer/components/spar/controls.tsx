import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

/**
 * macOS-style segmented control: one sunken track with a single raised thumb
 * that slides between equal-width segments. Equal widths are what let the thumb
 * be pure CSS — no measuring, so it lands correctly on the first paint.
 */
export function SparSegmented<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange(value: T): void;
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  value: T;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "relative grid shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-background-elevated-secondary)] p-0.5",
        "inset-shadow-[0_1px_0_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      role="radiogroup"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-background shadow-[0_1px_2px_oklch(0%_0_0/8%)] transition-[left] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
        style={{
          left: `calc(0.125rem + ${index} * ((100% - 0.25rem) / ${options.length}))`,
          width: `calc((100% - 0.25rem) / ${options.length})`,
        }}
      />
      {options.map(({ value: option, label, icon: Icon }) => (
        <button
          aria-checked={option === value}
          className={cn(
            "relative z-10 inline-flex h-7 items-center justify-center gap-1.5 px-2.5 text-ui font-medium transition-colors",
            option === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          key={option}
          onClick={() => option !== value && onChange(option)}
          role="radio"
          type="button"
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export type SparViewOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Live status for the view you are not looking at — a count, a dot, a spinner. */
  badge?: React.ReactNode;
};

/**
 * A tab control shaped like a macOS segmented switch: one sunken track, one
 * raised thumb that slides between equal-width segments.
 *
 * Tabs rather than radios, because these swap what the panel is showing rather
 * than set a value — which is also why the keyboard contract is the tablist one
 * (arrows move between tabs, Home/End jump to the ends).
 */
export function SparViewSwitch<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange(value: T): void;
  options: Array<SparViewOption<T>>;
  value: T;
}) {
  const list = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const keydown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step ? index + step : -1;
    if (next < 0 || next > options.length - 1) return;
    event.preventDefault();
    onChange(options[next]!.value);
    // Selection follows focus, so the newly selected tab has to take it.
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={list}
      aria-label={ariaLabel}
      className={cn(
        "relative grid shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-background-elevated-secondary)] p-0.5",
        className,
      )}
      onKeyDown={keydown}
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-background shadow-[0_1px_2px_oklch(0%_0_0/8%)] transition-[left] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
        style={{
          left: `calc(0.125rem + ${index} * ((100% - 0.25rem) / ${options.length}))`,
          width: `calc((100% - 0.25rem) / ${options.length})`,
        }}
      />
      {options.map(({ value: option, label, icon: Icon, badge }) => {
        const selected = option === value;
        return (
          <button
            aria-selected={selected}
            className={cn(
              "relative z-10 inline-flex h-6 items-center justify-center gap-1.5 px-2 text-ui font-medium transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            key={option}
            onClick={() => !selected && onChange(option)}
            role="tab"
            // Only the selected tab is in the tab order; arrows move within.
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {Icon && <Icon className="size-3.5" />}
            <span className="truncate">{label}</span>
            {badge}
          </button>
        );
      })}
    </div>
  );
}

export type SparMeterBand = { key: string; value: number; className: string; label: string };

/**
 * A proportional bar, drawn as separated bands rather than one gradient so the
 * parts stay countable — the whole point is reading how much of each, not just
 * how far along.
 *
 * Bands grow from zero on mount. Progress that is simply *there* on the first
 * frame reads as a static graphic; a short grow says it was measured.
 */
export function SparMeter({
  bands,
  className,
  height = "0.5rem",
  total: given,
  animate = true,
}: {
  bands: SparMeterBand[];
  className?: string;
  height?: string;
  /** Denominator when the bands are a fraction of a known whole. */
  total?: number;
  /**
   * Off when the meter is one of many. A single bar growing is a measurement
   * settling; a list of them growing together is a page that shudders on mount.
   */
  animate?: boolean;
}) {
  const sum = bands.reduce((acc, band) => acc + band.value, 0);
  const total = Math.max(given ?? sum, sum);
  const [grown, setGrown] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  return (
    <div
      className={cn(
        "flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--color-background-elevated-secondary)]",
        className,
      )}
      style={{ height }}
    >
      {total === 0
        ? null
        : bands
            .filter((band) => band.value > 0)
            .map((band, index) => (
              <span
                key={band.key}
                className={cn(
                  "h-full rounded-full transition-[width] duration-[520ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none",
                  band.className,
                )}
                style={{
                  width: grown ? `${(band.value / total) * 100}%` : "0%",
                  // Bands settle in sequence, so the eye reads them as ordered
                  // rather than as one block arriving.
                  transitionDelay: `${index * 55}ms`,
                }}
                title={`${band.label}: ${band.value}`}
              />
            ))}
    </div>
  );
}

/**
 * Empty states never invent data. Each one says exactly what has to happen
 * before content appears, so an empty pane is never mistaken for a broken one.
 */
export function SparEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-8 text-center",
        compact ? "py-10" : "min-h-[18rem] py-16",
        className,
      )}
    >
      <span className="mb-3 grid size-9 place-items-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <p className="text-content font-medium">{title}</p>
      <p className="mt-1 max-w-[26rem] text-ui leading-[1.6] text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
