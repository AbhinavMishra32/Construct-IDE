import { rubricForLevel } from "@construct/domain";

/**
 * Mastery, as colour.
 *
 * The ramp itself lives in `theme.css` as `--mastery-0` … `--mastery-5`; this is
 * the only place that turns a level into one. Four surfaces draw a level — the
 * sidebar list, the transcript card, the atlas, the entry masthead — and a ramp
 * that is spelled out at each of them is a ramp that drifts at three of them.
 *
 * Returned as a `var()` string rather than a Tailwind class because the atlas
 * paints to a canvas, where a class is no use: it resolves these against the
 * live computed style so the ramp still follows the theme.
 */
export function masteryColor(level: number): string {
  const step = Math.min(5, Math.max(0, Math.round(level)));
  return `var(--mastery-${step})`;
}

/** The level's name, from the rubric the agent is held to. */
export function masteryTitle(level: number): string {
  return rubricForLevel(level).title;
}

/** Whether Construct will set work on an idea at this level. */
export function taskReady(level: number): boolean {
  return rubricForLevel(level).taskReady;
}

/**
 * The ramp resolved to real colours, for the canvas.
 *
 * `getComputedStyle` on the document element is how a canvas reads a theme: it
 * cannot use a `var()`, and hard-coding the six values here would be a second
 * copy of the ramp free to drift from the first. Read once per mount and again
 * when the theme flips.
 */
export function resolveMasteryRamp(root: HTMLElement = document.documentElement): string[] {
  const style = getComputedStyle(root);
  return [0, 1, 2, 3, 4, 5].map((step) => style.getPropertyValue(`--mastery-${step}`).trim() || "#888");
}

/** One token from the theme, resolved the same way and for the same reason. */
export function resolveToken(name: string, root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(name).trim();
}
