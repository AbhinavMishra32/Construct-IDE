import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LearnerProfile } from "../../shared/api.js";
import { ProjectStore } from "../store/projectStore.js";
import { cleanOpenings, composeOpenings, composePortrait, EMPTY_PROFILE, LearnerProfileService, profileMemoryLines, profilePromptBlock } from "./learnerProfile.js";

let root: string;
let store: ProjectStore;
let service: LearnerProfileService;

const filled = (overrides: Partial<LearnerProfile> = {}): Omit<LearnerProfile, "updatedAt"> => {
  const { updatedAt: _updatedAt, ...rest } = {
    ...EMPTY_PROFILE,
    name: "Ada",
    footing: "working" as const,
    language: "rust" as const,
    ambition: "A renderer that puts a lit triangle on screen",
    leanings: ["shape-first" as const],
    pace: "deep" as const,
    followUp: { question: "What have you tried already?", answer: "A tutorial I never finished." },
    portrait: "You write code for a living and want the graphics half of it.",
    ...overrides,
  };
  return rest;
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "construct-learner-"));
  store = new ProjectStore(path.join(root, "state.sqlite3"));
  service = new LearnerProfileService(store, root);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the record", () => {
  it("starts empty and unmet", () => {
    expect(service.read().updatedAt).toBeNull();
    expect(service.onboarded()).toBe(false);
  });

  it("stores what the intake collected and marks it finished", async () => {
    const saved = await service.save(filled());
    expect(saved.name).toBe("Ada");
    expect(saved.updatedAt).not.toBeNull();
    expect(service.onboarded()).toBe(true);
    expect(service.read().ambition).toContain("lit triangle");
  });

  it("writes a copy the learner can read", async () => {
    await service.save(filled());
    const text = readFileSync(service.file(), "utf8");
    expect(text).toContain("# Learner");
    expect(text).toContain("Ada");
    expect(text).toContain("What have you tried already?");
    /* The file says it is not the place to edit, because it is rendered from
       the record on every save and anything typed here would be lost. */
    expect(text).toContain("Settings");
  });
});

describe("adopting an existing learner", () => {
  it("marks someone with projects as already met", () => {
    service.adoptExisting(true);
    expect(service.onboarded()).toBe(true);
  });

  it("leaves a fresh install alone", () => {
    service.adoptExisting(false);
    expect(service.onboarded()).toBe(false);
  });

  it("never reopens a decision already recorded", async () => {
    /* The one that matters. Someone who went through the intake and then made a
       project must not be re-marked, and — more importantly — the flag must not
       be re-derived from project count on every launch, or a learner who
       deleted all their projects would be asked to introduce themselves
       again. */
    await service.save(filled());
    service.adoptExisting(false);
    expect(service.onboarded()).toBe(true);
  });
});

describe("what the agent is told", () => {
  it("says nothing at all about someone it has not met", () => {
    expect(profilePromptBlock(EMPTY_PROFILE)).toEqual([]);
  });

  it("carries the facts that change how you would teach", async () => {
    const profile = await service.save(filled());
    const block = profilePromptBlock(profile).join("\n");
    expect(block).toContain("Ada");
    expect(block).toContain("writes code professionally");
    expect(block).toContain("rust");
    expect(block).toContain("lit triangle");
    expect(block).toContain("shape of the whole");
  });

  it("tells the model not to recite it back", async () => {
    const profile = await service.save(filled());
    expect(profilePromptBlock(profile).join("\n")).toContain("Do not recite it back");
  });

  it("clips a long ambition rather than the block after it", async () => {
    const profile = await service.save(filled({ ambition: "x".repeat(4_000) }));
    const block = profilePromptBlock(profile).join("\n");
    expect(block).toContain("…");
    /* The pace line comes after the ambition, so this is the assertion that a
       cap on the whole block would fail. */
    expect(block).toContain("Pace:");
  });
});

describe("a project's own learner.md", () => {
  it("is empty for someone who skipped the intake", () => {
    expect(profileMemoryLines(EMPTY_PROFILE)).toEqual([]);
  });

  it("warns the agent off overwriting stated preferences with guesses", async () => {
    const profile = await service.save(filled());
    expect(profileMemoryLines(profile).join("\n")).toContain("do not overwrite them with guesses");
  });
});

describe("the fallback portrait", () => {
  it("says something true about them without a model", () => {
    const { portrait: _portrait, ...draft } = filled();
    const text = composePortrait(draft);
    expect(text).toContain("rust");
    expect(text.length).toBeGreaterThan(40);
    /* No apology, no mention of a provider: the last screen of the intake is
       not where someone learns their model is down. */
    expect(text.toLowerCase()).not.toContain("could not");
  });
});

describe("reading the model's three suggestions", () => {
  const one = (overrides: Record<string, unknown> = {}) => ({
    name: "Triangle Rasterisation",
    goal: "Put a lit triangle on screen and understand every line that got it there.",
    why: "You said a renderer, and this is the smallest one that is still a renderer.",
    artifact: "a working rasteriser",
    language: "rust",
    ...overrides,
  });

  it("reads a plain array", () => {
    const openings = cleanOpenings(JSON.stringify([one(), one({ name: "Second" }), one({ name: "Third" })]), "typescript");
    expect(openings.map((opening) => opening.name)).toEqual(["Triangle Rasterisation", "Second", "Third"]);
  });

  /* A model told not to use a fence uses one anyway, and one told to reply with
     an array wraps it in an object. Both are one slice from parseable, and a
     screen with nothing on it is not the right response to either. */
  it("digs the array out of a fence or a wrapper", () => {
    const body = JSON.stringify([one()]);
    expect(cleanOpenings("```json\n" + body + "\n```", "typescript")).toHaveLength(1);
    expect(cleanOpenings('Here you go:\n{"projects": ' + body + "}", "typescript")).toHaveLength(1);
  });

  it("drops a bad entry rather than the whole answer", () => {
    /* Two good suggestions beat none — `learnerOpenings` tops the list back up
       from the draft, and a written-here card is the same shape as these. */
    const openings = cleanOpenings(JSON.stringify([one(), { name: "No" }, one({ name: "Third" })]), "typescript");
    expect(openings.map((opening) => opening.name)).toEqual(["Triangle Rasterisation", "Third"]);
  });

  it("keeps a card whose language it had to correct", () => {
    /* A suggestion right in every other respect should not be thrown away over
       a capital letter, or over a language Construct does not offer. */
    expect(cleanOpenings(JSON.stringify([one({ language: "Rust" })]), "typescript")[0]?.language).toBe("rust");
    expect(cleanOpenings(JSON.stringify([one({ language: "haskell" })]), "typescript")[0]?.language).toBe("typescript");
  });

  it("takes no more than three, and no duplicates", () => {
    const four = [one(), one(), one({ name: "Second" }), one({ name: "Third" }), one({ name: "Fourth" })];
    expect(cleanOpenings(JSON.stringify(four), "typescript").map((opening) => opening.name)).toEqual([
      "Triangle Rasterisation",
      "Second",
      "Third",
    ]);
  });

  it("returns nothing at all rather than guessing at prose", () => {
    expect(cleanOpenings("I would suggest building a renderer.", "typescript")).toEqual([]);
    expect(cleanOpenings("[not json", "typescript")).toEqual([]);
  });
});

describe("the fallback openings", () => {
  /* The last screen of the intake offers to start something. With no model
     reachable it still has to offer three, because "Construct could not think of
     anything" is a worse ending than never having offered. */
  it("always offers three, in the learner's language", () => {
    const openings = composeOpenings(filled({ ambition: "" }));
    expect(openings).toHaveLength(3);
    for (const opening of openings) expect(opening.language).toBe("rust");
  });

  it("leads with what they actually said, when they said something", () => {
    const openings = composeOpenings(filled());
    expect(openings[0]?.goal).toContain("A renderer that puts a lit triangle on screen");
    expect(openings).toHaveLength(3);
  });

  it("pitches at the footing, since footing is what decides whether a project is finishable", () => {
    expect(composeOpenings(filled({ ambition: "", footing: "new" }))).not.toEqual(composeOpenings(filled({ ambition: "", footing: "working" })));
  });
});
