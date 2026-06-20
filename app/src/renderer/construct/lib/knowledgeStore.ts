import type { ConstructLearningState, KnowledgeBaseRecord } from "../../../shared/constructLearning";
import type { ConceptCard, ProjectRecord } from "../types";
import {
  getLearningState,
  recordConceptOpen as recordConceptOpenInStore,
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
    usedInRecall: existing?.usedInRecall === true || usedInRecall,
    confidence: normalizeConceptConfidence(concept.confidence),
    authoredBy: normalizeConceptAuthor(concept.authoredBy),
    history: normalizeConceptHistory(concept.history)
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

export function recordKnowledgeOpen(project: ProjectRecord, concept: ConceptCard, usedInRecall = false): Promise<ConstructLearningState> {
  const existing = cache.find((record) => record.id === concept.id && record.sourceProjectId === project.id);
  const next = existing ? {
    ...existing,
    openedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    openCount: existing.openCount + 1,
    usedInRecall: existing.usedInRecall || usedInRecall
  } : undefined;
  if (next) {
    cache = [next, ...cache.filter((record) => record !== existing)];
    notify();
  }
  return recordConceptOpenInStore({
    projectId: project.id,
    conceptId: concept.id,
    title: concept.title,
    savedRecord: next
  }).then(async (state) => {
    await hydrateKnowledgeRecords();
    return state;
  });
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

function normalizeConceptConfidence(value: string | undefined): KnowledgeBaseRecord["confidence"] {
  if (
    value === "unknown"
    || value === "introduced"
    || value === "confused"
    || value === "fragile"
    || value === "practicing"
    || value === "applying"
    || value === "solid"
    || value === "fluent"
    || value === "teaching"
    || value === "weak"
    || value === "emerging"
    || value === "strong"
  ) {
    return value;
  }
  return undefined;
}

function normalizeConceptHistory(history: ConceptCard["history"]): KnowledgeBaseRecord["history"] {
  return history?.map((event) => ({
    ...event,
    kind: normalizeHistoryKind(event.kind),
    confidence: normalizeConceptConfidence(event.confidence),
    authoredBy: normalizeConceptAuthor(event.authoredBy)
  }));
}

function normalizeHistoryKind(value: string): NonNullable<KnowledgeBaseRecord["history"]>[number]["kind"] {
  if (value === "introduced" || value === "modified" || value === "removed" || value === "practiced" || value === "opened" || value === "system") {
    return value;
  }
  return "modified";
}

function normalizeConceptAuthor(value: string | undefined): KnowledgeBaseRecord["authoredBy"] {
  if (value === "learner" || value === "agent" || value === "mixed" || value === "system") {
    return value;
  }
  return undefined;
}

function notify() {
  window.dispatchEvent(new Event(changedEvent));
}
