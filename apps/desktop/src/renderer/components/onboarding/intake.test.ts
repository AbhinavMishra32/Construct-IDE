import { describe, expect, it } from "vitest";

import { answered, COPY, STEPS } from "./intake";

const draft = (overrides: Partial<Parameters<typeof answered>[1]> = {}) => ({
  name: "",
  ambition: "",
  leanings: [],
  followUpAnswer: "",
  modelReady: false,
  searchReady: false,
  ...overrides,
});

describe("the intake's shape", () => {
  it("has copy for every step", () => {
    for (const step of STEPS) expect(COPY[step]?.title).toBeTruthy();
  });

  it("asks for a model before anything that needs one", () => {
    expect(STEPS[0]).toBe("model");
  });

  it("asks about the web after the model and before the writing", () => {
    /* The key changes what Construct can find out, not whether it runs, so it
       comes after the step that decides that. It is also the last thing asked
       before the model has to write anything, which is what gives the adaptive
       question a step's worth of latency to arrive in. */
    expect(STEPS.indexOf("research")).toBeGreaterThan(STEPS.indexOf("model"));
    expect(STEPS.indexOf("research")).toBeLessThan(STEPS.indexOf("question"));
  });

  it("says its captions out loud", () => {
    /* No em dashes. The intake is Construct talking to a person for the first
       time, and a caption stitched together out of dashes is the one thing that
       makes it read as generated rather than written. */
    for (const step of STEPS) {
      const { title, caption } = COPY[step];
      expect(`${title} ${caption}`).not.toMatch(/[—–]/);
    }
  });

  it("ends on the portrait", () => {
    /* The order carries meaning: the adaptive question can only be written from
       the answers before it, and the portrait can only be written from that. */
    expect(STEPS[STEPS.length - 1]).toBe("portrait");
    expect(STEPS.indexOf("question")).toBeGreaterThan(STEPS.indexOf("leanings"));
    expect(STEPS.indexOf("portrait")).toBeGreaterThan(STEPS.indexOf("question"));
  });
});

describe("whether a step has been answered", () => {
  it("treats blank text as unanswered", () => {
    expect(answered("name", draft())).toBe(false);
    expect(answered("name", draft({ name: "  " }))).toBe(false);
    expect(answered("name", draft({ name: "Ada" }))).toBe(true);
  });

  it("wants more than a keystroke for the free-text answers", () => {
    expect(answered("ambition", draft({ ambition: "hi" }))).toBe(false);
    expect(answered("ambition", draft({ ambition: "a renderer" }))).toBe(true);
  });

  it("counts a leaning only once one is picked", () => {
    expect(answered("leanings", draft())).toBe(false);
    expect(answered("leanings", draft({ leanings: ["shape-first"] }))).toBe(true);
  });

  it("waits for a model before calling the first step done", () => {
    /* The one step whose answer is not typed. Nothing after it works without a
       provider — the adaptive question, the portrait, and every turn the
       learner will ever run all go through theirs. */
    expect(answered("model", draft())).toBe(false);
    expect(answered("model", draft({ modelReady: true }))).toBe(true);
  });

  it("treats the web-search key as something you can walk past", () => {
    /* Same shape as the model step, opposite consequence: unanswered here means
       the agent works from your own record only, not that it cannot answer. */
    expect(answered("research", draft())).toBe(false);
    expect(answered("research", draft({ searchReady: true }))).toBe(true);
  });

  it("calls the steps that start on a real value answered", () => {
    /* Footing, language and the portrait all open on a value rather than an
       empty one, so there is nothing on them that can be half-done — and
       labelling their button "Skip this" would be a lie about what pressing it
       does. */
    for (const step of ["footing", "language", "portrait"] as const) {
      expect(answered(step, draft())).toBe(true);
    }
  });
});
