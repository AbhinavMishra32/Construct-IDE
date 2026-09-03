import { cn } from "@/lib/utils";

/**
 * A pane with nothing in it yet.
 *
 * Empty states never invent data. Each one says exactly what has to happen
 * before content appears, so an empty pane is never mistaken for a broken one.
 *
 * On the drawing of it: no dashed box, and no icon in a bordered chip. Both were
 * here, and both are the same mistake — a placeholder drawn as an object. A
 * dashed rectangle is a shape that says "content goes here" to the person who
 * built the screen and "something is missing" to the person using it, and it
 * puts a hard edge around the emptiest part of the window, which is the one
 * place a hard edge has nothing to hold. The framed glyph then reads as a
 * button that cannot be pressed.
 *
 * So it is a centred column on the pane's own surface: a quiet mark, a real
 * heading, one line, and the action that fills the screen. Nothing is outlined.
 * The emptiness is allowed to be empty, which is what the window looks like
 * everywhere else that has room in it.
 *
 * `compact` is for a placeholder inside a pane that is part of a larger layout,
 * where the answer is somewhere else on the same screen — no mark, no action,
 * and set quietly enough that it does not compete with the thing it is pointing
 * at.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
  className,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  /** A keyboard shortcut, under the action. Only where one exists: a hint that
   *  has to be invented is decoration. */
  hint?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className={cn("px-6 text-center", className)}>
        <p className="text-content text-muted-foreground">{title}</p>
        <p className="mx-auto mt-0.5 max-w-[22rem] text-balance text-ui text-muted-foreground/75">{description}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center px-8 py-20 text-center", className)}>
      {/* Unframed, and at the size of a mark rather than of an icon. Set well
          back: it is there to say what kind of screen this is at a glance, and
          it is the one thing here nobody needs to look at twice. */}
      <Icon className="size-6 text-muted-foreground/40" />
      <h2 className="mt-3.5 text-title font-medium tracking-[-0.01em] text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-[25rem] text-balance text-content leading-[1.55] text-muted-foreground">{description}</p>
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
      {hint && <p className="mt-3 text-ui text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
