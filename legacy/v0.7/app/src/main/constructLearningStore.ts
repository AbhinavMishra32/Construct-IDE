import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APPLICATION_SCOPE,
  migrateJsonValueToStorage,
  StorageTarget,
  type IStorageService
} from "./storage/storage";
import { readLegacyJsonFile, type ConstructDomainStorage } from "./storage/ConstructDomainStorage";
import {
  createDefaultLearningState,
  knowledgeKey,
  type AssistanceEventRecord,
  type ConceptUnderstanding,
  type ConstructConceptArtifactAudit,
  type ConstructConceptProjectEvent,
  type ConstructInteractSession,
  type ConstructLearningState,
  type KnowledgeBaseRecord,
  type LearningStatePatch,
  type ProjectLearningState,
  type RecallAttemptRecord
} from "../shared/constructLearning";

type ConstructLearningStoreOptions = {
  storage: IStorageService;
  domainStorage?: ConstructDomainStorage;
  legacyPath: string;
};

const LEARNING_STATE_STORAGE_KEY = "construct.learningState";

export class ConstructLearningStore {
  private readonly filePath: string;
  private readonly storage: IStorageService | null;
  private readonly domainStorage: ConstructDomainStorage | null;

  constructor(filePathOrOptions: string | ConstructLearningStoreOptions) {
    if (typeof filePathOrOptions === "string") {
      this.filePath = filePathOrOptions;
      this.storage = null;
      this.domainStorage = null;
    } else {
      this.filePath = filePathOrOptions.legacyPath;
      this.storage = filePathOrOptions.storage;
      this.domainStorage = filePathOrOptions.domainStorage ?? null;
    }
  }

  async getState(): Promise<ConstructLearningState> {
    return decorateConceptProjects(await this.read());
  }

  async getGlobalLearnerState() {
    return (await this.read()).learner;
  }

  async getProjectLearnerState(projectId: string): Promise<ProjectLearningState> {
    const state = await this.read();
    return ensureProjectState(state, projectId);
  }

  async applyPatch(patch: LearningStatePatch): Promise<ConstructLearningState> {
    const state = await this.read();
    applyLearningPatch(state, patch);
    await this.write(state);
    return state;
  }

  async recordConstructInteractAttempt(session: ConstructInteractSession): Promise<ConstructLearningState> {
    return this.applyPatch({
      constructInteractSession: session,
      projectConceptUnderstanding: {
        [session.projectId]: understandingPatch(session.projectId, session.coveredConceptIds, "emerging", session.createdAt, session.missingConceptIds)
      }
    });
  }

  async upsertConstructInteractSession(session: ConstructInteractSession): Promise<ConstructLearningState> {
    return this.applyPatch({ constructInteractSessionUpsert: session });
  }

  async recordRecallAttempt(attempt: RecallAttemptRecord): Promise<ConstructLearningState> {
    return this.applyPatch({
      recallAttempt: attempt,
      projectConceptUnderstanding: {
        [attempt.projectId]: understandingPatch(
          attempt.projectId,
          attempt.conceptIds,
          attempt.passed ? "strong" : "weak",
          attempt.createdAt
        )
      }
    });
  }

  async recordAssistanceEvent(event: AssistanceEventRecord): Promise<ConstructLearningState> {
    return this.applyPatch({ assistanceEvent: event });
  }

  async saveKnowledgeConcept(record: KnowledgeBaseRecord): Promise<ConstructLearningState> {
    return this.applyPatch({
      knowledgeConcept: record,
      assistanceEvent: {
        id: randomUUID(),
        projectId: record.sourceProjectId,
        kind: "knowledge-save",
        conceptIds: [record.id],
        detail: record.title,
        createdAt: new Date().toISOString()
      }
    });
  }

  async recordConceptProjectEvent(event: ConstructConceptProjectEvent): Promise<ConstructLearningState> {
    return this.applyPatch({ conceptProjectEvent: event });
  }

  async recordConceptArtifactAudit(audit: ConstructConceptArtifactAudit): Promise<ConstructLearningState> {
    return this.applyPatch({ conceptArtifactAudit: audit });
  }

  async getProjectConceptRecords(projectId: string): Promise<KnowledgeBaseRecord[]> {
    const state = await this.read();
    const project = ensureProjectState(state, projectId);
    const records = latestKnowledgeRecords(Object.values(state.knowledgeBase.concepts));
    return Object.keys(project.conceptRelations ?? {})
      .map((conceptId) => records.get(conceptId))
      .filter((record): record is KnowledgeBaseRecord => Boolean(record))
      .map((record) => ({
        ...record,
        masteryLevel: project.conceptRelations?.[record.id]?.masteryLevel ?? record.masteryLevel,
        projects: conceptProjectRelations(state, record.id),
        projectEvents: conceptProjectEvents(state, record.id)
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getConceptProjectRelations(conceptId: string) {
    const state = await this.read();
    return conceptProjectRelations(state, conceptId);
  }

  async migrateLegacyProjectConcepts(projectId: string, projectTitle: string): Promise<ConstructLearningState> {
    const state = await this.read();
    const project = ensureProjectState(state, projectId);
    project.conceptRelations ??= {};
    const records = latestKnowledgeRecords(Object.values(state.knowledgeBase.concepts));
    let changed = false;
    for (const record of records.values()) {
      if (record.sourceProjectId !== projectId || project.conceptRelations[record.id]?.introducedAt) continue;
      const createdAt = record.savedAt || new Date().toISOString();
      const event: ConstructConceptProjectEvent = {
        id: randomUUID(),
        projectId,
        projectTitle,
        conceptId: record.id,
        kind: "introduced",
        masteryLevel: normalizeMasteryLevel(record.masteryLevel),
        reason: "Migrated existing project concept into the project-scoped concept ledger.",
        evidence: record.learnerEvidence?.length ? record.learnerEvidence : [record.summary || record.title],
        artifactKind: "teaching",
        createdAt
      };
      applyLearningPatch(state, { conceptProjectEvent: event });
      changed = true;
    }
    if (changed) await this.write(state);
    return state;
  }

  async openKnowledgeConcept(record: KnowledgeBaseRecord): Promise<ConstructLearningState> {
    return this.recordConceptOpen({
      projectId: record.sourceProjectId,
      conceptId: record.id,
      title: record.title,
      savedRecord: record
    });
  }

  async recordConceptOpen(input: {
    projectId: string;
    conceptId: string;
    title: string;
    savedRecord?: KnowledgeBaseRecord;
  }): Promise<ConstructLearningState> {
    const now = new Date().toISOString();
    const state = await this.read();
    const currentSaved = state.knowledgeBase.concepts[knowledgeKey(input.projectId, input.conceptId)];
    const savedRecord = currentSaved ?? input.savedRecord;
    const patch: LearningStatePatch = {
      conceptOpen: {
        projectId: input.projectId,
        conceptId: input.conceptId,
        openedAt: now
      },
      assistanceEvent: {
        id: randomUUID(),
        projectId: input.projectId,
        kind: "concept-open",
        conceptIds: [input.conceptId],
        detail: input.title,
        createdAt: now
      }
    };

    if (savedRecord) {
      patch.knowledgeConcept = {
        ...savedRecord,
        openedAt: now,
        openCount: (currentSaved?.openCount ?? savedRecord.openCount ?? 0) + 1
      };
    }

    applyLearningPatch(state, patch);
    await this.write(state);
    return state;
  }

  async removeKnowledgeConcept(projectId: string, conceptId: string): Promise<ConstructLearningState> {
    return this.applyPatch({
      removeKnowledgeConcept: {
        projectId,
        conceptId
      }
    });
  }

  async removeProjectConcept(projectId: string, conceptId: string): Promise<ConstructLearningState> {
    return this.applyPatch({ removeProjectConcept: { projectId, conceptId } });
  }

  async getWeakConcepts(projectId?: string): Promise<ConceptUnderstanding[]> {
    const state = await this.read();
    const values = projectId
      ? Object.values(ensureProjectState(state, projectId).conceptUnderstanding)
      : Object.values(state.learner.globalConceptUnderstanding);
    return values.filter((concept) => ["unknown", "introduced", "confused", "fragile", "weak"].includes(concept.confidence));
  }

  private async read(): Promise<ConstructLearningState> {
    if (this.domainStorage) {
      const stored = this.domainStorage.readLearningState();
      if (stored) {
        return decorateConceptProjects(normalizeLearningState(stored));
      }
      const legacy = this.storage?.getObject<Partial<ConstructLearningState>>(LEARNING_STATE_STORAGE_KEY, APPLICATION_SCOPE)
        ?? readLegacyJsonFile<Partial<ConstructLearningState>>(this.filePath);
      if (legacy) {
        const state = decorateConceptProjects(normalizeLearningState(legacy));
        this.domainStorage.writeLearningState(state);
        this.domainStorage.removeLegacyLearningRow();
        return state;
      }
      const state = createDefaultLearningState(randomUUID());
      this.domainStorage.writeLearningState(state);
      return state;
    }

    if (this.storage) {
      const migrated = await migrateJsonValueToStorage<Partial<ConstructLearningState>>({
        storage: this.storage,
        key: LEARNING_STATE_STORAGE_KEY,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER,
        legacyPath: this.filePath,
        normalize: normalizeLearningState
      });
      if (migrated) {
        return decorateConceptProjects(normalizeLearningState(migrated));
      }

      const state = createDefaultLearningState(randomUUID());
      await this.write(state);
      return state;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      const state = createDefaultLearningState(randomUUID());
      await this.write(state);
      return state;
    }

    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as ConstructLearningState;
      return normalizeLearningState(parsed);
    } catch {
      const state = createDefaultLearningState(randomUUID());
      await this.write(state);
      return state;
    }
  }

  private async write(state: ConstructLearningState): Promise<void> {
    state.sync.updatedAt = new Date().toISOString();
    if (this.domainStorage) {
      this.domainStorage.writeLearningState(normalizeLearningState(state));
      this.domainStorage.removeLegacyLearningRow();
      return;
    }

    if (this.storage) {
      this.storage.store(LEARNING_STATE_STORAGE_KEY, normalizeLearningState(state), APPLICATION_SCOPE, StorageTarget.USER);
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

export function applyLearningPatch(state: ConstructLearningState, patch: LearningStatePatch): void {
  for (const concept of Object.values(patch.globalConceptUnderstanding ?? {})) {
    state.learner.globalConceptUnderstanding[concept.conceptId] = mergeConcept(
      state.learner.globalConceptUnderstanding[concept.conceptId],
      concept
    );
  }

  for (const [projectId, concepts] of Object.entries(patch.projectConceptUnderstanding ?? {})) {
    const project = ensureProjectState(state, projectId);
    for (const concept of Object.values(concepts)) {
      project.conceptUnderstanding[concept.conceptId] = mergeConcept(project.conceptUnderstanding[concept.conceptId], concept, projectId);
      state.learner.globalConceptUnderstanding[concept.conceptId] = mergeConcept(
        state.learner.globalConceptUnderstanding[concept.conceptId],
        concept,
        projectId
      );
    }
  }

  if (patch.constructInteractSession) {
    upsertConstructInteractSession(state, patch.constructInteractSession);
  }

  if (patch.constructInteractSessionUpsert) {
    upsertConstructInteractSession(state, patch.constructInteractSessionUpsert);
  }

  if (patch.recallAttempt) {
    ensureProjectState(state, patch.recallAttempt.projectId).recallAttempts.push(patch.recallAttempt);
  }

  if (patch.assistanceEvent) {
    state.learner.assistanceEvents.push(patch.assistanceEvent);
    if (patch.assistanceEvent.projectId) {
      ensureProjectState(state, patch.assistanceEvent.projectId).assistanceEvents.push(patch.assistanceEvent);
    }
  }

  if (patch.conceptOpen) {
    const project = ensureProjectState(state, patch.conceptOpen.projectId);
    const current = project.conceptEngagement[patch.conceptOpen.conceptId];
    project.conceptEngagement[patch.conceptOpen.conceptId] = {
      conceptId: patch.conceptOpen.conceptId,
      firstOpenedAt: current?.firstOpenedAt ?? patch.conceptOpen.openedAt,
      lastOpenedAt: patch.conceptOpen.openedAt,
      openCount: (current?.openCount ?? 0) + 1
    };
  }

  if (patch.knowledgeConcept) {
    state.knowledgeBase.concepts[knowledgeKey(patch.knowledgeConcept.sourceProjectId, patch.knowledgeConcept.id)] = patch.knowledgeConcept;
  }

  if (patch.conceptProjectEvent) {
    const event = patch.conceptProjectEvent;
    const project = ensureProjectState(state, event.projectId);
    project.conceptEvents ??= [];
    project.conceptRelations ??= {};
    if (!project.conceptEvents.some((candidate) => candidate.id === event.id)) {
      project.conceptEvents.push(event);
    }
    const current = project.conceptRelations[event.conceptId];
    const introducedAt = current?.introducedAt
      ?? (event.kind === "introduced" ? event.createdAt : undefined);
    project.conceptRelations[event.conceptId] = {
      projectId: event.projectId,
      projectTitle: event.projectTitle,
      conceptId: event.conceptId,
      introducedAt,
      firstReferencedAt: current?.firstReferencedAt ?? event.createdAt,
      lastReferencedAt: event.createdAt,
      masteryLevel: event.masteryLevel ?? current?.masteryLevel ?? 0,
      lastEventKind: event.kind,
      eventIds: [...new Set([...(current?.eventIds ?? []), event.id])].slice(-200)
    };
  }

  if (patch.conceptArtifactAudit) {
    const audit = patch.conceptArtifactAudit;
    const project = ensureProjectState(state, audit.projectId);
    project.artifactAudits ??= [];
    if (!project.artifactAudits.some((candidate) => candidate.id === audit.id)) {
      project.artifactAudits.push(audit);
      project.artifactAudits = project.artifactAudits.slice(-500);
    }
  }

  if (patch.removeKnowledgeConcept) {
    delete state.knowledgeBase.concepts[knowledgeKey(patch.removeKnowledgeConcept.projectId, patch.removeKnowledgeConcept.conceptId)];
  }

  if (patch.removeProjectConcept) {
    const project = ensureProjectState(state, patch.removeProjectConcept.projectId);
    delete project.conceptRelations?.[patch.removeProjectConcept.conceptId];
  }

  if (patch.projectPosition) {
    ensureProjectState(state, patch.projectPosition.projectId).currentPosition = {
      stepIndex: patch.projectPosition.stepIndex,
      blockIndex: patch.projectPosition.blockIndex,
      blockId: patch.projectPosition.blockId
    };
  }

  if (patch.plannedOverlay) {
    ensureProjectState(state, patch.plannedOverlay.projectId).plannedOverlays.push(patch.plannedOverlay.overlay);
  }

  if (patch.generatedLiveSteps) {
    const project = ensureProjectState(state, patch.generatedLiveSteps.projectId);
    for (const step of patch.generatedLiveSteps.steps) {
      const existingIndex = project.generatedLiveSteps.findIndex((candidate) => candidate.id === step.id);
      if (existingIndex >= 0) {
        project.generatedLiveSteps[existingIndex] = step;
      } else {
        project.generatedLiveSteps.push(step);
      }
    }
    if (patch.generatedLiveSteps.run) {
      project.generatedLiveStepRuns.push(patch.generatedLiveSteps.run);
    }
  }

  if (patch.generatedLiveStepStatus) {
    const project = ensureProjectState(state, patch.generatedLiveStepStatus.projectId);
    const step = project.generatedLiveSteps.find((candidate) => candidate.id === patch.generatedLiveStepStatus?.stepId);
    if (step) {
      step.status = patch.generatedLiveStepStatus.status;
      step.updatedAt = patch.generatedLiveStepStatus.updatedAt ?? new Date().toISOString();
    }
  }

  state.sync.pendingOperations.push({
    id: randomUUID(),
    kind: "learning-state-patch",
    createdAt: new Date().toISOString()
  });
}

function upsertConstructInteractSession(state: ConstructLearningState, session: ConstructInteractSession): void {
  const project = ensureProjectState(state, session.projectId);
  const index = project.constructInteractSessions.findIndex((candidate) => candidate.id === session.id);
  if (index >= 0) {
    project.constructInteractSessions[index] = session;
    return;
  }
  project.constructInteractSessions.push(session);
}

function normalizeLearningState(input: Partial<ConstructLearningState>): ConstructLearningState {
  const fallback = createDefaultLearningState(randomUUID());
  return {
    ...fallback,
    ...input,
    learner: {
      ...fallback.learner,
      ...input.learner,
      preferences: {
        ...fallback.learner.preferences,
        ...input.learner?.preferences
      },
      globalConceptUnderstanding: input.learner?.globalConceptUnderstanding ?? {},
      assistanceEvents: input.learner?.assistanceEvents ?? []
    },
    projects: Object.fromEntries(
      Object.entries(input.projects ?? {}).map(([projectId, project]) => [
        projectId,
        {
          ...project,
          conceptRelations: project.conceptRelations ?? {},
          conceptEvents: project.conceptEvents ?? [],
          artifactAudits: project.artifactAudits ?? [],
          conceptEngagement: project.conceptEngagement ?? {},
          generatedLiveSteps: project.generatedLiveSteps ?? [],
          generatedLiveStepRuns: project.generatedLiveStepRuns ?? []
        }
      ])
    ),
    knowledgeBase: {
      concepts: input.knowledgeBase?.concepts ?? {}
    },
    sync: {
      ...fallback.sync,
      ...input.sync,
      mode: "local"
    }
  };
}

function ensureProjectState(state: ConstructLearningState, projectId: string): ProjectLearningState {
  state.projects[projectId] ??= {
    projectId,
    conceptUnderstanding: {},
    conceptRelations: {},
    conceptEvents: [],
    artifactAudits: [],
    constructInteractSessions: [],
    recallAttempts: [],
    assistanceEvents: [],
    conceptEngagement: {},
    plannedOverlays: [],
    generatedLiveSteps: [],
    generatedLiveStepRuns: []
  };
  state.projects[projectId].generatedLiveSteps ??= [];
  state.projects[projectId].generatedLiveStepRuns ??= [];
  state.projects[projectId].conceptEngagement ??= {};
  state.projects[projectId].conceptRelations ??= {};
  state.projects[projectId].conceptEvents ??= [];
  state.projects[projectId].artifactAudits ??= [];
  return state.projects[projectId];
}

function latestKnowledgeRecords(records: KnowledgeBaseRecord[]): Map<string, KnowledgeBaseRecord> {
  const latest = new Map<string, KnowledgeBaseRecord>();
  for (const record of records) {
    const current = latest.get(record.id);
    if (!current || Date.parse(record.lastModifiedAt ?? record.savedAt) >= Date.parse(current.lastModifiedAt ?? current.savedAt)) {
      latest.set(record.id, record);
    }
  }
  return latest;
}

function conceptProjectRelations(state: ConstructLearningState, conceptId: string) {
  return Object.values(state.projects)
    .map((project) => project.conceptRelations?.[conceptId])
    .filter((relation): relation is NonNullable<typeof relation> => Boolean(relation))
    .sort((left, right) => Date.parse(right.lastReferencedAt) - Date.parse(left.lastReferencedAt));
}

function decorateConceptProjects(state: ConstructLearningState): ConstructLearningState {
  for (const record of Object.values(state.knowledgeBase.concepts)) {
    record.projects = conceptProjectRelations(state, record.id);
    record.projectEvents = conceptProjectEvents(state, record.id);
  }
  return state;
}

function conceptProjectEvents(state: ConstructLearningState, conceptId: string) {
  return Object.values(state.projects)
    .flatMap((project) => project.conceptEvents ?? [])
    .filter((event) => event.conceptId === conceptId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function mergeConcept(
  current: ConceptUnderstanding | undefined,
  next: Partial<ConceptUnderstanding> & { conceptId: string },
  projectId?: string
): ConceptUnderstanding {
  const projectIds = new Set([...(current?.projectIds ?? []), ...(next.projectIds ?? []), ...(projectId ? [projectId] : [])]);
  return {
    conceptId: next.conceptId,
    confidence: next.confidence ?? current?.confidence ?? "unknown",
    lastEvidenceAt: next.lastEvidenceAt ?? current?.lastEvidenceAt,
    notes: next.notes ?? current?.notes,
    projectIds: [...projectIds]
  };
}

function understandingPatch(
  projectId: string,
  strongOrEmerging: string[],
  confidence: ConceptUnderstanding["confidence"],
  at: string,
  weak: string[] = []
) {
  const entries: Record<string, Partial<ConceptUnderstanding> & { conceptId: string }> = {};
  for (const conceptId of strongOrEmerging) {
    entries[conceptId] = { conceptId, confidence, lastEvidenceAt: at, projectIds: [projectId] };
  }
  for (const conceptId of weak) {
    entries[conceptId] = { conceptId, confidence: "weak", lastEvidenceAt: at, projectIds: [projectId] };
  }
  return entries;
}

function normalizeMasteryLevel(value: unknown): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return 0;
}
