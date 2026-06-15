import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import type {
  ConstructInteractAssessment,
  DynamicStepBlock,
  DynamicStepDraft
} from "../../shared/constructLearning";
import { validateConstructSource } from "../../renderer/construct/compiler/pipeline";
import { parseConstructDocument } from "../../renderer/construct/compiler/parser";
import { parseConstructSource } from "../../renderer/construct/lib/parser";
import type { ConstructBlock, ConstructProgram, ConstructStep } from "../../renderer/construct/types";

export type ConstructTapeToolProject = {
  id: string;
  title: string;
  workspacePath: string;
  source?: string;
  program: {
    spec?: string;
    description?: string;
    files?: Array<{ path: string; content: string; language?: string }>;
    steps: Array<{
      id?: string;
      title?: string;
      teaches?: string[];
      requires?: string[];
      blocks: Array<Record<string, unknown> & { id: string; kind?: string }>;
    }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
};

export type AgentToolCallRecorder = <T>(
  name: string,
  reason: string,
  output: T | Promise<T>,
  input?: unknown
) => Promise<T>;

export function createConstructTapeAgentTools(input: {
  project: ConstructTapeToolProject;
  recordToolCall: AgentToolCallRecorder;
  canCreateDynamicSteps: boolean;
  sourceBlockId?: string;
  sourceStepId?: string;
  sourceRunId?: string;
}): {
  tools: ToolsInput;
  dynamicSteps: DynamicStepDraft[];
} {
  const dynamicSteps: DynamicStepDraft[] = [];
  let inspectedTape = false;

  const getTapeOverview = createTool({
    id: "getTapeOverview",
    description: "Inspect the authored tape structure, current position, files, and block kinds before planning or creating Dynamic Steps.",
    inputSchema: z.object({}).strict(),
    execute: async () => {
      inspectedTape = true;
      return input.recordToolCall("getTapeOverview", "Authored tape overview", {
        sourceType: "authored-tape-overview",
        project: {
          id: input.project.id,
          title: input.project.title,
          description: input.project.program.description,
          spec: input.project.program.spec,
          currentStepIndex: input.project.currentStepIndex,
          currentBlockIndex: input.project.currentBlockIndex
        },
        files: (input.project.program.files ?? []).map((file) => ({
          path: file.path,
          language: file.language,
          bytes: Buffer.byteLength(file.content, "utf8")
        })),
        steps: input.project.program.steps.map((step, index) => summarizeTapeStep(step, index))
      });
    }
  });

  const getTapeStep = createTool({
    id: "getTapeStep",
    description: "Read one exact authored tape step, including every block and its original .construct source. Use this to match the tape's real teaching style.",
    inputSchema: z.object({
      stepId: z.string().min(1).optional(),
      stepIndex: z.number().int().min(0).optional()
    }).strict().refine((value) => value.stepId !== undefined || value.stepIndex !== undefined, {
      message: "Provide stepId or stepIndex."
    }),
    execute: async (toolInput) => {
      inspectedTape = true;
      const match = findStep(input.project, toolInput.stepId, toolInput.stepIndex);
      return input.recordToolCall("getTapeStep", "Exact authored tape step", match ? {
        sourceType: "authored-tape-step",
        index: match.index,
        step: match.step,
        source: extractStepSource(input.project.source ?? "", match.step.id ?? `step-${match.index + 1}`)
      } : null, toolInput);
    }
  });

  const getTapeStepBlock = createTool({
    id: "getTapeStepBlock",
    description: "Read one exact block from an authored tape step by block id.",
    inputSchema: z.object({ blockId: z.string().min(1) }).strict(),
    execute: async (toolInput) => {
      inspectedTape = true;
      const match = input.project.program.steps
        .flatMap((step, stepIndex) => step.blocks.map((block, blockIndex) => ({ step, stepIndex, block, blockIndex })))
        .find(({ block }) => block.id === toolInput.blockId);
      return input.recordToolCall("getTapeStepBlock", "Exact authored tape block", match ? {
        sourceType: "authored-tape-block",
        stepId: match.step.id ?? `step-${match.stepIndex + 1}`,
        stepIndex: match.stepIndex,
        blockIndex: match.blockIndex,
        block: match.block
      } : null, toolInput);
    }
  });

  const getTapeFileManifest = createTool({
    id: "getTapeFileManifest",
    description: "Inspect files authored into the tape, including language, size, and optional exact content for a few selected paths.",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).max(6).default([]),
      includeContent: z.boolean().default(false)
    }).strict(),
    execute: async (toolInput) => {
      inspectedTape = true;
      const paths = toolInput.paths ?? [];
      const files = input.project.program.files ?? [];
      const selected = paths.length > 0
        ? files.filter((file) => paths.includes(file.path))
        : files;
      return input.recordToolCall("getTapeFileManifest", "Authored tape files", selected.map((file) => ({
        path: file.path,
        language: file.language,
        bytes: Buffer.byteLength(file.content, "utf8"),
        content: toolInput.includeContent ? file.content.slice(0, 12_000) : undefined
      })), toolInput);
    }
  });

  const parseDynamicStep = createTool({
    id: "parseDynamicStep",
    description: "Parse proposed .construct step source against the real tape grammar and return its syntax tree and diagnostics without saving it.",
    inputSchema: dynamicStepSourceSchema(),
    execute: async (toolInput) => input.recordToolCall(
      "parseDynamicStep",
      "Parse proposed Dynamic Step",
      parseDynamicStepSource(input.project, toolInput.source),
      toolInput
    )
  });

  const compileDynamicStep = createTool({
    id: "compileDynamicStep",
    description: "Compile proposed .construct step source with the production Construct parser, safe fixes, strict parser, and linter without saving it.",
    inputSchema: dynamicStepSourceSchema(),
    execute: async (toolInput) => input.recordToolCall(
      "compileDynamicStep",
      "Compile proposed Dynamic Step",
      compileDynamicStepSource(input.project, toolInput.source),
      toolInput
    )
  });

  const createDynamicStep = createTool({
    id: "createDynamicStep",
    description: "Create one compiler-validated Dynamic Step from real .construct source. The step may use explain, guide, interact, edit, recall, run, expect, and checkpoint blocks just like authored tape steps.",
    inputSchema: z.object({
      source: z.string().min(20).max(30_000),
      reason: z.string().min(4).max(500),
      insertAfterStepId: z.string().min(1).optional(),
      insertBeforeStepId: z.string().min(1).optional()
    }).strict(),
    execute: async (toolInput) => {
      const output = (() => {
        if (!input.canCreateDynamicSteps) {
          return { created: false, reason: `Tape spec ${input.project.program.spec ?? "unknown"} does not support Dynamic Steps.` };
        }
        if (!inspectedTape) {
          return { created: false, reason: "Inspect the authored tape with getTapeOverview, getTapeStep, or getTapeStepBlock before creating a Dynamic Step." };
        }
        if (dynamicSteps.length >= 3) {
          return { created: false, reason: "This run already created the maximum of three Dynamic Steps." };
        }
        const knownStepIds = new Set(input.project.program.steps.map((step, index) => step.id ?? `step-${index + 1}`));
        if (toolInput.insertAfterStepId && !knownStepIds.has(toolInput.insertAfterStepId)) {
          return { created: false, reason: `Unknown insertAfterStepId: ${toolInput.insertAfterStepId}.` };
        }
        if (toolInput.insertBeforeStepId && !knownStepIds.has(toolInput.insertBeforeStepId)) {
          return { created: false, reason: `Unknown insertBeforeStepId: ${toolInput.insertBeforeStepId}.` };
        }
        const compiled = compileDynamicStepSource(input.project, toolInput.source);
        if (!compiled.valid || !compiled.step) {
          return { created: false, reason: "The proposed Dynamic Step did not compile.", diagnostics: compiled.diagnostics };
        }
        const draft: DynamicStepDraft = {
          id: compiled.step.id,
          source: "construct-interact",
          sourceBlockId: input.sourceBlockId,
          sourceStepId: input.sourceStepId,
          sourceRunId: input.sourceRunId,
          insertAfterStepId: toolInput.insertAfterStepId,
          insertBeforeStepId: toolInput.insertBeforeStepId,
          title: compiled.step.title,
          reason: toolInput.reason,
          blocks: compiled.step.blocks.map(toDynamicBlock),
          conceptIds: compiled.step.teaches
        };
        dynamicSteps.push(draft);
        return {
          created: true,
          step: {
            id: draft.id,
            title: draft.title,
            reason: draft.reason,
            blockKinds: draft.blocks.map((block) => block.kind),
            blockCount: draft.blocks.length,
            insertAfterStepId: draft.insertAfterStepId,
            insertBeforeStepId: draft.insertBeforeStepId
          },
          diagnostics: compiled.diagnostics
        };
      })();
      return input.recordToolCall("createDynamicStep", "Create compiler-validated Dynamic Step", output, toolInput);
    }
  });

  return {
    tools: {
      getTapeOverview,
      getTapeStep,
      getTapeStepBlock,
      getTapeFileManifest,
      parseDynamicStep,
      compileDynamicStep,
      createDynamicStep
    },
    dynamicSteps
  };
}

export function createLearnerAssessmentTool(recordToolCall: AgentToolCallRecorder): {
  tool: ToolsInput[string];
  getAssessment: () => ConstructInteractAssessment | undefined;
} {
  let assessment: ConstructInteractAssessment | undefined;
  const tool = createTool({
    id: "recordLearnerAssessment",
    description: "Record a lesson assessment only when the current interaction genuinely evaluates learner understanding. Do not call this for ordinary project chat.",
    inputSchema: z.object({
      status: z.enum(["continue", "pass", "almost", "skip"]),
      confidence: z.enum(["low", "medium", "high"]),
      coveredConceptIds: z.array(z.string().min(1)).max(20).default([]),
      missingConceptIds: z.array(z.string().min(1)).max(20).default([]),
      assistanceLevel: z.enum(["none", "hint", "guided", "answer"]),
      shouldAdvance: z.boolean(),
      reason: z.string().min(4).max(800)
    }).strict(),
    execute: async (toolInput) => {
      assessment = {
        ...toolInput,
        coveredConceptIds: toolInput.coveredConceptIds ?? [],
        missingConceptIds: toolInput.missingConceptIds ?? []
      };
      return recordToolCall("recordLearnerAssessment", "Learner assessment", {
        recorded: true,
        ...toolInput
      }, toolInput);
    }
  });
  return { tool, getAssessment: () => assessment };
}

function dynamicStepSourceSchema() {
  return z.object({ source: z.string().min(20).max(30_000) }).strict();
}

function summarizeTapeStep(step: ConstructTapeToolProject["program"]["steps"][number], index: number) {
  return {
    id: step.id ?? `step-${index + 1}`,
    index,
    title: step.title ?? `Step ${index + 1}`,
    teaches: step.teaches ?? [],
    requires: step.requires ?? [],
    blocks: step.blocks.map((block, blockIndex) => ({
      id: block.id,
      index: blockIndex,
      kind: block.kind,
      path: typeof block.path === "string" ? block.path : undefined,
      command: typeof block.command === "string" ? block.command : undefined
    }))
  };
}

function findStep(project: ConstructTapeToolProject, stepId?: string, stepIndex?: number) {
  if (stepId !== undefined) {
    const index = project.program.steps.findIndex((step, candidateIndex) => (step.id ?? `step-${candidateIndex + 1}`) === stepId);
    return index >= 0 ? { index, step: project.program.steps[index] } : null;
  }
  return stepIndex !== undefined && project.program.steps[stepIndex]
    ? { index: stepIndex, step: project.program.steps[stepIndex] }
    : null;
}

function extractStepSource(source: string, stepId: string): string | null {
  const document = parseConstructDocument(source);
  const node = document.root.children.find((child) => child.kind === "step" && child.attributes.id === stepId);
  return node ? source.slice(node.range.start, node.range.end).trim() : null;
}

export function parseDynamicStepSource(project: ConstructTapeToolProject, source: string) {
  const combined = appendCandidate(project.source ?? "", source);
  const document = parseConstructDocument(combined);
  return {
    spec: document.spec,
    diagnostics: document.diagnostics.map(compactDiagnostic),
    proposedSteps: findProposedStepNodes(project, document.root.children).map((node) => ({
      id: node.attributes.id,
      title: node.attributes.title,
      range: node.range,
      blockKinds: node.children.map((child) => child.kind)
    }))
  };
}

export function compileDynamicStepSource(project: ConstructTapeToolProject, source: string): {
  valid: boolean;
  diagnostics: Array<Record<string, unknown>>;
  appliedFixes: string[];
  step?: ConstructStep;
} {
  const combined = appendCandidate(project.source ?? "", source);
  const validation = validateConstructSource(combined);
  const result = {
    valid: false,
    diagnostics: validation.diagnostics.map(compactDiagnostic),
    appliedFixes: validation.appliedFixes.map((fix) => fix.title)
  };
  if (!validation.valid || validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return result;
  }
  let program: ConstructProgram;
  try {
    program = parseConstructSource(validation.source);
  } catch (error) {
    return {
      ...result,
      diagnostics: [...result.diagnostics, { severity: "error", code: "E_STRICT_PARSE", message: error instanceof Error ? error.message : String(error) }]
    };
  }
  const existingIds = new Set(project.program.steps.map((step, index) => step.id ?? `step-${index + 1}`));
  const proposedSteps = program.steps.filter((step) => !existingIds.has(step.id));
  if (proposedSteps.length !== 1) {
    return {
      ...result,
      diagnostics: [...result.diagnostics, {
        severity: "error",
        code: "E_DYNAMIC_STEP_COUNT",
        message: `Expected exactly one new ::step, found ${proposedSteps.length}.`
      }]
    };
  }
  return { ...result, valid: true, step: proposedSteps[0] };
}

function appendCandidate(source: string, candidate: string): string {
  return `${source.trimEnd()}\n\n${candidate.trim()}\n`;
}

function findProposedStepNodes(project: ConstructTapeToolProject, nodes: ReturnType<typeof parseConstructDocument>["root"]["children"]) {
  const existingIds = new Set(project.program.steps.map((step, index) => step.id ?? `step-${index + 1}`));
  return nodes.filter((node) => node.kind === "step" && node.attributes.id && !existingIds.has(node.attributes.id));
}

function compactDiagnostic(diagnostic: { severity: string; code: string; message: string; line: number; column?: number }) {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column
  };
}

function toDynamicBlock(block: ConstructBlock): DynamicStepBlock {
  switch (block.kind) {
    case "explain":
      return { ...block };
    case "guide":
      return { ...block };
    case "interact":
      return { ...block };
    case "edit":
      return {
        kind: "edit",
        id: block.id,
        path: block.path,
        mode: block.mode,
        typing: block.typing,
        anchor: block.anchor,
        language: block.language,
        content: block.content,
        notes: block.notes
      };
    case "recall":
      return {
        kind: "recall",
        id: block.id,
        mode: block.mode,
        path: block.path,
        target: block.target,
        references: block.references,
        task: block.task,
        support: block.support,
        concepts: block.concepts
      };
    case "run":
      return { ...block };
    case "expect":
      return { ...block };
    case "checkpoint":
      return { ...block };
  }
}
