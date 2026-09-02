import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Comments go first and are not searched: this file's own prose names the
   at-rules it is checking for, and so does theme.css's. */
const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The at-rules still open at `index`, outermost first. */
function enclosingAtRules(index: number): string[] {
  const stack: string[] = [];
  let i = 0;
  while (i < index) {
    const at = /^@([a-zA-Z-]+)[^;{}]*\{/.exec(css.slice(i, index));
    if (at) {
      stack.push(at[1]);
      i += at[0].length;
      continue;
    }
    if (css[i] === "{") stack.push("");
    if (css[i] === "}") stack.pop();
    i += 1;
  }
  return stack.filter(Boolean);
}

/**
 * Where a declaration sits relative to `@layer` decides whether it is applied
 * at all, and nothing about the source says so at a glance. The window-chrome
 * tokens are the case where getting it wrong is invisible on the machine doing
 * the writing and broken on the one running the build: `:root` declares the
 * macOS reservation unlayered, so a platform override tucked inside a layer
 * loses to it however specific its selector is. Construct 0.8 shipped that way
 * — on Windows the sidebar kept a 6rem inset for traffic lights that are not
 * there, and reserved nothing for the caption buttons it does have, so the
 * toolbar's own controls sat underneath minimise/maximise/close.
 */
describe("window chrome tokens", () => {
  for (const selector of ['[data-window-controls="right"]', '[data-window-controls="none"]']) {
    it(`declares ${selector} outside every @layer, so it can beat the unlayered :root`, () => {
      const index = css.indexOf(`:root${selector}`);
      expect(index, `${selector} is not declared at all`).toBeGreaterThan(-1);
      expect(enclosingAtRules(index)).toEqual([]);
    });
  }

  it("reserves the trailing edge where the Windows caption buttons are", () => {
    const block = css.slice(css.indexOf(':root[data-window-controls="right"]'));
    const trailing = /--window-controls-trailing:\s*([^;]+);/.exec(block)?.[1] ?? "";
    // Whatever the width is derived from, it may not be zero: that is the overlap.
    expect(trailing).not.toMatch(/^0/);
    expect(/--window-controls-leading:\s*0/.test(block)).toBe(true);
  });
});
