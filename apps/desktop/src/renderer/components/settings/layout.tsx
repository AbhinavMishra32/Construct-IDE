import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Settings page's structural vocabulary.
 *
 * Five pieces, and the whole page is built from them: a header, a titled
 * section, a card of rows, a row, and the row's two halves — the label on the
 * left and whatever control answers it on the right. Nothing here holds state
 * or knows what a provider is; the pages compose these and supply the content.
 *
 * The rules that matter are the ones you cannot see in any single row. The card
 * is negatively inset (`-mx-3.5`) so its rows sit flush with the column's
 * reading edge while the section heading above it does not. Rows are divided by
 * a hairline in light and by a gap in dark, because on a dark ground a
 * translucent surface separated by a gap reads as stacked material and a drawn
 * line reads as a table. And the control slot is capped rather than sized, so a
 * long select and a switch land on the same right edge.
 */

/** The page title. The size and weight live here rather than on each page's
 *  `h1`, so no page can drift off the scale by writing its own. */
export function SettingsHeader({ children }: { children: React.ReactNode }) {
  return <header className="[&_h1]:font-display mb-6 [&_h1]:text-2xl [&_h1]:font-[450]">{children}</header>;
}

/** A titled band of the page. The title is optional: a section that opens the
 *  page often needs no label, because the `h1` above it is already the label. */
export function SettingsSection({
  children,
  id,
  title,
}: {
  children: React.ReactNode;
  id?: string;
  title?: string;
}) {
  return (
    <section data-settings-section={title} id={id}>
      {title && <h2 className="font-display text-muted-foreground/80 mb-2 text-sm font-[550]">{title}</h2>}
      {children}
    </section>
  );
}

/** The card. Two of them stacked inside one section get a gap rather than a
 *  merge, so a section can hold related groups without becoming one long list. */
export function SettingsGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "divide-border -mx-3.5 divide-y overflow-hidden rounded-xl smooth-shadow-ring-sm dark:space-y-px dark:divide-y-0 dark:bg-transparent [&+&]:mt-2",
        className,
      )}
    />
  );
}

/** One row. `min-h-13` rather than a fixed height: a row with a two-line
 *  description grows, and a row with a bare switch does not. */
export function SettingsRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn("bg-surface-secondary flex min-h-13 items-center gap-3 p-2.5", className)} />;
}

/** A row that is itself the control — the whole surface is the hit target, so
 *  it takes a hover and a pointer the way a menu item does. */
export function SettingsRowButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "bg-surface-secondary flex min-h-13 w-full items-center gap-3 p-2.5 text-left outline-none",
        "dark:hover:bg-accent cursor-default hover:bg-neutral-100",
        className,
      )}
    />
  );
}

/** The left half: what the row is, and one line on why you would touch it. */
export function SettingsField({
  description,
  title,
}: {
  description?: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <div className="min-w-0 grow px-1">
      <h4 className="text-foreground text-sm font-medium" data-settings-field={typeof title === "string" ? title : undefined}>
        {title}
      </h4>
      {description && <p className="text-muted-foreground text-xs font-medium">{description}</p>}
    </div>
  );
}

/** The right half. Capped at `max-w-40` and right-aligned so every control in a
 *  card ends on the same line no matter how wide its content wants to be. */
export function SettingsControl({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn("flex max-w-40 min-w-0 shrink justify-end", className)} />;
}
