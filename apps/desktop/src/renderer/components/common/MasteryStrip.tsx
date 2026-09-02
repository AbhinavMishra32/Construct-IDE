import { masteryTitle } from "@/lib/mastery";
import { cn } from "@/lib/utils";

/**
 * What a project has actually taught you, as one strip.
 *
 * One block per concept, tinted by the level it is held at and sorted strongest
 * first. Two facts fall out of the same picture: how much ground the project
 * covers (how long the strip is) and how well you hold it (how far the colour
 * carries before it fades). A count alone answers neither — twenty concepts at
 * level 1 and twenty at level 4 are not the same project.
 *
 * The blocks are the app's own mark at strip scale: same coursing, same mortar,
 * so a project card reads as a course of the wall the icon draws — and, like the
 * icon's courses, they carry the level as tone rather than as hue.
 *
 * That is a deliberate departure from `--mastery-0…5`, which every other surface
 * uses. The ramp is a hue ramp because everywhere else a level is a label on one
 * concept, where hue is exactly right. Here thirty of them sit shoulder to
 * shoulder and the ramp smears into a candy stripe that reads as decoration. The
 * question this strip answers is not "what level is that one" but "how much of
 * this do you hold", and an aggregate has to be one material to be read at a
 * glance. The level is still named on hover, where the label belongs.
 *
 * Above `MAX` the blocks would be thinner than a mortar joint and the strip
 * would read as a solid bar, so it stops there and the remainder is counted in
 * text beside it. Truncating silently would be the one thing worse than a bar.
 */
const MAX = 32;

/** Level to ink, as a percentage of the foreground. Level 0 is met-but-not-held
 *  and has to stay visible as a laid block rather than disappearing into the
 *  card, so the floor is well above nothing. */
const TONE = [16, 30, 44, 58, 74, 92];

export function MasteryStrip({ className, levels }: { className?: string; levels: number[] }) {
  const held = [...levels].sort((a, b) => b - a);
  const shown = held.slice(0, MAX);

  if (shown.length === 0) {
    return (
      <div
        aria-label="Nothing learned yet"
        className={cn("h-2 rounded-[3px] border border-dashed border-border/70", className)}
        role="img"
      />
    );
  }

  return (
    <div
      aria-label={`${levels.length} concepts`}
      className={cn("flex h-2 items-stretch gap-px", className)}
      role="img"
    >
      {shown.map((level, index) => (
        <span
          className="min-w-[2px] flex-1 rounded-[2px]"
          // Concepts have no stable order here — they are sorted by level for
          // display — so the index is the identity the list actually has.
          key={index}
          style={{ background: `color-mix(in oklab, var(--foreground) ${TONE[Math.min(5, Math.max(0, Math.round(level)))]}%, transparent)` }}
          title={masteryTitle(level)}
        />
      ))}
    </div>
  );
}
