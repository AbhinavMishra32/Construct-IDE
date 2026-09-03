import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LearnerFooting, LearnerLeaning, LearnerOpening, LearnerPace, LearnerProfile } from "../../shared/api.js";
import { learnerOpeningSchema } from "../../shared/api.js";
import { LANGUAGES } from "@construct/domain";
import type { SyncLearner } from "../../shared/sync.js";
import type { ProjectStore } from "../store/projectStore.js";

/**
 * Who Construct is teaching.
 *
 * Two copies of the same thing, on purpose.
 *
 * The record in `settings` is what the intake writes and what Settings edits:
 * structured, validated, and the thing the language default is read from. The
 * Markdown file beside it is what the learner can actually read — the same
 * argument Flow Memory makes for keeping a project's memory as files in the
 * project. Memory that lives only in an application's private store is memory
 * you cannot audit, and this is memory *about a person*.
 *
 * The record is the source of truth; the file is rendered from it on every
 * save. That direction is deliberate. A file the learner may edit and an
 * application that may also write it will disagree eventually, and the failure
 * mode of "your notes were silently overwritten" is much worse than the failure
 * mode of "editing this file does nothing" — so the file says so at the top,
 * and Settings is where the editing happens.
 *
 * Nothing here is on the path of a turn. A learner who skips the intake gets an
 * empty profile and an agent that asks its own questions, exactly as before.
 */
const RECORD = "learner-profile";
const ONBOARDED = "learner-onboarded";

/** Written next to `state.sqlite3`, so it travels with everything else
 *  Construct keeps about this machine. */
export const LEARNER_FILE = "learner.md";

export const EMPTY_PROFILE: LearnerProfile = {
  name: "",
  footing: "some",
  language: "typescript",
  ambition: "",
  leanings: [],
  pace: "deep",
  followUp: null,
  portrait: "",
  updatedAt: null,
};

export class LearnerProfileService {
  constructor(
    private readonly store: ProjectStore,
    /** Construct's own folder — the one holding the database. */
    private readonly root: string,
  ) {}

  read(): LearnerProfile {
    return this.store.getSetting<LearnerProfile>(RECORD, EMPTY_PROFILE);
  }

  onboarded(): boolean {
    return this.store.getSetting<boolean>(ONBOARDED, false);
  }

  /**
   * Marks someone who was already here as met.
   *
   * The intake did not exist until now, so every existing learner would open
   * this build and be asked to introduce themselves to an application they have
   * been using for weeks. A learner with projects has already answered all of
   * this in the only way that counts, and being interrogated by software you
   * already use is the sort of thing that gets an update uninstalled.
   *
   * Run once at launch, and only where nothing has been recorded either way — a
   * learner who genuinely has no projects and has never been through the intake
   * still gets it.
   */
  adoptExisting(hasProjects: boolean): void {
    if (!hasProjects) return;
    if (this.store.getSetting<boolean | null>(ONBOARDED, null) !== null) return;
    this.store.setSetting(ONBOARDED, true);
  }

  /**
   * The profile as sync carries it, or nothing to say.
   *
   * `updatedAt` is the whole test. It is null until the intake has been
   * finished once, so a device that has never been through it pushes nothing
   * and cannot overwrite the copy in the cloud with an empty record.
   */
  syncable(): SyncLearner | null {
    const profile = this.read();
    if (!profile.updatedAt) return null;
    return { profile: profile as unknown as Record<string, unknown>, updatedAt: profile.updatedAt };
  }

  /**
   * Takes the profile the cloud is holding.
   *
   * Last write wins, the same rule every other synced row follows: a device
   * that has been offline since before the portrait was rewritten must not put
   * the old one back simply by being the one that reconnected.
   *
   * Adopting a profile also marks the intake finished, and that is the point of
   * the whole exercise. Signing out empties this device, so a learner signing
   * back in arrives with nothing; without this they would be asked the same
   * seven questions and their real portrait overwritten by the answers.
   */
  async adopt(row: SyncLearner): Promise<void> {
    const held = this.read().updatedAt;
    if (held && held >= row.updatedAt) return;
    const profile = { ...(row.profile as unknown as LearnerProfile), updatedAt: row.updatedAt };
    this.store.setSetting(RECORD, profile);
    this.store.setSetting(ONBOARDED, true);
    await this.write(profile).catch(() => undefined);
  }

  /**
   * Stores the profile, marks the intake finished, and renders the file.
   *
   * The file write is allowed to fail without failing the save: the record is
   * what the application reads, and a read-only home directory should not be
   * the reason someone cannot finish signing up.
   */
  async save(input: Omit<LearnerProfile, "updatedAt">): Promise<LearnerProfile> {
    const profile: LearnerProfile = { ...input, updatedAt: new Date().toISOString() };
    this.store.setSetting(RECORD, profile);
    this.store.setSetting(ONBOARDED, true);
    await this.write(profile).catch(() => undefined);
    return profile;
  }

  /** Where the readable copy lives, for Settings to reveal. */
  file(): string {
    return path.join(this.root, LEARNER_FILE);
  }

  private async write(profile: LearnerProfile): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(), renderProfile(profile), "utf8");
  }

  /** The file's current text, or null if it was never written. Only Settings
   *  wants this; the agent is handed the record. */
  async markdown(): Promise<string | null> {
    const target = this.file();
    if (!existsSync(target)) return null;
    return readFile(target, "utf8").catch(() => null);
  }
}

/* ---- What the agent is told ---------------------------------------------
   The same facts as the file, compressed. This goes into every turn's prompt,
   so it is written to be read by a model in a hurry: short lines, no headings,
   nothing that is merely decorative.

   Capped, and the cap is on the two free-text fields rather than the whole
   block, because truncating the block would cut whichever field happened to be
   last. A learner who writes an essay about their ambitions gets the first part
   of it in the prompt and all of it in the file.
*/
const CAP = 600;

export function profilePromptBlock(profile: LearnerProfile): string[] {
  /* Never been through the intake and never edited: there is nothing to say,
     and a block of empty labels would read to the model as a person with no
     goals rather than as a person it has not met. */
  if (!profile.updatedAt) return [];

  const lines = ["", "Who you are teaching (from their intake — do not ask them these again):"];
  if (profile.name.trim()) lines.push(`  Name: ${profile.name.trim()}`);
  lines.push(`  Footing: ${FOOTING_PROSE[profile.footing]}`);
  lines.push(`  Home language: ${profile.language}`);
  if (profile.ambition.trim()) lines.push(`  Wants to be able to: ${clip(profile.ambition, CAP)}`);
  if (profile.leanings.length > 0) lines.push(`  Explanations land when you: ${profile.leanings.map((leaning) => LEANING_PROSE[leaning]).join("; ")}`);
  lines.push(`  Pace: ${PACE_PROSE[profile.pace]}`);
  if (profile.followUp) lines.push(`  Asked "${profile.followUp.question}" — answered: ${clip(profile.followUp.answer, CAP)}`);
  if (profile.portrait.trim()) lines.push(`  In Construct's words: ${clip(profile.portrait, CAP)}`);
  /* Said explicitly, because a model handed a profile will otherwise open by
     reciting it back — which is the exact "so, you're a Go developer who wants
     to learn graphics!" opening that makes software feel like it is performing
     attentiveness rather than using it. */
  lines.push("  Use this to pitch the teaching. Do not recite it back to them.");
  return lines;
}

const FOOTING_PROSE: Record<LearnerFooting, string> = {
  new: "new to programming — assume no prior language",
  some: "has written some code, not professionally — knows the basics, gaps everywhere else",
  working: "writes code professionally — do not explain what a function is",
  returning: "wrote code before and is coming back after a gap — old foundations, stale specifics",
};

const LEANING_PROSE: Record<LearnerLeaning, string> = {
  "shape-first": "show the shape of the whole before any detail",
  "hands-first": "get them building early and explain into the mess",
  "first-principles": "derive it from the ground rather than asserting it",
  "by-example": "lead with a concrete example, generalise after",
};

const PACE_PROSE: Record<LearnerPace, string> = {
  deep: "slow and thorough — one idea properly beats three loosely",
  brisk: "keep moving — they would rather cover ground and circle back",
};

const clip = (value: string, limit: number): string => {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
};

/**
 * The same facts again, as Markdown bullets, for a project's own `learner.md`.
 *
 * A third rendering rather than a reuse of either of the other two, and that is
 * deliberate: `profilePromptBlock` is written to be read by a model in a hurry
 * and `renderProfile` is a document about a person, while this is a section
 * inside a file the agent patches all session. It has to look like the rest of
 * that file, which means bullets.
 */
export function profileMemoryLines(profile: LearnerProfile): string[] {
  if (!profile.updatedAt) return [];
  const lines: string[] = [];
  if (profile.name.trim()) lines.push(`- Goes by: ${profile.name.trim()}`);
  lines.push(`- Footing: ${FOOTING_PROSE[profile.footing]}`);
  lines.push(`- Home language: ${profile.language}`);
  if (profile.ambition.trim()) lines.push(`- Wants to be able to: ${clip(profile.ambition, CAP)}`);
  for (const leaning of profile.leanings) lines.push(`- Explanations land when you ${LEANING_PROSE[leaning]}`);
  lines.push(`- Pace: ${PACE_PROSE[profile.pace]}`);
  if (profile.followUp?.answer.trim()) lines.push(`- Asked "${profile.followUp.question}": ${clip(profile.followUp.answer, CAP)}`);
  /* Said here as well as in the prompt, because this file outlives the prompt
     and gets patched by an agent that will otherwise treat a stated preference
     as an inference of its own and quietly revise it. */
  lines.push("", "These were stated by the learner. Refine them with evidence; do not overwrite them with guesses.");
  return lines;
}

/* ---- The readable copy --------------------------------------------------- */

export function renderProfile(profile: LearnerProfile): string {
  const lines = [
    "# Learner",
    "",
    /* Stated first because it is the thing someone opening this file in an
       editor most needs to know before they start typing into it. */
    "<!-- Construct writes this file from your profile. Edit it in Settings → You;",
    "     changes made here are replaced the next time the profile is saved. -->",
    "",
    profile.name.trim() ? `Name: ${profile.name.trim()}` : "Name: not given.",
    "",
    `Footing: ${FOOTING_PROSE[profile.footing]}`,
    "",
    `Home language: ${profile.language}`,
    "",
    `Pace: ${PACE_PROSE[profile.pace]}`,
    "",
    "## Wants to be able to",
    "",
    profile.ambition.trim() || "Not said yet.",
    "",
    "## How explanations land",
    "",
    ...(profile.leanings.length > 0 ? profile.leanings.map((leaning) => `- ${LEANING_PROSE[leaning]}`) : ["Nothing recorded yet."]),
  ];

  if (profile.followUp) {
    lines.push("", "## What Construct asked", "", `**${profile.followUp.question.trim()}**`, "", profile.followUp.answer.trim() || "No answer given.");
  }

  if (profile.portrait.trim()) {
    lines.push("", "## Portrait", "", profile.portrait.trim());
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/**
 * The model's suggestions, or as many of them as survive.
 *
 * Every defence here is against an answer that is JSON-shaped rather than JSON:
 * a fenced block, a preamble, an object wrapping the array, a fourth entry, a
 * language nobody offered. Entries are validated one at a time and a bad one is
 * dropped rather than taking the others with it — see `learnerOpening`, which
 * falls back to one composed from the draft.
 *
 * A bare object counts as a list of one. The intake asks for the three cards a
 * card at a time, so a single suggestion is now the common answer rather than
 * the odd one, and a model asked for one project replies with one object.
 */
export function cleanOpenings(raw: string, fallbackLanguage: LearnerProfile["language"]): LearnerOpening[] {
  /* The array, wherever it is. A model told not to use a fence will sometimes
     use one anyway, and one told to reply with an array will sometimes wrap it
     in `{"projects": [...]}`; both are one slice away from parseable. */
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  const object = start < 0 || end <= start;
  const slice = object
    ? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    : text.slice(start, end + 1);
  if (!slice) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (object && typeof parsed === "object" && parsed !== null) parsed = [parsed];
  if (!Array.isArray(parsed)) return [];

  const openings: LearnerOpening[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (openings.length >= 3) break;
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    /* The language is coerced rather than validated away. A suggestion that is
       right in every other respect should not be discarded because the model
       answered "TypeScript" where the enum says "typescript", or named one
       Construct does not offer. */
    const named = String(record.language ?? "").trim().toLowerCase();
    const candidate = {
      name: clipField(record.name, 60),
      goal: clipField(record.goal, 400),
      why: clipField(record.why, 240),
      artifact: clipField(record.artifact, 48),
      language: (LANGUAGES as readonly string[]).includes(named) ? named : fallbackLanguage,
    };
    const valid = learnerOpeningSchema.safeParse(candidate);
    if (!valid.success) continue;
    const key = valid.data.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    openings.push(valid.data);
  }
  return openings;
}

/** One field off a parsed object, made safe to put on a card: a string, its
 *  whitespace collapsed, its wrapping quotes gone, cut to what the schema will
 *  take. Anything that is not a string becomes empty, which fails validation —
 *  which is the point. */
function clipField(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Three projects, written here, for when no model can be reached.
 *
 * Same argument as `composePortrait`, one screen later and with more riding on
 * it: the last thing the intake does is offer to start something, and "Construct
 * could not think of anything" is a worse ending than the intake not having
 * offered at all. So there is always something to press.
 *
 * They are deliberately generic in subject and specific in shape. A written-here
 * suggestion cannot know what this person wants to build — that is what the
 * model was for — but it can be a real project with a real finish line, pitched
 * at their footing and in their language, which is most of what makes a first
 * project work. The ladder is by footing rather than by topic, because footing
 * is the one answer that decides whether a project is a week or an afternoon.
 *
 * Their ambition is carried into the first card's goal when they gave one. That
 * card is then the honest one: it is their own words, aimed at their own
 * language, and the agent's research pass is what turns it into a path.
 */
export function composeOpenings(draft: Omit<LearnerProfile, "updatedAt" | "portrait">): LearnerOpening[] {
  const language = draft.language;
  const ambition = clip(draft.ambition, 240);
  const ladder = FALLBACK_OPENINGS[draft.footing];
  const openings = ladder.map((entry) => ({ ...entry, language }));

  /* Their own ambition, first, whenever they said one. It outranks anything
     written here because it is the only card on the screen that came from them. */
  if (ambition) {
    openings.unshift({
      name: "What You Came For",
      goal: `Build towards this, in ${language}, one finishable piece at a time: ${ambition}`,
      why: "This is what you said you wanted, so it is where I would rather start.",
      artifact: "your own project",
      language,
    });
  }
  return openings.slice(0, 3);
}

/**
 * The written-here suggestions, by footing.
 *
 * Three per footing so that a learner who gave no ambition still gets a full
 * screen, and each one is a project rather than an exercise: something exists at
 * the end of it, and the thing that exists is the reason to build it.
 */
const FALLBACK_OPENINGS: Record<LearnerFooting, Array<Omit<LearnerOpening, "language">>> = {
  new: [
    { name: "A Tool You Use", goal: "Write a small command-line tool that does one thing you actually want done, and understand every line of it.", why: "Starting from nothing, the fastest way to feel fluent is a program you reach for again.", artifact: "a tool you keep" },
    { name: "Reading Your Own Data", goal: "Take a file of real data — your own, ideally — and write a program that answers a question about it.", why: "Loops, conditions and types stop being vocabulary the moment they are answering something you asked.", artifact: "an answer from a file" },
    { name: "A Game With Rules", goal: "Build a small game with rules you decide, and learn how state and input fit together by moving them around.", why: "A game tells you immediately when your model of the state was wrong.", artifact: "a game you can play" },
  ],
  some: [
    { name: "Something From Scratch", goal: "Rebuild a library you have always imported — a router, a test runner, an argument parser — small but real.", why: "You have used these. Building one is where the box stops being black.", artifact: "your own library" },
    { name: "A Service You Own", goal: "Build a small service end to end: storage, an interface over it, and a reason for it to exist.", why: "You can build pieces. This is about how the pieces fit and where they leak.", artifact: "a running service" },
    { name: "One Idea, Properly", goal: "Implement one algorithm or data structure from the ground up, then make it fast, then prove it stayed correct.", why: "Depth on one thing is what turns tutorial fluency into judgement.", artifact: "a fast, tested implementation" },
  ],
  working: [
    { name: "The Layer Below", goal: "Reimplement a piece of infrastructure you depend on daily, far enough to know how it fails.", why: "You already ship on top of this. Knowing its shape changes how you design against it.", artifact: "a working reimplementation" },
    { name: "A Language Runtime", goal: "Write a lexer, a parser and an evaluator for a small language, and take it as far as closures.", why: "Nothing rearranges how you read code faster than having written something that reads code.", artifact: "a language that runs" },
    { name: "Under Load", goal: "Build something small, measure it honestly, and take it apart until you know exactly what its limits are made of.", why: "You write code professionally, so the interesting question is not whether it works but why it is this fast.", artifact: "a measured system" },
  ],
  returning: [
    { name: "Back In The Water", goal: "Build one complete small project, start to finish, in the way the language is written today.", why: "Your foundations are intact. This is about which specifics moved while you were away.", artifact: "one finished project" },
    { name: "What Changed", goal: "Take something you built before and rebuild it with the current tools, noticing every place the answer is now different.", why: "Comparing against your own old work is the fastest way to find what went stale.", artifact: "the same thing, rebuilt" },
    { name: "A Tool You Use", goal: "Write a small command-line tool you will actually reach for, and get comfortable in the toolchain again.", why: "Getting the build, the tests and the editor working is half of coming back.", artifact: "a tool you keep" },
  ],
};

/**
 * The portrait, written here, for when no model can be reached.
 *
 * Not a placeholder and not an apology. Someone who has just answered five
 * questions has earned a paragraph that reflects them, and "Construct could not
 * reach a model" as the last screen of the intake is the worst possible first
 * impression. It says less than the model's version and nothing that is untrue.
 */
export function composePortrait(draft: Omit<LearnerProfile, "updatedAt" | "portrait">): string {
  const opening = {
    new: "You are starting from the beginning",
    some: "You have written some code and know roughly where you stand",
    working: "You write code for a living",
    returning: "You are coming back to code after time away",
  }[draft.footing];

  const parts = [`${opening}, and you want to work in ${draft.language}.`];
  if (draft.ambition.trim()) parts.push(`What you are after: ${clip(draft.ambition, 240)}`);
  if (draft.leanings.length > 0) {
    parts.push(`Explanations land for you when they ${draft.leanings.map((leaning) => LEANING_PROSE[leaning]).join(", and when they ")}.`);
  }
  parts.push(draft.pace === "deep" ? "You would rather understand one thing properly than three loosely." : "You would rather keep moving and circle back.");
  return parts.join(" ");
}
