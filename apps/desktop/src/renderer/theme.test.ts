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
      /* Always matched, but the group is optional to the type system. */
      stack.push(at[1] ?? "at-rule");
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

/** The sRGB channel value of an achromatic `oklch(L 0 0)`.
 *
 *  With no chroma, Oklab's lightness is the cube root of relative luminance, so
 *  the whole conversion is one exponent and the sRGB transfer function. */
function grey(lightness: number): number {
  const luminance = lightness ** 3;
  return luminance <= 0.003_130_8 ? 12.92 * luminance : 1.055 * luminance ** (1 / 2.4) - 0.055;
}

/** Relative luminance of an sRGB channel value. */
function relative(channel: number): number {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** What a translucent token actually measures once it is on its own ground.
 *
 *  Alpha blends in sRGB, which is the whole reason the two themes cannot share
 *  a number: a light ground is already near the top of that range, so ink at a
 *  given alpha lands much closer to its background than white at the same alpha
 *  does to a dark one. `dim` is a Tailwind opacity modifier — `/70` mixes the
 *  token with transparent, which scales its alpha — because the interface
 *  stacks those on top of the token and the result is what a reader gets. */
function contrast(token: { lightness: number; alpha: number }, ground: number, dim = 1): number {
  const behind = grey(ground);
  const alpha = token.alpha * dim;
  const composite = grey(token.lightness) * alpha + behind * (1 - alpha);
  const [a, b] = [relative(composite), relative(behind)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Reads one `oklch(L% 0 0[ / A%])` token out of a theme block. The grounds are
 *  written without an alpha, being what everything else is measured against. */
function token(block: string, name: string): { lightness: number; alpha: number } {
  const found = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)% 0 0(?: / ([\\d.]+)%)?\\)`).exec(block);
  if (!found) throw new Error(`${name} is not an achromatic oklch token`);
  return { lightness: Number(found[1]) / 100, alpha: found[2] === undefined ? 1 : Number(found[2]) / 100 };
}

/**
 * The transcript's quiet text, measured rather than eyeballed.
 *
 * These tokens were written as one alpha per role, shared in spirit across both
 * themes, and the spirit is what went wrong: 0.8.2 shipped tool rows at 44%
 * black on a 97% ground, which measures 3.2:1, against the same rows at 50%
 * white on a dark ground, which measures 5.2:1. The light theme looked broken
 * and no individual value looked wrong.
 *
 * So the pairing is the thing under test. Dark is treated as the reference
 * because it is the one nobody complained about, and light has to reach the
 * same contrast — by whatever alpha that takes.
 */
describe("the transcript reads as well in light as it does in dark", () => {
  const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const dark = css.slice(css.indexOf(".dark {"));
  const LIGHT_GROUND = token(light, "--app-window-fill").lightness;
  const DARK_GROUND = token(dark, "--app-window-fill").lightness;

  for (const name of ["--transcript-step", "--transcript-step-strong", "--transcript-step-mark", "--muted-foreground"]) {
    it(`${name} measures the same in both themes`, () => {
      const inLight = contrast(token(light, name), LIGHT_GROUND);
      const inDark = contrast(token(dark, name), DARK_GROUND);
      /* Compared as a proportion, not as a difference. Contrast is a ratio, and
         half a point apart at 11:1 is two identical-looking greys where the same
         half point at 3:1 is one legible and one not. */
      const apart = Math.max(inLight, inDark) / Math.min(inLight, inDark) - 1;
      expect(apart, `light ${inLight.toFixed(2)}:1, dark ${inDark.toFixed(2)}:1`).toBeLessThan(0.1);
    });
  }

  /* A row of steps is body text, whatever it is a step toward. */
  it("keeps a tool row at 4.5:1 or better, which is the floor for reading it", () => {
    expect(contrast(token(light, "--transcript-step"), LIGHT_GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(dark, "--transcript-step"), DARK_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  /* Marks are shapes, and a shape reads at 3:1. Held separately so a future
     "the icons are too loud" never takes them below the point of being icons. */
  it("keeps a row's mark at 3:1, which is the floor for seeing what it is", () => {
    expect(contrast(token(light, "--transcript-step-mark"), LIGHT_GROUND)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "--transcript-step-mark"), DARK_GROUND)).toBeGreaterThanOrEqual(3);
  });

  /* The interface dims this token further at the call site, so the token alone
     passing is not the same as the interface passing. `/70` is the deepest
     modifier the transcript uses on text. */
  it("leaves muted text legible after the interface dims it to /70", () => {
    expect(contrast(token(light, "--muted-foreground"), LIGHT_GROUND, 0.7)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "--muted-foreground"), DARK_GROUND, 0.7)).toBeGreaterThanOrEqual(3);
  });
});
