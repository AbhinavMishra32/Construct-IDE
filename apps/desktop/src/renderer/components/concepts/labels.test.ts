import { describe, expect, it } from "vitest";
import { fit, wrap, type Measurer } from "./labels";

/** A monospace measurer: six pixels a character. Enough to test the logic, and
 *  it makes every expectation below arithmetic rather than a guess about SF Pro. */
const context: Measurer = { measureText: (text: string) => ({ width: text.length * 6 }) } as Measurer;

describe("fit", () => {
  it("leaves text that already fits alone", () => {
    expect(fit(context, "short", 120)).toBe("short");
  });

  it("trims to the room and marks that it did", () => {
    const trimmed = fit(context, "a very long concept title indeed", 60);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed.length * 6).toBeLessThanOrEqual(60);
  });

  it("never leaves a space before the ellipsis", () => {
    expect(fit(context, "one two three", 30)).not.toMatch(/ …$/);
  });

  it("gives up rather than printing a bare ellipsis in no room at all", () => {
    expect(fit(context, "anything", 0)).toBe("");
    expect(fit(context, "anything", 3)).toBe("");
  });
});

describe("wrap", () => {
  it("returns one line when one line is enough", () => {
    expect(wrap(context, "Object types", 120, 2)).toEqual(["Object types"]);
  });

  it("breaks on words, not mid-word", () => {
    const lines = wrap(context, "Testing with assertions", 84, 2);
    expect(lines).toEqual(["Testing with", "assertions"]);
  });

  it("keeps every line inside the measure", () => {
    for (const line of wrap(context, "Function types: parameters and return values", 90, 2)) {
      expect(line.length * 6).toBeLessThanOrEqual(90);
    }
  });

  it("ellipsises the last line rather than running to a third", () => {
    const lines = wrap(context, "Testing with assertions and Node's built-in test runner", 90, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  it("cuts a single word too long to fit, because a wrapped identifier is worse", () => {
    const lines = wrap(context, "createProjectWorkspaceService", 60, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
  });

  it("holds to one line when that is all it is given", () => {
    const lines = wrap(context, "Testing with assertions and more", 60, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
  });

  it("draws nothing in no room", () => {
    expect(wrap(context, "anything", 0, 2)).toEqual([]);
  });
});
