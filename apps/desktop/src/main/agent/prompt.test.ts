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
  /* This asserted byte-identity with v0.7 until the prompt was first changed on
     purpose — the reply-shaping rules below. Identity was the right guard for a
     port and the wrong one for a prompt that is now being developed, so it has
     become a containment check instead: every line v0.7 taught with must still
     be here, and anything this file does not name as a deliberate change is a
     regression. An accidental reflow or find-and-replace still fails. */
  const REPLACED = [
    "- Prefer short, conversational paragraphs. Use lightweight structure only when it genuinely reduces cognitive load. The learner should feel guided through a project, not assigned reading from documentation.",
    /* v0.7 reached the concept tree through `fetch-concepts includeTree` before
       calling `add-concept`. Construct has neither tool: concepts are recorded
       with `record-concept`, and the tree is printed in the project state on
       every turn, so the fetch this line asks for cannot be made and would not
       be needed if it could. The instruction it carries — placement is
       architecture, pick the narrowest parent that owns the model — is kept
       verbatim in the line that replaced it. */
    /* One character: v0.7 wrote "natural and dynamic—do not force", and the em
       dash is the thing the learner objected to seeing in the transcript. A
       prompt that models the punctuation it forbids is a prompt the model will
       follow twice, so the instruction reads "dynamic, and do not force". */
    "- When asking questions, Socratic checks, or creating exercises about knowledge the learner gained from a concept or the chat history, anchor and nudge the learner by referencing that context (e.g., \"Recall from the concept card we just discussed...\" or \"Building on our chat about X...\"). Do not ask dry, completely out-of-context questions about arbitrary files or setups unless they are anchored in the current project or what was just explained. However, keep this progression natural and dynamic\u2014do not force a rigid or mechanical reference to concepts every time.",
    "- Before add-concept, inspect the current project concept tree. If the full tree and candidate parents are not already visible in the prompt or current tool output, call fetch-concepts with includeTree true and a query for the proposed concept. Treat concept placement as architecture: choose the narrowest existing parent that already owns the mental model, then make the new concept a child of that parent.",
  ];

  it("still carries every line of the v0.7 prompt it was ported from", () => {
    /* Read from the archived tree rather than a copied fixture: a fixture would
       be a second copy that could drift with the first, which is the thing this
       test is meant to prevent. */
    const legacy = path.resolve(import.meta.dirname, "../../../../../legacy/v0.7/app/src/main/flow/ConstructFlowService.ts");
    const raw = readFileSync(legacy, "utf8");

    const marker = "export const FLOW_MAIN_AGENT_PROMPT = `";
    const original = raw.slice(raw.indexOf(marker) + marker.length, raw.lastIndexOf("`"));

    const missing = original
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((line) => !REPLACED.includes(line))
      .filter((line) => !CONSTRUCT_AGENT_PROMPT.includes(line));

    expect(missing).toEqual([]);
  });

  /* The house style, enforced. The learner has objected to em dashes in the
     transcript three times, and a model matches the punctuation of the text it
     is given as readily as it follows the instruction in it. */
  it("neither uses nor allows the punctuation it forbids", () => {
    expect(CONSTRUCT_AGENT_PROMPT).not.toMatch(/[\u2014\u2013]/);
    expect(CONSTRUCT_AGENT_PROMPT).toContain("No em dashes or en dashes anywhere");
  });

  /* Concept nesting. The tree is only as good as the agent's willingness to
     place things in it, and a model given an optional parent will file
     everything at the top unless told plainly not to. */
  it("tells the agent to nest concepts under a parent", () => {
    for (const rule of ["pass its id as parentId on record-concept", "Nest as deep as the subject actually goes"]) {
      expect(CONSTRUCT_AGENT_PROMPT).toContain(rule);
    }
  });

  /* The reply-shaping rules. Undifferentiated paragraphs are the hardest thing
     to read in a narrow panel and hide what to do next, so the agent is told to
     use the structure the transcript can render. */
  it("tells the agent to shape replies with markdown", () => {
    for (const rule of ["A short \"###\" heading", "A numbered list for steps", "for every filename, path, identifier"]) {
      expect(CONSTRUCT_AGENT_PROMPT).toContain(rule);
    }
    /* And not to overdo it, which is the failure mode of asking for structure. */
    expect(CONSTRUCT_AGENT_PROMPT).toContain("a two-sentence answer stays two sentences");
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
