import path from "node:path";
import { readFile } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

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

export function createConstructInteractTools(input: {
  project: ToolProject;
  request: Omit<ConstructInteractRuntimeInput, "learningState">;
  learningState: ConstructLearningState;
  latestTerminalOutput?: string;
  onToolCall?: (record: ConstructInteractToolCallRecord) => void;
}): {
  tools: ToolsInput;
  toolCalls: ConstructInteractToolCallRecord[];
} {
  const toolCalls: ConstructInteractToolCallRecord[] = [];
  const recordToolCall = (name: string, reason: string, output: unknown, toolInput?: unknown) => {
    const record: ConstructInteractToolCallRecord = {
      id: `${name}-${toolCalls.length + 1}`,
      name,
      reason,
      input: toolInput,
      outputPreview: preview(output),
      createdAt: new Date().toISOString()
    };
    toolCalls.push(record);
    input.onToolCall?.(record);
    return output;
  };

  const getCurrentStep = createTool({
    id: "getCurrentStep",
    description: "Read the active authored tape step. Use this when you need to anchor the learner answer to the current lesson.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getCurrentStep",
      "Anchor the learner answer to the active authored tape step.",
      summarizeStep(input.project.program.steps[input.project.currentStepIndex], input.project.currentStepIndex)
    )
  });

  const getStepById = createTool({
    id: "getStepById",
    description: "Read one authored tape step by id.",
    inputSchema: z.object({ stepId: z.string().min(1) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getStepById",
      "Inspect a specific authored step requested by the evaluator.",
      input.project.program.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step, index }) => (step.id ?? `step-${index + 1}`) === toolInput.stepId)
        .map(({ step, index }) => summarizeStep(step, index))[0] ?? null,
      toolInput
    )
  });

  const getPreviousSteps = createTool({
    id: "getPreviousSteps",
    description: "Read recent authored steps before the current one. Use only when the learner seems to be missing prerequisite context.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(6).default(4) }).strict(),
    execute: async (toolInput) => {
      const limit = toolInput.limit ?? 4;
      const start = Math.max(0, input.project.currentStepIndex - limit);
      return recordToolCall(
        "getPreviousSteps",
        "Check whether remediation already exists in completed or previous authored steps.",
        input.project.program.steps.slice(start, input.project.currentStepIndex).map((step, offset) => summarizeStep(step, start + offset)),
        toolInput
      );
    }
  });

  const getNextSteps = createTool({
    id: "getNextSteps",
    description: "Read upcoming authored steps. Use when deciding whether to advance or send the learner to a later authored explanation.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(4).default(2) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getNextSteps",
      "Inspect upcoming authored steps before deciding whether to advance.",
      input.project.program.steps
        .slice(input.project.currentStepIndex + 1, input.project.currentStepIndex + 1 + (toolInput.limit ?? 2))
        .map((step, offset) => summarizeStep(step, input.project.currentStepIndex + 1 + offset)),
      toolInput
    )
  });

  const getCurrentBlock = createTool({
    id: "getCurrentBlock",
    description: "Read the active Construct Interact block, including basis, understanding, assessment, and resources.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getCurrentBlock",
      "Compare the answer against the active Construct Interact block.",
      input.project.program.steps[input.project.currentStepIndex]?.blocks[input.project.currentBlockIndex] ?? null
    )
  });

  const getConceptCard = createTool({
    id: "getConceptCard",
    description: "Read concept cards by id. Use this only for concepts relevant to the learner answer or current block.",
    inputSchema: z.object({ conceptIds: z.array(z.string().min(1)).min(1).max(5) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getConceptCard",
      "Inspect relevant concept cards before generating new help.",
      uniqueStrings(toolInput.conceptIds)
        .map((conceptId) => conceptObjects(input.project.program.concepts).find((concept) => concept.id === conceptId))
        .filter(Boolean),
      toolInput
    )
  });

  const findWhereConceptWasIntroduced = createTool({
    id: "findWhereConceptWasIntroduced",
    description: "Find authored steps where a concept appears or was introduced.",
    inputSchema: z.object({ conceptIds: z.array(z.string().min(1)).min(1).max(5) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "findWhereConceptWasIntroduced",
      "Prefer sending the learner back to the authored introduction when it exists.",
      uniqueStrings(toolInput.conceptIds).map((conceptId) => ({
        conceptId,
        steps: input.project.program.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step.teaches?.includes(conceptId) || step.blocks.some((block) => extractConceptIds(block).includes(conceptId)))
          .map(({ step, index }) => summarizeStep(step, index))
      })),
      toolInput
    )
  });

  const searchTape = createTool({
    id: "searchTape",
    description: "Search authored tape steps for a phrase. Use this when you need existing content but do not know the step id.",
    inputSchema: z.object({ query: z.string().min(2).max(80), limit: z.number().int().min(1).max(8).default(5) }).strict(),
    execute: async (toolInput) => {
      const query = toolInput.query.toLowerCase();
      const results = input.project.program.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => JSON.stringify(step).toLowerCase().includes(query))
        .slice(0, toolInput.limit)
        .map(({ step, index }) => summarizeStep(step, index));
      return recordToolCall("searchTape", "Search authored content for an existing explanation.", results, toolInput);
    }
  });

  const getLearnerState = createTool({
    id: "getLearnerState",
    description: "Read the global learner state snapshot.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall("getLearnerState", "Inspect global learner state.", input.learningState)
  });

  const getProjectLearnerState = createTool({
    id: "getProjectLearnerState",
    description: "Read learner state for this project: recall attempts, assistance, generated live steps, and concept weakness.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getProjectLearnerState",
      "Inspect project-specific recall, assistance, generated live steps, and concept weakness.",
      input.learningState.projects[input.project.id] ?? null,
      { projectId: input.project.id }
    )
  });

  const getKnowledgeBase = createTool({
    id: "getKnowledgeBase",
    description: "Read saved knowledge records for this project.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getKnowledgeBase",
      "Inspect saved knowledge records relevant to this project.",
      Object.values(input.learningState.knowledgeBase.concepts).filter((record) => record.sourceProjectId === input.project.id)
    )
  });

  const getRecallHistory = createTool({
    id: "getRecallHistory",
    description: "Read recent recall attempts for this project.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(12).default(8) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getRecallHistory",
      "Use recent recall outcomes to decide whether this is a weak prerequisite.",
      (input.learningState.projects[input.project.id]?.recallAttempts ?? []).slice(-(toolInput.limit ?? 8)),
      toolInput
    )
  });

  const getConstructInteractHistory = createTool({
    id: "getConstructInteractHistory",
    description: "Read recent Construct Interact attempts for this project.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(12).default(8) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getConstructInteractHistory",
      "Use recent Construct Interact attempts without relying only on the latest answer.",
      (input.learningState.projects[input.project.id]?.constructInteractSessions ?? []).slice(-(toolInput.limit ?? 8)),
      toolInput
    )
  });

  const getStepFiles = createTool({
    id: "getStepFiles",
    description: "List files explicitly scoped by the current interact block.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getStepFiles",
      "Inspect file references explicitly scoped by the current interact block.",
      input.request.resources?.files ?? []
    )
  });

  const readWorkspaceFileTool = createTool({
    id: "readWorkspaceFile",
    description: "Read a project-relative workspace file. Only use files scoped by the current interact block or clearly needed for the answer.",
    inputSchema: z.object({ path: z.string().min(1) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "readWorkspaceFile",
      "Read a scoped project file.",
      { path: toolInput.path, content: await readWorkspaceFile(input.project, toolInput.path) },
      toolInput
    )
  });

  const getLatestTerminalOutput = createTool({
    id: "getLatestTerminalOutput",
    description: "Read the latest terminal output. Use only when the learner mentions an error, command, or terminal result.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getLatestTerminalOutput",
      "Use latest terminal output when the learner mentions an error or command result.",
      (input.latestTerminalOutput ?? "").slice(-4000)
    )
  });

  return {
    toolCalls,
    tools: {
      getCurrentStep,
      getStepById,
      getPreviousSteps,
      getNextSteps,
      getCurrentBlock,
      getConceptCard,
      findWhereConceptWasIntroduced,
      searchTape,
      getLearnerState,
      getProjectLearnerState,
      getKnowledgeBase,
      getRecallHistory,
      getConstructInteractHistory,
      getStepFiles,
      readWorkspaceFile: readWorkspaceFileTool,
      getLatestTerminalOutput
    }
  };
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
