import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentTraceEntry } from "./constructAgentRuntime";
import type {
  ConstructInteractAction,
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  GeneratedLiveStepDraft,
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

const ConstructInteractActionSchema: z.ZodType<ConstructInteractAction> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("go-to-step"),
    stepId: z.string().min(1),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("open-concept"),
    conceptId: z.string().min(1),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("open-file"),
    path: z.string().min(1),
    anchor: z.string().optional(),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("create-live-steps"),
    stepIds: z.array(z.string().min(1)).max(3),
    label: z.string().min(1),
    reason: z.string().min(1)
  })
]);

const GeneratedLiveStepDraftSchema: z.ZodType<GeneratedLiveStepDraft> = z.object({
  id: z.string().optional(),
  source: z.enum(["construct-interact", "adaptive-planner"]),
  sourceBlockId: z.string().optional(),
  sourceStepId: z.string().optional(),
  sourceRunId: z.string().optional(),
  insertAfterStepId: z.string().optional(),
  insertBeforeStepId: z.string().optional(),
  title: z.string().min(1).max(80),
  reason: z.string().min(1),
  status: z.enum(["pending", "active", "completed", "dismissed"]).optional(),
  blocks: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("explain"),
      id: z.string().min(1),
      content: z.string().min(1),
      concepts: z.array(z.string().min(1)).optional()
    }),
    z.object({
      kind: z.literal("interact"),
      id: z.string().min(1),
      prompt: z.string().min(1),
      basis: z.string().min(1),
      understanding: z.string().min(1),
      assessment: z.string().min(1),
      concepts: z.array(z.string().min(1)).optional()
    }),
    z.object({
      kind: z.literal("recall"),
      id: z.string().min(1),
      mode: z.literal("reply"),
      task: z.string().min(1),
      support: z.string().optional(),
      concepts: z.array(z.string().min(1)).optional()
    })
  ])).min(1).max(3),
  conceptIds: z.array(z.string().min(1)).optional()
});

const ConstructInteractResultSchema = z.object({
  status: z.enum(["continue", "pass", "almost", "skip"]),
  confidence: z.enum(["low", "medium", "high"]),
  reply: z.string().min(1),
  coveredConceptIds: z.array(z.string().min(1)).default([]),
  missingConceptIds: z.array(z.string().min(1)).default([]),
  assistanceLevel: z.enum(["none", "hint", "guided", "answer"]),
  shouldAdvance: z.boolean(),
  statePatch: LearningStatePatchSchema.optional(),
  actions: z.array(ConstructInteractActionSchema).max(4).default([]),
  generatedLiveSteps: z.array(GeneratedLiveStepDraftSchema).max(3).default([])
});

export async function runConstructInteract(
  input: ConstructInteractRuntimeInput,
  onTrace?: (entry: ConstructAgentTraceEntry) => void
): Promise<ConstructInteractResult> {
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
      "You can inspect scoped context through the tool outputs in the prompt. Use the smallest relevant set; do not require every tool every time.",
      "Prefer existing tape content before generating new content: open a concept card, go to the exact step where a concept was introduced, show an existing reference, then generate a small live step only if existing content is not enough.",
      "You may return structured actions for stronger CTAs: go-to-step, open-concept, open-file, or create-live-steps. Labels and reasons must be dynamic and learner-specific.",
      "You may return generatedLiveSteps only when the learner is stuck, weak on a prerequisite, used heavy assistance, failed or almost failed recall, says they do not understand, or the answer reveals a missing concept.",
      "Generated live steps must be learning-focused only: explain, Construct Interact, or reply recall. No file edits and no code ghost edits.",
      "Generate usually one live step. Never generate more than three. Keep titles short, reasons explicit, and content small.",
      "Use status=pass only when the learner has enough ownership to continue.",
      "Use status=almost for a focused follow-up. Set shouldAdvance=true only if the missing detail is minor.",
      "Use status=skip when the learner cannot answer and needs to continue with assistance recorded.",
      "Return structured statePatch updates. The app will validate and apply them; do not assume direct mutation."
    ].join("\n"),
    prompt: buildConstructInteractPrompt(input),
    schema: ConstructInteractResultSchema,
    maxRetries: 1,
    onTrace
  });
  return {
    ...result,
    coveredConceptIds: result.coveredConceptIds ?? [],
    missingConceptIds: result.missingConceptIds ?? [],
    actions: result.actions ?? [],
    generatedLiveSteps: result.generatedLiveSteps ?? []
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
    "Scoped Construct Interact tool guidance:",
    [
      "The app may provide read-only tool outputs under projectContext.toolContext.",
      "Treat those outputs as the result of safe scoped tools such as getCurrentStep, getPreviousSteps, getConceptCard, findWhereConceptWasIntroduced, searchTape, getLearnerState, getProjectLearnerState, getKnowledgeBase, getRecallHistory, getConstructInteractHistory, getStepFiles, readWorkspaceFile, and getLatestTerminalOutput.",
      "If a needed tool output is absent, make a conservative decision from available context and explain the limitation in your reason.",
      "When existing content directly addresses the gap, return an action instead of generatedLiveSteps."
    ].join("\n"),
    "",
    "Learning state snapshot:",
    JSON.stringify(input.learningState, null, 2),
    "",
    "Return a concise learner-facing reply, statePatch updates for covered and missing concepts, optional structured actions, and optional generatedLiveSteps."
  ].join("\n");
}
