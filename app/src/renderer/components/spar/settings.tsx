import type { ReactNode } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "../../lib/utils";

/**
 * The frame every settings screen sits in: one measure, one scroll, one heading
 * treatment.
 *
 * There were two of these. The landing screen had Spar's — a 42rem measure, a
 * 24.8px heading at -0.035em, and a deep bottom gutter so the last card is not
 * flush against the window — while every other page went through Opaline's
 * `SettingsPanel`, which brought its own heading size, its own top padding, and a
 * `bg-background` fill that stopped the window's material at the pane edge. Two
 * frames is why the deep pages read as a different app to the page that links to
 * them, and no amount of matching the cards inside fixes a heading that changes
 * size when you click into it.
 *
 * `app-settings-surface` is kept as the hook `spar-shell.css` reaches for.
 */
export function SparSettingsPage({
  title,
  subtitle,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("app-scroll app-settings-surface h-full min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="mx-auto w-full max-w-[42rem] px-6 pt-9 pb-20">
        {title != null && <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">{title}</h1>}
        {subtitle != null && <p className="mt-1 text-content text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}

/**
 * A labelled stack of rows. The label sits above the card, not inside it — the
 * card is then one uninterrupted surface instead of a header plus a body.
 *
 * Geometry copied from Spar's `Group` in `components/pages/SettingsPage.tsx`.
 */
export function SparSettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-7", className)}>
      {title != null && <h2 className="mb-2 px-0.5 text-ui font-medium text-muted-foreground">{title}</h2>}
      {description != null && (
        <p className="mb-2 px-0.5 text-ui leading-[1.6] text-muted-foreground/80">{description}</p>
      )}
      {children}
    </section>
  );
}

/** The card the rows live in: one surface, hairline-divided, sheet radius. */
export function SparSettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card shadow-[var(--app-shadow-card)]",
        className,
      )}
      data-slot="settings-card"
    >
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** A section and its card in one, for the common case of exactly one card. */
export function SparSettingsGroup({
  label,
  description,
  children,
  className,
}: {
  label?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SparSettingsSection
      className={className}
      {...(description == null ? {} : { description })}
      {...(label == null ? {} : { title: label })}
    >
      <SparSettingsCard>{children}</SparSettingsCard>
    </SparSettingsSection>
  );
}

/**
 * One row of a settings card, exactly as Spar draws it: a flex line with a 54px
 * floor, so a row holding only a title still lines up with one holding a title
 * and a description instead of the list looking unevenly spaced.
 *
 * Children are composed freely — this is a row, not a template. {@link
 * SparSettingsField} is the labelled arrangement most rows want, built on top.
 */
export function SparSettingsRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[3.375rem] items-center gap-3 px-3.5 py-2", className)} data-slot="settings-row">
      {children}
    </div>
  );
}

/**
 * The labelled arrangement: copy on the left, control on the right, and anything
 * wider than a control on its own line underneath.
 *
 * The control drops below the copy when the pane is too narrow to hold both, so a
 * dragged-in sidebar does not squeeze a select down to nothing.
 */
export function SparSettingsField({
  title,
  description,
  control,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <SparSettingsRow className={cn(children ? "flex-col items-stretch gap-2.5 py-3" : undefined, className)}>
      <div className="flex w-full min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {(title != null || description != null) && (
          <div className="min-w-0 flex-1">
            {title != null && <p className="text-content font-medium">{title}</p>}
            {description != null && (
              <p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        {control != null && (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">{control}</div>
        )}
      </div>
      {children}
    </SparSettingsRow>
  );
}

/**
 * The macOS switch: a 26x16 track with a raised 12px knob.
 *
 * Smaller than the web default, because at chrome size a 44px switch is the
 * loudest thing on a settings screen — and every row that has one would then be
 * shouting over the rows that do not.
 */
export function SparSettingsToggle({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  /** Optional: a disabled switch reporting a fixed runtime guarantee has nothing
   *  to call, and requiring a no-op handler for it is ceremony. */
  onCheckedChange?(next: boolean): void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <SwitchPrimitive.Root
      aria-label={ariaLabel}
      checked={checked}
      className={cn(
        "peer inline-flex h-4 w-[1.625rem] shrink-0 cursor-default items-center rounded-full p-px transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50",
        "data-[state=checked]:bg-[var(--construct-success)] data-[state=unchecked]:bg-[var(--color-background-elevated-secondary)]",
        "data-[state=unchecked]:inset-shadow-[0_1px_0_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]",
      )}
      data-slot="settings-toggle"
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0%_0_0/25%)] ring-0",
          "transition-transform data-[state=checked]:translate-x-[0.625rem] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

/**
 * A standing fact about the runtime rather than something to change: the claim on
 * the left, the state that backs it on the right.
 */
export function SparSettingsBoundary({
  title,
  detail,
  badge,
  tone = "muted",
}: {
  title: ReactNode;
  detail: ReactNode;
  badge: ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <SparSettingsRow className="items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-content font-medium">{title}</p>
        <p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">{detail}</p>
      </div>
      <span
        className={cn(
          "mt-px inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm",
          tone === "success" ? "text-[var(--construct-success)]" : "text-muted-foreground",
        )}
      >
        {badge}
      </span>
    </SparSettingsRow>
  );
}
