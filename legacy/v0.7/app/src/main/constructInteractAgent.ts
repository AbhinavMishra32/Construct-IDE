import { createConstructAgentRuntime, type ConstructAgentTools, type ConstructAgentTraceEntry } from "./constructAgentRuntime";
import type {
  ConstructInteractResult,
  ConstructInteractRuntimeInput
} from "../shared/constructLearning";
import { supportsConstructInteract, supportsGeneratedLiveSteps, supportsToolDrivenInteract } from "../shared/tapeFeatures";
import { isCompleteLearnerFacingReply } from "./constructInteractReply";

export const CONSTRUCT_INTERACT_AGENT_ID = "construct-interact-agent";
export const CONSTRUCT_INTERACT_AGENT_NAME = "Construct Interact";

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
  const result = await runtime.runAgentic({
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
    tools,
    maxSteps: 12,
    abortSignal: options?.abortSignal,
    maxRetries: 2,
    onTrace
  });
  const reply = normalizeAgentReply(result.text);
  return {
    reply,
    status: "continue",
    confidence: "low",
    coveredConceptIds: [],
    missingConceptIds: [],
    assistanceLevel: "none",
    shouldAdvance: false,
    actions: [],
    durationMs: result.durationMs
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
    "Short commands like 'go', 'go ahead', 'send me to the next step', and 'debug' are action requests. Use tools and return the completed action or a concrete UI action; do not ask what they want when the project context already says it.",
    "Choose tools from the situation, not from a fixed checklist. Run independent reads together when possible and do not repeat a tool without a new reason.",
    "Finish tool work before returning. Never end with 'let me check', 'I will create', or similar future-tense filler.",
    "Match the response to the request. Do not add canned project introductions, capability menus, message-type classifications, or generic suggested topics.",
    "Never claim wording or project state without tool evidence. Preserve whether evidence came from a tape step, concept card, reference, workspace file, or terminal output.",
    "The final reply must be complete learner-facing prose with balanced Markdown.",
    "Do not return JSON for UI actions. Use UI/action tools when a navigation, focus, file, terminal, or Dynamic Step action is needed.",
    "Do not place confidence, pass/fail status, assistance level, learning-state patches, or Dynamic Step JSON in the final reply.",
    isGeneralMode
      ? "Do not assess ordinary project chat. If the user asks for file or terminal work, use the available workspace tools and return a relevant UI action."
      : "Call recordLearnerAssessment only when this turn genuinely evaluates learner understanding. That tool is the only place for confidence, pass/fail status, assistance level, concept coverage, or advancement.",
    canGenerateLiveSteps
      ? "When the user asks for new or expanded learning steps, create them with createDynamicStep. Do not return step content in the final reply."
      : "This tape cannot create Dynamic Steps. Use existing tape resources or explain the limitation without inventing an action.",
    canGenerateLiveSteps
      ? "When the user asks to edit or improve the next step, use editNextStep to create a compiler-validated adaptive next-step edit before replying."
      : null,
    canGenerateLiveSteps
      ? "Before createDynamicStep, inspect the authored tape with getTapeOverview and the relevant getTapeStep/getTapeStepBlock or file tools. Match its actual structure and use any useful combination of explain, guide, interact, edit, recall, run, expect, and checkpoint blocks."
      : "Prefer grounded go-to-step, open-concept, open-file, focus-code, or terminal actions.",
    canGenerateLiveSteps
      ? "Write proposed Dynamic Steps as real .construct ::step source. Use parseDynamicStep or compileDynamicStep while drafting when useful; createDynamicStep performs the final production compiler validation."
      : null,
    "If tools are needed, call them, observe their results, then continue reasoning and answer. Do not stop after a tool call unless the next expected event is user input.",
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
      "Call UI action tools for concrete next moves: focus-code, open-file, go-to-step, open-concept, focus-terminal, or run-terminal-command.",
        "If you say a file changed, the file-writing tool must have succeeded in this run.",
        "If a terminal command should run, return run-terminal-command instead of only telling the user to run it.",
        "Keep the reply proportional to the request. Do not include a project introduction or capability list unless it directly answers the user."
      ].filter(Boolean).join("\n"),
      "",
      "Return concise project-facing prose after any needed tool work."
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
      "Use tools when they help establish authored content, learner history, or the requested action. Record an assessment only when this is actually an evaluation. Return concise learner-facing prose after tool work."
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
    "Return concise learner-facing prose after any needed tool work."
  ].filter(Boolean).join("\n");
}

function normalizeAgentReply(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "I could not produce a response from the model, but the activity above shows the work completed.";
  }
  return isCompleteLearnerFacingReply(trimmed) ? trimmed : trimmed.replace(/[`*_~]+$/g, "").trim();
}
