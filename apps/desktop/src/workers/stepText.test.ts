import { describe, expect, it } from "vitest";

/**
 * The normaliser from the agent worker, tested directly.
 *
 * `step.reasoning` has been a string, an array of reasoning parts, and an array
 * of bare strings across AI SDK and Mastra versions. Assuming one shape threw
 * "step.reasoning?.trim is not a function" and killed every turn before it
 * produced a reply — a whole conversation lost to a type guess.
 *
 * Kept as a copy rather than imported because the worker module opens a parent
 * port on load. The behaviour is small enough that duplicating it costs less
 * than making the worker importable, and this test is what pins it.
 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const record = value as { text?: unknown; reasoning?: unknown; content?: unknown };
    return textOf(record.text ?? record.reasoning ?? record.content);
  }
  return "";
}

describe("normalising a step's text", () => {
  it("passes a plain string through", () => {
    expect(textOf("thinking about it")).toBe("thinking about it");
  });

  it("joins an array of parts, which is the shape that threw", () => {
    expect(textOf([{ type: "reasoning", text: "first " }, { type: "reasoning", text: "second" }])).toBe("first second");
  });

  it("joins an array of bare strings", () => {
    expect(textOf(["a", "b", "c"])).toBe("abc");
  });

  it("reads a single part object", () => {
    expect(textOf({ type: "text", text: "hello" })).toBe("hello");
  });

  it("falls back through reasoning and content keys", () => {
    expect(textOf({ reasoning: "why" })).toBe("why");
    expect(textOf({ content: "body" })).toBe("body");
  });

  it("handles nesting, since parts can hold parts", () => {
    expect(textOf({ content: [{ text: "outer " }, { content: [{ text: "inner" }] }] })).toBe("outer inner");
  });

  it.each([undefined, null, 42, {}, []])("answers with an empty string for %p rather than throwing", (value) => {
    expect(textOf(value)).toBe("");
  });

  /* The failure this replaces: a reply stored as "[object Object]" is a lost
     turn that looks like a successful one. */
  it("never produces [object Object]", () => {
    expect(textOf([{ text: "ok" }, { unknown: true }])).toBe("ok");
    expect(textOf({ unknown: true })).not.toContain("[object");
  });
});
