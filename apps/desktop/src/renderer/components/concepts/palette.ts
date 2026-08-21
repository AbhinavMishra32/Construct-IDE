/**
 * The atlas's colours.
 *
 * Two facts, two channels, and they do not fight:
 *
 *   · **Hue is the topic.** Every concept in a cluster shares one hue, so a
 *     bunch of wired dots reads as a bunch before a single label is read — which
 *     is the whole job of colour on a map with forty things on it.
 *   · **Value is mastery.** Within a hue, a concept the learner has only met is
 *     faint and washed out; one they can teach is deep and saturated. So a
 *     cluster shows its own progress as a gradient inside itself, and "I know a
 *     lot about one of these and nothing about the other three" is visible from
 *     across the room.
 *
 * This is deliberately not the mastery ramp used in the lists. There, with no
 * cluster to belong to, the level is all a colour can usefully say; here the
 * level is one of two things worth saying and the ramp would spend the whole of
 * colour on half the information.
 *
 * The direction of the value channel flips with the theme, because "more" has to
 * mean "more contrast against the page": on a dark ground mastery brightens, on
 * a light one it deepens. A single direction would have made the top of the ramp
 * the least visible thing in one of the two themes.
 */

/** The hues, in oklch degrees.
 *
 *  Eight, spaced far enough apart to survive both common colour-blindnesses, and
 *  ordered so that consecutive picks are not neighbours on the wheel — the first
 *  few topics a learner has are the ones that must not look alike. */
const TOPIC_HUES = [265, 150, 40, 205, 320, 95, 15, 240];

/** A small stable integer from a string. Duplicated from `atlas.ts` rather than
 *  imported to keep the palette free of the layout, and it is four lines. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** The hue a topic owns. Stable across launches, because a cluster that changes
 *  colour between sessions is a cluster you have to re-learn every time. */
export function topicHue(topic: string): number {
  return TOPIC_HUES[hash(topic) % TOPIC_HUES.length]!;
}

/**
 * The colour of one concept: its topic's hue, at the depth its level earns.
 *
 * Returned as an `oklch()` string so it works in a canvas fill and in a style
 * attribute without a second code path.
 */
export function conceptColor(topic: string, level: number, dark: boolean): string {
  const step = Math.min(5, Math.max(0, Math.round(level))) / 5;
  const hue = topicHue(topic);
  /* Chroma climbs with mastery either way: an idea barely met should look
     provisional, and a colour with no saturation in it is exactly that. */
  const chroma = 0.02 + step * 0.145;
  const lightness = dark ? 46 + step * 36 : 74 - step * 30;
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

/** The topic's own colour, at its best level — what a star burns at, and what
 *  the legend puts beside the topic's name. */
export function topicColor(topic: string, reach: number, dark: boolean): string {
  return conceptColor(topic, reach, dark);
}
