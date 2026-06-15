import path from "node:path";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import type {
  ConstructInteractAssessment,
  ConstructInteractRuntimeInput,
  ConstructInteractToolCallRecord,
  ConstructLearningState,
  DynamicStepDraft
} from "../shared/constructLearning";
import { supportsGeneratedLiveSteps } from "../shared/tapeFeatures";
import {
  createConstructTapeAgentTools,
  createLearnerAssessmentTool,
  type ConstructTapeToolProject
} from "./agent-tools/constructTapeTools";

type ToolProject = ConstructTapeToolProject & {
  id: string;
  title: string;
  workspacePath: string;
  program: ConstructTapeToolProject["program"] & {
    steps: Array<{
      id?: string;
      title?: string;
      teaches?: string[];
      requires?: string[];
      blocks: Array<Record<string, unknown> & { id: string; kind?: string }>;
    }>;
    concepts?: unknown[];
    references?: Array<Record<string, unknown> & { id: string }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
};

export function createConstructInteractTools(input: {
  project: ToolProject;
  request: Omit<ConstructInteractRuntimeInput, "learningState">;
  learningState: ConstructLearningState;
  latestTerminalOutput?: string;
  sourceBlockId?: string;
  sourceStepId?: string;
  sourceRunId?: string;
  onToolCallStart?: (record: Omit<ConstructInteractToolCallRecord, "outputPreview">) => void;
  onToolCall?: (record: ConstructInteractToolCallRecord) => void;
}): {
  tools: ToolsInput;
  toolCalls: ConstructInteractToolCallRecord[];
  dynamicSteps: DynamicStepDraft[];
  getAssessment: () => ConstructInteractAssessment | undefined;
} {
  const toolCalls: ConstructInteractToolCallRecord[] = [];
  const recordToolCall = async <T>(name: string, reason: string, output: T | Promise<T>, toolInput?: unknown): Promise<T> => {
    const baseRecord = {
      id: `${name}-${toolCalls.length + 1}`,
      name,
      reason,
      input: toolInput,
      createdAt: new Date().toISOString()
    } satisfies Omit<ConstructInteractToolCallRecord, "outputPreview">;
    input.onToolCallStart?.(baseRecord);
    const resolvedOutput = await output;
    const record: ConstructInteractToolCallRecord = {
      ...baseRecord,
      outputPreview: preview(resolvedOutput)
    };
    toolCalls.push(record);
    input.onToolCall?.(record);
    return resolvedOutput;
  };

  const tapeTools = createConstructTapeAgentTools({
    project: input.project,
    recordToolCall,
    canCreateDynamicSteps: supportsGeneratedLiveSteps(input.request.tapeSpec ?? input.project.program.spec ?? ""),
    sourceBlockId: input.sourceBlockId ?? input.request.blockId,
    sourceStepId: input.sourceStepId,
    sourceRunId: input.sourceRunId
  });
  const learnerAssessment = createLearnerAssessmentTool(recordToolCall);

  const getCurrentStep = createTool({
    id: "getCurrentStep",
    description: "Read the active authored tape step. Use this when you need to anchor the learner answer to the current lesson.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getCurrentStep",
      "Active lesson step",
      summarizeStep(input.project.program.steps[input.project.currentStepIndex], input.project.currentStepIndex)
    )
  });

  const getStepById = createTool({
    id: "getStepById",
    description: "Read one authored tape step by id.",
    inputSchema: z.object({ stepId: z.string().min(1) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getStepById",
      "Requested lesson step",
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
        "Previous lesson steps",
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
      "Upcoming lesson steps",
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
      "Current question block",
      summarizeBlock(input.project.program.steps[input.project.currentStepIndex]?.blocks[input.project.currentBlockIndex] ?? null)
    )
  });

  const getAuthoredResources = createTool({
    id: "getAuthoredResources",
    description: "Resolve the current interact block's authored resource ids into provenance-labeled steps, concept cards, reference cards, files, and learner engagement. Use this before recommending remediation or quoting a source.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getAuthoredResources",
      "Authored resources",
      buildAuthoredResourceContext(input)
    )
  });

  const getConceptCard = createTool({
    id: "getConceptCard",
    description: "Read concept cards by id. Use this only for concepts relevant to the learner answer or current block.",
    inputSchema: z.object({ conceptIds: z.array(z.string().min(1)).min(1).max(5) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getConceptCard",
      "Relevant concept cards",
      uniqueStrings(toolInput.conceptIds)
        .map((conceptId) => conceptResource(input, conceptId))
        .filter(Boolean),
      toolInput
    )
  });

  const getReferenceCard = createTool({
    id: "getReferenceCard",
    description: "Read authored reference cards by id. Reference-card wording is not step wording; preserve that provenance when quoting it.",
    inputSchema: z.object({ referenceIds: z.array(z.string().min(1)).min(1).max(5) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getReferenceCard",
      "Authored reference cards",
      uniqueStrings(toolInput.referenceIds)
        .map((referenceId) => referenceResource(input.project.program.references, referenceId))
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
      "Concept introduction points",
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
      return recordToolCall("searchTape", "Authored lesson search results", results, toolInput);
    }
  });

  const getLearnerState = createTool({
    id: "getLearnerState",
    description: "Read a compact global learner summary relevant to this request.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getLearnerState",
      "Global learner state",
      buildLearnerStateSummary(input.learningState, input.request.resources?.concepts ?? [])
    )
  });

  const getProjectLearnerState = createTool({
    id: "getProjectLearnerState",
    description: "Read a compact learner summary for this project: recent recall, assistance, generated steps, and concept weakness.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getProjectLearnerState",
      "Project learner state",
      buildProjectLearnerStateSummary(input.learningState, input.project.id),
      { projectId: input.project.id }
    )
  });

  const getKnowledgeBase = createTool({
    id: "getKnowledgeBase",
    description: "Read saved knowledge records for this project.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getKnowledgeBase",
      "Saved project knowledge",
      Object.values(input.learningState.knowledgeBase.concepts).filter((record) => record.sourceProjectId === input.project.id)
    )
  });

  const getRecallHistory = createTool({
    id: "getRecallHistory",
    description: "Read recent recall attempts for this project.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(12).default(8) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getRecallHistory",
      "Recent recall attempts",
      (input.learningState.projects[input.project.id]?.recallAttempts ?? []).slice(-(toolInput.limit ?? 8)),
      toolInput
    )
  });

  const getConstructInteractHistory = createTool({
    id: "getConstructInteractHistory",
    description: "Read compact recent Construct Interact outcomes for this project. Traces and full tool payloads are intentionally omitted.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(12).default(8) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "getConstructInteractHistory",
      "Recent Construct Interact attempts",
      buildConstructInteractHistorySummary(input.learningState, input.project.id, toolInput.limit ?? 8),
      toolInput
    )
  });

  const getStepFiles = createTool({
    id: "getStepFiles",
    description: "List files explicitly scoped by the current interact block.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getStepFiles",
      "Scoped file references",
      input.request.resources?.files ?? []
    )
  });

  const readWorkspaceFileTool = createTool({
    id: "readWorkspaceFile",
    description: "Read a project-relative workspace file. Only use files scoped by the current interact block or clearly needed for the answer.",
    inputSchema: z.object({ path: z.string().min(1) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "readWorkspaceFile",
      `Project file: ${toolInput.path}`,
      { path: toolInput.path, content: await readWorkspaceFile(input.project, toolInput.path) },
      toolInput
    )
  });

  const writeWorkspaceFileTool = createTool({
    id: "writeWorkspaceFile",
    description: "Create or replace a project-relative workspace file. Available only in general Construct Interact.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string()
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "writeWorkspaceFile",
      `Project file: ${toolInput.path}`,
      await writeWorkspaceFile(input.project, toolInput.path, toolInput.content),
      toolInput
    )
  });

  const appendWorkspaceFileTool = createTool({
    id: "appendWorkspaceFile",
    description: "Append text to a project-relative workspace file. Available only in general Construct Interact.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string()
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "appendWorkspaceFile",
      `Project file: ${toolInput.path}`,
      await appendWorkspaceFile(input.project, toolInput.path, toolInput.content),
      toolInput
    )
  });

  const createWorkspaceFolderTool = createTool({
    id: "createWorkspaceFolder",
    description: "Create a project-relative workspace folder. Available only in general Construct Interact.",
    inputSchema: z.object({ path: z.string().min(1) }).strict(),
    execute: async (toolInput) => recordToolCall(
      "createWorkspaceFolder",
      `Project folder: ${toolInput.path}`,
      await createWorkspaceFolder(input.project, toolInput.path),
      toolInput
    )
  });

  const getLatestTerminalOutput = createTool({
    id: "getLatestTerminalOutput",
    description: "Read the latest terminal output. Use only when the learner mentions an error, command, or terminal result.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "getLatestTerminalOutput",
      "Latest terminal output",
      (input.latestTerminalOutput ?? "").slice(-4000)
    )
  });

  const tools: ToolsInput = {
    ...tapeTools.tools,
    getCurrentStep,
    getStepById,
    getPreviousSteps,
    getNextSteps,
    getCurrentBlock,
    getAuthoredResources,
    getConceptCard,
    getReferenceCard,
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
  };

  if (input.request.mode === "general") {
    tools.writeWorkspaceFile = writeWorkspaceFileTool;
    tools.appendWorkspaceFile = appendWorkspaceFileTool;
    tools.createWorkspaceFolder = createWorkspaceFolderTool;
  } else {
    tools.recordLearnerAssessment = learnerAssessment.tool;
  }

  return {
    toolCalls,
    tools,
    dynamicSteps: tapeTools.dynamicSteps,
    getAssessment: learnerAssessment.getAssessment
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
    sourceType: "authored-step",
    blocks: step.blocks.map(summarizeBlock)
  };
}

function summarizeBlock(block: (Record<string, unknown> & { id: string; kind?: string }) | null) {
  if (!block) return null;
  return {
    sourceType: "authored-step-block",
    id: block.id,
    kind: block.kind,
    title: typeof block.title === "string" ? block.title : undefined,
    prompt: typeof block.prompt === "string" ? block.prompt.slice(0, 1200) : undefined,
    basis: typeof block.basis === "string" ? block.basis.slice(0, 1200) : undefined,
    understanding: typeof block.understanding === "string" ? block.understanding.slice(0, 1200) : undefined,
    assessment: typeof block.assessment === "string" ? block.assessment.slice(0, 1200) : undefined,
    task: typeof block.task === "string" ? block.task.slice(0, 1200) : undefined,
    content: typeof block.content === "string" ? block.content.slice(0, 2400) : undefined,
    concepts: extractConceptIds(block),
    resources: block.resources && typeof block.resources === "object" ? block.resources : undefined
  };
}

export function buildAuthoredResourceContext(input: Parameters<typeof createConstructInteractTools>[0]) {
  const resourceIds = input.request.resources;
  return {
    sourceType: "authored-resource-map",
    steps: (resourceIds.steps ?? [])
      .map((stepId) => input.project.program.steps
        .map((step, index) => ({ step, index }))
        .find(({ step, index }) => (step.id ?? `step-${index + 1}`) === stepId))
      .filter((match): match is { step: ToolProject["program"]["steps"][number]; index: number } => Boolean(match))
      .map(({ step, index }) => summarizeStep(step, index)),
    concepts: (resourceIds.concepts ?? []).map((conceptId) => conceptResource(input, conceptId)).filter(Boolean),
    references: (resourceIds.references ?? []).map((referenceId) => referenceResource(input.project.program.references, referenceId)).filter(Boolean),
    files: (resourceIds.files ?? []).map((file) => ({ sourceType: "authored-file-reference", path: file }))
  };
}

export function buildLearnerStateSummary(
  state: ConstructLearningState,
  relevantConceptIds: string[]
) {
  const relevantConcepts = Object.fromEntries(uniqueStrings(relevantConceptIds)
    .map((conceptId) => [conceptId, state.learner.globalConceptUnderstanding[conceptId]])
    .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])));
  return {
    sourceType: "global-learner-summary",
    preferences: state.learner.preferences,
    relevantConceptUnderstanding: relevantConcepts,
    recentAssistance: state.learner.assistanceEvents.slice(-6),
    projectCount: Object.keys(state.projects).length,
    savedConceptCount: Object.keys(state.knowledgeBase.concepts).length,
    updatedAt: state.sync.updatedAt
  };
}

export function buildProjectLearnerStateSummary(state: ConstructLearningState, projectId: string) {
  const project = state.projects[projectId];
  if (!project) return null;
  return {
    sourceType: "project-learner-summary",
    projectId,
    currentPosition: project.currentPosition,
    conceptUnderstanding: project.conceptUnderstanding,
    conceptEngagement: project.conceptEngagement,
    recentRecallAttempts: project.recallAttempts.slice(-8),
    recentAssistance: project.assistanceEvents.slice(-8),
    activeOverlays: project.plannedOverlays.filter((overlay) => overlay.enabled),
    dynamicSteps: project.generatedLiveSteps.slice(-8).map((step) => ({
      id: step.id,
      title: step.title,
      reason: step.reason,
      status: step.status,
      conceptIds: step.conceptIds,
      createdAt: step.createdAt
    })),
    interactAttemptCount: project.constructInteractSessions.length
  };
}

export function buildConstructInteractHistorySummary(
  state: ConstructLearningState,
  projectId: string,
  limit: number
) {
  return (state.projects[projectId]?.constructInteractSessions ?? [])
    .slice(-Math.max(1, Math.min(limit, 12)))
    .map((session) => ({
      id: session.id,
      blockId: session.blockId,
      mode: session.mode,
      answer: session.answer.slice(0, 600),
      reply: session.reply.slice(0, 900),
      assessment: session.assessment,
      dynamicStepCount: (session.dynamicSteps ?? session.generatedLiveSteps)?.length ?? 0,
      runStatus: session.runStatus,
      createdAt: session.createdAt,
      durationMs: session.durationMs
    }));
}

function conceptResource(input: Parameters<typeof createConstructInteractTools>[0], conceptId: string) {
  const concept = conceptObjects(input.project.program.concepts).find((candidate) => candidate.id === conceptId);
  if (!concept) return null;
  const projectState = input.learningState.projects[input.project.id];
  const engagement = projectState?.conceptEngagement?.[conceptId];
  const saved = input.learningState.knowledgeBase.concepts[`${input.project.id}:${conceptId}`];
  return {
    sourceType: "authored-concept-card",
    concept,
    engagement: {
      opened: Boolean(engagement),
      openCount: engagement?.openCount ?? 0,
      firstOpenedAt: engagement?.firstOpenedAt,
      lastOpenedAt: engagement?.lastOpenedAt,
      saved: Boolean(saved),
      savedAt: saved?.savedAt
    }
  };
}

function referenceResource(references: ToolProject["program"]["references"], referenceId: string) {
  const reference = references?.find((candidate) => candidate.id === referenceId);
  return reference ? { sourceType: "authored-reference-card", reference } : null;
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
  const target = resolveWorkspacePath(project, relativePath);
  if (!target.ok) return `[blocked: ${target.reason}]`;
  try {
    return (await readFile(target.resolved, "utf8")).slice(0, 5000);
  } catch (error) {
    return `[unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

async function writeWorkspaceFile(project: ToolProject, relativePath: string, content: string) {
  const target = resolveWorkspacePath(project, relativePath);
  if (!target.ok) return { path: relativePath, status: "blocked", reason: target.reason };
  await mkdir(path.dirname(target.resolved), { recursive: true });
  await writeFile(target.resolved, content, "utf8");
  return { path: target.normalized, status: "written", bytes: Buffer.byteLength(content, "utf8") };
}

async function appendWorkspaceFile(project: ToolProject, relativePath: string, content: string) {
  const target = resolveWorkspacePath(project, relativePath);
  if (!target.ok) return { path: relativePath, status: "blocked", reason: target.reason };
  await mkdir(path.dirname(target.resolved), { recursive: true });
  await appendFile(target.resolved, content, "utf8");
  return { path: target.normalized, status: "appended", bytes: Buffer.byteLength(content, "utf8") };
}

async function createWorkspaceFolder(project: ToolProject, relativePath: string) {
  const target = resolveWorkspacePath(project, relativePath);
  if (!target.ok) return { path: relativePath, status: "blocked", reason: target.reason };
  await mkdir(target.resolved, { recursive: true });
  return { path: target.normalized, status: "created" };
}

function resolveWorkspacePath(
  project: ToolProject,
  relativePath: string
): { ok: true; workspace: string; normalized: string; resolved: string } | { ok: false; reason: string } {
  const workspace = path.resolve(project.workspacePath);
  const normalized = path.normalize(relativePath);
  if (
    path.isAbsolute(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    return { ok: false, reason: "invalid project-relative path" };
  }
  const resolved = path.resolve(workspace, normalized);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    return { ok: false, reason: "path escaped project workspace" };
  }
  return { ok: true, workspace, normalized, resolved };
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
