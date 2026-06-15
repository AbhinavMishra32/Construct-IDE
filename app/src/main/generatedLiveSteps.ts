import { randomUUID } from "node:crypto";

import type {
  GeneratedLiveStep,
  GeneratedLiveStepDraft,
  GeneratedLiveStepValidationRecord
} from "../shared/constructLearning";
import { normalizeGeneratedMarkdown } from "../shared/generatedLiveSteps";

type ValidationContext = {
  projectId: string;
  sourceBlockId?: string;
  sourceStepId?: string;
  sourceRunId?: string;
  validStepIds: Set<string>;
  validConceptIds: Set<string>;
  now?: string;
};

const MAX_STEPS_PER_GENERATION = 3;
const MAX_TITLE_LENGTH = 80;
const MAX_REASON_LENGTH = 500;
const MAX_BLOCKS_PER_STEP = 8;
const MAX_TEXT_LENGTH = 2200;

export function validateGeneratedLiveStepDrafts(
  drafts: GeneratedLiveStepDraft[] | undefined,
  context: ValidationContext
): {
  steps: GeneratedLiveStep[];
  validation: GeneratedLiveStepValidationRecord[];
} {
  const now = context.now ?? new Date().toISOString();
  const validation: GeneratedLiveStepValidationRecord[] = [];
  const steps: GeneratedLiveStep[] = [];

  for (const draft of (drafts ?? []).slice(0, MAX_STEPS_PER_GENERATION)) {
    const result = validateDraft(draft, context, now);
    validation.push(result.record);
    if (result.step) {
      steps.push(result.step);
    }
  }

  const extraCount = Math.max(0, (drafts?.length ?? 0) - MAX_STEPS_PER_GENERATION);
  if (extraCount > 0) {
    validation.push({
      draftTitle: "extra Dynamic Steps",
      status: "rejected",
      reason: `Rejected ${extraCount} extra draft${extraCount === 1 ? "" : "s"} because generation is capped at ${MAX_STEPS_PER_GENERATION}.`,
      createdAt: now
    });
  }

  return { steps, validation };
}

function validateDraft(
  draft: GeneratedLiveStepDraft,
  context: ValidationContext,
  now: string
): {
  step?: GeneratedLiveStep;
  record: GeneratedLiveStepValidationRecord;
} {
  const rejection = (reason: string) => ({
    record: {
      draftTitle: typeof draft.title === "string" ? draft.title : undefined,
      status: "rejected" as const,
      reason,
      createdAt: now
    }
  });

  if (!draft || typeof draft !== "object") {
    return rejection("Draft is not an object.");
  }

  const title = draft.title?.trim();
  if (!title) {
    return rejection("Title is required.");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return rejection(`Title must be ${MAX_TITLE_LENGTH} characters or less.`);
  }

  const reason = draft.reason?.trim();
  if (!reason) {
    return rejection("Reason is required.");
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return rejection(`Reason must be ${MAX_REASON_LENGTH} characters or less.`);
  }

  if (draft.insertAfterStepId && !context.validStepIds.has(draft.insertAfterStepId)) {
    return rejection(`Invalid insertAfterStepId: ${draft.insertAfterStepId}.`);
  }
  if (draft.insertBeforeStepId && !context.validStepIds.has(draft.insertBeforeStepId)) {
    return rejection(`Invalid insertBeforeStepId: ${draft.insertBeforeStepId}.`);
  }

  if (!Array.isArray(draft.blocks) || draft.blocks.length === 0) {
    return rejection("At least one renderable Dynamic Step block is required.");
  }
  if (draft.blocks.length > MAX_BLOCKS_PER_STEP) {
    return rejection(`A Dynamic Step can contain at most ${MAX_BLOCKS_PER_STEP} blocks.`);
  }

  const blockValidation = draft.blocks.map((block) => validateBlock(block, context.validConceptIds));
  const invalidBlock = blockValidation.find((entry) => !entry.ok);
  if (invalidBlock) {
    return rejection(invalidBlock.reason);
  }

  const conceptIds = uniqueStrings([...(draft.conceptIds ?? []), ...draft.blocks.flatMap(blockConceptIds)])
    .filter((conceptId) => context.validConceptIds.has(conceptId));

  const id = safeId(draft.id) ?? `live-${randomUUID()}`;
  const step: GeneratedLiveStep = {
    id,
    projectId: context.projectId,
    source: draft.source === "adaptive-planner" ? "adaptive-planner" : "construct-interact",
    sourceBlockId: draft.sourceBlockId ?? context.sourceBlockId,
    sourceStepId: draft.sourceStepId ?? context.sourceStepId,
    sourceRunId: draft.sourceRunId ?? context.sourceRunId,
    insertAfterStepId: draft.insertAfterStepId,
    insertBeforeStepId: draft.insertBeforeStepId,
    title,
    reason,
    status: draft.status === "active" ? "active" : "pending",
    blocks: draft.blocks.map((block) => prepareBlock(
      block,
      safeId(block.id) ?? `${id}-${block.kind}-${randomUUID()}`,
      context.validConceptIds
    )),
    conceptIds,
    createdAt: now,
    updatedAt: now
  };

  return {
    step,
    record: {
      draftTitle: title,
      stepId: id,
      status: "accepted",
      reason: "Accepted compiler-validated Dynamic Step.",
      createdAt: now
    }
  };
}

function validateBlock(
  block: GeneratedLiveStepDraft["blocks"][number],
  validConceptIds: Set<string>
): { ok: true } | { ok: false; reason: string } {
  if (!block || typeof block !== "object") {
    return { ok: false, reason: "Block is not an object." };
  }

  if (blockConceptIds(block).some((conceptId) => !validConceptIds.has(conceptId))) {
    return { ok: false, reason: "Block references an unknown concept id." };
  }

  if (block.kind === "explain") {
    return validateText(block.content, "Explain content");
  }

  if (block.kind === "guide") {
    return firstInvalid([
      validateText(block.content, "Guide content"),
      ...(block.sections ?? []).map((section) => validateText(section.content, "Guide section"))
    ]);
  }

  if (block.kind === "interact") {
    return firstInvalid([
      validateText(block.prompt, "Interact prompt"),
      validateText(block.basis, "Interact basis"),
      validateText(block.understanding, "Interact understanding"),
      validateText(block.assessment, "Interact assessment")
    ]);
  }

  if (block.kind === "recall") {
    if (block.mode === "code" && !block.path) {
      return { ok: false, reason: "Code recall requires a project file path." };
    }
    return firstInvalid([
      validateText(block.task, "Recall task"),
      block.support ? validateText(block.support, "Recall support") : { ok: true as const }
    ]);
  }

  if (block.kind === "edit") {
    if (!isSafeRelativePath(block.path)) {
      return { ok: false, reason: "Edit block path must be a safe project-relative path." };
    }
    return firstInvalid([
      validateText(block.content, "Edit content"),
      ...(block.notes ?? []).map((note) => validateText(note.content, "Edit note"))
    ]);
  }

  if (block.kind === "run") {
    return validateText(block.command, "Run command");
  }

  if (block.kind === "expect") {
    return validateText(block.content, "Expectation content");
  }

  if (block.kind === "checkpoint") {
    return validateText(block.content, "Checkpoint content");
  }

  return { ok: false, reason: `Unsupported Dynamic Step block kind: ${(block as { kind?: string }).kind ?? "unknown"}.` };
}

function normalizeBlock(
  block: GeneratedLiveStep["blocks"][number]
): GeneratedLiveStep["blocks"][number] {
  if (block.kind === "explain") {
    return { ...block, content: normalizeGeneratedMarkdown(block.content) };
  }
  if (block.kind === "guide") {
    return {
      ...block,
      content: normalizeGeneratedMarkdown(block.content),
      sections: block.sections?.map((section) => ({
        ...section,
        content: normalizeGeneratedMarkdown(section.content)
      }))
    };
  }
  if (block.kind === "interact") {
    return {
      ...block,
      prompt: normalizeGeneratedMarkdown(block.prompt),
      basis: normalizeGeneratedMarkdown(block.basis),
      understanding: normalizeGeneratedMarkdown(block.understanding),
      assessment: normalizeGeneratedMarkdown(block.assessment)
    };
  }
  if (block.kind === "edit") {
    return {
      ...block,
      notes: block.notes?.map((note) => ({
        ...note,
        content: normalizeGeneratedMarkdown(note.content)
      }))
    };
  }
  if (block.kind === "recall") {
    return {
      ...block,
      task: normalizeGeneratedMarkdown(block.task),
      support: block.support ? normalizeGeneratedMarkdown(block.support) : undefined
    };
  }
  if (block.kind === "expect" || block.kind === "checkpoint") {
    return { ...block, content: normalizeGeneratedMarkdown(block.content) };
  }
  return block;
}

function prepareBlock(
  block: GeneratedLiveStepDraft["blocks"][number],
  id: string,
  validConceptIds: Set<string>
): GeneratedLiveStep["blocks"][number] {
  if ("concepts" in block) {
    return normalizeBlock({
      ...block,
      id,
      concepts: block.concepts?.filter((conceptId) => validConceptIds.has(conceptId))
    } as GeneratedLiveStep["blocks"][number]);
  }
  return normalizeBlock({ ...block, id } as GeneratedLiveStep["blocks"][number]);
}

function blockConceptIds(block: GeneratedLiveStepDraft["blocks"][number]): string[] {
  const direct = "concepts" in block ? block.concepts ?? [] : [];
  const resources = block.kind === "interact" ? block.resources?.concepts ?? [] : [];
  return [...direct, ...resources];
}

function validateText(text: string | undefined, label: string): { ok: true } | { ok: false; reason: string } {
  if (!text?.trim()) {
    return { ok: false, reason: `${label} is required.` };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, reason: `${label} must be ${MAX_TEXT_LENGTH} characters or less.` };
  }
  return { ok: true };
}

function firstInvalid(results: Array<{ ok: true } | { ok: false; reason: string }>) {
  return results.find((result): result is { ok: false; reason: string } => !result.ok) ?? { ok: true as const };
}

function safeId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed || trimmed.length > 96 || !/^[a-zA-Z0-9:_-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isSafeRelativePath(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().replace(/\\/g, "/");
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && !normalized.split("/").includes("..");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
