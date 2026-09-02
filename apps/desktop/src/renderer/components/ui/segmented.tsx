import { cn } from "@/lib/utils";

/**
 * macOS-style segmented control: one sunken track with a single raised thumb
 * that slides between equal-width segments. Equal widths are what let the thumb
 * be pure CSS — no measuring, so it lands correctly on the first paint.
 */
/** Two scales. `sm` exists for the sidebar, where the control has to share the
 *  narrowest column in the window with a button and still fit its labels. */
const SIZES = {
  md: { button: "h-7 px-2.5 text-ui", icon: "size-3.5" },
  sm: { button: "h-6 px-1.5 text-ui-sm", icon: "size-3" },
} as const;

export function Segmented<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  size = "md",
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange(value: T): void;
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  size?: "sm" | "md";
  value: T;
}) {
  const scale = SIZES[size];
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
            "relative z-10 inline-flex min-w-0 items-center justify-center gap-1.5 font-medium transition-colors",
            scale.button,
            option === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          key={option}
          onClick={() => option !== value && onChange(option)}
          role="radio"
          type="button"
        >
          {Icon && <Icon className={scale.icon} />}
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}
