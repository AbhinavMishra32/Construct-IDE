import type { ConceptCard, ProjectRecord } from "../types";

const storageKey = "construct.knowledge.records.v1";
const changedEvent = "construct:knowledge-changed";

export type SavedKnowledgeRecord = ConceptCard & {
  sourceProjectId: string;
  sourceProjectTitle: string;
  firstSeenAt: string;
  lastOpenedAt: string;
  savedAt: string;
  openCount: number;
  usedInRecall: boolean;
};

export function readKnowledgeRecords(): SavedKnowledgeRecord[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter(isKnowledgeRecord) : [];
  } catch {
    return [];
  }
}

export function saveKnowledgeConcept(project: ProjectRecord, concept: ConceptCard, usedInRecall = false): SavedKnowledgeRecord[] {
  const now = new Date().toISOString();
  const records = readKnowledgeRecords();
  const existing = records.find((record) => record.id === concept.id && record.sourceProjectId === project.id);
  const nextRecord: SavedKnowledgeRecord = {
    ...concept,
    sourceProjectId: project.id,
    sourceProjectTitle: project.title,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastOpenedAt: now,
    savedAt: existing?.savedAt ?? now,
    openCount: existing?.openCount ?? 0,
    usedInRecall: existing?.usedInRecall === true || usedInRecall
  };
  return writeRecords([nextRecord, ...records.filter((record) => !(record.id === concept.id && record.sourceProjectId === project.id))]);
}

export function removeKnowledgeConcept(projectId: string, conceptId: string): SavedKnowledgeRecord[] {
  return writeRecords(readKnowledgeRecords().filter((record) => !(record.id === conceptId && record.sourceProjectId === projectId)));
}

export function recordKnowledgeOpen(project: ProjectRecord, concept: ConceptCard, usedInRecall = false): void {
  const records = readKnowledgeRecords();
  const existing = records.find((record) => record.id === concept.id && record.sourceProjectId === project.id);
  if (!existing) return;
  writeRecords(records.map((record) => record === existing ? {
    ...record,
    lastOpenedAt: new Date().toISOString(),
    openCount: record.openCount + 1,
    usedInRecall: record.usedInRecall || usedInRecall
  } : record));
}

export function subscribeKnowledgeRecords(listener: () => void): () => void {
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", listener);
  };
}

function writeRecords(records: SavedKnowledgeRecord[]): SavedKnowledgeRecord[] {
  window.localStorage.setItem(storageKey, JSON.stringify(records));
  window.dispatchEvent(new Event(changedEvent));
  return records;
}

function isKnowledgeRecord(value: unknown): value is SavedKnowledgeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SavedKnowledgeRecord>;
  return typeof record.id === "string" && typeof record.title === "string" && typeof record.sourceProjectId === "string";
}
