export type ConceptUnderstanding = {
  conceptId: string;
  confidence: "unknown" | "weak" | "emerging" | "strong";
  lastEvidenceAt?: string;
  notes?: string;
  projectIds: string[];
};

export type ConstructInteractSession = {
  id: string;
  projectId: string;
  blockId: string;
  prompt: string;
  answer: string;
  status: "continue" | "pass" | "almost" | "skip";
  confidence: "low" | "medium" | "high";
  reply: string;
  coveredConceptIds: string[];
  missingConceptIds: string[];
  assistanceLevel: "none" | "hint" | "guided" | "answer";
  createdAt: string;
};

export type ConstructInteractAction =
  | {
      type: "go-to-step";
      stepId: string;
      label: string;
      reason: string;
    }
  | {
      type: "open-concept";
      conceptId: string;
      label: string;
      reason: string;
    }
  | {
      type: "open-file";
      path: string;
      anchor?: string;
      label: string;
      reason: string;
    }
  | {
      type: "create-live-steps";
      stepIds: string[];
      label: string;
      reason: string;
    };

export type GeneratedLiveStepBlock =
  | {
      kind: "explain";
      id: string;
      content: string;
      concepts?: string[];
    }
  | {
      kind: "interact";
      id: string;
      prompt: string;
      basis: string;
      understanding: string;
      assessment: string;
      concepts?: string[];
    }
  | {
      kind: "recall";
      id: string;
      mode: "reply";
      task: string;
      support?: string;
      concepts?: string[];
    };

export type GeneratedLiveStep = {
  id: string;
  projectId: string;
  source: "construct-interact" | "adaptive-planner";
  sourceBlockId?: string;
  sourceStepId?: string;
  sourceRunId?: string;
  insertAfterStepId?: string;
  insertBeforeStepId?: string;
  title: string;
  reason: string;
  status: "pending" | "active" | "completed" | "dismissed";
  blocks: GeneratedLiveStepBlock[];
  conceptIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type GeneratedLiveStepDraft = Omit<
  GeneratedLiveStep,
  "id" | "projectId" | "status" | "createdAt" | "updatedAt"
> & {
  id?: string;
  status?: GeneratedLiveStep["status"];
};

export type ConstructInteractToolCallRecord = {
  id: string;
  name: string;
  reason: string;
  input?: unknown;
  outputPreview?: string;
  createdAt: string;
};

export type GeneratedLiveStepValidationRecord = {
  draftTitle?: string;
  stepId?: string;
  status: "accepted" | "rejected";
  reason: string;
  createdAt: string;
};

export type ConstructInteractRuntimeInput = {
  projectId: string;
  blockId: string;
  tapeSpec?: string;
  prompt: string;
  answer: string;
  basis: string;
  understanding: string;
  assessment: string;
  resources: {
    concepts: string[];
    files: string[];
  };
  projectContext?: unknown;
  learningState: ConstructLearningState;
};

export type ConstructInteractResult = {
  status: "continue" | "pass" | "almost" | "skip";
  confidence: "low" | "medium" | "high";
  reply: string;
  coveredConceptIds: string[];
  missingConceptIds: string[];
  assistanceLevel: "none" | "hint" | "guided" | "answer";
  shouldAdvance: boolean;
  statePatch?: LearningStatePatch;
  actions?: ConstructInteractAction[];
  generatedLiveSteps?: GeneratedLiveStepDraft[];
  toolCalls?: ConstructInteractToolCallRecord[];
  liveStepValidation?: GeneratedLiveStepValidationRecord[];
};

export type RecallAttemptRecord = {
  id: string;
  projectId: string;
  recallId: string;
  mode: "code" | "reply";
  answer?: string;
  passed: boolean;
  status?: "pass" | "fail" | "almost";
  confidence: "low" | "medium" | "high";
  conceptIds: string[];
  createdAt: string;
};

export type AssistanceEventRecord = {
  id: string;
  projectId?: string;
  kind: "concept-open" | "knowledge-save" | "interact" | "recall" | "selection-explain" | "manual";
  conceptIds: string[];
  detail: string;
  createdAt: string;
};

export type KnowledgeBaseRecord = {
  id: string;
  sourceProjectId: string;
  sourceProjectTitle: string;
  title: string;
  kind: string;
  tags: string[];
  summary: string;
  why: string;
  example?: string;
  docs: Array<{ title: string; url: string; why?: string }>;
  savedAt: string;
  openedAt?: string;
  openCount: number;
  usedInRecall: boolean;
};

export type ProjectLearningState = {
  projectId: string;
  conceptUnderstanding: Record<string, ConceptUnderstanding>;
  constructInteractSessions: ConstructInteractSession[];
  recallAttempts: RecallAttemptRecord[];
  assistanceEvents: AssistanceEventRecord[];
  currentPosition?: {
    stepIndex: number;
    blockIndex: number;
    blockId?: string;
  };
  plannedOverlays: Array<{
    id: string;
    conceptIds: string[];
    reason: string;
    enabled: boolean;
  }>;
  generatedLiveSteps: GeneratedLiveStep[];
  generatedLiveStepRuns: Array<{
    id: string;
    source: "construct-interact" | "adaptive-planner";
    sourceBlockId?: string;
    sourceStepId?: string;
    generatedStepIds: string[];
    actions: ConstructInteractAction[];
    toolCalls: ConstructInteractToolCallRecord[];
    validation: GeneratedLiveStepValidationRecord[];
    createdAt: string;
  }>;
};

export type ConstructLearningState = {
  version: 1;
  learner: {
    id: string;
    preferences: {
      adaptiveOverlaysEnabled: boolean;
      constructInteractEnabled: boolean;
      storeKnowledgeOnOpen: boolean;
    };
    globalConceptUnderstanding: Record<string, ConceptUnderstanding>;
    assistanceEvents: AssistanceEventRecord[];
  };
  projects: Record<string, ProjectLearningState>;
  knowledgeBase: {
    concepts: Record<string, KnowledgeBaseRecord>;
  };
  sync: {
    mode: "local";
    deviceId: string;
    pendingOperations: Array<{ id: string; kind: string; createdAt: string }>;
    updatedAt: string;
    userId?: string;
  };
};

export type LearningStatePatch = {
  globalConceptUnderstanding?: Record<string, Partial<ConceptUnderstanding> & { conceptId: string }>;
  projectConceptUnderstanding?: Record<string, Record<string, Partial<ConceptUnderstanding> & { conceptId: string }>>;
  constructInteractSession?: ConstructInteractSession;
  recallAttempt?: RecallAttemptRecord;
  assistanceEvent?: AssistanceEventRecord;
  knowledgeConcept?: KnowledgeBaseRecord;
  removeKnowledgeConcept?: {
    projectId: string;
    conceptId: string;
  };
  projectPosition?: {
    projectId: string;
    stepIndex: number;
    blockIndex: number;
    blockId?: string;
  };
  plannedOverlay?: {
    projectId: string;
    overlay: ProjectLearningState["plannedOverlays"][number];
  };
  generatedLiveSteps?: {
    projectId: string;
    steps: GeneratedLiveStep[];
    run?: ProjectLearningState["generatedLiveStepRuns"][number];
  };
  generatedLiveStepStatus?: {
    projectId: string;
    stepId: string;
    status: GeneratedLiveStep["status"];
    updatedAt?: string;
  };
};

export function createDefaultLearningState(deviceId: string): ConstructLearningState {
  const now = new Date().toISOString();
  return {
    version: 1,
    learner: {
      id: `local:${deviceId}`,
      preferences: {
        adaptiveOverlaysEnabled: false,
        constructInteractEnabled: true,
        storeKnowledgeOnOpen: true
      },
      globalConceptUnderstanding: {},
      assistanceEvents: []
    },
    projects: {},
    knowledgeBase: {
      concepts: {}
    },
    sync: {
      mode: "local",
      deviceId,
      pendingOperations: [],
      updatedAt: now
    }
  };
}

export function knowledgeKey(projectId: string, conceptId: string): string {
  return `${projectId}:${conceptId}`;
}
