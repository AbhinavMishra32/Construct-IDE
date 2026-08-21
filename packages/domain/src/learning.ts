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
