import { describe, expect, it } from "vitest";

import { describeStanding, dueForReview, freshnessOf, halfLifeFor, retentionAfter, type ConceptStanding } from "./learning.js";

/**
 * The forgetting model.
 *
 * These are assertions about shape rather than about numbers. The constants
 * behind them are a judgement call and will be tuned; what must not change is
 * the ordering — a firmer reading outlasts a shakier one, spaced practice
 * outlasts crammed practice, and nothing survives forever.
 */
describe("retention", () => {
  it("gives a firmer reading a longer half-life", () => {
    expect(halfLifeFor(5, 1)).toBeGreaterThan(halfLifeFor(3, 1));
    expect(halfLifeFor(3, 1)).toBeGreaterThan(halfLifeFor(1, 1));
  });

  /* The whole reason distinct days are counted rather than events. Four
     encounters in one sitting must not buy what four across four days does. */
  it("rewards spacing, and stops rewarding it eventually", () => {
    expect(halfLifeFor(3, 4)).toBeGreaterThan(halfLifeFor(3, 1));
    expect(halfLifeFor(3, 40)).toEqual(halfLifeFor(3, 400));
  });

  it("is whole on the day and decays from there", () => {
    expect(retentionAfter(3, 1, 0)).toBe(1);
    expect(retentionAfter(3, 1, 7)).toBeGreaterThan(retentionAfter(3, 1, 30));
    expect(retentionAfter(3, 1, 3_650)).toBeLessThan(0.01);
  });

  /* Half a half-life is half of what is left, which is what makes the curve
     exponential rather than linear. */
  it("halves over a half-life", () => {
    expect(retentionAfter(2, 1, halfLifeFor(2, 1))).toBeCloseTo(0.5, 6);
  });

  it("separates never tested from gone cold", () => {
    expect(freshnessOf(0, false)).toBe("untested");
    expect(freshnessOf(0.9, true)).toBe("fresh");
    expect(freshnessOf(0.5, true)).toBe("fading");
    expect(freshnessOf(0.1, true)).toBe("stale");
  });
});

const standing = (overrides: Partial<ConceptStanding> = {}): ConceptStanding => ({
  conceptId: "closures",
  masteryLevel: 3,
  lastEvidenceAt: "2026-01-01T00:00:00.000Z",
  evidenceCount: 2,
  distinctDays: 2,
  demands: ["recall", "produce"],
  retention: 0.2,
  freshness: "stale",
  ...overrides,
});

describe("review", () => {
  it("offers a cold concept the learner once had", () => {
    expect(dueForReview(standing())).toBe(true);
  });

  /* Nothing to bring back. Offering an unseen idea as revision would tell the
     learner they used to know something they have never met. */
  it("does not offer one they never had", () => {
    expect(dueForReview(standing({ masteryLevel: 0 }))).toBe(false);
  });

  it("leaves a fresh concept alone", () => {
    expect(dueForReview(standing({ freshness: "fresh", retention: 0.9 }))).toBe(false);
  });
});

describe("the line the agent reads", () => {
  const now = new Date("2026-03-01T00:00:00.000Z");

  it("says how long ago, how fresh, and what was asked", () => {
    expect(describeStanding(standing({ lastEvidenceAt: "2026-02-27T00:00:00.000Z" }), now)).toBe("2d ago, stale, demands recall/produce");
  });

  /* The honest answer for a level nobody has ever tested, which is the case
     this whole layer exists to make visible. */
  it("says plainly when there is nothing behind the level", () => {
    expect(describeStanding(standing({ lastEvidenceAt: null, demands: [] }), now)).toBe("no evidence yet");
  });
});
