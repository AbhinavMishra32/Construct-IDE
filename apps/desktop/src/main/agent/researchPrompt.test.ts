import { describe, expect, it } from "vitest";
import { openingRequest, researchDocument, researchRequest, wroteResearch } from "./researchPrompt.js";

const step = (overrides: Partial<{ kind: string; tool: string; ok: boolean; input: string }> = {}) => ({
  kind: "tool",
  tool: "flow-memory-patch",
  ok: true,
  input: JSON.stringify({ patches: [{ file: "research.md" }] }),
  ...overrides,
});

describe("did the research get saved", () => {
  it("sees a successful patch to research.md", () => {
    expect(wroteResearch(step())).toBe(true);
  });

  it("does not count a patch to another file", () => {
    expect(wroteResearch(step({ input: JSON.stringify({ patches: [{ file: "learner.md" }] }) }))).toBe(false);
  });

  it("does not count a patch that failed", () => {
    /* The point of the check is whether the file ended up written. A rejected
       patch — an ambiguous find, say — leaves it exactly as it was. */
    expect(wroteResearch(step({ ok: false }))).toBe(false);
  });

  it("does not count reading memory as writing it", () => {
    expect(wroteResearch(step({ tool: "flow-memory-fetch" }))).toBe(false);
  });

  it("does not count reasoning that merely mentions the file", () => {
    expect(wroteResearch(step({ kind: "reasoning", tool: "", input: "I should write research.md" }))).toBe(false);
  });
});

describe("the saved document", () => {
  it("wraps the reply with the handoff the mentor needs", () => {
    /* Without this paragraph the mentor treats research.md as background reading
       and asks the learner project-direction questions it already has answers
       to. */
    const document = researchDocument("Bytecode VMs dispatch through a loop over opcodes.");
    expect(document).toContain("# Research");
    expect(document).toContain("Mentor handoff");
    expect(document).toContain("Bytecode VMs dispatch through a loop over opcodes.");
  });

  it("trims the reply, so the file does not open on blank lines", () => {
    expect(researchDocument("\n\n  Findings.  \n\n")).toContain("\nFindings.");
  });
});

describe("what each run is asked for", () => {
  it("gives research the learner's own words for the goal", () => {
    const request = researchRequest({ name: "VM study", goal: "Understand opcode dispatch", language: "typescript" });
    expect(request).toContain("VM study");
    expect(request).toContain("Understand opcode dispatch");
    expect(request).toContain("typescript");
  });

  it("tells the mentor to start teaching rather than to greet and wait", () => {
    /* The learner has just typed what they want to build; asking them again is
       the failure this handoff exists to prevent. */
    const opening = openingRequest(true);
    expect(opening).toContain("research is complete");
    expect(opening).toContain("without waiting for another message");
  });

  it("says so when research did not run", () => {
    expect(openingRequest(false)).toContain("without prior research");
  });
});
