/**
 * Setting text on a canvas, where there is no line box and nothing wraps itself.
 *
 * Both of these measure in the font that will actually draw the text rather than
 * counting characters, because a character count is a guess about a proportional
 * face: "Illiterate" and "Wallpaper" are the same ten letters and nowhere near
 * the same label. Their own module so they can be tested against a measurer, and
 * because they are the two things in the atlas that are about typesetting rather
 * than about space.
 */

/** How wide a label may be, in CSS pixels.
 *
 *  A cap, and a small one. A concept title is a sentence; set on one line it runs
 *  half the width of the pane, crosses whatever is behind it and turns the map
 *  into a bibliography. Titles wrap into this measure rather than growing to the
 *  room available. */
export const LABEL_WIDTH = 158;

/** Just the part of a 2D context these need, so a test can supply a measurer
 *  without standing up a canvas. */
export type Measurer = Pick<CanvasRenderingContext2D, "measureText">;

/**
 * Text cut to the pixels available.
 *
 * Binary search rather than a character at a time: this runs for every visible
 * node, every frame.
 */
export function fit(context: Measurer, text: string, room: number): string {
  if (room <= 0) return "";
  if (context.measureText(text).width <= room) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle).trimEnd()}…`).width <= room) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "";
}

/**
 * Breaks text into at most `maxLines` lines that each fit `room`, ellipsised if
 * it does not all fit.
 *
 * On word boundaries, cutting mid-word only for a single word too long to fit at
 * all — which in practice is a stray identifier, and a wrapped identifier reads
 * worse than a trimmed one.
 */
export function wrap(context: Measurer, text: string, room: number, maxLines: number): string[] {
  if (room <= 0) return [];
  if (context.measureText(text).width <= room) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= room) {
      line = candidate;
      continue;
    }
    /* Checked before the line is committed, not after. Pushing first and then
       asking whether there was room for another line meant a one-line budget
       never stopped: the first overflow pushed line one, so the count could
       never equal `maxLines - 1` again, and a long title came back as four
       lines nobody had asked for. */
    if (lines.length === maxLines - 1) {
      /* This line is the last, so it takes everything still to come, trimmed to
         fit — the ellipsis then lands where the text actually stopped rather
         than after whichever word happened to end near the edge. */
      lines.push(fit(context, [line, ...words.slice(index)].join(" ").trim(), room));
      return lines;
    }
    if (line) lines.push(line);
    line = word;
  }

  if (line) lines.push(fit(context, line, room));
  return lines;
}
