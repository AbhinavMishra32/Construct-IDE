import { z } from "zod";

import { createConstructAgentRuntime } from "./constructAgentRuntime";
import type {
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  LearningStatePatch
} from "../shared/constructLearning";

export const CONSTRUCT_INTERACT_AGENT_ID = "construct-interact-agent";
export const CONSTRUCT_INTERACT_AGENT_NAME = "Construct Interact";

const LearningStatePatchSchema: z.ZodType<LearningStatePatch> = z.object({
  globalConceptUnderstanding: z.record(z.object({
    conceptId: z.string().min(1),
    confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional(),
    lastEvidenceAt: z.string().optional(),
    notes: z.string().optional(),
    projectIds: z.array(z.string()).optional()
  })).optional(),
  projectConceptUnderstanding: z.record(z.record(z.object({
    conceptId: z.string().min(1),
    confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional(),
    lastEvidenceAt: z.string().optional(),
    notes: z.string().optional(),
    projectIds: z.array(z.string()).optional()
  }))).optional(),
  assistanceEvent: z.any().optional(),
  plannedOverlay: z.any().optional()
}).passthrough();

const ConstructInteractResultSchema = z.object({
  status: z.enum(["continue", "pass", "almost", "skip"]),
  confidence: z.enum(["low", "medium", "high"]),
  reply: z.string().min(1),
  coveredConceptIds: z.array(z.string().min(1)).default([]),
  missingConceptIds: z.array(z.string().min(1)).default([]),
  assistanceLevel: z.enum(["none", "hint", "guided", "answer"]),
  shouldAdvance: z.boolean(),
  statePatch: LearningStatePatchSchema.optional()
});

export async function runConstructInteract(input: ConstructInteractRuntimeInput): Promise<ConstructInteractResult> {
  const runtime = createConstructAgentRuntime();
  const result = await runtime.generateStructured({
    id: CONSTRUCT_INTERACT_AGENT_ID,
    featureId: "construct-interact",
    name: CONSTRUCT_INTERACT_AGENT_NAME,
    purpose: "Construct Interact evaluation",
    instructions: [
      "You are Construct Interact, an active learning evaluator inside Construct IDE.",
      "Evaluate the learner answer against the prompt, basis, expected understanding, assessment guidance, concept context, project context, and learning state.",
      "Do not reveal the full answer immediately when the learner is close. Ask one smaller grounded follow-up instead.",
      "Use status=pass only when the learner has enough ownership to continue.",
      "Use status=almost for a focused follow-up. Set shouldAdvance=true only if the missing detail is minor.",
      "Use status=skip when the learner cannot answer and needs to continue with assistance recorded.",
      "Return structured statePatch updates. The app will validate and apply them; do not assume direct mutation."
    ].join("\n"),
    prompt: buildConstructInteractPrompt(input),
    schema: ConstructInteractResultSchema,
    maxRetries: 1
  });
  return {
    ...result,
    coveredConceptIds: result.coveredConceptIds ?? [],
    missingConceptIds: result.missingConceptIds ?? []
  };
}

function buildConstructInteractPrompt(input: ConstructInteractRuntimeInput): string {
  return [
    "Construct Interact prompt:",
    input.prompt,
    "",
    "Learner answer:",
    input.answer || "(empty answer)",
    "",
    "Basis hidden from learner:",
    input.basis || "(none)",
    "",
    "Expected understanding:",
    input.understanding || "(none)",
    "",
    "Assessment guidance:",
    input.assessment || "(none)",
    "",
    "Resources:",
    JSON.stringify(input.resources, null, 2),
    "",
    "Project context:",
    JSON.stringify(input.projectContext ?? {}, null, 2),
    "",
    "Learning state snapshot:",
    JSON.stringify(input.learningState, null, 2),
    "",
    "Return a concise learner-facing reply plus statePatch updates for covered and missing concepts."
  ].join("\n");
}
