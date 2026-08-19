import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSTRUCT_AGENT_PROMPT } from "./prompt.js";

/**
 * The prompt is the teaching behaviour. These assertions exist so that an
 * accidental reflow, a find-and-replace, or an editor stripping trailing
 * whitespace fails here rather than quietly changing how Construct teaches.
 */
describe("the Construct agent prompt", () => {
  it("is byte-identical to the v0.7 prompt it was ported from", () => {
    /* Read from the archived tree rather than a copied fixture: a fixture would
       be a second copy that could drift with the first, which is the thing this
       test is meant to prevent. */
    const legacy = path.resolve(import.meta.dirname, "../../../../../legacy/v0.7/app/src/main/flow/ConstructFlowService.ts");
    const raw = readFileSync(legacy, "utf8");

    const marker = "export const FLOW_MAIN_AGENT_PROMPT = `";
    const original = raw.slice(raw.indexOf(marker) + marker.length, raw.lastIndexOf("`"));

    expect(CONSTRUCT_AGENT_PROMPT).toBe(original);
  });

  it("opens by naming what the agent is", () => {
    expect(CONSTRUCT_AGENT_PROMPT.startsWith("You are Construct Flow, an understanding-based coding mentor")).toBe(true);
  });

  /* The pedagogy rule is the whole product in one line. If a future edit ever
     removes it, Construct becomes a coding agent that happens to be chatty. */
  it("still forbids the agent from writing the learner's implementation", () => {
    expect(CONSTRUCT_AGENT_PROMPT).toContain("You must NEVER use write/edit to write the actual implementation");
    expect(CONSTRUCT_AGENT_PROMPT).toContain("You are not a code vending machine");
  });

  it("carries no interpolations, so run-mode text is appended rather than woven in", () => {
    expect(CONSTRUCT_AGENT_PROMPT).not.toMatch(/\$\{/);
  });
});
