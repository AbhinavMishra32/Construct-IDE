export type ConceptUnderstanding = {
  conceptId: string;
  confidence: "unknown" | "weak" | "emerging" | "strong";
  lastEvidenceAt?: string;
  notes?: string;
  projectIds: string[];
};

export const CONSTRUCT_CONCEPT_LANGUAGES = ["swift", "python", "typescript", "javascript", "cpp", "unknown"] as const;

export type ConstructConceptLanguage = typeof CONSTRUCT_CONCEPT_LANGUAGES[number];

export type ConstructInteractMode = "lesson-check" | "general";

export type ConstructInteractRunStatus = "queued" | "running" | "completed" | "error";

export type ConstructInteractAssessment = {
  status: "continue" | "pass" | "almost" | "skip";
  confidence: "low" | "medium" | "high";
  coveredConceptIds: string[];
  missingConceptIds: string[];
  assistanceLevel: "none" | "hint" | "guided" | "answer";
  shouldAdvance: boolean;
  reason: string;
};

export type ConstructInteractSession = {
  id: string;
  threadId?: string;
  mode?: ConstructInteractMode;
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
  updatedAt?: string;
  runStatus?: ConstructInteractRunStatus;
  errorMessage?: string;
  assessment?: ConstructInteractAssessment;
  actions?: ConstructInteractAction[];
  dynamicSteps?: DynamicStepDraft[];
  dynamicStepValidation?: DynamicStepValidationRecord[];
  generatedLiveSteps?: GeneratedLiveStepDraft[];
  liveStepValidation?: GeneratedLiveStepValidationRecord[];
  toolCalls?: ConstructInteractToolCallRecord[];
  agentEvents?: ConstructAgentRunEvent[];
  durationMs?: number;
};

export type ConstructAgentRunEvent = {
  id: string;
  type: "iteration" | "tool" | "reasoning" | "message";
  status: "running" | "completed" | "error";
  title: string;
  detail?: string;
  text?: string;
  iteration?: number;
  toolName?: string;
  input?: unknown;
  outputPreview?: string;
  createdAt: string;
};

export type ConstructAgentContextWindow = {
  providerId?: string;
  modelId?: string;
  usedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  maxTokens?: number;
  source: "runtime" | "estimated";
  updatedAt: string;
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
      type: "focus-code";
      path: string;
      line?: number;
      endLine?: number;
      anchor?: string;
      label: string;
      reason: string;
    }
  | {
      type: "focus-terminal";
      label: string;
      reason: string;
    }
  | {
      type: "run-terminal-command";
      command: string;
      cwd?: string;
      label: string;
      reason: string;
    }
  | {
      type: "open-dynamic-steps";
      stepIds: string[];
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
      focus?: string;
      concepts?: string[];
    }
  | {
      kind: "guide";
      id: string;
      guideKind?: string;
      title?: string;
      content: string;
      sections?: Array<{ kind: string; content: string }>;
    }
  | {
      kind: "interact";
      id: string;
      interactKind?: string;
      uses?: string[];
      prompt: string;
      basis: string;
      understanding: string;
      assessment: string;
      concepts?: string[];
      resources?: {
        concepts?: string[];
        files?: string[];
        references?: string[];
        steps?: string[];
      };
    }
  | {
      kind: "edit";
      id: string;
      path: string;
      mode: "create" | "append" | "replace";
      typing?: "ghost";
      anchor?: string;
      language?: string;
      content: string;
      notes?: Array<{ when: "start" | "done" | "progress"; content: string }>;
    }
  | {
      kind: "recall";
      id: string;
      mode: "code" | "reply";
      path?: string;
      target?: string;
      references?: string[];
      task: string;
      support?: string;
      concepts?: string[];
    }
  | {
      kind: "run";
      id: string;
      cwd?: string;
      command: string;
    }
  | {
      kind: "expect";
      id: string;
      expectationType?: "manual";
      content: string;
    }
  | {
      kind: "checkpoint";
      id: string;
      content: string;
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

// Dynamic Steps are tape-shaped, runtime-authored steps. The GeneratedLiveStep
// aliases remain while existing learning-state files migrate without data loss.
export type DynamicStepBlock = GeneratedLiveStepBlock;
export type DynamicStep = GeneratedLiveStep;
export type DynamicStepDraft = GeneratedLiveStepDraft;
export type DynamicStepValidationRecord = GeneratedLiveStepValidationRecord;

export type ConstructInteractRuntimeInput = {
  mode?: ConstructInteractMode;
  threadId?: string;
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
    references: string[];
    steps: string[];
  };
  projectContext?: unknown;
  learningState: ConstructLearningState;
};

export type ConstructInteractResult = {
  requestedOutcome?: "answer" | "clarify" | "navigate" | "create-dynamic-steps" | "generate-learning-steps" | "edit-project" | "run-command";
  status: "continue" | "pass" | "almost" | "skip";
  confidence: "low" | "medium" | "high";
  reply: string;
  coveredConceptIds: string[];
  missingConceptIds: string[];
  assistanceLevel: "none" | "hint" | "guided" | "answer";
  shouldAdvance: boolean;
  assessment?: ConstructInteractAssessment;
  statePatch?: LearningStatePatch;
  actions?: ConstructInteractAction[];
  dynamicSteps?: DynamicStepDraft[];
  dynamicStepValidation?: DynamicStepValidationRecord[];
  generatedLiveSteps?: GeneratedLiveStepDraft[];
  toolCalls?: ConstructInteractToolCallRecord[];
  agentEvents?: ConstructAgentRunEvent[];
  durationMs?: number;
  liveStepValidation?: GeneratedLiveStepValidationRecord[];
};

export type ConstructInteractSessionEvent = {
  type: "started" | "updated" | "completed" | "error";
  runId: string;
  projectId: string;
  blockId: string;
  threadId?: string;
  session: ConstructInteractSession;
  result?: ConstructInteractResult;
  learningState?: ConstructLearningState;
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
  language?: ConstructConceptLanguage;
  technology?: string;
  tags: string[];
  summary: string;
  why: string;
  example?: string;
  docs: Array<{ title: string; url: string; why?: string }>;
  savedAt: string;
  openedAt?: string;
  openCount: number;
  usedInRecall: boolean;
  parentId?: string | null;
  content?: string;
  examples?: string[];
  relatedConcepts?: string[];
  confidence?: "unknown" | "weak" | "emerging" | "strong";
  lastChangeReason?: string;
  learnerEvidence?: string[];
  confidenceReason?: string;
  authoredBy?: "learner" | "agent" | "mixed" | "system";
  agentContributionPercent?: number;
  lastPracticedAt?: string;
  lastModifiedAt?: string;
};

export type ConceptEngagement = {
  conceptId: string;
  firstOpenedAt: string;
  lastOpenedAt: string;
  openCount: number;
};

export type ProjectLearningState = {
  projectId: string;
  conceptUnderstanding: Record<string, ConceptUnderstanding>;
  constructInteractSessions: ConstructInteractSession[];
  recallAttempts: RecallAttemptRecord[];
  assistanceEvents: AssistanceEventRecord[];
  conceptEngagement: Record<string, ConceptEngagement>;
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
  constructInteractSessionUpsert?: ConstructInteractSession;
  recallAttempt?: RecallAttemptRecord;
  assistanceEvent?: AssistanceEventRecord;
  conceptOpen?: {
    projectId: string;
    conceptId: string;
    openedAt: string;
  };
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
