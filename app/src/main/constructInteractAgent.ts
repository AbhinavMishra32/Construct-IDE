import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentTools, type ConstructAgentTraceEntry } from "./constructAgentRuntime";
import type {
  ConstructInteractAction,
  ConstructInteractResult,
  ConstructInteractRuntimeInput
} from "../shared/constructLearning";
import { supportsConstructInteract, supportsGeneratedLiveSteps, supportsToolDrivenInteract } from "../shared/tapeFeatures";
import { isCompleteLearnerFacingReply } from "./constructInteractReply";

export const CONSTRUCT_INTERACT_AGENT_ID = "construct-interact-agent";
export const CONSTRUCT_INTERACT_AGENT_NAME = "Construct Interact";

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
    type: z.literal("focus-code"),
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    anchor: z.string().optional(),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("focus-terminal"),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("run-terminal-command"),
    command: z.string().min(1),
    cwd: z.string().optional(),
    label: z.string().min(1),
    reason: z.string().min(1)
  }),
]);

const ConstructInteractResultBaseSchema = z.object({
  requestedOutcome: z.enum([
    "answer",
    "clarify",
    "navigate",
    "create-dynamic-steps",
    "edit-project",
    "run-command"
  ]),
  reply: z.string().min(2).refine((value) => !looksInternalReplyLabel(value), {
    message: "Reply must be learner-facing prose, not an internal label."
  }).refine(isCompleteLearnerFacingReply, {
    message: "Reply must be complete prose with balanced Markdown delimiters."
  }),
  actions: z.array(ConstructInteractActionSchema).max(6).default([])
});

function constructInteractResultSchema() {
  return ConstructInteractResultBaseSchema.superRefine((value, context) => {
    if (value.requestedOutcome === "clarify" && !value.reply.includes("?")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reply"],
        message: "A clarify outcome must contain a learner-facing question."
      });
    }
  });
}

function looksInternalReplyLabel(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/i.test(value.trim());
}

export async function runConstructInteract(
  input: ConstructInteractRuntimeInput,
  onTrace?: (entry: ConstructAgentTraceEntry) => void,
  tools?: ConstructAgentTools,
  options?: { abortSignal?: AbortSignal }
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
    instructions: buildConstructInteractInstructions({
      canGenerateLiveSteps,
      formalToolDrivenSpec,
      mode: input.mode ?? "lesson-check"
    }),
    prompt: buildConstructInteractPrompt(input, toolDriven),
    schema: constructInteractResultSchema(),
    tools,
    maxSteps: 12,
    abortSignal: options?.abortSignal,
    maxRetries: 2,
    onTrace
  });
  return {
    ...result,
    status: "continue",
    confidence: "low",
    coveredConceptIds: [],
    missingConceptIds: [],
    assistanceLevel: "none",
    shouldAdvance: false,
    actions: result.actions ?? []
  };
}

export function buildConstructInteractInstructions({
  canGenerateLiveSteps,
  formalToolDrivenSpec,
  mode
}: {
  canGenerateLiveSteps: boolean;
  formalToolDrivenSpec: boolean;
  mode?: ConstructInteractRuntimeInput["mode"];
}): string {
  const isGeneralMode = mode === "general";
  return [
    isGeneralMode
      ? "You are Construct Interact, a general-purpose project agent inside Construct IDE."
      : "You are Construct Interact, an active learning agent inside Construct IDE.",
    "Complete the user's actual request. Do not substitute navigation, advice, or a promise for an action the available tools can perform.",
    "Choose tools from the situation, not from a fixed checklist. Run independent reads together when possible and do not repeat a tool without a new reason.",
    "Finish tool work before returning. Never end with 'let me check', 'I will create', or similar future-tense filler.",
    "Match the response to the request. Do not add canned project introductions, capability menus, message-type classifications, or generic suggested topics.",
    "Never claim wording or project state without tool evidence. Preserve whether evidence came from a tape step, concept card, reference, workspace file, or terminal output.",
    "The final reply must be complete learner-facing prose with balanced Markdown. The structured result contains only requestedOutcome, reply, and optional UI actions.",
    "Do not place confidence, pass/fail status, assistance level, learning-state patches, or Dynamic Step JSON in the final structured result.",
    isGeneralMode
      ? "Do not assess ordinary project chat. If the user asks for file or terminal work, use the available workspace tools and return a relevant UI action."
      : "Call recordLearnerAssessment only when this turn genuinely evaluates learner understanding. That tool is the only place for confidence, pass/fail status, assistance level, concept coverage, or advancement.",
    canGenerateLiveSteps
      ? "When the user asks for new or expanded learning steps, set requestedOutcome=create-dynamic-steps and create them with createDynamicStep. Do not return step content in the final object."
      : "This tape cannot create Dynamic Steps. Use existing tape resources or explain the limitation without inventing an action.",
    canGenerateLiveSteps
      ? "Before createDynamicStep, inspect the authored tape with getTapeOverview and the relevant getTapeStep/getTapeStepBlock or file tools. Match its actual structure and use any useful combination of explain, guide, interact, edit, recall, run, expect, and checkpoint blocks."
      : "Prefer grounded go-to-step, open-concept, open-file, focus-code, or terminal actions.",
    canGenerateLiveSteps
      ? "Write proposed Dynamic Steps as real .construct ::step source. Use parseDynamicStep or compileDynamicStep while drafting when useful; createDynamicStep performs the final production compiler validation."
      : null,
    formalToolDrivenSpec
      ? "This tape uses tape-0.4.2 agentic Interact; resource ids are discovery hints, not preloaded evidence."
      : "Apply the same agentic behavior to this compatible tape version."
  ].filter(Boolean).join("\n");
}

export function buildConstructInteractPrompt(input: ConstructInteractRuntimeInput, toolDriven: boolean): string {
  if (input.mode === "general") {
    return [
      `Project id: ${input.projectId}`,
      `Construct Interact mode: general`,
      `Synthetic chat block id: ${input.blockId}`,
      `Tape spec: ${input.tapeSpec ?? "unknown"}`,
      "",
      "User message:",
      input.answer || "(empty message)",
      "",
      "Current project context:",
      JSON.stringify(input.projectContext ?? {}, null, 2),
      "",
      "Scoped resources:",
      JSON.stringify(input.resources, null, 2),
      "",
      "General-mode tool guidance:",
      [
        "Use read tools when you need authored tape, learner state, workspace, or terminal context.",
        "Use writeWorkspaceFile, appendWorkspaceFile, or createWorkspaceFolder only when the user clearly asks for a file/project change or the change is the obvious next step.",
        "Return UI actions for concrete next moves: focus-code, open-file, go-to-step, open-concept, focus-terminal, or run-terminal-command.",
        "If you say a file changed, the file-writing tool must have succeeded in this run.",
        "If a terminal command should run, return run-terminal-command instead of only telling the user to run it.",
        "Keep the reply proportional to the request. Do not include a project introduction or capability list unless it directly answers the user."
      ].filter(Boolean).join("\n"),
      "",
      "Return a concise project-facing reply and concrete UI actions."
    ].join("\n");
  }

  if (toolDriven) {
    return [
      `Project id: ${input.projectId}`,
      `Current block id: ${input.blockId}`,
      `Tape spec: ${input.tapeSpec ?? "tape-0.4.2"}`,
      "",
      "Learner message:",
      input.answer || "(empty answer)",
      "",
      "Use tools when they help establish authored content, learner history, or the requested action. Record an assessment only when this is actually an evaluation. Return concise learner-facing prose and optional UI actions."
    ].filter(Boolean).join("\n");
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
      dynamicSteps: supportsGeneratedLiveSteps(input.tapeSpec ?? "")
    }, null, 2),
    "",
    "Scoped Construct Interact tool guidance:",
    [
      "Use the available tape, learner, workspace, and terminal tools only when they improve the answer or complete the requested action.",
      "Use the smallest relevant set. If no tool is needed, answer directly from the prompt and rubric.",
      "For requested Dynamic Steps, inspect the authored tape and create compiler-validated steps through createDynamicStep instead of returning step JSON."
    ].join("\n"),
    "",
    "Return a concise learner-facing reply and optional structured UI actions."
  ].filter(Boolean).join("\n");
}
