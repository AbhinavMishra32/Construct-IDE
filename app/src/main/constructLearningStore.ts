import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createDefaultLearningState,
  knowledgeKey,
  type AssistanceEventRecord,
  type ConceptUnderstanding,
  type ConstructInteractSession,
  type ConstructLearningState,
  type KnowledgeBaseRecord,
  type LearningStatePatch,
  type ProjectLearningState,
  type RecallAttemptRecord
} from "../shared/constructLearning";

export class ConstructLearningStore {
  constructor(private readonly filePath: string) {}

  async getState(): Promise<ConstructLearningState> {
    return this.read();
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

  async getWeakConcepts(projectId?: string): Promise<ConceptUnderstanding[]> {
    const state = await this.read();
    const values = projectId
      ? Object.values(ensureProjectState(state, projectId).conceptUnderstanding)
      : Object.values(state.learner.globalConceptUnderstanding);
    return values.filter((concept) => concept.confidence === "weak" || concept.confidence === "unknown");
  }

  private async read(): Promise<ConstructLearningState> {
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
    ensureProjectState(state, patch.constructInteractSession.projectId).constructInteractSessions.push(patch.constructInteractSession);
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

  if (patch.removeKnowledgeConcept) {
    delete state.knowledgeBase.concepts[knowledgeKey(patch.removeKnowledgeConcept.projectId, patch.removeKnowledgeConcept.conceptId)];
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
  return state.projects[projectId];
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
