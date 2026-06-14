import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentTools, type ConstructAgentTraceEntry } from "./constructAgentRuntime";
import type {
  ConstructInteractAction,
  ConstructInteractResult,
  ConstructInteractRuntimeInput,
  GeneratedLiveStepDraft,
  LearningStatePatch
} from "../shared/constructLearning";
import { supportsConstructInteract, supportsGeneratedLiveSteps, supportsToolDrivenInteract } from "../shared/tapeFeatures";

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
  onTrace?: (entry: ConstructAgentTraceEntry) => void,
  tools?: ConstructAgentTools
): Promise<ConstructInteractResult> {
  const runtime = createConstructAgentRuntime();
  const canGenerateLiveSteps = supportsGeneratedLiveSteps(input.tapeSpec ?? "");
  const toolDriven = supportsConstructInteract(input.tapeSpec ?? "");
  const formalToolDrivenSpec = supportsToolDrivenInteract(input.tapeSpec ?? "");
  const result = await runtime.generateStructured({
    id: CONSTRUCT_INTERACT_AGENT_ID,
    featureId: "construct-interact",
    name: CONSTRUCT_INTERACT_AGENT_NAME,
    purpose: "Construct Interact evaluation",
    instructions: buildConstructInteractInstructions({ canGenerateLiveSteps, formalToolDrivenSpec }),
    prompt: buildConstructInteractPrompt(input, toolDriven),
    schema: ConstructInteractResultSchema,
    tools,
    maxSteps: 12,
    completionGuard: (iteration) => {
      if (!iteration.isFinal) return;
      if (/\b(?:let me|i(?:'|’)ll|i will|i need to)\s+(?:check|inspect|look|read|review|find|search|add|create|open|verify)\b/i.test(iteration.text)) {
        return {
          continue: true,
          feedback: "Do the promised inspection or action now. Use only the tools that help, inspect their results, and finish with the learner-facing response rather than another promise."
        };
      }
    },
    maxRetries: 2,
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

export function buildConstructInteractInstructions({
  canGenerateLiveSteps,
  formalToolDrivenSpec
}: {
  canGenerateLiveSteps: boolean;
  formalToolDrivenSpec: boolean;
}): string {
  return [
      "You are Construct Interact, an active learning evaluator inside Construct IDE.",
      "Use the authored block, relevant resources, and learner state available through tools to evaluate the learner's message.",
      "Do not reveal the full answer immediately when the learner is close. Ask one smaller grounded follow-up instead.",
      "You have read-only scoped tools for the authored tape, concepts, learner state, scoped files, and terminal context. Call only the tools you need. Do not require every tool every time.",
      "Never claim wording appeared in a lesson step unless an authored-step or authored-step-block tool result contains that wording. Concept-card and reference-card text are separate sources; name the source accurately.",
      "When the learner asks whether something was explained, compare the exact authored step text with attached resource cards. If the detail exists only in a card, say that plainly.",
      "Use concept engagement from tools. If a relevant concept card has never been opened, prefer an open-concept action before repeating its full answer. If it was opened, acknowledge that and use a smaller targeted follow-up.",
      formalToolDrivenSpec
        ? "This is tape-0.4.2 agentic Interact. Resource ids are discovery hints, not preloaded evidence."
        : "This older tape-0.4.x project uses the same agentic Interact behavior for backwards compatibility.",
      "Decide which tools, if any, are needed for this learner message. Explore only as far as needed to give a grounded, useful response. Do not follow a fixed tool sequence.",
      "Do not call a tool merely because it is available, and do not repeat the previous turn's tool set unless the learner's new message actually requires it.",
      "Finish the work inside this agent run. Never stop with 'let me check', 'I will inspect', or another promise to act later. Call useful tools, read their results, and only then return the learner-facing response.",
      "Do not expose private chain-of-thought. Observable progress may summarize decisions, tool calls, and evidence, but the learner-facing reply should contain only useful conclusions and guidance.",
      canGenerateLiveSteps
        ? "Prefer existing tape content before generating new content: open a concept card, go to the exact step where a concept was introduced, show an existing reference, then generate a small live step only if existing content is not enough."
        : "Prefer existing tape content: open a concept card, go to the exact step where a concept was introduced, or show an existing reference. Do not generate live steps for this tape spec.",
      canGenerateLiveSteps
        ? "You may return structured actions for stronger CTAs: go-to-step, open-concept, open-file, or create-live-steps. Labels and reasons must be dynamic and learner-specific."
        : "You may return structured actions for stronger CTAs: go-to-step, open-concept, or open-file. Labels and reasons must be dynamic and learner-specific.",
      canGenerateLiveSteps
        ? "You may return generatedLiveSteps only when the learner is stuck, weak on a prerequisite, used heavy assistance, failed or almost failed recall, says they do not understand, or the answer reveals a missing concept."
        : "Return generatedLiveSteps as an empty array for this tape spec.",
      canGenerateLiveSteps
        ? "Generated live steps must be learning-focused only: explain, Construct Interact, or reply recall. No file edits and no code ghost edits."
        : "Do not return create-live-steps actions for this tape spec.",
      canGenerateLiveSteps
        ? "Generate usually one live step. Never generate more than three. Keep titles short, reasons explicit, and content small."
        : "Use go-to-step, open-concept, or open-file actions when an existing resource can help.",
      "Use status=pass only when the learner has enough ownership to continue.",
      "Use status=almost for a focused follow-up. Set shouldAdvance=true only if the missing detail is minor.",
      "Use status=skip when the learner cannot answer and needs to continue with assistance recorded.",
      "Return structured statePatch updates. The app will validate and apply them; do not assume direct mutation."
    ].join("\n");
}

export function buildConstructInteractPrompt(input: ConstructInteractRuntimeInput, toolDriven: boolean): string {
  if (toolDriven) {
    return [
      `Project id: ${input.projectId}`,
      `Current block id: ${input.blockId}`,
      `Tape spec: ${input.tapeSpec ?? "tape-0.4.2"}`,
      "",
      "Learner message:",
      input.answer || "(empty answer)",
      "",
      "Use the available tools when they help you understand what was authored, what the learner has already seen or opened, and what response would move learning forward. Return a concise learner-facing reply plus structured actions and state updates."
    ].join("\n");
  }

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
    "Tape feature gates:",
    JSON.stringify({
      tapeSpec: input.tapeSpec ?? "unknown",
      generatedLiveSteps: supportsGeneratedLiveSteps(input.tapeSpec ?? "")
    }, null, 2),
    "",
    "Scoped Construct Interact tool guidance:",
    [
      "Use the read-only tools when you need more context. Available tools include getCurrentStep, getStepById, getPreviousSteps, getNextSteps, getCurrentBlock, getConceptCard, findWhereConceptWasIntroduced, searchTape, getLearnerState, getProjectLearnerState, getKnowledgeBase, getRecallHistory, getConstructInteractHistory, getStepFiles, readWorkspaceFile, and getLatestTerminalOutput.",
      "Use the smallest relevant set. If no tool is needed, answer directly from the prompt and rubric.",
      "When existing content directly addresses the gap, return an action instead of generatedLiveSteps."
    ].join("\n"),
    "",
    "Return a concise learner-facing reply, statePatch updates for covered and missing concepts, optional structured actions, and optional generatedLiveSteps."
  ].join("\n");
}
