import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LearnerProfile } from "../../shared/api.js";
import { ProjectStore } from "../store/projectStore.js";
import { composePortrait, EMPTY_PROFILE, LearnerProfileService, profileMemoryLines, profilePromptBlock } from "./learnerProfile.js";

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
