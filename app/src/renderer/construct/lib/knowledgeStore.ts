import type { KnowledgeBaseRecord } from "../../../shared/constructLearning";
import type { ConceptCard, ProjectRecord } from "../types";
import {
  getLearningState,
  openKnowledgeConcept as openKnowledgeConceptInStore,
  removeKnowledgeConceptFromStore,
  saveKnowledgeConcept as saveKnowledgeConceptInStore
} from "./bridge";

const changedEvent = "construct:knowledge-changed";
let cache: SavedKnowledgeRecord[] = [];

export type SavedKnowledgeRecord = KnowledgeBaseRecord & {
  firstSeenAt: string;
  lastOpenedAt: string;
};

export function readKnowledgeRecords(): SavedKnowledgeRecord[] {
  return cache;
}

export async function hydrateKnowledgeRecords(): Promise<SavedKnowledgeRecord[]> {
  const state = await getLearningState();
  cache = Object.values(state.knowledgeBase.concepts).map(toSavedRecord)
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  notify();
  return cache;
}

export function saveKnowledgeConcept(project: ProjectRecord, concept: ConceptCard, usedInRecall = false): SavedKnowledgeRecord[] {
  const now = new Date().toISOString();
  const existing = cache.find((record) => record.id === concept.id && record.sourceProjectId === project.id);
  const record: KnowledgeBaseRecord = {
    ...concept,
    sourceProjectId: project.id,
    sourceProjectTitle: project.title,
    savedAt: existing?.savedAt ?? now,
    openedAt: existing?.openedAt ?? existing?.lastOpenedAt,
    openCount: existing?.openCount ?? 0,
    usedInRecall: existing?.usedInRecall === true || usedInRecall
  };

  cache = [toSavedRecord(record), ...cache.filter((item) => !(item.id === concept.id && item.sourceProjectId === project.id))];
  notify();
  void saveKnowledgeConceptInStore(record).then(() => hydrateKnowledgeRecords()).catch(console.error);
  return cache;
}

export function removeKnowledgeConcept(projectId: string, conceptId: string): SavedKnowledgeRecord[] {
  cache = cache.filter((record) => !(record.id === conceptId && record.sourceProjectId === projectId));
  notify();
  void removeKnowledgeConceptFromStore({ projectId, conceptId }).then(() => hydrateKnowledgeRecords()).catch(console.error);
  return cache;
}

export function recordKnowledgeOpen(project: ProjectRecord, concept: ConceptCard, usedInRecall = false): void {
  const existing = cache.find((record) => record.id === concept.id && record.sourceProjectId === project.id);
  if (!existing) return;
  const next = {
    ...existing,
    openedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    openCount: existing.openCount + 1,
    usedInRecall: existing.usedInRecall || usedInRecall
  };
  cache = [next, ...cache.filter((record) => record !== existing)];
  notify();
  void openKnowledgeConceptInStore(next).then(() => hydrateKnowledgeRecords()).catch(console.error);
}

export function subscribeKnowledgeRecords(listener: () => void): () => void {
  window.addEventListener(changedEvent, listener);
  void hydrateKnowledgeRecords().catch(console.error);
  return () => {
    window.removeEventListener(changedEvent, listener);
  };
}

function toSavedRecord(record: KnowledgeBaseRecord): SavedKnowledgeRecord {
  return {
    ...record,
    firstSeenAt: record.savedAt,
    lastOpenedAt: record.openedAt ?? record.savedAt
  };
}

function notify() {
  window.dispatchEvent(new Event(changedEvent));
}
