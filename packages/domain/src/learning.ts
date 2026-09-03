import { z } from "zod";
import { id, isoDate } from "./agent.js";

/**
 * The learner's understanding of a concept, and what Construct is allowed to do
 * with it.
 *
 * Ported from v0.7's `shared/constructLearning.ts`. The rubric text is verbatim
 * — it is quoted to the agent, so rewording it changes how the agent judges
 * mastery, which is a behaviour change dressed as a copy edit.
 */

export const CONCEPT_CONFIDENCE_LEVELS = [
  "unknown",
  "introduced",
  "confused",
  "fragile",
  "practicing",
  "applying",
  "solid",
  "fluent",
  "teaching",
  "weak",
  "emerging",
  "strong",
] as const;
export const conceptConfidenceSchema = z.enum(CONCEPT_CONFIDENCE_LEVELS);
export type ConceptConfidence = z.infer<typeof conceptConfidenceSchema>;

export const MASTERY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

export type MasteryRubric = {
  level: MasteryLevel;
  title: string;
  text: string;
  /** Whether a scoped task may be set on this concept yet. This single flag is
   *  what the concept firewall consults, and it is why level 3 matters more
   *  than any other boundary in the product. */
  taskReady: boolean;
};

export const MASTERY_RUBRIC: readonly MasteryRubric[] = [
  {
    level: 0,
    title: "Unseen",
    text: "The learner has only been introduced to the name or has no reliable understanding yet.",
    taskReady: false,
  },
  {
    level: 1,
    title: "Recognizes Pieces",
    text: "The learner can identify some parts or vocabulary, but still needs close explanation and examples.",
    taskReady: false,
  },
  {
    level: 2,
    title: "Guided Understanding",
    text: "The learner can explain the basic idea with support and answer small checks, but cannot apply it independently yet.",
    taskReady: false,
  },
  {
    level: 3,
    title: "Practice Ready",
    text: "The learner can reason about the concept in their own words and is ready for scoped tasks that test it.",
    taskReady: true,
  },
  {
    level: 4,
    title: "Applies Reliably",
    text: "The learner can use the concept in their own work with only light review or edge-case guidance.",
    taskReady: true,
  },
  {
    level: 5,
    title: "Transfers and Teaches",
    text: "The learner can transfer, debug, and explain the concept across nearby problems without hand-holding.",
    taskReady: true,
  },
];

/** The rubric for a level, defaulting to Unseen. An unrecognised level is
 *  treated as knowing nothing rather than as knowing everything: the failure
 *  has to fall on the side of teaching more, never of skipping ahead. */
export function rubricForLevel(level: number | undefined): MasteryRubric {
  const normalized = MASTERY_LEVELS.includes(level as MasteryLevel) ? (level as MasteryLevel) : 0;
  return MASTERY_RUBRIC.find((entry) => entry.level === normalized) ?? MASTERY_RUBRIC[0]!;
}

export function isTaskReady(level: number | undefined): boolean {
  return rubricForLevel(level).taskReady;
}

export const conceptUnderstandingSchema = z.object({
  conceptId: z.string().min(1).max(200),
  confidence: conceptConfidenceSchema,
  masteryLevel: z.number().int().min(0).max(5).optional(),
  masteryText: z.string().max(2_000).optional(),
  lastEvidenceAt: isoDate.optional(),
  notes: z.string().max(4_000).optional(),
  /** Which projects this understanding was built in. Understanding is the
   *  learner's, not the project's — a concept learned once should not have to
   *  be taught again in the next project. */
  projectIds: z.array(z.string()).default([]),
});
export type ConceptUnderstanding = z.infer<typeof conceptUnderstandingSchema>;

export const CONCEPT_EVENT_KINDS = [
  "introduced",
  "referenced",
  "practiced",
  "assessed",
  "leveled-up",
  "leveled-down",
  "task-used",
  "write-used",
  "blocked",
] as const;
export const conceptEventKindSchema = z.enum(CONCEPT_EVENT_KINDS);
export type ConceptEventKind = z.infer<typeof conceptEventKindSchema>;

export const conceptEventSchema = z.object({
  id,
  projectId: z.string(),
  conceptId: z.string(),
  kind: conceptEventKindSchema,
  previousMasteryLevel: z.number().int().min(0).max(5).optional(),
  masteryLevel: z.number().int().min(0).max(5).optional(),
  reason: z.string().max(2_000),
  evidence: z.array(z.string().max(1_000)).default([]),
  createdAt: isoDate,
});
export type ConceptEvent = z.infer<typeof conceptEventSchema>;

/** What the agent may be producing when the firewall is consulted. */
export const ARTIFACT_KINDS = ["teaching", "task", "assessment", "file-write", "file-edit", "scaffold", "next-step"] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

/** Kinds that require the learner to be task-ready on every concept involved.
 *
 *  Teaching is deliberately absent: introducing an idea is exactly what the
 *  learner who does not know it yet needs. The firewall exists to stop
 *  Construct *setting work* or *writing code* on ideas never taught, not to
 *  stop it explaining them. */
export const GATED_ARTIFACT_KINDS: readonly ArtifactKind[] = ["task", "assessment", "file-write", "file-edit", "scaffold"];

export const conceptArtifactAuditSchema = z.object({
  id,
  projectId: z.string(),
  artifactKind: artifactKindSchema,
  artifactRef: z.string().max(500).optional(),
  declaredConceptIds: z.array(z.string()).default([]),
  matchedConceptIds: z.array(z.string()).default([]),
  blockedCapabilities: z.array(z.string()).default([]),
  status: z.enum(["allowed", "blocked"]),
  reason: z.string().max(2_000),
  createdAt: isoDate,
});
export type ConceptArtifactAudit = z.infer<typeof conceptArtifactAuditSchema>;

/** What the firewall decided, and why. The reason is shown to the learner and
 *  fed back to the agent, so it has to read as an explanation rather than a
 *  refusal code. */
export type ConceptPolicyDecision = {
  allowed: boolean;
  declaredConceptIds: string[];
  matchedConceptIds: string[];
  /** Concepts the artifact needs that the learner is not ready for. Named
   *  "blocked" because each one is a reason the artifact cannot proceed. */
  blockedConceptIds: string[];
  reason: string;
  auditId: string;
};

/* ---- Evidence ------------------------------------------------------------
 *
 * What the learner actually did, as opposed to what an earlier model call
 * concluded from it.
 *
 * Mastery used to be the whole record: a number and a sentence of prose
 * explaining it. That is a summary, and a summary cannot be checked, recomputed
 * or disagreed with — a later turn reading "L3, explained capture correctly"
 * has no way to find out what was actually said, or to notice that every signal
 * behind the 3 was a multiple-choice answer and the learner has never written
 * one. Evidence rows point at the artefact instead: the message, the diff, the
 * submitted file. The level becomes a conclusion drawn over them rather than a
 * fact somebody wrote down.
 */

/** How the evidence arose. */
export const EVIDENCE_KINDS = [
  /** They answered a tracked question. */
  "answered",
  /** They wrote code in a task. */
  "wrote-code",
  /** They found and fixed something themselves. */
  "debugged",
  /** They explained it back well enough to teach from. */
  "taught-back",
  /** The agent's own reading, with no learner artefact behind it. The weakest
   *  kind on purpose: it is what `record-concept` produces when it reports a
   *  level without pointing at anything the learner did. */
  "observed",
] as const;
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

/**
 * What the evidence asked of them.
 *
 * The reason a single mastery number cannot carry a concept: recall and produce
 * dissociate constantly, and everybody has read a tutorial they cannot write
 * from. A task whose demand is `produce` is not covered by three `recall`
 * answers, however fluent they were — and until this field existed there was no
 * way to say so.
 */
export const EVIDENCE_DEMANDS = ["recall", "recognise", "produce", "debug", "transfer"] as const;
export const evidenceDemandSchema = z.enum(EVIDENCE_DEMANDS);
export type EvidenceDemand = z.infer<typeof evidenceDemandSchema>;

/** How it went. `unjudged` is honest rather than lazy: a submitted diff is
 *  evidence the moment it exists, and the verdict lands later. */
export const EVIDENCE_OUTCOMES = ["held", "partial", "missed", "unjudged"] as const;
export const evidenceOutcomeSchema = z.enum(EVIDENCE_OUTCOMES);
export type EvidenceOutcome = z.infer<typeof evidenceOutcomeSchema>;

export const evidenceSchema = z.object({
  id,
  /** Where it happened. Provenance, not ownership: understanding is the
   *  learner's, so evidence is read across every project they have. */
  projectId: z.string(),
  conceptId: z.string().min(1).max(200),
  kind: evidenceKindSchema,
  demand: evidenceDemandSchema,
  outcome: evidenceOutcomeSchema,
  /** The artefact this points at: `message:<id>`, `task:<taskId>`, `concept:<id>`. */
  source: z.string().max(300),
  /** Enough of the artefact to recognise it without opening it. Their words or
   *  their diff, never a paraphrase. */
  excerpt: z.string().max(2_000).default(""),
  createdAt: isoDate,
});
export type EvidenceRecord = z.infer<typeof evidenceSchema>;

/* ---- Retention -----------------------------------------------------------
 *
 * Forgetting is the one thing about a learner that needs no inference. A level
 * recorded in March is not a claim about August, and until this existed
 * Construct read it as one — which is the single commonest way a task comes out
 * unfairly hard.
 *
 * What decays is confidence in the reading, never the reading itself. The
 * evidence is a fact and the level is a conclusion drawn from it; only our
 * certainty that the conclusion still holds is a function of time. Overwriting
 * the level would destroy the record, for the same reason evidence is
 * append-only.
 */

/** Days for confidence in a reading at each mastery level to halve.
 *
 *  Higher mastery is more durable, which is most of what the levels mean: an
 *  idea you can transfer and teach survives a season away, and one you were
 *  introduced to last week does not survive the fortnight. */
const HALF_LIFE_DAYS = [3, 7, 14, 30, 75, 180] as const;

/** How much longer each extra day of practice makes a reading last, and the
 *  ceiling on that. Spacing is what turns exposure into retention: the same
 *  four encounters spread over four days are worth far more than four in one
 *  sitting, so what counts is distinct days rather than total events. */
const SPACING_GAIN = 0.35;
const SPACING_CEILING = 4;

export type Freshness = "fresh" | "fading" | "stale" | "untested";

/**
 * The learner's standing on one concept: the level, and how much of it we can
 * still expect them to have.
 */
export type ConceptStanding = {
  conceptId: string;
  masteryLevel: number;
  lastEvidenceAt: string | null;
  evidenceCount: number;
  /** Separate days carrying evidence. The spacing input. */
  distinctDays: number;
  /** Every demand they have ever met on this. A task asking them to `produce`
   *  wants to see `produce` here, not three `recall`s. */
  demands: EvidenceDemand[];
  /** 0 to 1. What is left of our confidence in the reading. */
  retention: number;
  freshness: Freshness;
};

/** The half-life for a reading, in days, given its level and how spread out the
 *  practice behind it was. */
export function halfLifeFor(masteryLevel: number, distinctDays: number): number {
  const base = HALF_LIFE_DAYS[Math.min(5, Math.max(0, Math.round(masteryLevel)))] ?? HALF_LIFE_DAYS[0];
  const spacing = Math.min(SPACING_CEILING, 1 + SPACING_GAIN * Math.max(0, distinctDays - 1));
  return base * spacing;
}

/** What is left of a reading after this long. Exponential rather than linear
 *  because forgetting is: most of the loss happens early, and what survives the
 *  first month tends to survive the third. */
export function retentionAfter(masteryLevel: number, distinctDays: number, ageDays: number): number {
  if (ageDays <= 0) return 1;
  return 0.5 ** (ageDays / halfLifeFor(masteryLevel, distinctDays));
}

export function freshnessOf(retention: number, hasEvidence: boolean): Freshness {
  if (!hasEvidence) return "untested";
  if (retention >= 0.7) return "fresh";
  if (retention >= 0.4) return "fading";
  return "stale";
}

/**
 * Whether this is worth putting back in front of the learner.
 *
 * Level 0 is excluded because there is nothing to review: an idea they have
 * only been introduced to needs teaching, and offering it as revision would
 * claim they once had it.
 */
export function dueForReview(standing: ConceptStanding): boolean {
  return standing.masteryLevel >= 1 && standing.freshness === "stale";
}

/** The standing as one line for the agent, naming only what it cannot infer
 *  from the level: how long ago, and what the learner has actually been asked
 *  to do with it. */
export function describeStanding(standing: ConceptStanding, now: Date = new Date()): string {
  if (!standing.lastEvidenceAt) return "no evidence yet";
  const days = Math.max(0, Math.round((now.getTime() - new Date(standing.lastEvidenceAt).getTime()) / 86_400_000));
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days}d ago` : days < 60 ? `${Math.round(days / 7)}w ago` : `${Math.round(days / 30)}mo ago`;
  const demands = standing.demands.length > 0 ? standing.demands.join("/") : "none";
  return `${when}, ${standing.freshness}, demands ${demands}`;
}
