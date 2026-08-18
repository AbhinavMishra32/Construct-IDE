import {
  readKnowledgeRecords,
  saveKnowledgeConcept
} from "../../lib/knowledgeStore";
import type { ConceptCard, ProjectRecord } from "../../types";

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function uniqueConcepts(values: ConceptCard[]): ConceptCard[] {
  const seen = new Set<string>();
  return values.filter((concept) => {
    if (seen.has(concept.id)) {
      return false;
    }

    seen.add(concept.id);
    return true;
  });
}

export function conceptIdsIntroducedThrough(project: ProjectRecord, stepIndex: number, blockIndex: number): string[] {
  const ids: string[] = [];
  const known = new Set(project.program.concepts.map((concept) => concept.id));

  for (let currentStepIndex = 0; currentStepIndex <= stepIndex; currentStepIndex += 1) {
    const step = project.program.steps[currentStepIndex];
    if (!step) continue;
    const finalBlockIndex = currentStepIndex === stepIndex ? Math.min(blockIndex, step.blocks.length - 1) : step.blocks.length - 1;
    for (let currentBlockIndex = 0; currentBlockIndex <= finalBlockIndex; currentBlockIndex += 1) {
      const current = step.blocks[currentBlockIndex];
      if (!current) continue;
      const declared = current.kind === "explain" || current.kind === "recall" ? current.concepts : [];
      const inlineText = current.kind === "explain"
        ? current.content
        : current.kind === "recall"
          ? `${current.task}\n${current.support}`
          : "";
      const inline = [...inlineText.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]);
      for (const id of [...declared, ...inline]) {
        if (known.has(id) && !ids.includes(id)) ids.push(id);
      }
    }
  }

  return ids;
}

export function initialSavedConceptIds(project: ProjectRecord, concepts: ConceptCard[]): string[] {
  const existing = readKnowledgeRecords().filter((record) => record.sourceProjectId === project.id).map((record) => record.id);
  try {
    const legacy = JSON.parse(window.localStorage.getItem("construct.knowledge.savedConceptIds") ?? "[]");
    if (Array.isArray(legacy)) {
      for (const conceptId of legacy) {
        const concept = concepts.find((candidate) => candidate.id === conceptId);
        if (concept && !existing.includes(concept.id)) {
          saveKnowledgeConcept(project, concept);
          existing.push(concept.id);
        }
      }
    }
  } catch {
    // Ignore malformed legacy storage and keep valid records.
  }
  return uniqueStrings(existing);
}
