import path from "node:path";
import { readFile } from "node:fs/promises";

import type {
  ConstructInteractRuntimeInput,
  ConstructInteractToolCallRecord,
  ConstructLearningState
} from "../shared/constructLearning";

type ToolProject = {
  id: string;
  title: string;
  workspacePath: string;
  program: {
    steps: Array<{
      id?: string;
      title?: string;
      teaches?: string[];
      requires?: string[];
      blocks: Array<Record<string, unknown> & { id: string; kind?: string }>;
    }>;
    concepts?: unknown[];
    references?: unknown[];
  };
  currentStepIndex: number;
  currentBlockIndex: number;
};

export async function buildConstructInteractToolContext(input: {
  project: ToolProject;
  request: Omit<ConstructInteractRuntimeInput, "learningState">;
  learningState: ConstructLearningState;
  latestTerminalOutput?: string;
}): Promise<{
  toolContext: Record<string, unknown>;
  toolCalls: ConstructInteractToolCallRecord[];
}> {
  const toolCalls: ConstructInteractToolCallRecord[] = [];
  const toolContext: Record<string, unknown> = {
    availableTools: [
      "getCurrentStep",
      "getStepById",
      "getPreviousSteps",
      "getNextSteps",
      "getCurrentBlock",
      "getConceptCard",
      "findWhereConceptWasIntroduced",
      "searchTape",
      "getLearnerState",
      "getProjectLearnerState",
      "getKnowledgeBase",
      "getRecallHistory",
      "getConstructInteractHistory",
      "getStepFiles",
      "readWorkspaceFile",
      "getLatestTerminalOutput"
    ]
  };

  const callTool = async (name: string, reason: string, output: unknown, toolInput?: unknown) => {
    toolCalls.push({
      id: `${name}-${toolCalls.length + 1}`,
      name,
      reason,
      input: toolInput,
      outputPreview: preview(output),
      createdAt: new Date().toISOString()
    });
    toolContext[name] = output;
  };

  const currentStep = summarizeStep(input.project.program.steps[input.project.currentStepIndex], input.project.currentStepIndex);
  const currentBlock = input.project.program.steps[input.project.currentStepIndex]?.blocks[input.project.currentBlockIndex] ?? null;
  await callTool("getCurrentStep", "Anchor the learner answer to the active authored tape step.", currentStep);
  await callTool("getCurrentBlock", "Compare the answer against the active Construct Interact block.", currentBlock);

  const requestedConcepts = uniqueStrings([
    ...(input.request.resources?.concepts ?? []),
    ...extractConceptIds(currentBlock)
  ]);
  if (requestedConcepts.length > 0) {
    const conceptCards = requestedConcepts
      .map((conceptId) => conceptObjects(input.project.program.concepts).find((concept) => concept.id === conceptId))
      .filter(Boolean);
    await callTool("getConceptCard", "Inspect relevant concept cards before generating new help.", conceptCards, { conceptIds: requestedConcepts });
    await callTool(
      "findWhereConceptWasIntroduced",
      "Prefer sending the learner back to the authored introduction when it exists.",
      requestedConcepts.map((conceptId) => ({
        conceptId,
        steps: input.project.program.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step.teaches?.includes(conceptId) || step.blocks.some((block) => extractConceptIds(block).includes(conceptId)))
          .map(({ step, index }) => summarizeStep(step, index))
      })),
      { conceptIds: requestedConcepts }
    );
  }

  if (input.project.currentStepIndex > 0 || missingPrereqSignal(input.request.answer)) {
    await callTool(
      "getPreviousSteps",
      "Check whether the remediation already exists in completed or previous authored steps.",
      input.project.program.steps
        .slice(Math.max(0, input.project.currentStepIndex - 4), input.project.currentStepIndex)
        .map((step, offset) => summarizeStep(step, Math.max(0, input.project.currentStepIndex - 4) + offset))
    );
  }

  await callTool(
    "getProjectLearnerState",
    "Inspect project-specific recall, assistance, generated live steps, and concept weakness.",
    input.learningState.projects[input.project.id] ?? null,
    { projectId: input.project.id }
  );

  const projectState = input.learningState.projects[input.project.id];
  if ((projectState?.recallAttempts.length ?? 0) > 0) {
    await callTool("getRecallHistory", "Use recent recall outcomes to decide whether this is a weak prerequisite.", projectState?.recallAttempts.slice(-8) ?? []);
  }
  if ((projectState?.constructInteractSessions.length ?? 0) > 0) {
    await callTool("getConstructInteractHistory", "Use recent Construct Interact attempts without relying only on the latest answer.", projectState?.constructInteractSessions.slice(-8) ?? []);
  }

  if (input.request.resources?.files?.length) {
    await callTool("getStepFiles", "Inspect file references explicitly scoped by the current interact block.", input.request.resources.files);
    const readableFiles = await Promise.all(
      input.request.resources.files.slice(0, 3).map(async (filePath) => ({
        path: filePath,
        content: await readWorkspaceFile(input.project, filePath)
      }))
    );
    await callTool("readWorkspaceFile", "Read only files referenced by the authored interact block.", readableFiles);
  }

  if (terminalSignal(input.request.answer) || input.latestTerminalOutput) {
    await callTool("getLatestTerminalOutput", "Use latest terminal output when the learner mentions an error or command result.", (input.latestTerminalOutput ?? "").slice(-4000));
  }

  return { toolContext, toolCalls };
}

function summarizeStep(step: ToolProject["program"]["steps"][number] | undefined, index: number) {
  if (!step) return null;
  return {
    id: step.id ?? `step-${index + 1}`,
    index,
    title: step.title ?? `Step ${index + 1}`,
    teaches: step.teaches ?? [],
    requires: step.requires ?? [],
    blocks: step.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      title: typeof block.title === "string" ? block.title : undefined,
      prompt: typeof block.prompt === "string" ? block.prompt.slice(0, 700) : undefined,
      task: typeof block.task === "string" ? block.task.slice(0, 700) : undefined,
      content: typeof block.content === "string" ? block.content.slice(0, 700) : undefined,
      concepts: extractConceptIds(block)
    }))
  };
}

function extractConceptIds(block: Record<string, unknown> | null): string[] {
  if (!block) return [];
  const values = [
    ...(Array.isArray(block.concepts) ? block.concepts : []),
    ...(Array.isArray(block.uses) ? block.uses : []),
    ...((block.resources && typeof block.resources === "object" && Array.isArray((block.resources as { concepts?: unknown }).concepts))
      ? ((block.resources as { concepts: unknown[] }).concepts)
      : [])
  ];
  return uniqueStrings(values.filter((value): value is string => typeof value === "string"));
}

function conceptObjects(concepts: unknown[] | undefined): Array<Record<string, unknown> & { id: string }> {
  return (concepts ?? []).filter((concept): concept is Record<string, unknown> & { id: string } => (
    typeof concept === "object" &&
    concept !== null &&
    typeof (concept as { id?: unknown }).id === "string"
  ));
}

async function readWorkspaceFile(project: ToolProject, relativePath: string): Promise<string> {
  const workspace = path.resolve(project.workspacePath);
  const normalized = path.normalize(relativePath);
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return "[blocked: invalid project-relative path]";
  }
  const resolved = path.resolve(workspace, normalized);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    return "[blocked: path escaped project workspace]";
  }
  try {
    return (await readFile(resolved, "utf8")).slice(0, 5000);
  } catch (error) {
    return `[unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function terminalSignal(answer: string): boolean {
  return /\b(error|failed|terminal|command|stack|trace|stderr|stdout|npm|pnpm|test)\b/i.test(answer);
}

function missingPrereqSignal(answer: string): boolean {
  return /\b(confused|stuck|don't understand|do not understand|lost|why|how)\b/i.test(answer);
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1600);
  } catch {
    return String(value).slice(0, 1600);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
