import { spawn } from "node:child_process";
import type http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Script } from "node:vm";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { ChatOpenAI } from "@langchain/openai";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  AgentEventSchema,
  AgentJobCreatedResponseSchema,
  AgentJobSnapshotSchema,
  CheckReviewResponseSchema,
  BlueprintStepSchema,
  BlueprintDeepDiveRequestSchema,
  BlueprintDeepDiveResponseSchema,
  ComprehensionCheckSchema,
  CurrentPlanningSessionResponseSchema,
  DependencyGraphSchema,
  GeneratedProjectPlanSchema,
  KnowledgeGraphSchema,
  LearnerProfileResponseSchema,
  PlanningQuestionSchema,
  PlanningSessionCompleteRequestSchema,
  PlanningSessionCompleteResponseSchema,
  PlanningSessionSchema,
  PlanningSessionStartRequestSchema,
  PlanningSessionStartResponseSchema,
  ProjectBlueprintSchema,
  ProjectSelectionResponseSchema,
  ProjectsDashboardResponseSchema,
  RuntimeGuideRequestSchema,
  RuntimeGuideResponseSchema,
  getBlueprintRuntimeSteps,
  type AgentEvent,
  type AgentJobCreatedResponse,
  type AgentJobKind,
  type AgentJobSnapshot,
  type ArchitectureComponent,
  type BlueprintBuild,
  type BlueprintBuildDetailResponse,
  type BlueprintBuildStage,
  type BlueprintBuildSummary,
  type CheckReviewRequest,
  type CheckReviewResponse,
  type BlueprintDeepDiveRequest,
  type BlueprintDeepDiveResponse,
  type ConceptConfidence,
  type ComprehensionCheck,
  type GeneratedProjectPlan,
  type KnowledgeGraph,
  type LearnerModel,
  type LearnerProfileResponse,
  type PlanningQuestion,
  type PlanningSession,
  type PlanningSessionCompleteRequest,
  type PlanningSessionCompleteResponse,
  type PlanningSessionStartRequest,
  type PlanningSessionStartResponse,
  type ProjectBlueprint,
  type ProjectImprovement,
  type ProjectSelectionResponse,
  type ProjectsDashboardResponse,
  type RuntimeGuideRequest,
  type RuntimeGuideResponse,
  type StoredKnowledgeConcept,
  type TaskTelemetry,
  type UserKnowledgeBase
} from "@construct/shared";
import { tavily } from "@tavily/core";
import ts from "typescript";
import { z } from "zod";

import {
  createAgentPersistence,
  type AgentPersistence,
  type PersistedGeneratedBlueprintRecord
} from "./agentPersistence";
import { getCurrentUserId } from "./authContext";
import { ConstructAuthService } from "./authService";
import {
  getActiveBlueprintPath as getActiveBlueprintPathFromFile,
  setActiveBlueprintPath
} from "./activeBlueprint";
import { prepareLearnerWorkspace } from "./workspaceMaterializer";
import {
  applyKnowledgeSignals,
  confidenceToScore,
  createEmptyKnowledgeBase,
  flattenKnowledgeConcepts,
  getKnowledgeConceptLabelPath,
  serializeKnowledgeBaseForPrompt,
  summarizeKnowledgeBase,
  taskOutcomeToScore
} from "./knowledgeGraph";
import { sanitizeMaterializedFileContent, sanitizeMaterializedFiles } from "./materializedFiles";
import { loadBlueprint } from "./testRunner";
import { zodToJsonSchema } from "zod-to-json-schema";

type PlanningStateFile = {
  session: PlanningSession | null;
  plan: GeneratedProjectPlan | null;
  answers: PlanningSessionCompleteRequest["answers"];
};

type JobListener = (eventName: string, payload: unknown) => void;
type BuildListener = (eventName: string, payload: unknown) => void;

type AgentJobRecord = {
  jobId: string;
  userId: string;
  kind: AgentJobKind;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  events: AgentEvent[];
  result: unknown | null;
  error?: string;
  listeners: Set<JobListener>;
};

type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
};

type ResearchDigest = {
  query: string;
  answer?: string;
  sources: ResearchSource[];
};

type AgentConfig = {
  provider: "openai";
  searchProvider: "tavily" | "exa";
  openAiModel: string;
  openAiFastModel: string;
  openAiRepairModel: string;
  openAiApiKey: string;
  openAiBaseUrl?: string;
  tavilyApiKey: string;
  tavilySearchDepth: "basic" | "advanced" | "fast" | "ultra-fast";
};

type AgentDependencies = {
  now?: () => Date;
  llm?: StructuredLanguageModel;
  search?: SearchProvider;
  logger?: AgentLogger;
  persistence?: AgentPersistence;
  auth?: ConstructAuthService;
  projectInstaller?: ProjectInstaller;
};

type AgentLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
  trace?(message: string, context?: Record<string, unknown>): void;
};

type StructuredLanguageModel = {
  parse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
    usage?: LanguageModelUsageContext;
  }): Promise<z.infer<T>>;
};

type LanguageModelUsageContext = {
  jobId?: string | null;
  buildId?: string | null;
  sessionId?: string | null;
  blueprintPath?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectGoal?: string | null;
  stage?: string | null;
  operation?: string | null;
};

type LanguageModelMessage = [role: "system" | "user", content: string];

type LanguageModelRawResponse = {
  content: unknown;
  response_metadata?: unknown;
  usage_metadata?: unknown;
};

type LanguageModelClient = {
  withStructuredOutput<T extends z.ZodTypeAny>(
    schema: T,
    options: { name: string; method: "jsonSchema"; includeRaw?: boolean }
  ): {
    invoke(messages: LanguageModelMessage[], config?: LanguageModelInvokeConfig): Promise<unknown>;
  };
  invoke(
    messages: LanguageModelMessage[],
    config?: LanguageModelInvokeConfig
  ): Promise<LanguageModelRawResponse>;
};

type LanguageModelInvokeConfig = {
  callbacks?: BaseCallbackHandler[];
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
} & Partial<RunnableConfig<Record<string, unknown>>>;

type SearchProvider = {
  research(query: string): Promise<ResearchDigest>;
};

type DependencyInstallResult = {
  status: "installed" | "skipped" | "failed";
  packageManager: string;
  manifestPath?: string;
  detail?: string;
};

type ProjectInstaller = {
  install(projectRoot: string, files: Record<string, string>): Promise<DependencyInstallResult>;
};

type QuestionGraphState = {
  jobId: string;
  request: PlanningSessionStartRequest;
  knowledgeBase: UserKnowledgeBase;
  goalScope: GoalScope | null;
  projectShapeResearch: ResearchDigest | null;
  prerequisiteResearch: ResearchDigest | null;
  mergedResearch: ResearchDigest | null;
  session: PlanningSession | null;
};

type PlanGraphState = {
  jobId: string;
  request: PlanningSessionCompleteRequest;
  session: PlanningSession;
  resumeFromCheckpoint: boolean;
  knowledgeBase: UserKnowledgeBase;
  goalScope: GoalScope | null;
  architectureResearch: ResearchDigest | null;
  dependencyResearch: ResearchDigest | null;
  validationResearch: ResearchDigest | null;
  mergedResearch: ResearchDigest | null;
  plan: GeneratedProjectPlan | null;
  blueprintDraft: GeneratedBlueprintBundleDraft | null;
  checkpointStage:
    | "plan-generated"
    | "blueprint-draft-invalid"
    | "blueprint-drafted"
    | "lessons-authored"
    | null;
  checkpointFailure: PlanningBuildCheckpoint["failure"];
  activeBlueprintPath: string | null;
};

type RuntimeGuideGraphState = {
  jobId: string;
  request: RuntimeGuideRequest;
  knowledgeBase: UserKnowledgeBase;
  guide: RuntimeGuideResponse | null;
};

type ResolvedPlanningAnswer = {
  questionId: string;
  conceptId: string;
  category: "language" | "domain" | "workflow";
  prompt: string;
  answerType: "option" | "custom" | "skipped";
  selectedOption: {
    id: string;
    label: string;
    description: string;
    confidenceSignal: ConceptConfidence;
  } | null;
  customResponse: string | null;
  availableOptions: Array<{
    id: string;
    label: string;
    description: string;
    confidenceSignal: ConceptConfidence;
  }>;
};

type GoalScope = {
  scopeSummary: string;
  artifactShape: string;
  complexityScore: number;
  shouldResearch: boolean;
  recommendedQuestionCount: number;
  recommendedMinSteps: number;
  recommendedMaxSteps: number;
  rationale: string;
};

const GOAL_SCOPE_DRAFT_SCHEMA = z.object({
  scopeSummary: z.string().min(1),
  artifactShape: z.string().min(1),
  complexityScore: z.number().int().min(0).max(100),
  shouldResearch: z.boolean(),
  recommendedQuestionCount: z.number().int().min(2).max(8),
  recommendedMinSteps: z.number().int().min(1).max(12),
  recommendedMaxSteps: z.number().int().min(1).max(16),
  rationale: z.string().min(1)
}).superRefine((value, context) => {
  if (value.recommendedMaxSteps < value.recommendedMinSteps) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "recommendedMaxSteps must be greater than or equal to recommendedMinSteps.",
      path: ["recommendedMaxSteps"]
    });
  }
});

const PLANNING_QUESTION_DRAFT_SCHEMA = z.object({
  detectedLanguage: z.string().min(1),
  detectedDomain: z.string().min(1),
  questions: z.array(
    z.object({
      conceptId: z.string().min(1),
      category: z.enum(["language", "domain", "workflow"]),
      prompt: z.string().min(1),
      options: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          confidenceSignal: z.enum(["comfortable", "shaky", "new"])
        })
      ).length(3)
    })
  ).min(2).max(8)
});

const GENERATED_PROJECT_PLAN_DRAFT_SCHEMA = z.object({
  summary: z.string().min(1),
  knowledgeGraph: KnowledgeGraphSchema,
  architecture: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(["component", "skill"]),
      summary: z.string().min(1),
      dependsOn: z.array(z.string().min(1)).default([])
    })
  ).min(1),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      kind: z.enum(["skill", "implementation"]),
      objective: z.string().min(1),
      rationale: z.string().min(1),
      concepts: z.array(z.string().min(1)).default([]),
      dependsOn: z.array(z.string().min(1)).default([]),
      validationFocus: z.array(z.string().min(1)).default([]),
      suggestedFiles: z.array(z.string().min(1)).default([]),
      implementationNotes: z.array(z.string().min(1)).default([]),
      quizFocus: z.array(z.string().min(1)).default([]),
      hiddenValidationFocus: z.array(z.string().min(1)).default([])
    })
  ).min(1),
  suggestedFirstStepId: z.string().min(1)
});

const GENERATED_FILE_ENTRY_SCHEMA = z.object({
  path: z.string().min(1),
  content: z.string().min(1)
});

const FILE_CONTENTS_SCHEMA = z.array(GENERATED_FILE_ENTRY_SCHEMA);
const NON_EMPTY_FILE_CONTENTS_SCHEMA = FILE_CONTENTS_SCHEMA.refine(
  (files) => files.length > 0,
  {
    message: "At least one file is required."
  }
);

const GENERATED_ANCHOR_DRAFT_SCHEMA = z.object({
  file: z.string().min(1),
  marker: z.string().min(1),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable()
});

const GENERATED_CHECK_OPTION_DRAFT_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1).nullable()
});

const GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("mcq"),
    prompt: z.string().min(1),
    options: z.array(GENERATED_CHECK_OPTION_DRAFT_SCHEMA).min(2),
    answer: z.string().min(1)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("short-answer"),
    prompt: z.string().min(1),
    rubric: z.array(z.string().min(1)).min(1),
    placeholder: z.string().min(1).nullable()
  })
]);

const GENERATED_LESSON_SLIDE_BLOCK_DRAFT_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    markdown: z.string().min(1)
  }),
  z.object({
    type: z.literal("check"),
    placement: z.enum(["inline", "end"]).default("inline"),
    check: GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA
  })
]);

const GENERATED_LESSON_SLIDE_DRAFT_SCHEMA = z.object({
  blocks: z.array(GENERATED_LESSON_SLIDE_BLOCK_DRAFT_SCHEMA).min(1)
});

const GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  doc: z.string().min(1),
  lessonSlides: z.array(GENERATED_LESSON_SLIDE_DRAFT_SCHEMA).default([]),
  anchor: GENERATED_ANCHOR_DRAFT_SCHEMA,
  tests: z.array(z.string().min(1)).min(1),
  concepts: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  checks: z.array(GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA),
  estimatedMinutes: z.number().int().positive(),
  difficulty: z.enum(["intro", "core", "advanced"])
});

const GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA = z.object({
  projectName: z.string().min(1),
  projectSlug: z.string().min(1),
  description: z.string().min(1),
  language: z.string().min(1),
  entrypoints: z.array(z.string().min(1)).min(1).max(5),
  supportFiles: FILE_CONTENTS_SCHEMA,
  canonicalFiles: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  learnerFiles: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  hiddenTests: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  steps: z.array(GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA).min(1),
  dependencyGraph: DependencyGraphSchema,
  tags: z.array(z.string().min(1))
});

const GENERATED_BLUEPRINT_FILE_PATCH_SCHEMA = z.object({
  supportFiles: FILE_CONTENTS_SCHEMA.default([]),
  canonicalFiles: FILE_CONTENTS_SCHEMA.default([]),
  learnerFiles: FILE_CONTENTS_SCHEMA.default([]),
  hiddenTests: FILE_CONTENTS_SCHEMA.default([])
}).refine(
  (patch) =>
    patch.supportFiles.length +
      patch.canonicalFiles.length +
      patch.learnerFiles.length +
      patch.hiddenTests.length >
    0,
  {
    message: "At least one repaired file is required."
  }
);

const GENERATED_FRONTIER_DRAFT_SCHEMA = z.object({
  learnerFiles: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  hiddenTests: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  steps: z.array(GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA).min(1).max(3)
});

const LESSON_AUTHORED_STEP_DRAFT_SCHEMA = z.object({
  summary: z.string().min(1),
  doc: z.string().min(1),
  lessonSlides: z.array(GENERATED_LESSON_SLIDE_DRAFT_SCHEMA).min(2).max(8),
  checks: z.array(GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA).max(4)
});

const RESEARCH_SOURCE_SCHEMA = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  snippet: z.string().min(1),
  publishedDate: z.string().min(1).optional()
});

const RESEARCH_DIGEST_SCHEMA = z.object({
  query: z.string().min(1),
  answer: z.string().min(1).optional(),
  sources: z.array(RESEARCH_SOURCE_SCHEMA).default([])
});

const PLANNING_BUILD_CHECKPOINT_FAILURE_SCHEMA = z.object({
  stage: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean().default(true),
  recordedAt: z.string().datetime()
});

const PLANNING_BUILD_CHECKPOINT_SCHEMA = z.object({
  sessionId: z.string().min(1),
  answersSignature: z.string().min(1),
  updatedAt: z.string().datetime(),
  stage: z.enum([
    "plan-generated",
    "blueprint-draft-invalid",
    "blueprint-drafted",
    "lessons-authored"
  ]),
  plan: GeneratedProjectPlanSchema,
  blueprintDraft: GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.nullable(),
  goalScope: GOAL_SCOPE_DRAFT_SCHEMA.nullable().default(null),
  mergedResearch: RESEARCH_DIGEST_SCHEMA.nullable().default(null),
  failure: PLANNING_BUILD_CHECKPOINT_FAILURE_SCHEMA.nullable().default(null)
}).superRefine((value, context) => {
  if (value.stage === "plan-generated" && value.blueprintDraft !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blueprintDraft"],
      message: "blueprintDraft must be null for plan-generated checkpoints."
    });
  }

  if (value.stage !== "plan-generated" && value.blueprintDraft === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blueprintDraft"],
      message: "blueprintDraft is required once blueprint generation has completed."
    });
  }

  if (value.stage === "blueprint-draft-invalid" && value.failure === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failure"],
      message: "failure is required for blueprint-draft-invalid checkpoints."
    });
  }

  if (value.stage !== "blueprint-draft-invalid" && value.failure !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failure"],
      message: "failure must be null once the checkpoint is no longer in a failed blueprint stage."
    });
  }
});

const GENERATED_DEEP_DIVE_DRAFT_SCHEMA = z.object({
  note: z.string().min(1),
  lessonSlides: z.array(GENERATED_LESSON_SLIDE_DRAFT_SCHEMA).min(1).max(6),
  checks: z.array(GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA).min(1).max(5),
  constraints: z.array(z.string().min(1)).max(4).default([])
});

const EXPLICIT_GOAL_SELF_REPORT_DRAFT_SCHEMA = z.object({
  signals: z.array(
    z.object({
      conceptId: z.string().min(1),
      label: z.string().min(1),
      category: z.enum(["language", "domain", "workflow"]),
      score: z.number().int().min(0).max(100),
      rationale: z.string().min(1),
      labelPath: z.array(z.string().min(1)).min(1).max(8).optional()
    })
  ).max(8).default([])
});

const SHORT_ANSWER_CHECK_REVIEW_DRAFT_SCHEMA = z.object({
  status: z.enum(["complete", "needs-revision"]),
  message: z.string().min(1),
  coveredCriteria: z.array(z.string().min(1)).default([]),
  missingCriteria: z.array(z.string().min(1)).default([])
});

const ADAPTIVE_FRONTIER_UPDATE_DECISION_SCHEMA = z.object({
  shouldUpdate: z.boolean(),
  updateMode: z.enum(["keep-path", "refresh-current-frontier", "advance-frontier"]),
  reason: z.string().min(1),
  detail: z.string().min(1)
}).superRefine((value, context) => {
  if (!value.shouldUpdate && value.updateMode !== "keep-path") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["updateMode"],
      message: "updateMode must be keep-path when shouldUpdate is false."
    });
  }
});

type GeneratedBlueprintBundleDraft = z.infer<typeof GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA>;
type GeneratedBlueprintFilePatchDraft = z.infer<typeof GENERATED_BLUEPRINT_FILE_PATCH_SCHEMA>;
type GeneratedBlueprintStepDraft = z.infer<typeof GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA>;
type GeneratedFrontierDraft = z.infer<typeof GENERATED_FRONTIER_DRAFT_SCHEMA>;
type PlanningBuildCheckpoint = z.infer<typeof PLANNING_BUILD_CHECKPOINT_SCHEMA>;
type GeneratedBlueprintFileGroup =
  | "supportFiles"
  | "canonicalFiles"
  | "learnerFiles"
  | "hiddenTests";
type GeneratedBlueprintFileValidationTarget = {
  group: GeneratedBlueprintFileGroup;
  path: string;
  error: string;
  kind: "invalid-json" | "invalid-source-syntax" | "invalid-hidden-test";
};

export class ConstructAgentService {
  private readonly rootDirectory: string;
  private readonly generatedPlansDirectory: string;
  private readonly generatedBlueprintsDirectory: string;
  private readonly now: () => Date;
  private readonly logger: AgentLogger;
  private readonly persistence: AgentPersistence;
  private readonly auth: ConstructAuthService;
  private readonly llmOverride: StructuredLanguageModel | null;
  private readonly searchOverride: SearchProvider | null;
  private readonly installerOverride: ProjectInstaller | null;
  private readonly resolvedConfigByUserId = new Map<string, AgentConfig>();
  private readonly llmByUserId = new Map<string, StructuredLanguageModel>();
  private readonly fastLlmByUserId = new Map<string, StructuredLanguageModel>();
  private readonly repairLlmByUserId = new Map<string, StructuredLanguageModel>();
  private readonly searchByUserId = new Map<string, SearchProvider>();
  private projectInstaller: ProjectInstaller | null = null;
  private readonly jobs = new Map<string, AgentJobRecord>();
  private readonly blueprintBuildListeners = new Map<string, Set<BuildListener>>();
  private readonly buildIdsByJobId = new Map<string, string>();
  private readonly buildStageStartedAt = new Map<string, string>();
  private blueprintBuildWriteQueue: Promise<void> = Promise.resolve();

  constructor(
    rootDirectory: string,
    dependencies: AgentDependencies = {}
  ) {
    this.rootDirectory = rootDirectory;
    this.generatedPlansDirectory = path.join(
      rootDirectory,
      ".construct",
      "generated-plans"
    );
    this.generatedBlueprintsDirectory = path.join(
      rootDirectory,
      ".construct",
      "generated-blueprints"
    );
    this.now = dependencies.now ?? (() => new Date());
    this.logger = dependencies.logger ?? createConsoleAgentLogger();
    this.persistence =
      dependencies.persistence ??
      createAgentPersistence({
        rootDirectory,
        logger: this.logger
      });
    this.auth = dependencies.auth ?? new ConstructAuthService(rootDirectory);
    this.llmOverride = dependencies.llm ?? null;
    this.searchOverride = dependencies.search ?? null;
    this.installerOverride = dependencies.projectInstaller ?? null;
  }

  clearResolvedUserConfig(userId: string): void {
    this.resolvedConfigByUserId.delete(userId);
    this.llmByUserId.delete(userId);
    this.fastLlmByUserId.delete(userId);
    this.repairLlmByUserId.delete(userId);
    this.searchByUserId.delete(userId);
  }

  async getCurrentPlanningState(): Promise<PlanningStateFile> {
    const state = await this.readPlanningState();
    return CurrentPlanningSessionResponseSchema.parse(state);
  }

  async listBlueprintBuilds(): Promise<BlueprintBuildSummary[]> {
    return this.persistence.listBlueprintBuilds();
  }

  async getBlueprintBuildDetail(buildId: string): Promise<BlueprintBuildDetailResponse> {
    return this.persistence.getBlueprintBuildDetail(buildId);
  }

  async getApiUsageDashboard() {
    return this.persistence.getApiUsageDashboard();
  }

  async getLearnerProfile(
    learnerModel: LearnerModel | null = null
  ): Promise<LearnerProfileResponse> {
    const knowledgeBase = await this.readKnowledgeBase();

    return LearnerProfileResponseSchema.parse({
      userId: getCurrentUserId(),
      knowledgeBase,
      knowledgeStats: summarizeKnowledgeBase(knowledgeBase),
      learnerModel
    });
  }

  async getActiveBlueprintPath(): Promise<string | null> {
    const activeState = await this.persistence.getActiveBlueprintState();
    const candidatePath = activeState?.blueprintPath?.trim();

    if (candidatePath) {
      const resolvedPath = path.resolve(candidatePath);

      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }

      if (activeState?.sessionId) {
        const restoredPath = await this.restoreGeneratedBlueprint(activeState.sessionId);
        if (restoredPath) {
          return restoredPath;
        }
      }
    }

    return getActiveBlueprintPathFromFile(this.rootDirectory);
  }

  async listProjectsDashboard(): Promise<ProjectsDashboardResponse> {
    const [projects, activeProject] = await Promise.all([
      this.persistence.listProjects(),
      this.persistence.getActiveProject()
    ]);

    return ProjectsDashboardResponseSchema.parse({
      userId: getCurrentUserId(),
      activeProjectId: activeProject?.id ?? null,
      projects
    });
  }

  async selectProject(projectId: string): Promise<ProjectSelectionResponse> {
    const project = await this.persistence.setActiveProject(projectId);

    if (!project) {
      return ProjectSelectionResponseSchema.parse({
        activeProjectId: null,
        project: null
      });
    }

    await setActiveBlueprintPath({
      rootDirectory: this.rootDirectory,
      blueprintPath: project.blueprintPath,
      sessionId: project.id,
      now: this.now
    });

    return ProjectSelectionResponseSchema.parse({
      activeProjectId: project.id,
      project
    });
  }

  async syncProjectStepSelection(
    canonicalBlueprintPath: string,
    stepId: string
  ): Promise<void> {
    const blueprint = await loadBlueprint(canonicalBlueprintPath);
    const runtimeSteps = getBlueprintRuntimeSteps(blueprint);
    const stepIndex = runtimeSteps.findIndex((step) => step.id === stepId);
    const step = stepIndex >= 0 ? runtimeSteps[stepIndex] : null;

    if (!step) {
      return;
    }

    await this.persistence.updateProjectProgress({
      blueprintPath: canonicalBlueprintPath,
      stepId: step.id,
      stepTitle: step.title,
      stepIndex,
      totalSteps: blueprint.spine?.commitGraph.length ?? runtimeSteps.length
    });
  }

  async syncProjectTaskProgress(input: {
    canonicalBlueprintPath: string;
    stepId: string;
    markStepCompleted?: boolean;
    lastAttemptStatus?: "failed" | "passed" | "needs-review" | null;
    telemetry?: TaskTelemetry | null;
    autoAdvanceProject?: boolean;
  }): Promise<ProjectImprovement> {
    const blueprint = await loadBlueprint(input.canonicalBlueprintPath);
    const runtimeSteps = getBlueprintRuntimeSteps(blueprint);
    const stepIndex = runtimeSteps.findIndex((step) => step.id === input.stepId);
    const step = stepIndex >= 0 ? runtimeSteps[stepIndex] : null;

    if (!step) {
      return this.createProjectImprovementResult({
        trigger: "task-submit",
        status: "skipped",
        title: "Skipped project improvement",
        detail: `Construct could not resolve ${input.stepId}, so the project path stayed as-is.`
      });
    }

    await this.persistence.updateProjectProgress({
      blueprintPath: input.canonicalBlueprintPath,
      stepId: step.id,
      stepTitle: step.title,
      stepIndex,
      totalSteps: blueprint.spine?.commitGraph.length ?? runtimeSteps.length,
      markStepCompleted: input.markStepCompleted,
      lastAttemptStatus: input.lastAttemptStatus ?? null
    });

    if (input.lastAttemptStatus && input.telemetry) {
      await this.recordTaskKnowledgeSignal({
        step,
        status: input.lastAttemptStatus,
        telemetry: input.telemetry
      });
    }

    try {
      if (input.lastAttemptStatus && input.lastAttemptStatus !== "passed") {
        const taskOutcome = this.buildTaskOutcomeDiagnostic({
          step,
          status: input.lastAttemptStatus,
          telemetry: input.telemetry ?? null
        });

        await this.recordAdaptiveFrontierDiagnostic({
          canonicalBlueprintPath: input.canonicalBlueprintPath,
          stepId: step.id,
          kind: taskOutcome.diagnostic.kind,
          summary: taskOutcome.diagnostic.summary,
          evidence: taskOutcome.diagnostic.evidence,
          conceptIds: step.concepts,
          intervention: taskOutcome.intervention
        });

        return this.createProjectImprovementResult({
          trigger: "task-submit",
          status: "recorded",
          title:
            input.lastAttemptStatus === "needs-review"
              ? `Recorded the latest guarded submit for ${step.title}`
              : `Recorded the latest failing submit for ${step.title}`,
          detail:
            input.lastAttemptStatus === "needs-review"
              ? "Construct stored this guarded submission and will use it, together with the earlier failed attempts on this step, once you fully clear the code task."
              : "Construct stored this failed submission and its errors. Once you fully clear the code task, Construct will update the project using the whole submission trail.",
          activeStepId: step.id
        });
      }

      if (input.lastAttemptStatus === "passed" && input.autoAdvanceProject === false) {
        const taskOutcome = this.buildTaskOutcomeDiagnostic({
          step,
          status: input.lastAttemptStatus,
          telemetry: input.telemetry ?? null
        });

        await this.recordAdaptiveFrontierDiagnostic({
          canonicalBlueprintPath: input.canonicalBlueprintPath,
          stepId: step.id,
          kind: taskOutcome.diagnostic.kind,
          summary: taskOutcome.diagnostic.summary,
          evidence: taskOutcome.diagnostic.evidence,
          conceptIds: step.concepts,
          intervention: taskOutcome.intervention
        });

        return this.createProjectImprovementResult({
          trigger: "task-submit",
          status: "recorded",
          title: `Recorded the passing submission for ${step.title}`,
          detail:
            "Construct saved this passing submission and the full attempt trail for this step. Project updates stay manual until you explicitly request one.",
          activeStepId: step.id
        });
      }

      return await this.applyTaskOutcomeToAdaptiveFrontier({
        canonicalBlueprintPath: input.canonicalBlueprintPath,
        step,
        markStepCompleted: input.markStepCompleted ?? false,
        lastAttemptStatus: input.lastAttemptStatus ?? null,
        telemetry: input.telemetry ?? null
      });
    } catch (error) {
      this.logger.warn("Adaptive frontier update failed after task evaluation. Keeping the existing path.", {
        blueprintPath: input.canonicalBlueprintPath,
        stepId: input.stepId,
        status: input.lastAttemptStatus ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createProjectImprovementResult({
        trigger: "task-submit",
        status: "failed",
        title: "Recorded your latest submission",
        detail:
          "Construct saved the latest task evidence, but the project path could not be refreshed right now.",
        activeStepId: step.id
      });
    }
  }

  async reviewCheck(input: CheckReviewRequest): Promise<CheckReviewResponse> {
    const review =
      input.check.type === "mcq"
        ? this.reviewMultipleChoiceCheck(input.check, input.response)
        : await this.reviewShortAnswerCheck(input);

    await this.recordCheckKnowledgeSignal({
      concepts: input.concepts,
      check: input.check,
      review: review.review,
      attemptCount: input.attemptCount,
      stepId: input.stepId,
      stepTitle: input.stepTitle,
      stepSummary: input.stepSummary
    });

    await this.recordAdaptiveFrontierDiagnostic({
      stepId: input.stepId,
      kind: "check-answer",
      summary:
        review.review.status === "complete"
          ? `Confirmed the core check for ${input.stepTitle}.`
          : `Detected a blocker in the check for ${input.stepTitle}.`,
      evidence: review.review.message,
      conceptIds: input.concepts,
      intervention:
        review.review.status === "complete"
          ? {
              kind: "continue-to-code",
              summary: "The current step is ready to continue in code.",
              reason: "The check result shows the learner can carry the concept back into the implementation."
            }
          : {
              kind: "targeted-check",
              summary: "Construct is holding on the current concept before moving further.",
              reason: "The check response still missed a concept this implementation depends on."
            }
    });

    return CheckReviewResponseSchema.parse(review);
  }

  async syncProjectCheckProgress(input: {
    canonicalBlueprintPath: string;
    stepId: string;
    review: CheckReviewResponse["review"];
    check: CheckReviewRequest["check"];
    response: string;
    attemptCount: number;
  }): Promise<ProjectImprovement> {
    const blueprint = await loadBlueprint(input.canonicalBlueprintPath);
    const step =
      getBlueprintRuntimeSteps(blueprint).find((entry) => entry.id === input.stepId) ?? null;

    if (!step) {
      return this.createProjectImprovementResult({
        trigger: "check-review",
        status: "skipped",
        title: "Skipped project improvement",
        detail: `Construct could not resolve ${input.stepId}, so the current project path stayed as-is.`
      });
    }

    try {
      return await this.applyCheckOutcomeToAdaptiveFrontier({
        canonicalBlueprintPath: input.canonicalBlueprintPath,
        step,
        review: input.review,
        check: input.check,
        response: input.response,
        attemptCount: input.attemptCount
      });
    } catch (error) {
      this.logger.warn("Adaptive frontier update failed after check review. Keeping the existing path.", {
        blueprintPath: input.canonicalBlueprintPath,
        stepId: input.stepId,
        reviewStatus: input.review.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createProjectImprovementResult({
        trigger: "check-review",
        status: "failed",
        title: "Recorded your latest answer",
        detail:
          "Construct saved the latest check evidence, but the project path could not be refreshed right now.",
        activeStepId: step.id
      });
    }
  }

  private async loadAdaptiveFrontierMutationContext(
    canonicalBlueprintPath?: string | null
  ): Promise<{
    sessionId: string;
    record: PersistedGeneratedBlueprintRecord;
    build: BlueprintBuild | null;
    plan: GeneratedProjectPlan;
    bundle: GeneratedBlueprintBundleDraft;
    blueprint: ProjectBlueprint;
    canonicalBlueprintPath: string;
    learnerBlueprintPath: string;
    learnerWorkspaceRoot: string;
    projectRoot: string;
  } | null> {
    const activeState = await this.persistence.getActiveBlueprintState();
    const resolvedBlueprintPath = canonicalBlueprintPath
      ? path.resolve(canonicalBlueprintPath)
      : activeState
        ? path.resolve(activeState.blueprintPath)
        : null;

    if (!resolvedBlueprintPath) {
      return null;
    }

    let sessionId =
      activeState &&
      activeState.sessionId &&
      path.resolve(activeState.blueprintPath) === resolvedBlueprintPath
        ? activeState.sessionId
        : null;

    if (!sessionId) {
      const projects = await this.persistence.listProjects();
      sessionId =
        projects.find((project) => path.resolve(project.blueprintPath) === resolvedBlueprintPath)?.id
        ?? null;
    }

    if (!sessionId) {
      return null;
    }

    const record = await this.persistence.getGeneratedBlueprintRecord(sessionId);
    if (!record) {
      return null;
    }

    const preparedWorkspace = await prepareLearnerWorkspace(resolvedBlueprintPath);

    return {
      sessionId,
      record,
      build: await this.persistence.getBlueprintBuildBySession(sessionId),
      plan: GeneratedProjectPlanSchema.parse(JSON.parse(record.planJson)),
      bundle: GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.parse(JSON.parse(record.bundleJson)),
      blueprint: await loadBlueprint(resolvedBlueprintPath),
      canonicalBlueprintPath: resolvedBlueprintPath,
      learnerBlueprintPath: preparedWorkspace.learnerBlueprintPath,
      learnerWorkspaceRoot: preparedWorkspace.learnerWorkspaceRoot,
      projectRoot: record.projectRoot
    };
  }

  private async applyCheckOutcomeToAdaptiveFrontier(input: {
    canonicalBlueprintPath: string;
    step: ProjectBlueprint["steps"][number];
    review: CheckReviewResponse["review"];
    check: CheckReviewRequest["check"];
    response: string;
    attemptCount: number;
  }): Promise<ProjectImprovement> {
    const context = await this.loadAdaptiveFrontierMutationContext(input.canonicalBlueprintPath);
    if (!context?.blueprint.frontier || !context.blueprint.spine) {
      return this.createProjectImprovementResult({
        trigger: "check-review",
        status: "skipped",
        title: "Recorded your latest answer",
        detail: "Construct stored the check evidence, but there was no active adaptive frontier to rewrite.",
        activeStepId: input.step.id
      });
    }

    const intervention =
      input.review.status === "complete"
        ? {
            kind: "continue-to-code",
            summary: "The current step is ready to continue in code.",
            reason: "The latest check shows the learner can carry the concept back into the implementation."
          } as const
        : {
            kind: "targeted-check",
            summary: "Construct is holding on the current concept before moving further.",
            reason: "The latest check response still missed a concept this implementation depends on."
          } as const;

    const decision = await this.decideAdaptiveFrontierUpdate({
      context,
      step: input.step,
      trigger: "check-review",
      latestSignal: input.review.message,
      intervention,
      preferredUpdateMode: "refresh-current-frontier",
      latestInteraction: {
        kind: "check-review",
        status: input.review.status,
        attemptCount: input.attemptCount,
        response: input.response,
        check: {
          id: input.check.id,
          type: input.check.type,
          prompt: input.check.prompt,
          answer:
            input.check.type === "mcq"
              ? input.check.answer
              : input.check.rubric,
          options:
            input.check.type === "mcq"
              ? input.check.options.map((option) => ({
                  id: option.id,
                  label: option.label
                }))
              : []
        }
      }
    });

    if (!decision.shouldUpdate) {
      return this.createProjectImprovementResult({
        trigger: "check-review",
        status: "recorded",
        title:
          input.review.status === "complete"
            ? `Recorded the recovered check for ${input.step.title}`
            : `Recorded the latest check signal for ${input.step.title}`,
        detail: decision.detail,
        activeStepId: input.step.id,
        evidenceCount: decision.evidenceCount
      });
    }

    return this.regenerateCurrentAdaptiveFrontier({
      context,
      step: input.step,
      trigger: "check-review",
      reason: decision.reason,
      title:
        input.review.status === "complete"
          ? `Updated ${input.step.title} around your recovered understanding`
          : `Updated ${input.step.title} around your latest check response`,
      detail: decision.detail,
      latestSignal: input.review.message,
      intervention:
        input.review.status === "complete"
          ? {
              kind: "continue-to-code",
              summary: "Construct refreshed the current capability with the learner's recovered understanding in mind.",
              reason: "The latest check shows the learner can move forward, but the active project slice should still reflect the exact concept trail that led there."
            }
          : {
              kind: "deepen-explanation",
              summary: "Construct refreshed the current capability around the learner's latest blocker.",
              reason: "The latest check shows the learner still needs more grounded support before the current path should feel fixed."
            },
      evidenceCountOverride: decision.evidenceCount
    });
  }

  private async applyTaskOutcomeToAdaptiveFrontier(input: {
    canonicalBlueprintPath: string;
    step: ProjectBlueprint["steps"][number];
    markStepCompleted: boolean;
    lastAttemptStatus: "failed" | "passed" | "needs-review" | null;
    telemetry: TaskTelemetry | null;
  }): Promise<ProjectImprovement> {
    if (!input.lastAttemptStatus) {
      return this.createProjectImprovementResult({
        trigger: "task-submit",
        status: "skipped",
        title: "Skipped project improvement",
        detail: `Construct did not receive a task outcome for ${input.step.title}, so the project path stayed as-is.`,
        activeStepId: input.step.id
      });
    }

    const context = await this.loadAdaptiveFrontierMutationContext(input.canonicalBlueprintPath);
    if (!context?.blueprint.frontier || !context.blueprint.spine) {
      return this.createProjectImprovementResult({
        trigger: "task-submit",
        status: "skipped",
        title: "Recorded your latest submission",
        detail: "Construct stored the submission evidence, but there was no active adaptive frontier to rewrite.",
        activeStepId: input.step.id
      });
    }

    const diagnosticTimestamp = this.now().toISOString();
    const taskOutcome = this.buildTaskOutcomeDiagnostic({
      step: input.step,
      status: input.lastAttemptStatus,
      telemetry: input.telemetry
    });
    const taskDiagnostic = {
      id: `diagnostic.${slugify(input.step.id)}.${Date.parse(diagnosticTimestamp)}`,
      kind: taskOutcome.diagnostic.kind,
      summary: taskOutcome.diagnostic.summary,
      evidence: taskOutcome.diagnostic.evidence,
      conceptIds: input.step.concepts,
      recordedAt: diagnosticTimestamp
    } satisfies NonNullable<ProjectBlueprint["frontier"]>["diagnostics"][number];

    if (input.markStepCompleted && input.lastAttemptStatus === "passed") {
      const decision = await this.decideAdaptiveFrontierUpdate({
        context,
        step: input.step,
        trigger: "task-submit",
        latestSignal: taskDiagnostic.evidence,
        intervention: taskOutcome.intervention,
        preferredUpdateMode: "advance-frontier",
        latestInteraction: {
          kind: "task-submit",
          status: input.lastAttemptStatus,
          markStepCompleted: input.markStepCompleted,
          telemetry: input.telemetry
        }
      });

      if (!decision.shouldUpdate) {
        return this.createProjectImprovementResult({
          trigger: "task-submit",
          status: "recorded",
          title: `Recorded the passing submission for ${input.step.title}`,
          detail: decision.detail,
          activeStepId: input.step.id,
          evidenceCount: decision.evidenceCount
        });
      }

      const remainingFrontierSteps = context.blueprint.frontier.steps.filter(
        (step) => step.id !== input.step.id
      );
      const cursorIndex = Math.max(
        getPlanStepIndex(context.plan, input.step.id),
        ...remainingFrontierSteps.map((step) => getPlanStepIndex(context.plan, step.id))
      );
      const nextPlanSteps = context.plan.steps
        .filter((step, index) => index > cursorIndex)
        .filter((step) => !remainingFrontierSteps.some((existing) => existing.id === step.id))
        .slice(0, Math.max(0, 3 - remainingFrontierSteps.length));
      const generatedFrontierResult =
        nextPlanSteps.length > 0
          ? await this.generateAdaptiveFrontierDraft({
              context,
              frontierPlanSteps: nextPlanSteps,
              reason: decision.reason,
              evidenceContext: {
                trigger: "task-submit",
                step: input.step,
                latestSignal: taskDiagnostic.evidence
              }
            })
          : null;
      const generatedFrontierDraft = generatedFrontierResult?.draft ?? null;
      const generatedSteps =
        generatedFrontierDraft === null
          ? []
          : annotateGeneratedBlueprintSteps({
              steps: normalizeGeneratedBlueprintSteps(generatedFrontierDraft.steps),
              plan: context.plan,
              entrypoint: context.blueprint.entrypoints[0] ?? null
            });
      const nextFrontierSteps = [...remainingFrontierSteps, ...generatedSteps].slice(0, 3);
      const currentLearnerFiles = await this.readProjectFilesSnapshot(
        context.learnerWorkspaceRoot,
        Object.keys(context.blueprint.files)
      );
      const generatedLearnerFiles = fileEntriesToRecord(generatedFrontierDraft?.learnerFiles ?? []);
      const nextBlueprint = ProjectBlueprintSchema.parse({
        ...context.blueprint,
        files: {
          ...currentLearnerFiles,
          ...generatedLearnerFiles
        },
        steps: mergeBlueprintStepRegistry(context.blueprint.steps, generatedSteps),
        spine: {
          ...context.blueprint.spine,
          activeCommitId: nextFrontierSteps[0]?.commitId ?? input.step.commitId ?? context.blueprint.spine.activeCommitId
        },
        frontier: buildAdaptiveFrontier({
          steps: nextFrontierSteps,
          spine: {
            ...context.blueprint.spine,
            activeCommitId: nextFrontierSteps[0]?.commitId ?? input.step.commitId ?? context.blueprint.spine.activeCommitId
          },
          generatedAt: diagnosticTimestamp,
          diagnostics: appendAdaptiveFrontierDiagnostic(
            context.blueprint.frontier.diagnostics,
            taskDiagnostic
          ),
          intervention: nextFrontierSteps.length > 0
            ? {
                kind: "mutate-frontier",
                summary: `Construct advanced the build path to ${nextFrontierSteps[0]?.title ?? "the next capability"}.`,
                reason: `${input.step.title} passed, so the next visible project slice has been rewritten around the remaining work.`
              }
            : {
                kind: "return-to-code",
                summary: "The adaptive frontier is complete.",
                reason: "There are no remaining frontier commits to generate for this project."
              },
          activeStepId: nextFrontierSteps[0]?.id ?? null
        })
      });
      const nextFrontierStepIds = new Set(nextFrontierSteps.map((step) => step.id));
      const nextFrontierTestPaths = uniquePaths(nextFrontierSteps.flatMap((step) => step.tests));
      const nextFrontierLearnerPaths = uniquePaths(
        nextFrontierSteps.flatMap((step) => [step.anchor.file, ...step.visibleFiles])
      );
      const nextBundle =
        nextFrontierSteps.length === 0
          ? context.bundle
          : GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.parse({
              ...context.bundle,
              learnerFiles: recordToFileEntries(
                pickRecordPaths(nextBlueprint.files, nextFrontierLearnerPaths)
              ),
              hiddenTests: recordToFileEntries(
                pickRecordPaths(
                  {
                    ...fileEntriesToRecord(context.bundle.hiddenTests),
                    ...fileEntriesToRecord(generatedFrontierDraft?.hiddenTests ?? [])
                  },
                  nextFrontierTestPaths
                )
              ),
              steps: mergeFrontierDraftSteps(
                context.bundle.steps.filter((step) => nextFrontierStepIds.has(step.id)),
                generatedFrontierDraft?.steps ?? []
              )
            });

      await this.persistAdaptiveBlueprintState({
        context,
        blueprint: nextBlueprint,
        bundle: nextBundle,
        generatedLearnerFiles,
        generatedHiddenTests: fileEntriesToRecord(generatedFrontierDraft?.hiddenTests ?? []),
        event: {
          stage: "adaptive-frontier",
          title:
            nextFrontierSteps.length > 0
              ? `Updated the build frontier to ${nextFrontierSteps[0]?.title ?? "the next capability"}`
              : "Completed the adaptive frontier",
          detail:
            nextFrontierSteps.length > 0
              ? `Construct kept the stable project spine, preserved completed work, and generated the next ${nextFrontierSteps.length} active step(s).`
              : "Construct reached the end of the current build path.",
          level: "success",
          payload: {
            completedStepId: input.step.id,
            activeStepId: nextBlueprint.frontier?.activeStepId ?? null,
            frontierStepIds: nextBlueprint.frontier?.stepIds ?? []
          }
        }
      });

      return this.createProjectImprovementResult({
        trigger: "task-submit",
        status: "updated",
        title:
          nextFrontierSteps.length > 0
            ? `Updated the project path after ${input.step.title}`
            : "Completed the adaptive project path",
        detail:
          nextFrontierSteps.length > 0
            ? decision.detail
            : "Construct folded the latest evidence into the blueprint and reached the end of the active frontier.",
        updatedBlueprint: true,
        activeStepId: nextBlueprint.frontier?.activeStepId ?? null,
        evidenceCount: Math.max(
          decision.evidenceCount,
          generatedFrontierResult?.evidenceCount ?? 0
        )
      });
    }

    return this.regenerateCurrentAdaptiveFrontier({
      context,
      step: input.step,
      trigger: "task-submit",
      reason:
        input.lastAttemptStatus === "needs-review"
          ? `Refresh the current build path after ${input.step.title} hit the rewrite gate despite passing tests.`
          : `Refresh the current build path after ${input.step.title} failed its latest targeted validation.`,
      title:
        input.lastAttemptStatus === "needs-review"
          ? `Updated ${input.step.title} around your latest guarded submit`
          : `Updated ${input.step.title} around your latest submission`,
      detail:
        input.lastAttemptStatus === "needs-review"
          ? "Construct rewrote the current project slice using the latest rewrite-gate evidence so the next attempt better matches your current ownership of the code."
          : "Construct rewrote the current project slice using the latest failing-test evidence so the next attempt better fits the concepts that still need support.",
      latestSignal: taskDiagnostic.evidence,
      intervention: taskOutcome.intervention,
      diagnostic: taskDiagnostic
    });
  }

  private buildTaskOutcomeDiagnostic(input: {
    step: ProjectBlueprint["steps"][number];
    status: "failed" | "passed" | "needs-review";
    telemetry: TaskTelemetry | null;
  }): {
    diagnostic: Pick<
      NonNullable<ProjectBlueprint["frontier"]>["diagnostics"][number],
      "kind" | "summary" | "evidence"
    >;
    intervention: Exclude<NonNullable<ProjectBlueprint["frontier"]>["intervention"], null>;
  } {
    return {
      diagnostic: {
        kind:
          input.status === "passed"
            ? "submission-result"
            : input.status === "needs-review"
              ? "rewrite-gate"
              : input.telemetry && input.telemetry.hintsUsed > 0
                ? "hint-usage"
                : "repeat-failure",
        summary:
          input.status === "passed"
            ? `Completed ${input.step.title}.`
            : input.status === "needs-review"
              ? `Completion is paused for ${input.step.title}.`
              : `Construct detected a blocker in ${input.step.title}.`,
        evidence:
          input.status === "passed"
            ? `Targeted validation passed with hints=${input.telemetry?.hintsUsed ?? 0} and pasteRatio=${(input.telemetry?.pasteRatio ?? 0).toFixed(2)}.`
            : input.status === "needs-review"
              ? "Tests passed, but the rewrite gate or validation guard still needs learner-owned typing before Construct advances."
              : `Targeted validation failed with hints=${input.telemetry?.hintsUsed ?? 0} and pasteRatio=${(input.telemetry?.pasteRatio ?? 0).toFixed(2)}.`
      },
      intervention:
        input.status === "passed"
          ? {
              kind: "mutate-frontier",
              summary: "Construct is ready to advance the build path from the learner's latest successful implementation.",
              reason: "The learner cleared the current code task, so the adaptive frontier can now move using the full submission trail."
            }
          : input.status === "needs-review"
            ? {
                kind: "deepen-explanation",
                summary: "Construct recorded the rewrite-gate evidence for the current capability.",
                reason: "The validation guard indicates the learner still needs a more grounded implementation pass before the project should change."
              }
            : input.telemetry && input.telemetry.hintsUsed >= 2
              ? {
                  kind: "diagnostic-question",
                  summary: "Construct recorded the failing validation and shifted into diagnosis mode for this step.",
                  reason: "The learner used several hints and still hit a failing validation."
                }
              : {
                  kind: "targeted-check",
                  summary: "Construct recorded the latest failing validation on the current capability.",
                  reason: "The latest task result shows the learner needs another pass before the path should advance."
                }
    };
  }

  private async regenerateCurrentAdaptiveFrontier(input: {
    context: {
      sessionId: string;
      record: PersistedGeneratedBlueprintRecord;
      build: BlueprintBuild | null;
      plan: GeneratedProjectPlan;
      bundle: GeneratedBlueprintBundleDraft;
      blueprint: ProjectBlueprint;
      canonicalBlueprintPath: string;
      learnerBlueprintPath: string;
      learnerWorkspaceRoot: string;
      projectRoot: string;
    };
    step: ProjectBlueprint["steps"][number];
    trigger: ProjectImprovement["trigger"];
    reason: string;
    title: string;
    detail: string;
    latestSignal: string;
    intervention: Exclude<NonNullable<ProjectBlueprint["frontier"]>["intervention"], null>;
    diagnostic?: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"][number];
    evidenceCountOverride?: number;
  }): Promise<ProjectImprovement> {
    const frontier = input.context.blueprint.frontier;
    const spine = input.context.blueprint.spine;
    if (!frontier || !spine) {
      return this.createProjectImprovementResult({
        trigger: input.trigger,
        status: "skipped",
        title: input.title,
        detail: "Construct recorded the evidence, but there was no active adaptive frontier to rewrite.",
        activeStepId: input.step.id
      });
    }

    const timestamp = this.now().toISOString();
    const nextDiagnostics = input.diagnostic
      ? appendAdaptiveFrontierDiagnostic(frontier.diagnostics, input.diagnostic)
      : frontier.diagnostics;
    const frontierPlanSteps = resolveFrontierPlanSteps(input.context.plan, frontier.steps);

    if (frontierPlanSteps.length === 0) {
      const nextBlueprint = ProjectBlueprintSchema.parse({
        ...input.context.blueprint,
        frontier: buildAdaptiveFrontier({
          steps: frontier.steps,
          spine,
          generatedAt: timestamp,
          diagnostics: nextDiagnostics,
          intervention: input.intervention,
          activeStepId: frontier.activeStepId ?? input.step.id
        })
      });

      await this.persistAdaptiveBlueprintState({
        context: input.context,
        blueprint: nextBlueprint,
        bundle: input.context.bundle,
        event: {
          stage: "adaptive-frontier-refresh",
          title: input.title,
          detail: input.detail,
          level: "info",
          payload: {
            activeStepId: nextBlueprint.frontier?.activeStepId ?? null,
            frontierStepIds: nextBlueprint.frontier?.stepIds ?? [],
            trigger: input.trigger
          }
        }
      });

      return this.createProjectImprovementResult({
        trigger: input.trigger,
        status: "recorded",
        title: input.title,
        detail: input.detail,
        updatedBlueprint: false,
        activeStepId: nextBlueprint.frontier?.activeStepId ?? null
      });
    }

    const generatedFrontierResult = await this.generateAdaptiveFrontierDraft({
      context: input.context,
      frontierPlanSteps,
      reason: input.reason,
      evidenceContext: {
        trigger: input.trigger,
        step: input.step,
        latestSignal: input.latestSignal,
        diagnostics: nextDiagnostics
      }
    });
    const generatedFrontierDraft = generatedFrontierResult.draft;
    const generatedSteps = annotateGeneratedBlueprintSteps({
      steps: normalizeGeneratedBlueprintSteps(generatedFrontierDraft.steps),
      plan: input.context.plan,
      entrypoint: input.context.blueprint.entrypoints[0] ?? null
    });
    const generatedStepsById = new Map(generatedSteps.map((step) => [step.id, step]));
    const nextFrontierSteps = frontier.steps.map(
      (step) => generatedStepsById.get(step.id) ?? step
    );
    const currentLearnerFiles = await this.readProjectFilesSnapshot(
      input.context.learnerWorkspaceRoot,
      Object.keys(input.context.blueprint.files)
    );
    const generatedLearnerFiles = fileEntriesToRecord(generatedFrontierDraft.learnerFiles);
    const nextBlueprint = ProjectBlueprintSchema.parse({
      ...input.context.blueprint,
      files: {
        ...currentLearnerFiles,
        ...generatedLearnerFiles
      },
      steps: mergeBlueprintStepRegistry(input.context.blueprint.steps, generatedSteps),
      spine: {
        ...spine,
        activeCommitId:
          nextFrontierSteps.find((step) => step.id === (frontier.activeStepId ?? input.step.id))?.commitId
          ?? input.step.commitId
          ?? frontier.activeCommitId
          ?? spine.activeCommitId
      },
      frontier: buildAdaptiveFrontier({
        steps: nextFrontierSteps,
        spine: {
          ...spine,
          activeCommitId:
            nextFrontierSteps.find((step) => step.id === (frontier.activeStepId ?? input.step.id))?.commitId
            ?? input.step.commitId
            ?? frontier.activeCommitId
            ?? spine.activeCommitId
        },
        generatedAt: timestamp,
        diagnostics: nextDiagnostics,
        intervention: input.intervention,
        activeStepId: frontier.activeStepId ?? input.step.id
      })
    });
    const nextFrontierStepIds = new Set(nextFrontierSteps.map((step) => step.id));
    const nextFrontierTestPaths = uniquePaths(nextFrontierSteps.flatMap((step) => step.tests));
    const nextFrontierLearnerPaths = uniquePaths(
      nextFrontierSteps.flatMap((step) => [step.anchor.file, ...step.visibleFiles])
    );
    const nextBundle = GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.parse({
      ...input.context.bundle,
      learnerFiles: recordToFileEntries(
        pickRecordPaths(nextBlueprint.files, nextFrontierLearnerPaths)
      ),
      hiddenTests: recordToFileEntries(
        pickRecordPaths(
          {
            ...fileEntriesToRecord(input.context.bundle.hiddenTests),
            ...fileEntriesToRecord(generatedFrontierDraft.hiddenTests)
          },
          nextFrontierTestPaths
        )
      ),
      steps: mergeFrontierDraftSteps(
        input.context.bundle.steps.filter((step) => nextFrontierStepIds.has(step.id)),
        generatedFrontierDraft.steps
      )
    });

    await this.persistAdaptiveBlueprintState({
      context: input.context,
      blueprint: nextBlueprint,
      bundle: nextBundle,
      generatedLearnerFiles,
      generatedHiddenTests: fileEntriesToRecord(generatedFrontierDraft.hiddenTests),
      event: {
        stage: "adaptive-frontier-refresh",
        title: input.title,
        detail: input.detail,
        level: "success",
        payload: {
          activeStepId: nextBlueprint.frontier?.activeStepId ?? null,
          frontierStepIds: nextBlueprint.frontier?.stepIds ?? [],
          trigger: input.trigger
        }
      }
    });

    return this.createProjectImprovementResult({
      trigger: input.trigger,
      status: "updated",
      title: input.title,
      detail: input.detail,
      updatedBlueprint: true,
      activeStepId: nextBlueprint.frontier?.activeStepId ?? null,
      evidenceCount: input.evidenceCountOverride ?? generatedFrontierResult.evidenceCount
    });
  }

  private async decideAdaptiveFrontierUpdate(input: {
    context: {
      sessionId: string;
      record: PersistedGeneratedBlueprintRecord;
      build: BlueprintBuild | null;
      plan: GeneratedProjectPlan;
      bundle: GeneratedBlueprintBundleDraft;
      blueprint: ProjectBlueprint;
      canonicalBlueprintPath: string;
      learnerBlueprintPath: string;
      learnerWorkspaceRoot: string;
      projectRoot: string;
    };
    step: ProjectBlueprint["steps"][number];
    trigger: ProjectImprovement["trigger"];
    latestSignal: string;
    intervention: Exclude<NonNullable<ProjectBlueprint["frontier"]>["intervention"], null>;
    preferredUpdateMode: "refresh-current-frontier" | "advance-frontier";
    latestInteraction:
      | {
          kind: "check-review";
          status: CheckReviewResponse["review"]["status"];
          attemptCount: number;
          response: string;
          check: {
            id: string;
            type: ComprehensionCheck["type"];
            prompt: string;
            answer: string | string[];
            options: Array<{ id: string; label: string }>;
          };
        }
      | {
          kind: "task-submit";
          status: "failed" | "passed" | "needs-review";
          markStepCompleted: boolean;
          telemetry: TaskTelemetry | null;
        };
  }): Promise<{
    shouldUpdate: boolean;
    updateMode: "keep-path" | "refresh-current-frontier" | "advance-frontier";
    reason: string;
    detail: string;
    evidenceCount: number;
  }> {
    const knowledgeBase = await this.readKnowledgeBase();
    const recentCapabilityEvidence = this.buildAdaptiveFrontierEvidenceBundle({
      knowledgeBase,
      blueprint: input.context.blueprint,
      step: input.step,
      trigger: input.trigger,
      latestSignal: input.latestSignal,
      diagnostics: input.context.blueprint.frontier?.diagnostics ?? []
    });
    const focusStepIndex = getPlanStepIndex(input.context.plan, input.step.id);
    const upcomingPlanSteps = input.context.plan.steps
      .filter((_, index) => index > focusStepIndex)
      .slice(0, 4)
      .map((step) => ({
        id: step.id,
        title: step.title,
        objective: step.objective,
        concepts: step.concepts,
        dependsOn: step.dependsOn
      }));

    try {
      const decision = await (await this.getFastLlm()).parse({
        schema: ADAPTIVE_FRONTIER_UPDATE_DECISION_SCHEMA,
        schemaName: "construct_adaptive_frontier_update_decision",
        instructions: buildAdaptiveFrontierUpdateDecisionInstructions(),
        prompt: JSON.stringify(
          {
            goal: input.context.record.goal,
            project: {
              name: input.context.blueprint.name,
              description: input.context.blueprint.description,
              language: input.context.blueprint.language
            },
            focusStep: {
              id: input.step.id,
              title: input.step.title,
              summary: input.step.summary,
              concepts: input.step.concepts
            },
            currentFrontier: input.context.blueprint.frontier
              ? {
                  activeStepId: input.context.blueprint.frontier.activeStepId,
                  stepIds: input.context.blueprint.frontier.stepIds,
                  diagnosticsCount: input.context.blueprint.frontier.diagnostics.length
                }
              : null,
            upcomingPlanSteps,
            recentCapabilityEvidence,
            preferredUpdateMode: input.preferredUpdateMode,
            latestInteraction: input.latestInteraction,
            currentIntervention: input.intervention
          },
          null,
          2
        ),
        maxOutputTokens: 400,
        verbosity: "low",
        usage: {
          sessionId: input.context.sessionId,
          projectId: input.context.record.sessionId,
          projectName: input.context.blueprint.name,
          projectGoal: input.context.record.goal,
          blueprintPath: input.context.record.blueprintPath,
          stage: "adaptive-frontier-decision",
          operation: "adaptive frontier decision"
        }
      });

      return {
        ...decision,
        evidenceCount: recentCapabilityEvidence.evidenceCount
      };
    } catch (error) {
      this.logger.warn("Adaptive frontier decision pass failed. Falling back to the previous rewrite behavior.", {
        trigger: input.trigger,
        stepId: input.step.id,
        preferredUpdateMode: input.preferredUpdateMode,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        shouldUpdate: true,
        updateMode: input.preferredUpdateMode,
        reason:
          input.preferredUpdateMode === "advance-frontier"
            ? `Advance the build path after ${input.step.title} based on the latest code-task evidence.`
            : `Refresh the current build path after ${input.step.title} based on the latest learner evidence.`,
        detail:
          input.preferredUpdateMode === "advance-frontier"
            ? `Construct advanced the blueprint using your latest implementation evidence and prepared the next capability.`
            : "Construct refreshed the current project slice using the latest learner evidence.",
        evidenceCount: recentCapabilityEvidence.evidenceCount
      };
    }
  }

  private async generateAdaptiveFrontierDraft(input: {
    context: {
      sessionId: string;
      plan: GeneratedProjectPlan;
      blueprint: ProjectBlueprint;
      learnerWorkspaceRoot: string;
      record: PersistedGeneratedBlueprintRecord;
    };
    frontierPlanSteps: GeneratedProjectPlan["steps"];
    reason: string;
    evidenceContext: {
      trigger: ProjectImprovement["trigger"];
      step: ProjectBlueprint["steps"][number];
      latestSignal: string;
      diagnostics?: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"];
    };
  }): Promise<{
    draft: GeneratedFrontierDraft;
    evidenceCount: number;
  }> {
    const knowledgeBase = await this.readKnowledgeBase();
    const recentCapabilityEvidence = this.buildAdaptiveFrontierEvidenceBundle({
      knowledgeBase,
      blueprint: input.context.blueprint,
      step: input.evidenceContext.step,
      trigger: input.evidenceContext.trigger,
      latestSignal: input.evidenceContext.latestSignal,
      diagnostics:
        input.evidenceContext.diagnostics
        ?? input.context.blueprint.frontier?.diagnostics
        ?? []
    });
    const currentWorkspaceFiles = await this.readProjectFilesSnapshot(
      input.context.learnerWorkspaceRoot,
      uniquePaths([
        ...Object.keys(input.context.blueprint.files),
        ...getBlueprintRuntimeSteps(input.context.blueprint).flatMap((step) => [
          step.anchor.file,
          ...step.visibleFiles
        ])
      ])
    );
    const draft = await (await this.getLlm()).parse({
      schema: GENERATED_FRONTIER_DRAFT_SCHEMA,
      schemaName: "construct_generated_adaptive_frontier",
      instructions: buildAdaptiveFrontierGenerationInstructions(),
      prompt: JSON.stringify(
        {
          goal: input.context.record.goal,
          project: {
            name: input.context.blueprint.name,
            description: input.context.blueprint.description,
            language: input.context.blueprint.language,
            entrypoints: input.context.blueprint.entrypoints
          },
          reason: input.reason,
          planSummary: input.context.plan.summary,
          selectedFrontierSteps: input.frontierPlanSteps,
          currentFrontier: input.context.blueprint.frontier,
          stableSpine: input.context.blueprint.spine,
          currentWorkspaceFiles: recordToFileEntries(currentWorkspaceFiles),
          priorKnowledge: serializeKnowledgeBaseForPrompt(knowledgeBase),
          recentCapabilityEvidence
        },
        null,
        2
      ),
      maxOutputTokens: 12_000,
      verbosity: "medium",
      usage: {
        sessionId: input.context.sessionId,
        projectId: input.context.record.sessionId,
        projectName: input.context.blueprint.name,
        projectGoal: input.context.record.goal,
        blueprintPath: input.context.record.blueprintPath,
        stage: "adaptive-frontier-generation",
        operation: "adaptive frontier generation"
      }
    });

    return {
      draft: trimGeneratedFrontierDraftToPlan(
        normalizeGeneratedFrontierDraft(draft, {
          language: input.context.blueprint.language
        }),
        input.frontierPlanSteps
      ),
      evidenceCount: recentCapabilityEvidence.evidenceCount
    };
  }

  private async readProjectFilesSnapshot(
    projectRoot: string,
    relativePaths: string[]
  ): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};

    for (const relativePath of uniquePaths(relativePaths)) {
      const absolutePath = path.join(projectRoot, relativePath);
      if (!existsSync(absolutePath)) {
        continue;
      }

      snapshot[relativePath] = await readFile(absolutePath, "utf8");
    }

    return snapshot;
  }

  private async recordAdaptiveFrontierDiagnostic(input: {
    canonicalBlueprintPath?: string | null;
    stepId: string;
    kind:
      | "check-answer"
      | "submission-result"
      | "repeat-failure"
      | "hint-usage"
      | "runtime-question"
      | "inactivity"
      | "rewrite-gate"
      | "debug-trace";
    summary: string;
    evidence: string;
    conceptIds?: string[];
    intervention: Exclude<NonNullable<ProjectBlueprint["frontier"]>["intervention"], null>;
  }): Promise<void> {
    const context = await this.loadAdaptiveFrontierMutationContext(input.canonicalBlueprintPath);
    if (!context?.blueprint.frontier) {
      return;
    }

    const timestamp = this.now().toISOString();
    const nextBlueprint = ProjectBlueprintSchema.parse({
      ...context.blueprint,
      frontier: {
        ...context.blueprint.frontier,
        diagnostics: appendAdaptiveFrontierDiagnostic(
          context.blueprint.frontier.diagnostics,
          {
            id: `diagnostic.${slugify(input.stepId)}.${Date.parse(timestamp)}`,
            kind: input.kind,
            summary: input.summary,
            evidence: input.evidence,
            conceptIds: input.conceptIds ?? [],
            recordedAt: timestamp
          }
        ),
        intervention: input.intervention,
        updating: false
      }
    });

    await this.persistAdaptiveBlueprintState({
      context,
      blueprint: nextBlueprint,
      bundle: context.bundle,
      event: {
        stage: "adaptive-diagnostics",
        title: input.summary,
        detail: input.evidence,
        level: "info",
        payload: {
          stepId: input.stepId,
          kind: input.kind,
          intervention: input.intervention.kind,
          conceptIds: input.conceptIds ?? []
        }
      }
    });
  }

  private async persistAdaptiveBlueprintState(input: {
    context: {
      sessionId: string;
      record: PersistedGeneratedBlueprintRecord;
      build: BlueprintBuild | null;
      bundle: GeneratedBlueprintBundleDraft;
      blueprint: ProjectBlueprint;
      canonicalBlueprintPath: string;
      learnerBlueprintPath: string;
      learnerWorkspaceRoot: string;
      projectRoot: string;
    };
    blueprint: ProjectBlueprint;
    bundle: GeneratedBlueprintBundleDraft;
    generatedLearnerFiles?: Record<string, string>;
    generatedHiddenTests?: Record<string, string>;
    event?: {
      stage: string;
      title: string;
      detail: string;
      level: "info" | "success" | "warning" | "error";
      payload?: Record<string, unknown>;
    };
  }): Promise<void> {
    const timestamp = this.now().toISOString();
    const learnerBlueprint = ProjectBlueprintSchema.parse({
      ...input.blueprint,
      projectRoot: input.context.learnerWorkspaceRoot
    });

    if (input.generatedHiddenTests && Object.keys(input.generatedHiddenTests).length > 0) {
      await this.writeProjectFiles(input.context.projectRoot, input.generatedHiddenTests);
      await this.writeProjectFiles(input.context.learnerWorkspaceRoot, input.generatedHiddenTests);
    }

    if (input.generatedLearnerFiles && Object.keys(input.generatedLearnerFiles).length > 0) {
      await this.writeProjectFiles(input.context.learnerWorkspaceRoot, input.generatedLearnerFiles);
    }

    await this.writeBlueprintFile(input.context.canonicalBlueprintPath, input.blueprint);
    await this.writeBlueprintFile(input.context.learnerBlueprintPath, learnerBlueprint);

    await this.persistence.saveGeneratedBlueprintRecord({
      ...input.context.record,
      blueprintPath: input.context.canonicalBlueprintPath,
      projectRoot: input.context.projectRoot,
      blueprintJson: JSON.stringify(input.blueprint),
      bundleJson: JSON.stringify(input.bundle),
      updatedAt: timestamp,
      isActive: true
    });
    await this.persistence.setActiveBlueprintState({
      blueprintPath: input.context.canonicalBlueprintPath,
      sessionId: input.context.sessionId,
      updatedAt: timestamp
    });
    await setActiveBlueprintPath({
      rootDirectory: this.rootDirectory,
      blueprintPath: input.context.canonicalBlueprintPath,
      sessionId: input.context.sessionId,
      now: this.now
    });

    if (input.context.build?.id) {
      const currentBuild = input.context.build;
      await this.mutateBlueprintBuild(currentBuild.id, (current) => ({
        ...(current ?? currentBuild ?? createBlueprintBuildRecord({
          id: input.context.sessionId,
          sessionId: input.context.sessionId,
          goal: input.context.record.goal,
          createdAt: timestamp,
          updatedAt: timestamp
        })),
        blueprint: input.blueprint,
        blueprintDraft: input.bundle,
        learnerFiles: toBlueprintArtifactFiles(input.bundle.learnerFiles, "learner"),
        hiddenTests: toBlueprintArtifactFiles(input.bundle.hiddenTests, "hidden-tests"),
        updatedAt: timestamp,
        lastError: null,
        currentStage: input.event?.stage ?? current?.currentStage ?? currentBuild.currentStage,
        currentStageTitle: input.event?.title ?? current?.currentStageTitle ?? currentBuild.currentStageTitle,
        currentStageStatus:
          input.event?.level === "warning"
            ? "warning"
            : input.event?.level === "error"
              ? "failed"
              : "completed"
      }));
    }

    if (input.event) {
      await this.recordBlueprintBuildEventForSession(input.context.sessionId, input.event);
    }
  }

  private async recordBlueprintBuildEventForSession(inputSessionId: string, event: {
    stage: string;
    title: string;
    detail: string;
    level: "info" | "success" | "warning" | "error";
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const build = await this.persistence.getBlueprintBuildBySession(inputSessionId);
    if (!build) {
      return;
    }

    const timestamp = this.now().toISOString();
    const record = {
      id: randomUUID(),
      buildId: build.id,
      jobId: null,
      kind: null,
      stage: event.stage,
      title: event.title,
      detail: event.detail,
      level: event.level,
      payload: cloneJsonCompatible(event.payload ?? null),
      traceUrl: null,
      timestamp
    } satisfies Parameters<AgentPersistence["appendBlueprintBuildEvent"]>[0];

    await this.enqueueBlueprintBuildWrite(async () => {
      await this.persistence.appendBlueprintBuildEvent(record);
      this.broadcastBlueprintBuild(build.id, "build-event", record);
      await this.mutateBlueprintBuildUnsafe(build.id, (current) => ({
        ...(current ?? build),
        updatedAt: timestamp,
        lastEventAt: timestamp,
        currentStage: event.stage,
        currentStageTitle: event.title,
        currentStageStatus:
          event.level === "warning"
            ? "warning"
            : event.level === "error"
              ? "failed"
              : "completed",
        lastError: event.level === "error" ? event.detail : current?.lastError ?? null
      }));
    });
  }

  private reviewMultipleChoiceCheck(
    check: Extract<ComprehensionCheck, { type: "mcq" }>,
    response: string
  ): CheckReviewResponse {
    const isCorrect = response.trim() === check.answer;
    const selected = check.options.find((option) => option.id === response.trim()) ?? null;

    return {
      review: {
        status: isCorrect ? "complete" : "needs-revision",
        message: isCorrect
          ? "Correct. You picked the option that matches the taught concept."
          : selected
            ? `Not quite. "${selected.label}" misses the core behavior this step depends on.`
            : "Select the option that best matches the behavior explained in the lesson.",
        coveredCriteria: isCorrect ? [check.answer] : [],
        missingCriteria: isCorrect
          ? []
          : ["Choose the option that matches the concept explained in the lesson."]
      },
      projectImprovement: null
    };
  }

  private async reviewShortAnswerCheck(
    input: CheckReviewRequest
  ): Promise<CheckReviewResponse> {
    const activeProject = await this.persistence.getActiveProject();
    const draft = await (await this.getLlm()).parse({
      schema: SHORT_ANSWER_CHECK_REVIEW_DRAFT_SCHEMA,
      schemaName: "construct_short_answer_check_review",
      instructions: buildShortAnswerCheckReviewInstructions(),
      prompt: JSON.stringify(
        {
          stepId: input.stepId,
          stepTitle: input.stepTitle,
          stepSummary: input.stepSummary,
          concepts: input.concepts,
          check: input.check,
          learnerAnswer: input.response
        },
        null,
        2
      ),
      maxOutputTokens: 900,
      verbosity: "low",
      usage: {
        projectId: activeProject?.id ?? null,
        projectName: activeProject?.name ?? null,
        projectGoal: activeProject?.goal ?? null,
        blueprintPath: activeProject?.blueprintPath ?? null,
        stage: "check-review",
        operation: "short-answer review"
      }
    });

    return CheckReviewResponseSchema.parse({
      review: draft
    });
  }

  private async recordTaskKnowledgeSignal(input: {
    step: ProjectBlueprint["steps"][number];
    status: "failed" | "passed" | "needs-review";
    telemetry: TaskTelemetry;
  }): Promise<void> {
    const knowledgeBase = await this.readKnowledgeBase();
    const timestamp = this.now().toISOString();
    const projectContext = await this.getKnowledgeProjectContext({
      stepId: input.step.id,
      stepTitle: input.step.title,
      fallbackFilePath: input.step.anchor.file,
      fallbackAnchorMarker: input.step.anchor.marker
    });
    const score = taskOutcomeToScore({
      status: input.status,
      hintsUsed: input.telemetry.hintsUsed,
      pasteRatio: input.telemetry.pasteRatio
    });
    const signals = this.buildSignalsForConceptIds(
      knowledgeBase,
      input.step.concepts,
      {
        score,
        source: "task-performance",
        recordedAt: timestamp,
        rationale: `${input.step.title} ended ${input.status}. Hidden-test telemetry recorded hints=${input.telemetry.hintsUsed} and pasteRatio=${input.telemetry.pasteRatio.toFixed(2)}.`,
        title: `Worked on ${input.step.title}`,
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
        projectGoal: projectContext.projectGoal,
        stepId: input.step.id,
        stepTitle: input.step.title,
        filePath: projectContext.filePath,
        anchorMarker: projectContext.anchorMarker,
        revisionNotes: [
          input.step.summary,
          `Submission status: ${input.status}.`,
          input.telemetry.hintsUsed > 0 ? `Hints used: ${input.telemetry.hintsUsed}.` : "",
          input.telemetry.pasteRatio > 0 ? `Paste ratio: ${input.telemetry.pasteRatio.toFixed(2)}.` : ""
        ],
        codeExample: projectContext.codeExample,
        revisitPrompt: `Re-open ${input.step.title} and inspect the anchored implementation path.`
      }
    );

    if (signals.length === 0) {
      return;
    }

    await this.persistence.setKnowledgeBase(applyKnowledgeSignals(knowledgeBase, signals));
  }

  private async recordCheckKnowledgeSignal(input: {
    concepts: string[];
    check: ComprehensionCheck;
    review: CheckReviewResponse["review"];
    attemptCount: number;
    stepId: string;
    stepTitle: string;
    stepSummary: string;
  }): Promise<void> {
    const knowledgeBase = await this.readKnowledgeBase();
    const timestamp = this.now().toISOString();
    const projectContext = await this.getKnowledgeProjectContext({
      stepId: input.stepId,
      stepTitle: input.stepTitle
    });
    const score = input.review.status === "complete"
      ? Math.max(58, 80 - input.attemptCount * 6)
      : Math.max(18, 42 - input.attemptCount * 4);
    const signals = this.buildSignalsForConceptIds(
      knowledgeBase,
      input.concepts,
      {
        score,
        source: "quiz-review",
        recordedAt: timestamp,
        rationale: `${input.stepTitle}: ${input.review.message}`,
        title: `Review ${input.stepTitle}`,
        projectId: projectContext.projectId,
        projectName: projectContext.projectName,
        projectGoal: projectContext.projectGoal,
        stepId: input.stepId,
        stepTitle: input.stepTitle,
        filePath: projectContext.filePath,
        anchorMarker: projectContext.anchorMarker,
        revisionNotes: [
          input.stepSummary,
          input.check.prompt,
          input.review.message
        ],
        codeExample: projectContext.codeExample,
        revisitPrompt: `Revisit ${input.stepTitle} and answer why ${input.check.prompt}`
      }
    );

    if (signals.length === 0) {
      return;
    }

    await this.persistence.setKnowledgeBase(applyKnowledgeSignals(knowledgeBase, signals));
  }

  private buildSignalsForConceptIds(
    knowledgeBase: UserKnowledgeBase,
    conceptIds: string[],
    input: {
      score: number;
      source: "self-report" | "agent-inferred" | "task-performance" | "quiz-review" | "runtime-guide";
      recordedAt: string;
      rationale: string;
      title?: string | null;
      projectId?: string | null;
      projectName?: string | null;
      projectGoal?: string | null;
      stepId?: string | null;
      stepTitle?: string | null;
      filePath?: string | null;
      anchorMarker?: string | null;
      revisionNotes?: string[];
      codeExample?: string | null;
      revisitPrompt?: string | null;
    }
  ) {
    const flattened = flattenKnowledgeConcepts(knowledgeBase.concepts);
    const existingConcepts = new Map(flattened.map((concept) => [concept.id, concept]));

    return Array.from(new Set(conceptIds))
      .filter(Boolean)
      .map((conceptId) => {
        const existing = existingConcepts.get(conceptId);

        return {
          conceptId,
          label: existing?.label ?? labelForConceptId(conceptId),
          category: existing?.category ?? inferKnowledgeCategory(conceptId),
          score: input.score,
          rationale: input.rationale,
          source: input.source,
          recordedAt: input.recordedAt,
          labelPath: getKnowledgeConceptLabelPath(knowledgeBase.concepts, conceptId) ?? undefined,
          evidenceTitle: input.title ?? null,
          projectId: input.projectId ?? null,
          projectName: input.projectName ?? null,
          projectGoal: input.projectGoal ?? null,
          stepId: input.stepId ?? null,
          stepTitle: input.stepTitle ?? null,
          filePath: input.filePath ?? null,
          anchorMarker: input.anchorMarker ?? null,
          revisionNotes: input.revisionNotes?.filter(Boolean) ?? [],
          codeExample: input.codeExample ?? null,
          revisitPrompt: input.revisitPrompt ?? null
        };
      });
  }

  private async getKnowledgeProjectContext(input: {
    stepId?: string | null;
    stepTitle?: string | null;
    fallbackFilePath?: string | null;
    fallbackAnchorMarker?: string | null;
  }): Promise<{
    projectId: string | null;
    projectName: string | null;
    projectGoal: string | null;
    stepId: string | null;
    stepTitle: string | null;
    filePath: string | null;
    anchorMarker: string | null;
    codeExample: string | null;
  }> {
    const activeProject = await this.persistence.getActiveProject();
    const base = {
      projectId: activeProject?.id ?? null,
      projectName: activeProject?.name ?? null,
      projectGoal: activeProject?.goal ?? null,
      stepId: input.stepId ?? activeProject?.currentStepId ?? null,
      stepTitle: input.stepTitle ?? activeProject?.currentStepTitle ?? null,
      filePath: input.fallbackFilePath ?? null,
      anchorMarker: input.fallbackAnchorMarker ?? null,
      codeExample: null as string | null
    };

    if (!activeProject?.blueprintPath || !base.stepId) {
      return base;
    }

    try {
      const blueprint = await loadBlueprint(activeProject.blueprintPath);
      const step =
        getBlueprintRuntimeSteps(blueprint).find((entry) => entry.id === base.stepId) ?? null;

      if (!step) {
        return base;
      }

      return {
        ...base,
        stepTitle: step.title,
        filePath: step.anchor.file,
        anchorMarker: step.anchor.marker,
        codeExample: extractKnowledgeCodeExample(
          blueprint.files[step.anchor.file] ?? "",
          step.anchor.marker
        )
      };
    } catch {
      return base;
    }
  }

  private buildAdaptiveFrontierEvidenceBundle(input: {
    knowledgeBase: UserKnowledgeBase;
    blueprint: ProjectBlueprint;
    step: ProjectBlueprint["steps"][number];
    trigger: ProjectImprovement["trigger"];
    latestSignal: string;
    diagnostics: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"];
  }): {
    trigger: ProjectImprovement["trigger"];
    focusStep: {
      id: string;
      title: string;
      summary: string;
      concepts: string[];
    };
    latestSignal: string;
    conceptNotes: Array<{
      conceptId: string;
      label: string;
      currentScore: number;
      trend: "improving" | "steady" | "slipping";
      recentSignals: Array<{
        source: StoredKnowledgeConcept["evidence"][number]["source"];
        score: number;
        summary: string;
        recordedAt: string;
        stepId: string | null;
        stepTitle: string | null;
      }>;
    }>;
    frontierDiagnostics: Array<{
      kind: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"][number]["kind"];
      summary: string;
      evidence: string;
      recordedAt: string;
    }>;
    evidenceCount: number;
  } {
    const conceptsById = new Map(
      flattenKnowledgeConcepts(input.knowledgeBase.concepts).map((concept) => [concept.id, concept])
    );
    const conceptNotes = Array.from(new Set(input.step.concepts))
      .map((conceptId) => conceptsById.get(conceptId))
      .filter((concept): concept is StoredKnowledgeConcept => Boolean(concept))
      .map((concept) => {
        const recentSignals = concept.evidence
          .slice()
          .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
          .slice(-4)
          .map((evidence) => ({
            source: evidence.source,
            score: evidence.score,
            summary: evidence.summary,
            recordedAt: evidence.recordedAt,
            stepId: evidence.stepId,
            stepTitle: evidence.stepTitle
          }));
        const firstScore = recentSignals[0]?.score ?? concept.score;
        const lastScore = recentSignals[recentSignals.length - 1]?.score ?? concept.score;
        const trend: "improving" | "steady" | "slipping" =
          lastScore - firstScore >= 10
            ? "improving"
            : firstScore - lastScore >= 10
              ? "slipping"
              : "steady";

        return {
          conceptId: concept.id,
          label: concept.label,
          currentScore: concept.score,
          trend,
          recentSignals
        };
      });
    const frontierDiagnostics = input.diagnostics
      .filter((diagnostic) =>
        diagnostic.conceptIds.some((conceptId) => input.step.concepts.includes(conceptId))
        || diagnostic.summary.includes(input.step.title)
        || diagnostic.evidence.includes(input.step.title)
      )
      .slice(-5)
      .map((diagnostic) => ({
        kind: diagnostic.kind,
        summary: diagnostic.summary,
        evidence: diagnostic.evidence,
        recordedAt: diagnostic.recordedAt
      }));
    const evidenceCount =
      conceptNotes.reduce((sum, note) => sum + note.recentSignals.length, 0)
      + frontierDiagnostics.length;

    return {
      trigger: input.trigger,
      focusStep: {
        id: input.step.id,
        title: input.step.title,
        summary: input.step.summary,
        concepts: input.step.concepts
      },
      latestSignal: input.latestSignal,
      conceptNotes,
      frontierDiagnostics,
      evidenceCount
    };
  }

  private createProjectImprovementResult(input: {
    trigger: ProjectImprovement["trigger"];
    status: ProjectImprovement["status"];
    title: string;
    detail: string;
    updatedBlueprint?: boolean;
    activeStepId?: string | null;
    evidenceCount?: number;
  }): ProjectImprovement {
    return {
      trigger: input.trigger,
      status: input.status,
      title: input.title,
      detail: input.detail,
      updatedBlueprint: input.updatedBlueprint ?? false,
      activeStepId: input.activeStepId ?? null,
      evidenceCount: input.evidenceCount ?? 0
    };
  }

  private async getLlm(): Promise<StructuredLanguageModel> {
    if (this.llmOverride) {
      return this.llmOverride;
    }

    const userId = getCurrentUserId();
    const existing = this.llmByUserId.get(userId);
    if (existing) {
      return existing;
    }

    const config = await this.getAgentConfig();
    const llm = new OpenAIStructuredLanguageModel({
        apiKey: config.openAiApiKey,
        baseUrl: config.openAiBaseUrl,
        model: config.openAiModel,
        logger: this.logger,
        persistence: this.persistence
      });
    this.llmByUserId.set(userId, llm);

    return llm;
  }

  private async getFastLlm(): Promise<StructuredLanguageModel> {
    if (this.llmOverride) {
      return this.llmOverride;
    }

    const userId = getCurrentUserId();
    const existing = this.fastLlmByUserId.get(userId);
    if (existing) {
      return existing;
    }

    const config = await this.getAgentConfig();
    const llm = new OpenAIStructuredLanguageModel({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiFastModel,
      logger: this.logger,
      persistence: this.persistence
    });
    this.fastLlmByUserId.set(userId, llm);

    return llm;
  }

  private async getRepairLlm(): Promise<StructuredLanguageModel> {
    if (this.llmOverride) {
      return this.llmOverride;
    }

    const userId = getCurrentUserId();
    const existing = this.repairLlmByUserId.get(userId);
    if (existing) {
      return existing;
    }

    const config = await this.getAgentConfig();
    const llm = new OpenAIStructuredLanguageModel({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiRepairModel,
      logger: this.logger,
      persistence: this.persistence
    });
    this.repairLlmByUserId.set(userId, llm);

    return llm;
  }

  private async getSearch(): Promise<SearchProvider> {
    if (this.searchOverride) {
      return this.searchOverride;
    }

    const userId = getCurrentUserId();
    const existing = this.searchByUserId.get(userId);
    if (existing) {
      return existing;
    }

    const config = await this.getAgentConfig();
    const search = buildSearchProvider({
        provider: config.searchProvider,
        tavilyApiKey: config.tavilyApiKey,
        depth: config.tavilySearchDepth,
        logger: this.logger
      });
    this.searchByUserId.set(userId, search);

    return search;
  }

  private getProjectInstaller(): ProjectInstaller {
    if (this.installerOverride) {
      return this.installerOverride;
    }

    if (!this.projectInstaller) {
      this.projectInstaller = createProjectInstaller(this.logger);
    }

    return this.projectInstaller;
  }

  private async getAgentConfig(): Promise<AgentConfig> {
    const userId = getCurrentUserId();
    const cached = this.resolvedConfigByUserId.get(userId);
    if (cached) {
      return cached;
    }

    const envConfig = resolveAgentConfig();
    const [openAiConnection, tavilyConnection] = await Promise.all([
      this.auth.resolveProviderSecret({
        userId,
        provider: "openai"
      }),
      this.auth.resolveProviderSecret({
        userId,
        provider: "tavily"
      })
    ]);

    const resolved = {
      ...envConfig,
      openAiApiKey: openAiConnection.secret ?? envConfig.openAiApiKey,
      openAiBaseUrl: openAiConnection.baseUrl ?? envConfig.openAiBaseUrl,
      tavilyApiKey: tavilyConnection.secret ?? envConfig.tavilyApiKey
    } satisfies AgentConfig;

    this.resolvedConfigByUserId.set(userId, resolved);
    return resolved;
  }

  createPlanningQuestionsJob(
    input: PlanningSessionStartRequest
  ): AgentJobCreatedResponse {
    const request = PlanningSessionStartRequestSchema.parse(input);
    const job = this.createJob("planning-questions");
    this.logger.info("Queued planning questions job.", {
      jobId: job.jobId,
      kind: job.kind,
      goal: request.goal,
    });

    void this.runJob(job, async () => {
      const result = await this.runPlanningQuestionGraph(job.jobId, request);
      return PlanningSessionStartResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  createPlanningPlanJob(
    input: PlanningSessionCompleteRequest
  ): AgentJobCreatedResponse {
    const request = PlanningSessionCompleteRequestSchema.parse(input);
    const job = this.createJob("planning-plan");
    this.logger.info("Queued planning roadmap job.", {
      jobId: job.jobId,
      kind: job.kind,
      sessionId: request.sessionId,
      answerCount: request.answers.length
    });

    void this.runJob(job, async () => {
      const result = await this.runPlanningPlanGraph(job.jobId, request);
      return PlanningSessionCompleteResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  createRuntimeGuideJob(input: RuntimeGuideRequest): AgentJobCreatedResponse {
    const request = RuntimeGuideRequestSchema.parse(input);
    const job = this.createJob("runtime-guide");
    this.logger.info("Queued runtime guide job.", {
      jobId: job.jobId,
      kind: job.kind,
      stepId: request.stepId,
      filePath: request.filePath,
      tests: request.tests
    });

    void this.runJob(job, async () => {
      const result = await this.runRuntimeGuideGraph(job.jobId, request);
      await this.recordAdaptiveFrontierDiagnostic({
        stepId: request.stepId,
        kind: "runtime-question",
        summary: `Guide interaction opened for ${request.stepTitle}.`,
        evidence: result.nextAction,
        conceptIds: [],
        intervention: {
          kind: "return-to-code",
          summary: "Construct answered in context and kept the current capability active.",
          reason: "The learner asked for runtime guidance instead of advancing the path."
        }
      });
      return RuntimeGuideResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  createBlueprintDeepDiveJob(
    input: BlueprintDeepDiveRequest
  ): AgentJobCreatedResponse {
    const request = BlueprintDeepDiveRequestSchema.parse(input);
    const job = this.createJob("blueprint-deep-dive");
    this.logger.info("Queued blueprint deep-dive job.", {
      jobId: job.jobId,
      kind: job.kind,
      stepId: request.stepId,
      failureCount: request.failureCount,
      hintsUsed: request.hintsUsed
    });

    void this.runJob(job, async () => {
      const result = await this.runBlueprintDeepDiveGraph(job.jobId, request);
      return BlueprintDeepDiveResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  getJob(jobId: string): AgentJobSnapshot {
    const job = this.getOwnedJob(jobId);

    return AgentJobSnapshotSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      result: job.result
    });
  }

  openJobStream(jobId: string, response: http.ServerResponse): void {
    const job = this.getOwnedJob(jobId);

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (eventName: string, payload: unknown) => {
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);

      if (eventName === "agent-end") {
        response.end();
      }
    };

    send("agent-state", this.getJob(jobId));

    for (const event of job.events) {
      send("agent-event", event);
    }

    if (job.status === "completed") {
      send("agent-complete", {
        jobId,
        result: job.result
      });
      response.end();
      return;
    }

    if (job.status === "failed") {
      send("agent-error", {
        jobId,
        error: job.error ?? "Unknown agent failure."
      });
      response.end();
      return;
    }

    job.listeners.add(send);

    response.on("close", () => {
      job.listeners.delete(send);
    });
  }

  async openBlueprintBuildStream(
    buildId: string,
    response: http.ServerResponse
  ): Promise<void> {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (eventName: string, payload: unknown) => {
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);

      if (eventName === "build-end") {
        response.end();
      }
    };

    const detail = await this.getBlueprintBuildDetail(buildId);
    send("build-detail", detail);

    if (detail.build?.status === "completed" || detail.build?.status === "failed") {
      send("build-end", {
        buildId,
        status: detail.build.status
      });
      return;
    }

    const listeners = this.blueprintBuildListeners.get(buildId) ?? new Set<BuildListener>();
    listeners.add(send);
    this.blueprintBuildListeners.set(buildId, listeners);

    response.on("close", () => {
      listeners.delete(send);

      if (listeners.size === 0) {
        this.blueprintBuildListeners.delete(buildId);
      }
    });
  }

  private async ensurePlanningQuestionsBuild(
    jobId: string,
    request: PlanningSessionStartRequest
  ): Promise<BlueprintBuild> {
    const existingBuildId = this.buildIdsByJobId.get(jobId);
    if (existingBuildId) {
      const existingBuild = await this.persistence.getBlueprintBuild(existingBuildId);
      if (existingBuild) {
        return existingBuild;
      }
    }

    const timestamp = this.now().toISOString();
    const build = createBlueprintBuildRecord({
      id: randomUUID(),
      sessionId: null,
      goal: request.goal.trim(),
      detectedLanguage: null,
      detectedDomain: null,
      status: "running",
      currentStage: "question-generation",
      currentStageTitle: "Generating tailoring questions",
      currentStageStatus: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      planningSession: null,
      answers: [],
      langSmithProject: resolveLangSmithProjectName(),
      traceUrl: null
    });

    this.buildIdsByJobId.set(jobId, build.id);
    await this.persistBlueprintBuild(build);
    return build;
  }

  private async ensurePlanningPlanBuild(
    jobId: string,
    request: PlanningSessionCompleteRequest,
    session: PlanningSession
  ): Promise<BlueprintBuild> {
    const existingBySession = await this.persistence.getBlueprintBuildBySession(session.sessionId);
    const timestamp = this.now().toISOString();
    const build = existingBySession ?? createBlueprintBuildRecord({
      id: session.sessionId,
      sessionId: session.sessionId,
      goal: session.goal,
      detectedLanguage: session.detectedLanguage,
      detectedDomain: session.detectedDomain,
      status: "running",
      currentStage: "plan-generation",
      currentStageTitle: "Synthesizing project plan",
      currentStageStatus: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      planningSession: session,
      answers: request.answers,
      langSmithProject: resolveLangSmithProjectName(),
      traceUrl: null
    });

    this.buildIdsByJobId.set(jobId, build.id);

    const nextBuild = createBlueprintBuildRecord({
      ...build,
      sessionId: session.sessionId,
      goal: session.goal,
      detectedLanguage: session.detectedLanguage,
      detectedDomain: session.detectedDomain,
      status: "running",
      currentStage:
        build.currentStage && build.currentStage !== "failed"
          ? build.currentStage
          : "plan-generation",
      currentStageTitle:
        build.currentStageTitle && build.currentStage !== "failed"
          ? build.currentStageTitle
          : "Synthesizing project plan",
      currentStageStatus: "running",
      updatedAt: timestamp,
      completedAt: null,
      lastError: null,
      planningSession: session,
      answers: request.answers,
      langSmithProject: build.langSmithProject ?? resolveLangSmithProjectName()
    });

    await this.persistBlueprintBuild(nextBuild);
    return nextBuild;
  }

  private async mutateBlueprintBuildForJob(
    jobId: string,
    mutate: (current: BlueprintBuild | null) => BlueprintBuild
  ): Promise<BlueprintBuild | null> {
    const buildId = this.buildIdsByJobId.get(jobId);
    if (!buildId) {
      return null;
    }

    return this.mutateBlueprintBuild(buildId, mutate);
  }

  private async mutateBlueprintBuild(
    buildId: string,
    mutate: (current: BlueprintBuild | null) => BlueprintBuild
  ): Promise<BlueprintBuild> {
    return this.enqueueBlueprintBuildWrite(async () =>
      this.mutateBlueprintBuildUnsafe(buildId, mutate)
    );
  }

  private async mutateBlueprintBuildUnsafe(
    buildId: string,
    mutate: (current: BlueprintBuild | null) => BlueprintBuild
  ): Promise<BlueprintBuild> {
    const current = await this.persistence.getBlueprintBuild(buildId);
    const next = createBlueprintBuildRecord(mutate(current));
    await this.persistBlueprintBuildUnsafe(next);
    return next;
  }

  private async persistBlueprintBuild(build: BlueprintBuild): Promise<void> {
    await this.enqueueBlueprintBuildWrite(async () => {
      await this.persistBlueprintBuildUnsafe(build);
    });
  }

  private async persistBlueprintBuildUnsafe(build: BlueprintBuild): Promise<void> {
    await this.persistence.upsertBlueprintBuild(build);
    this.broadcastBlueprintBuild(build.id, "build-state", build);

    if (build.status === "completed" || build.status === "failed") {
      this.broadcastBlueprintBuild(build.id, "build-end", {
        buildId: build.id,
        status: build.status
      });
    }
  }

  private async recordBlueprintBuildEvent(
    jobId: string,
    event: AgentEvent
  ): Promise<void> {
    const buildId = this.buildIdsByJobId.get(jobId);
    if (!buildId) {
      return;
    }

    await this.enqueueBlueprintBuildWrite(async () => {
      const record = {
        id: event.id,
        buildId,
        jobId,
        kind: event.kind,
        stage: event.stage,
        title: event.title,
        detail: event.detail ?? null,
        level: event.level,
        payload: cloneJsonCompatible(event.payload ?? null),
        traceUrl: null,
        timestamp: event.timestamp
      } satisfies Parameters<AgentPersistence["appendBlueprintBuildEvent"]>[0];

      await this.persistence.appendBlueprintBuildEvent(record);
      this.broadcastBlueprintBuild(buildId, "build-event", record);

      const normalizedStage = stripStageStreamSuffix(event.stage);
      const isStreamEvent = event.stage.endsWith("-stream");
      await this.mutateBlueprintBuildUnsafe(buildId, (current) => {
        const existing = current ?? createBlueprintBuildRecord({
          id: buildId,
          sessionId: null,
          goal: event.title,
          detectedLanguage: null,
          detectedDomain: null,
          status: "running",
          currentStage: normalizedStage,
          currentStageTitle: event.title,
          currentStageStatus: event.level === "error" ? "failed" : "running",
          createdAt: event.timestamp,
          updatedAt: event.timestamp
        });

        return {
          ...existing,
          updatedAt: event.timestamp,
          lastEventAt: event.timestamp,
          currentStage: normalizedStage,
          currentStageTitle: isStreamEvent ? existing.currentStageTitle : event.title,
          currentStageStatus:
            event.level === "error"
              ? "failed"
              : event.level === "warning"
                ? "warning"
                : existing.currentStageStatus,
          lastError:
            event.level === "error"
              ? event.detail ?? event.title
              : existing.lastError
        };
      });
    });
  }

  private async markBlueprintBuildStageForJob(
    jobId: string,
    input: {
      stage: string;
      title: string;
      status: BlueprintBuildStage["status"];
      detail: string;
      inputJson?: unknown;
      outputJson?: unknown;
      metadataJson?: unknown;
    }
  ): Promise<void> {
    const buildId = this.buildIdsByJobId.get(jobId);
    if (!buildId) {
      return;
    }

    await this.enqueueBlueprintBuildWrite(async () => {
      const timestamp = this.now().toISOString();
      const stageKey = `${buildId}:${input.stage}`;
      const startedAt = this.buildStageStartedAt.get(stageKey) ?? timestamp;

      if (input.status === "running") {
        this.buildStageStartedAt.set(stageKey, startedAt);
      } else if (input.status === "completed" || input.status === "failed") {
        this.buildStageStartedAt.delete(stageKey);
      }

      const stageRecord: BlueprintBuildStage = {
        id: stageKey,
        buildId,
        stage: input.stage,
        title: input.title,
        status: input.status,
        detail: input.detail,
        inputJson: cloneJsonCompatible(input.inputJson ?? null),
        outputJson: cloneJsonCompatible(input.outputJson ?? null),
        metadataJson: cloneJsonCompatible(input.metadataJson ?? null),
        traceUrl: null,
        startedAt,
        updatedAt: timestamp,
        completedAt:
          input.status === "completed" || input.status === "failed" ? timestamp : null
      };

      await this.persistence.upsertBlueprintBuildStage(stageRecord);
      this.broadcastBlueprintBuild(buildId, "build-stage", stageRecord);

      await this.mutateBlueprintBuildUnsafe(buildId, (current) => {
        const existing = current ?? createBlueprintBuildRecord({
          id: buildId,
          sessionId: null,
          goal: input.title,
          detectedLanguage: null,
          detectedDomain: null,
          status: "running",
          currentStage: input.stage,
          currentStageTitle: input.title,
          currentStageStatus: input.status,
          createdAt: timestamp,
          updatedAt: timestamp
        });

        return {
          ...existing,
          status:
            input.status === "failed"
              ? "failed"
              : existing.status === "completed"
                ? "completed"
                : "running",
          currentStage: input.stage,
          currentStageTitle: input.title,
          currentStageStatus: input.status,
          updatedAt: timestamp,
          lastError: input.status === "failed" ? input.detail : existing.lastError
        };
      });
    });
  }

  private async markBlueprintBuildFailedForJob(
    jobId: string,
    errorMessage: string
  ): Promise<void> {
    const buildId = this.buildIdsByJobId.get(jobId);
    if (!buildId) {
      return;
    }

    const timestamp = this.now().toISOString();
    await this.mutateBlueprintBuild(buildId, (current) => {
      if (!current) {
        return createBlueprintBuildRecord({
          id: buildId,
          sessionId: null,
          goal: "Project creation",
          detectedLanguage: null,
          detectedDomain: null,
          status: "failed",
          currentStage: "failed",
          currentStageTitle: "Project creation failed",
          currentStageStatus: "failed",
          lastError: errorMessage,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      return {
        ...current,
        status: "failed",
        currentStage: current.currentStage ?? "failed",
        currentStageTitle: current.currentStageTitle ?? "Project creation failed",
        currentStageStatus: "failed",
        lastError: errorMessage,
        updatedAt: timestamp
      };
    });
  }

  private broadcastBlueprintBuild(
    buildId: string,
    eventName: string,
    payload: unknown
  ): void {
    const listeners = this.blueprintBuildListeners.get(buildId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(eventName, payload);
    }
  }

  private async enqueueBlueprintBuildWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.blueprintBuildWriteQueue.then(task, task);
    this.blueprintBuildWriteQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private createJob(kind: AgentJobKind): AgentJobRecord {
    const timestamp = this.now().toISOString();
    const record: AgentJobRecord = {
      jobId: randomUUID(),
      userId: getCurrentUserId(),
      kind,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
      result: null,
      listeners: new Set()
    };

    this.jobs.set(record.jobId, record);
    return record;
  }

  private getOwnedJob(jobId: string): AgentJobRecord {
    const job = this.jobs.get(jobId);

    if (!job || job.userId !== getCurrentUserId()) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    return job;
  }

  private async runJob<T>(job: AgentJobRecord, task: () => Promise<T>): Promise<void> {
    const startedAt = Date.now();
    this.updateJobStatus(job, "running");
    this.logger.info("Started agent job.", {
      jobId: job.jobId,
      kind: job.kind
    });

    try {
      const result = await task();
      job.result = result;
      this.updateJobStatus(job, "completed");
      this.logger.info("Completed agent job.", {
        jobId: job.jobId,
        kind: job.kind,
        durationMs: Date.now() - startedAt,
        result: summarizeJobResult(job.kind, result)
      });
      this.broadcast(job, "agent-complete", {
        jobId: job.jobId,
        result
      });
      this.closeListeners(job);
    } catch (error) {
      job.error = error instanceof Error ? error.message : "Unknown agent failure.";
      this.updateJobStatus(job, "failed");
      this.logger.error("Agent job failed.", {
        jobId: job.jobId,
        kind: job.kind,
        durationMs: Date.now() - startedAt,
        error: job.error
      });
      this.emitEvent(job, {
        stage: "failed",
        title: "Agent run failed",
        detail: job.error,
        level: "error"
      });
      this.broadcast(job, "agent-error", {
        jobId: job.jobId,
        error: job.error
      });
      await this.markBlueprintBuildFailedForJob(job.jobId, job.error);
      this.closeListeners(job);
    }
  }

  private updateJobStatus(
    job: AgentJobRecord,
    status: AgentJobRecord["status"]
  ): void {
    const previousStatus = job.status;
    job.status = status;
    job.updatedAt = this.now().toISOString();
    if (previousStatus !== status) {
      this.logger.info("Agent job status changed.", {
        jobId: job.jobId,
        kind: job.kind,
        from: previousStatus,
        to: status
      });
    }
    this.broadcast(job, "agent-state", this.getJob(job.jobId));
  }

  private closeListeners(job: AgentJobRecord): void {
    for (const listener of job.listeners) {
      listener("agent-end", {
        jobId: job.jobId,
        status: job.status
      });
    }

    job.listeners.clear();
  }

  private emitEvent(
    job: AgentJobRecord,
    input: Omit<AgentEvent, "id" | "jobId" | "kind" | "timestamp">
  ): void {
    const event = AgentEventSchema.parse({
      id: randomUUID(),
      jobId: job.jobId,
      kind: job.kind,
      timestamp: this.now().toISOString(),
      ...input
    });

    job.events.push(event);
    job.updatedAt = event.timestamp;
    this.logAgentEvent(job, event);
    this.broadcast(job, "agent-event", event);
    void this.recordBlueprintBuildEvent(job.jobId, event);
  }

  private logAgentEvent(job: AgentJobRecord, event: AgentEvent): void {
    const payloadSummary = summarizeAgentEventPayload(event);
    const isStreamEvent = Boolean(
      event.payload &&
        typeof event.payload === "object" &&
        "stream" in event.payload &&
        (event.payload as Record<string, unknown>).stream === true
    );
    const context: Record<string, unknown> = {
      jobId: job.jobId,
      kind: job.kind,
      stage: event.stage,
      level: event.level,
      title: event.title
    };

    if (event.detail && !isStreamEvent) {
      context.detail = event.detail;
    }

    if (payloadSummary) {
      context.payload = payloadSummary;
    }

    if (event.level === "error") {
      this.logger.error("Agent emitted event.", context);
      return;
    }

    if (event.level === "warning") {
      this.logger.warn("Agent emitted event.", context);
      return;
    }

    this.logger.info("Agent emitted event.", context);
  }

  private broadcast(job: AgentJobRecord, eventName: string, payload: unknown): void {
    for (const listener of job.listeners) {
      listener(eventName, payload);
    }
  }

  private async runPlanningQuestionGraph(
    jobId: string,
    request: PlanningSessionStartRequest
  ): Promise<PlanningSessionStartResponse> {
    await this.ensurePlanningQuestionsBuild(jobId, request);

    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<PlanningSessionStartRequest>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      goalScope: Annotation<GoalScope | null>(),
      projectShapeResearch: Annotation<ResearchDigest | null>(),
      prerequisiteResearch: Annotation<ResearchDigest | null>(),
      mergedResearch: Annotation<ResearchDigest | null>(),
      session: Annotation<PlanningSession | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async (state) => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner knowledge", "Pulling stored concept history and past goals.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("extractGoalSelfReport", async (state) => ({
        knowledgeBase: await this.withStage(jobId, "goal-self-report", "Reading learner self-description", "The Architect is extracting any explicit self-reported skill signals directly from the project prompt before it writes intake questions.", async () => {
          return this.extractGoalSelfReportKnowledge(
            state.knowledgeBase,
            state.request.goal,
            this.buildJobUsageContext(jobId, {
              stage: "goal-self-report",
              operation: "goal self-report extraction"
            })
          );
        })
      }))
      .addNode("determineScope", async (state) => ({
        goalScope: await this.withStage(jobId, "scope-analysis", "Scoping the request", "The Architect is deciding how large the project should be and whether broad external research is justified.", async () => {
          return this.determineGoalScope(
            state.request.goal,
            this.buildJobUsageContext(jobId, {
              stage: "scope-analysis",
              operation: "goal scope analysis"
            })
          );
        })
      }))
      .addNode("researchProjectShape", async (state) => ({
        projectShapeResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-project-shape",
              "Skipping broad project-shape research",
              state.goalScope.rationale,
              `Local-scope shape for: ${state.request.goal}`
            )
          : await this.withStage(jobId, "research-project-shape", "Researching the target project shape", "Fetching architecture references, major subsystems, and implementation constraints from Tavily.", async () => {
              return (await this.getSearch()).research(
                `Project architecture, core subsystems, and implementation constraints for: ${state.request.goal}`
              );
            })
      }))
      .addNode("researchPrerequisites", async (state) => ({
        prerequisiteResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-prerequisites",
              "Skipping broad prerequisite research",
              state.goalScope.rationale,
              `Local-scope prerequisites for: ${state.request.goal}`
            )
          : await this.withStage(jobId, "research-prerequisites", "Researching prerequisite skills", "Identifying the language, compiler, and systems concepts this project depends on.", async () => {
              return (await this.getSearch()).research(
                `Prerequisite language, compiler, and systems skills needed for: ${state.request.goal}`
              );
            })
      }))
      .addNode("mergeResearch", async (state) => ({
        mergedResearch: await this.withStage(jobId, "research-merge", "Combining research signals", "Merging architecture and prerequisite findings into a single planning context.", async () => {
          return mergeResearchDigests("Combined project-shape and prerequisite research", [
            state.projectShapeResearch,
            state.prerequisiteResearch
          ]);
        })
      }))
      .addNode("generateQuestions", async (state) => ({
        session: await this.withStage(jobId, "question-generation", "Generating project-tailoring questions", "OpenAI is turning the goal and stored knowledge into collaborative intake questions that tailor the project path.", async () => {
          const stream = this.createModelStreamForwarder(jobId, "question-generation", "question generation");
          try {
            const questionDraft = await (await this.getLlm()).parse({
              schema: PLANNING_QUESTION_DRAFT_SCHEMA,
              schemaName: "construct_planning_question_draft",
              instructions: buildQuestionGenerationInstructions(),
              prompt: JSON.stringify(
                {
                  goal: state.request.goal,
                  goalScope: state.goalScope,
                  priorKnowledge: serializeKnowledgeBaseForPrompt(state.knowledgeBase),
                  research: compactResearchDigest(state.mergedResearch)
                },
                null,
                2
              ),
              maxOutputTokens: 2_500,
              verbosity: "medium",
              stream,
              usage: this.buildJobUsageContext(jobId, {
                stage: "question-generation",
                operation: "planning question generation"
              })
            });

            return this.buildPlanningSession(state.request, questionDraft);
          } finally {
            stream.onComplete?.();
          }
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "extractGoalSelfReport")
      .addEdge("extractGoalSelfReport", "determineScope")
      .addEdge("determineScope", "researchProjectShape")
      .addEdge("determineScope", "researchPrerequisites")
      .addEdge("researchProjectShape", "mergeResearch")
      .addEdge("researchPrerequisites", "mergeResearch")
      .addEdge("mergeResearch", "generateQuestions")
      .addEdge("generateQuestions", END)
      .compile();

    const result = await graph.invoke(
      {
        jobId,
        request,
        knowledgeBase: createEmptyKnowledgeBase(this.now().toISOString()),
        goalScope: null,
        projectShapeResearch: null,
        prerequisiteResearch: null,
        mergedResearch: null,
        session: null
      },
      {
        runName: "construct:planning-questions",
        tags: ["construct", "planning-questions"],
        metadata: {
          buildId: this.buildIdsByJobId.get(jobId) ?? null,
          goal: request.goal,
          langSmithProject: resolveLangSmithProjectName()
        }
      }
    );

    await this.writePlanningState({
      session: result.session,
      plan: null,
      answers: []
    });

    await this.mutateBlueprintBuildForJob(jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: result.session?.sessionId ?? randomUUID(),
          sessionId: result.session?.sessionId ?? null,
          goal: request.goal,
          detectedLanguage: result.session?.detectedLanguage ?? null,
          detectedDomain: result.session?.detectedDomain ?? null,
          status: "questions-ready",
          currentStage: "question-generation",
          currentStageTitle: "Tailoring questions ready",
          currentStageStatus: "completed",
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString()
        })),
      sessionId: result.session?.sessionId ?? current?.sessionId ?? null,
      goal: result.session?.goal ?? request.goal,
      detectedLanguage: result.session?.detectedLanguage ?? current?.detectedLanguage ?? null,
      detectedDomain: result.session?.detectedDomain ?? current?.detectedDomain ?? null,
      status: "questions-ready",
      currentStage: "question-generation",
      currentStageTitle: "Tailoring questions ready",
      currentStageStatus: "completed",
      planningSession: result.session,
      updatedAt: this.now().toISOString(),
      lastError: null
    }));

    return PlanningSessionStartResponseSchema.parse({
      session: result.session
    });
  }

  private async runPlanningPlanGraph(
    jobId: string,
    request: PlanningSessionCompleteRequest
  ): Promise<PlanningSessionCompleteResponse> {
    const planningState = await this.readPlanningState();

    if (!planningState.session || planningState.session.sessionId !== request.sessionId) {
      throw new Error(`Unknown planning session ${request.sessionId}.`);
    }

    const session = planningState.session;
    const resolvedAnswers = this.resolvePlanningAnswers(session, request.answers);
    const answersSignature = this.buildPlanningAnswersSignature(resolvedAnswers);
    const planningCheckpoint = await this.readPlanningBuildCheckpoint(
      request.sessionId,
      answersSignature
    );
    await this.ensurePlanningPlanBuild(jobId, request, session);
    await this.writePlanningState({
      session,
      plan: planningState.plan,
      answers: request.answers
    });

    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<PlanningSessionCompleteRequest>(),
      session: Annotation<PlanningSession>(),
      resumeFromCheckpoint: Annotation<boolean>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      goalScope: Annotation<GoalScope | null>(),
      architectureResearch: Annotation<ResearchDigest | null>(),
      dependencyResearch: Annotation<ResearchDigest | null>(),
      validationResearch: Annotation<ResearchDigest | null>(),
      mergedResearch: Annotation<ResearchDigest | null>(),
      plan: Annotation<GeneratedProjectPlan | null>(),
      blueprintDraft: Annotation<GeneratedBlueprintBundleDraft | null>(),
      checkpointStage: Annotation<PlanGraphState["checkpointStage"]>(),
      checkpointFailure: Annotation<PlanningBuildCheckpoint["failure"]>(),
      activeBlueprintPath: Annotation<string | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async (state) => ({
        knowledgeBase: state.resumeFromCheckpoint
          ? await this.readKnowledgeBase()
          : await this.withStage(jobId, "knowledge-base", "Loading learner knowledge", "Combining stored knowledge with the current self-reported answers.", async () => {
              return this.readKnowledgeBase();
            })
      }))
      .addNode("determineScope", async (state) => ({
        goalScope: state.goalScope ?? (
          state.resumeFromCheckpoint
            ? await this.determineGoalScope(
                state.session.goal,
                this.buildJobUsageContext(jobId, {
                  sessionId: state.session.sessionId,
                  stage: "scope-analysis",
                  operation: "goal scope analysis"
                })
              )
            : await this.withStage(jobId, "scope-analysis", "Scoping the request", "The Architect is deciding how large the generated project should be before it spends tokens on research and blueprint synthesis.", async () => {
                return this.determineGoalScope(
                  state.session.goal,
                  this.buildJobUsageContext(jobId, {
                    sessionId: state.session.sessionId,
                    stage: "scope-analysis",
                    operation: "goal scope analysis"
                  })
                );
              })
        )
      }))
      .addNode("researchArchitecture", async (state) => ({
        architectureResearch: state.mergedResearch
          ? null
          : state.resumeFromCheckpoint
          ? state.goalScope && !state.goalScope.shouldResearch
            ? {
                query: `Local architecture outline for: ${state.session.goal}`,
                answer: state.goalScope.rationale,
                sources: []
              }
            : await (await this.getSearch()).research(
                `${state.session.goal} architecture, core modules, component boundaries`
              )
          : state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-architecture",
              "Skipping broad architecture research",
              state.goalScope.rationale,
              `Local architecture outline for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-architecture", "Researching architecture", "Fetching reference material for the requested system shape and major component boundaries.", async () => {
              return (await this.getSearch()).research(
                `${state.session.goal} architecture, core modules, component boundaries`
              );
            })
      }))
      .addNode("researchDependencies", async (state) => ({
        dependencyResearch: state.mergedResearch
          ? null
          : state.resumeFromCheckpoint
          ? state.goalScope && !state.goalScope.shouldResearch
            ? {
                query: `Local dependency order for: ${state.session.goal}`,
                answer: state.goalScope.rationale,
                sources: []
              }
            : await (await this.getSearch()).research(
                `${state.session.goal} dependency order, implementation sequence, first real behavior to implement`
              )
          : state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-dependency-order",
              "Skipping broad dependency-order research",
              state.goalScope.rationale,
              `Local dependency order for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-dependency-order", "Researching dependency order", "Tracing which modules must exist first and how the build should be sequenced.", async () => {
              return (await this.getSearch()).research(
                `${state.session.goal} dependency order, implementation sequence, first real behavior to implement`
              );
            })
      }))
      .addNode("researchValidation", async (state) => ({
        validationResearch: state.mergedResearch
          ? null
          : state.resumeFromCheckpoint
          ? state.goalScope && !state.goalScope.shouldResearch
            ? {
                query: `Local validation seams for: ${state.session.goal}`,
                answer: state.goalScope.rationale,
                sources: []
              }
            : await (await this.getSearch()).research(
                `${state.session.goal} validation strategy, test harness, component-level testing approach`
              )
          : state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-validation-strategy",
              "Skipping broad validation research",
              state.goalScope.rationale,
              `Local validation seams for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-validation-strategy", "Researching validation strategy", "Finding good validation seams, harness patterns, and per-component test boundaries.", async () => {
              return (await this.getSearch()).research(
                `${state.session.goal} validation strategy, test harness, component-level testing approach`
              );
            })
      }))
      .addNode("mergeResearch", async (state) => ({
        mergedResearch: state.mergedResearch ?? (
          state.resumeFromCheckpoint
            ? mergeResearchDigests("Combined architecture, dependency-order, and validation research", [
                state.architectureResearch,
                state.dependencyResearch,
                state.validationResearch
              ])
            : await this.withStage(jobId, "research-merge", "Combining research signals", "Fusing architecture, dependency, and validation research into a single generation context.", async () => {
                return mergeResearchDigests("Combined architecture, dependency-order, and validation research", [
                  state.architectureResearch,
                  state.dependencyResearch,
                  state.validationResearch
                ]);
              })
        )
      }))
      .addNode("generatePlan", async (state) => ({
        plan: state.plan
          ? await (async () => {
              await this.resumePlanningCheckpointStage(
                jobId,
                "plan-generation",
                "Reusing the saved roadmap draft",
                "Construct is resuming from the last successful planning stage instead of generating the roadmap again."
              );
              return state.plan;
            })()
          : await this.withStage(jobId, "plan-generation", "Synthesizing the personalized roadmap", "OpenAI is merging the project dependencies, learner profile, and research into a detailed build path.", async () => {
          const stream = this.createModelStreamForwarder(jobId, "plan-generation", "plan generation");
          try {
            const planDraft = await (await this.getLlm()).parse({
              schema: GENERATED_PROJECT_PLAN_DRAFT_SCHEMA,
              schemaName: "construct_generated_project_plan",
              instructions: buildPlanGenerationInstructions(),
              prompt: JSON.stringify(
                {
                  session: state.session,
                  goalScope: state.goalScope,
                  answers: resolvedAnswers,
                  priorKnowledge: serializeKnowledgeBaseForPrompt(state.knowledgeBase),
                  research: compactResearchDigest(state.mergedResearch)
                },
                null,
                2
              ),
              maxOutputTokens: 16_000,
              verbosity: "medium",
              stream,
              usage: this.buildJobUsageContext(jobId, {
                sessionId: state.session.sessionId,
                stage: "plan-generation",
                operation: "planning roadmap generation"
              })
            });

            const plan = this.buildGeneratedPlan(state.session, planDraft);
            await this.persistPlanningArtifacts(state.session, plan);
            await this.writePlanningState({
              session: state.session,
              plan,
              answers: request.answers
            });
            await this.mutateBlueprintBuildForJob(jobId, (current) => ({
              ...(current ??
                createBlueprintBuildRecord({
                  id: state.session.sessionId,
                  sessionId: state.session.sessionId,
                  goal: state.session.goal,
                  detectedLanguage: state.session.detectedLanguage,
                  detectedDomain: state.session.detectedDomain,
                  status: "running",
                  currentStage: "plan-generation",
                  currentStageTitle: "Project plan ready",
                  currentStageStatus: "completed",
                  createdAt: this.now().toISOString(),
                  updatedAt: this.now().toISOString()
                })),
              planningSession: state.session,
              answers: request.answers,
              plan,
              status: "running",
              currentStage: "plan-generation",
              currentStageTitle: "Project plan ready",
              currentStageStatus: "completed",
              updatedAt: this.now().toISOString(),
              lastError: null
            }));
            await this.mergeKnowledgeBase(
              state.knowledgeBase,
              state.session,
              plan,
              resolvedAnswers
            );
            await this.writePlanningBuildCheckpoint(state.session.sessionId, {
              answersSignature,
              stage: "plan-generated",
              plan,
              blueprintDraft: null,
              goalScope: state.goalScope,
              mergedResearch: state.mergedResearch
            });

            return plan;
          } finally {
            stream.onComplete?.();
          }
        }),
        checkpointStage: state.plan ? (state.checkpointStage ?? "plan-generated") : "plan-generated"
      }))
      .addNode("generateBlueprint", async (state) => ({
        blueprintDraft: state.blueprintDraft &&
          (state.checkpointStage === "blueprint-drafted" || state.checkpointStage === "lessons-authored")
          ? await (async () => {
              await this.resumePlanningCheckpointStage(
                jobId,
                "blueprint-generation",
                "Reusing the saved project bundle draft",
                "Construct is resuming from the last successful project-bundle stage instead of drafting the bundle again."
              );
              return state.blueprintDraft;
            })()
          : state.blueprintDraft && state.checkpointStage === "blueprint-draft-invalid"
            ? await this.repairPlanningBlueprintDraft({
                jobId,
                session: state.session,
                plan: state.plan,
                goalScope: state.goalScope,
                answers: resolvedAnswers,
                knowledgeBase: state.knowledgeBase,
                mergedResearch: state.mergedResearch,
                failedDraft: state.blueprintDraft,
                failure: state.checkpointFailure,
                answersSignature,
                requestAnswers: request.answers
              })
            : await this.generatePlanningBlueprintDraft({
                jobId,
                session: state.session,
                plan: state.plan,
                goalScope: state.goalScope,
                answers: resolvedAnswers,
                knowledgeBase: state.knowledgeBase,
                mergedResearch: state.mergedResearch,
                answersSignature,
                requestAnswers: request.answers
              }),
        checkpointStage:
          state.blueprintDraft && state.checkpointStage === "lessons-authored"
            ? state.checkpointStage
            : "blueprint-drafted"
      }))
      .addNode("authorLessons", async (state) => ({
        blueprintDraft: state.blueprintDraft && state.checkpointStage === "lessons-authored"
          ? await (async () => {
              await this.resumePlanningCheckpointStage(
                jobId,
                "lesson-authoring",
                "Reusing the saved lesson chapters",
                "Construct is resuming from the last successful lesson-authoring stage instead of rewriting the chapters again."
              );
              return state.blueprintDraft;
            })()
          : await this.withStage(jobId, "lesson-authoring", "Writing the lesson chapters", "The Architect is turning each step into a docs-style lesson with substantial markdown explanations, grounded checks, and a clear implementation handoff.", async () => {
          if (!state.plan) {
            throw new Error("Cannot author lessons before the project plan exists.");
          }

          if (!state.blueprintDraft) {
            throw new Error("Cannot author lessons before the blueprint draft exists.");
          }

          const lessonAuthoringContext = {
            stepCount: state.blueprintDraft.steps.length,
            firstStepTitle: state.blueprintDraft.steps[0]?.title ?? null,
            firstStepSlideCount: state.blueprintDraft.steps[0]?.lessonSlides.length ?? 0,
            firstStepCheckCount: state.blueprintDraft.steps[0]?.checks.length ?? 0
          };

          const job = this.jobs.get(jobId);
          if (job) {
            this.emitEvent(job, {
              stage: "lesson-authoring",
              title: "Writing the lesson chapters",
              detail: "The Architect is rewriting each step as a docs-style chapter so the learner is taught clearly before any checks or code tasks.",
              level: "info",
              payload: lessonAuthoringContext
            });
          }
          this.logger.info("Submitting lesson authoring request.", {
            jobId,
            sessionId: state.session.sessionId,
            goal: state.session.goal,
            ...lessonAuthoringContext
          });

          const authoredSteps: GeneratedBlueprintBundleDraft["steps"] = [];

          for (const [stepIndex, step] of state.blueprintDraft.steps.entries()) {
            if (job) {
              this.emitEvent(job, {
                stage: "lesson-authoring",
                title: `Writing lesson chapter ${stepIndex + 1} of ${state.blueprintDraft.steps.length}`,
                detail: `The Architect is expanding ${step.title} into a hand-holding docs chapter before the learner sees checks or code.`,
                level: "info",
                payload: {
                  stepId: step.id,
                  stepTitle: step.title,
                  stepIndex: stepIndex + 1,
                  totalSteps: state.blueprintDraft.steps.length
                }
              });
            }
            this.logger.info("Submitting lesson authoring request for step.", {
              jobId,
              sessionId: state.session.sessionId,
              stepId: step.id,
              stepTitle: step.title,
              stepIndex: stepIndex + 1,
              totalSteps: state.blueprintDraft.steps.length
            });

            const stream = this.createModelStreamForwarder(
              jobId,
              "lesson-authoring",
              `lesson chapter authoring for ${step.title}`
            );

            const authoredStep = await (await this.getLlm()).parse({
              schema: LESSON_AUTHORED_STEP_DRAFT_SCHEMA,
              schemaName: "construct_authored_blueprint_step",
              instructions: buildLessonAuthoringInstructions({
                stepIndex,
                totalSteps: state.blueprintDraft.steps.length
              }),
              prompt: JSON.stringify(
                {
                  session: state.session,
                  goalScope: state.goalScope,
                  answers: resolvedAnswers,
                  plan: state.plan,
                  priorKnowledge: serializeKnowledgeBaseForPrompt(state.knowledgeBase),
                  research: compactResearchDigest(state.mergedResearch),
                  currentStep: step,
                  lessonAuthoringBrief: buildLessonAuthoringBrief(step, stepIndex, state.blueprintDraft.steps.length)
                },
                null,
                2
              ),
              maxOutputTokens: stepIndex === 0 ? 10_000 : 8_000,
              verbosity: "high",
              stream,
              usage: this.buildJobUsageContext(jobId, {
                sessionId: state.session.sessionId,
                stage: "lesson-authoring",
                operation: `lesson authoring:${step.id}`
              })
            }).finally(() => {
              stream.onComplete?.();
            });

            authoredSteps.push(mergeLessonAuthoredStepDraft(step, authoredStep));
          }

          const nextBlueprintDraft = normalizeGeneratedBlueprintDraft({
            ...state.blueprintDraft,
            steps: authoredSteps
          });

          if (job) {
            this.emitEvent(job, {
              stage: "lesson-authoring",
              title: "Lesson chapters ready",
              detail: "The Architect has expanded the teaching content into richer markdown chapters and aligned the checks with what was actually taught.",
              level: "success",
              payload: {
                stepCount: nextBlueprintDraft.steps.length,
                firstStepSlideCount: nextBlueprintDraft.steps[0]?.lessonSlides.length ?? 0,
                firstStepCheckCount: nextBlueprintDraft.steps[0]?.checks.length ?? 0
              }
            });
          }
          this.logger.info("Received lesson authoring response.", {
            jobId,
            sessionId: state.session.sessionId,
            stepCount: nextBlueprintDraft.steps.length,
            firstStepSlideCount: nextBlueprintDraft.steps[0]?.lessonSlides.length ?? 0,
            firstStepCheckCount: nextBlueprintDraft.steps[0]?.checks.length ?? 0
          });
          await this.writePlanningBuildCheckpoint(state.session.sessionId, {
            answersSignature,
            stage: "lessons-authored",
            plan: state.plan,
            blueprintDraft: nextBlueprintDraft,
            goalScope: state.goalScope,
            mergedResearch: state.mergedResearch
          });
          await this.mutateBlueprintBuildForJob(jobId, (current) => ({
            ...(current ??
              createBlueprintBuildRecord({
                id: state.session.sessionId,
                sessionId: state.session.sessionId,
                goal: state.session.goal,
                detectedLanguage: state.session.detectedLanguage,
                detectedDomain: state.session.detectedDomain,
                status: "running",
                currentStage: "lesson-authoring",
                currentStageTitle: "Lesson chapters ready",
                currentStageStatus: "completed",
                createdAt: this.now().toISOString(),
                updatedAt: this.now().toISOString()
              })),
            planningSession: state.session,
            answers: request.answers,
            plan: state.plan,
            blueprintDraft: nextBlueprintDraft,
            supportFiles: toBlueprintArtifactFiles(nextBlueprintDraft.supportFiles, "support"),
            canonicalFiles: toBlueprintArtifactFiles(nextBlueprintDraft.canonicalFiles, "canonical"),
            learnerFiles: toBlueprintArtifactFiles(nextBlueprintDraft.learnerFiles, "learner"),
            hiddenTests: toBlueprintArtifactFiles(nextBlueprintDraft.hiddenTests, "hidden-tests"),
            status: "running",
            currentStage: "lesson-authoring",
            currentStageTitle: "Lesson chapters ready",
            currentStageStatus: "completed",
            updatedAt: this.now().toISOString(),
            lastError: null
          }));

          return nextBlueprintDraft;
        }),
        checkpointStage:
          state.blueprintDraft && state.checkpointStage === "lessons-authored"
            ? state.checkpointStage
            : "lessons-authored"
      }))
      .addNode("persistBlueprint", async (state) => ({
        activeBlueprintPath: await this.withStage(jobId, "blueprint-materialization", "Materializing the generated project", "Construct is writing the authored lessons, canonical project, learner workspace, and hidden tests into the active project.", async () => {
          if (!state.plan) {
            throw new Error("Cannot persist a blueprint before the project plan exists.");
          }

          const resolvedBlueprintDraft = this.resolvePersistablePlanningBlueprintDraft(
            state.blueprintDraft,
            planningCheckpoint?.blueprintDraft ?? null
          );

          const activeBlueprintPath = await this.persistGeneratedBlueprint(
            jobId,
            state.session,
            state.plan,
            resolvedBlueprintDraft
          );
          await this.persistence.clearPlanningBuildCheckpoint(state.session.sessionId);
          return activeBlueprintPath;
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "determineScope")
      .addEdge("determineScope", "researchArchitecture")
      .addEdge("determineScope", "researchDependencies")
      .addEdge("determineScope", "researchValidation")
      .addEdge("researchArchitecture", "mergeResearch")
      .addEdge("researchDependencies", "mergeResearch")
      .addEdge("researchValidation", "mergeResearch")
      .addEdge("mergeResearch", "generatePlan")
      .addEdge("generatePlan", "generateBlueprint")
      .addEdge("generateBlueprint", "authorLessons")
      .addEdge("authorLessons", "persistBlueprint")
      .addEdge("persistBlueprint", END)
      .compile();

    const result = await graph.invoke(
      {
        jobId,
        request,
        session,
        resumeFromCheckpoint: planningCheckpoint !== null,
        knowledgeBase: createEmptyKnowledgeBase(this.now().toISOString()),
        goalScope: planningCheckpoint?.goalScope ?? null,
        architectureResearch: null,
        dependencyResearch: null,
        validationResearch: null,
        mergedResearch: planningCheckpoint?.mergedResearch ?? null,
        plan: planningCheckpoint?.plan ?? null,
        blueprintDraft: planningCheckpoint?.blueprintDraft ?? null,
        checkpointStage: planningCheckpoint?.stage ?? null,
        checkpointFailure: planningCheckpoint?.failure ?? null,
        activeBlueprintPath: null
      },
      {
        runName: "construct:planning-plan",
        tags: ["construct", "planning-plan"],
        metadata: {
          buildId: this.buildIdsByJobId.get(jobId) ?? null,
          sessionId: session.sessionId,
          goal: session.goal,
          checkpointStage: planningCheckpoint?.stage ?? null,
          langSmithProject: resolveLangSmithProjectName()
        }
      }
    );

    return PlanningSessionCompleteResponseSchema.parse({
      session,
      plan: result.plan
    });
  }

  private async runRuntimeGuideGraph(
    jobId: string,
    request: RuntimeGuideRequest
  ): Promise<RuntimeGuideResponse> {
    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<RuntimeGuideRequest>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      guide: Annotation<RuntimeGuideResponse | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async () => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner context", "Reading stored knowledge so guidance matches prior signals.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("generateGuidance", async (state) => ({
        guide: await this.withStage(jobId, "runtime-guide", "Analyzing the current implementation", "OpenAI is reviewing the anchored code, constraints, and latest test result to prepare Socratic guidance.", async () => {
          const stream = this.createModelStreamForwarder(
            jobId,
            "runtime-guide",
            "runtime guidance"
          );
          const stopProgressUpdates = this.startNarratedProgress(jobId, {
            stage: "runtime-guide",
            title: "Construct is tracing the current step",
            details: buildRuntimeGuideProgressNotes(state.request)
          });
          const activeProject = await this.persistence.getActiveProject();

          try {
            return (await this.getLlm()).parse({
              schema: RuntimeGuideResponseSchema,
              schemaName: "construct_runtime_guide",
              instructions: buildRuntimeGuideInstructions(),
              prompt: JSON.stringify(
                {
                  request: state.request,
                  priorKnowledge: serializeKnowledgeBaseForPrompt(state.knowledgeBase)
                },
                null,
                2
              ),
              maxOutputTokens: 3_000,
              verbosity: "medium",
              stream,
              usage: this.buildJobUsageContext(jobId, {
                projectId: activeProject?.id ?? null,
                projectName: activeProject?.name ?? null,
                projectGoal: activeProject?.goal ?? null,
                blueprintPath: activeProject?.blueprintPath ?? null,
                stage: "runtime-guide",
                operation: "runtime guide generation"
              })
            });
          } finally {
            stopProgressUpdates();
            stream.onComplete?.();
          }
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "generateGuidance")
      .addEdge("generateGuidance", END)
      .compile();

    const result = await graph.invoke({
      jobId,
      request,
      knowledgeBase: createEmptyKnowledgeBase(this.now().toISOString()),
      guide: null
    });

    return RuntimeGuideResponseSchema.parse(result.guide);
  }

  private async runBlueprintDeepDiveGraph(
    jobId: string,
    request: BlueprintDeepDiveRequest
  ): Promise<BlueprintDeepDiveResponse> {
    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<BlueprintDeepDiveRequest>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      canonicalBlueprint: Annotation<ProjectBlueprint | null>(),
      learnerBlueprint: Annotation<ProjectBlueprint | null>(),
      currentStep: Annotation<ProjectBlueprint["steps"][number] | null>(),
      deepDiveDraft: Annotation<z.infer<typeof GENERATED_DEEP_DIVE_DRAFT_SCHEMA> | null>(),
      response: Annotation<BlueprintDeepDiveResponse | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async () => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner context", "Reading stored knowledge and recent struggle signals before generating the deeper walkthrough.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("loadBlueprint", async (state) => {
        const canonicalBlueprint = await this.withStage(jobId, "deep-dive-blueprint", "Loading the active blueprint", "Opening the current generated blueprint so Construct can mutate the exact step the learner is stuck on.", async () => {
          return loadBlueprint(state.request.canonicalBlueprintPath);
        });
        const learnerBlueprint = await loadBlueprint(state.request.learnerBlueprintPath);
        const currentStep =
          canonicalBlueprint.steps.find((step) => step.id === state.request.stepId) ?? null;

        if (!currentStep) {
          throw new Error(`Unknown blueprint step ${state.request.stepId}.`);
        }

        return {
          canonicalBlueprint,
          learnerBlueprint,
          currentStep
        };
      })
      .addNode("generateDeepDive", async (state) => ({
        deepDiveDraft: await this.withStage(jobId, "deep-dive-generation", "Designing a deeper walkthrough", "The Architect is generating additional concept slides and a tighter quiz for the exact blocker you hit in this step.", async () => {
          const stream = this.createModelStreamForwarder(
            jobId,
            "deep-dive-generation",
            "deep dive generation"
          );
          try {
            return (await this.getLlm()).parse({
              schema: GENERATED_DEEP_DIVE_DRAFT_SCHEMA,
              schemaName: "construct_blueprint_deep_dive",
              instructions: buildBlueprintDeepDiveInstructions(),
              prompt: JSON.stringify(
                {
                  request: state.request,
                  currentStep: state.currentStep,
                  currentSlides:
                    state.currentStep && state.currentStep.lessonSlides.length > 0
                      ? state.currentStep.lessonSlides
                      : state.currentStep
                        ? [state.currentStep.doc]
                        : [],
                  priorKnowledge: serializeKnowledgeBaseForPrompt(state.knowledgeBase)
                },
                null,
                2
              ),
              maxOutputTokens: 4_000,
              verbosity: "medium",
              stream,
              usage: this.buildJobUsageContext(jobId, {
                blueprintPath: state.request.canonicalBlueprintPath,
                stage: "deep-dive-generation",
                operation: "deep dive generation"
              })
            });
          } finally {
            stream.onComplete?.();
          }
        })
      }))
      .addNode("applyMutation", async (state) => {
        if (!state.canonicalBlueprint || !state.learnerBlueprint || !state.currentStep || !state.deepDiveDraft) {
          throw new Error("Cannot apply a deep dive without the active blueprint and generated walkthrough.");
        }

        const canonicalBlueprint = state.canonicalBlueprint;
        const learnerBlueprint = state.learnerBlueprint;
        const currentStep = state.currentStep;
        const deepDiveDraft = state.deepDiveDraft;

        return {
          response: await this.withPayloadStage(
            jobId,
            "deep-dive-apply",
            "Updating the active blueprint",
            "Saving the deeper walkthrough into the active step so the brief reopens with more explanation before the task.",
            async () => {
              const updatedStep = BlueprintStepSchema.parse({
                ...currentStep,
                lessonSlides: [
                  ...normalizeGeneratedLessonSlides(deepDiveDraft.lessonSlides, deepDiveDraft.note),
                  ...getExistingLessonSlides(currentStep)
                ],
                checks: [
                  ...normalizeGeneratedChecks(deepDiveDraft.checks),
                  ...currentStep.checks
                ],
                constraints: Array.from(
                  new Set([...deepDiveDraft.constraints, ...currentStep.constraints])
                )
              });

              const updatedCanonicalBlueprint = replaceBlueprintStep(
                canonicalBlueprint,
                updatedStep
              );
              const updatedLearnerBlueprint = replaceBlueprintStep(
                learnerBlueprint,
                updatedStep
              );

              await this.writeBlueprintFile(
                state.request.canonicalBlueprintPath,
                updatedCanonicalBlueprint
              );
              await this.writeBlueprintFile(
                state.request.learnerBlueprintPath,
                updatedLearnerBlueprint
              );

              return {
                blueprintPath: state.request.learnerBlueprintPath,
                step: updatedStep,
                insertedSlideCount: deepDiveDraft.lessonSlides.length,
                insertedCheckCount: deepDiveDraft.checks.length,
                note: deepDiveDraft.note
              };
            }
          )
        };
      })
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "loadBlueprint")
      .addEdge("loadBlueprint", "generateDeepDive")
      .addEdge("generateDeepDive", "applyMutation")
      .addEdge("applyMutation", END)
      .compile();

    const result = await graph.invoke({
      jobId,
      request,
      knowledgeBase: createEmptyKnowledgeBase(this.now().toISOString()),
      canonicalBlueprint: null,
      learnerBlueprint: null,
      currentStep: null,
      deepDiveDraft: null,
      response: null
    });

    return BlueprintDeepDiveResponseSchema.parse(result.response);
  }

  private async withStage<T>(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    task: () => Promise<T>
  ): Promise<T> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    await this.markBlueprintBuildStageForJob(jobId, {
      stage,
      title,
      status: "running",
      detail
    });

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    try {
      const result = await task();

      if (stage.startsWith("research")) {
        const research = result as ResearchDigest;
        this.emitEvent(job, {
          stage,
          title: "Research references loaded",
          detail: `Collected ${research.sources.length} sources through ${research.query}.`,
          level: "success",
          payload: {
            query: research.query,
            sources: research.sources
          }
        });
        await this.markBlueprintBuildStageForJob(jobId, {
          stage,
          title,
          status: "completed",
          detail,
          outputJson: research
        });
        return result;
      }

      this.emitEvent(job, {
        stage,
        title: `${title} complete`,
        detail,
        level: "success"
      });
      await this.markBlueprintBuildStageForJob(jobId, {
        stage,
        title,
        status: "completed",
        detail,
        outputJson: cloneJsonCompatible(result)
      });

      return result;
    } catch (error) {
      await this.markBlueprintBuildStageForJob(jobId, {
        stage,
        title,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private startNarratedProgress(
    jobId: string,
    input: {
      stage: string;
      title: string;
      details: string[];
      intervalMs?: number;
    }
  ): () => void {
    const job = this.jobs.get(jobId);

    if (!job || input.details.length === 0) {
      return () => {};
    }

    let index = 0;

    const emitDetail = () => {
      const activeJob = this.jobs.get(jobId);

      if (!activeJob || activeJob.status !== "running") {
        return;
      }

      const detail = input.details[Math.min(index, input.details.length - 1)];

      this.emitEvent(activeJob, {
        stage: input.stage,
        title: input.title,
        detail,
        level: "info",
        payload: {
          thinking: true,
          step: index + 1,
          totalSteps: input.details.length
        }
      });

      if (index < input.details.length - 1) {
        index += 1;
      }
    };

    emitDetail();

    const intervalHandle = setInterval(emitDetail, input.intervalMs ?? 1500);

    return () => {
      clearInterval(intervalHandle);
    };
  }

  private async withPayloadStage<T extends Record<string, unknown>>(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    task: () => Promise<T>
  ): Promise<T> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    await this.markBlueprintBuildStageForJob(jobId, {
      stage,
      title,
      status: "running",
      detail
    });

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    try {
      const result = await task();

      this.emitEvent(job, {
        stage,
        title: `${title} complete`,
        detail,
        level: "success",
        payload: result
      });
      await this.markBlueprintBuildStageForJob(jobId, {
        stage,
        title,
        status: "completed",
        detail,
        outputJson: cloneJsonCompatible(result)
      });

      return result;
    } catch (error) {
      await this.markBlueprintBuildStageForJob(jobId, {
        stage,
        title,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async determineGoalScope(
    goal: string,
    usage?: LanguageModelUsageContext
  ): Promise<GoalScope> {
    try {
      return await (await this.getLlm()).parse({
        schema: GOAL_SCOPE_DRAFT_SCHEMA,
        schemaName: "construct_goal_scope",
        instructions: buildGoalScopeInstructions(),
        prompt: JSON.stringify(
          {
            goal
          },
          null,
          2
        ),
        maxOutputTokens: 800,
        verbosity: "low",
        usage
      });
    } catch (error) {
      const fallback = inferGoalScopeFallback(goal);
      this.logger.warn("Goal-scope analysis failed. Falling back to heuristic scope.", {
        goal,
        error: error instanceof Error ? error.message : "Unknown scope-analysis failure.",
        fallback
      });
      return fallback;
    }
  }

  private async skipResearchStage(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    query: string
  ): Promise<ResearchDigest> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    await this.markBlueprintBuildStageForJob(jobId, {
      stage,
      title,
      status: "running",
      detail
    });

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    const result: ResearchDigest = {
      query,
      answer: detail,
      sources: []
    };

    this.emitEvent(job, {
      stage,
      title: "Research skipped for small local scope",
      detail,
      level: "success",
      payload: {
        query,
        skipped: true,
        reason: "small-local-scope"
      }
    });
    await this.markBlueprintBuildStageForJob(jobId, {
      stage,
      title,
      status: "completed",
      detail,
      outputJson: result
    });

    return result;
  }

  private createModelStreamForwarder(
    jobId: string,
    stage: string,
    label: string
  ): NonNullable<Parameters<StructuredLanguageModel["parse"]>[0]["stream"]> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    let buffer = "";
    let flushHandle: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (!buffer) {
        return;
      }

      const chunk = buffer;
      buffer = "";

      this.logger.trace?.("Streaming model output chunk.", {
        jobId,
        kind: job.kind,
        stage,
        label,
        chunk
      });

      this.emitEvent(job, {
        stage: `${stage}-stream`,
        title: `Live draft: ${label}`,
        detail: chunk,
        level: "info",
        payload: {
          stream: true,
          label,
          text: chunk
        }
      });
    };

    const clearScheduledFlush = () => {
      if (!flushHandle) {
        return;
      }

      clearTimeout(flushHandle);
      flushHandle = null;
    };

    const scheduleFlush = () => {
      if (flushHandle) {
        return;
      }

      flushHandle = setTimeout(() => {
        flushHandle = null;
        flush();
      }, 180);
    };

    return {
      stage,
      label,
      onToken: (chunk) => {
        if (!chunk) {
          return;
        }

        buffer += chunk;

        if (buffer.length >= 120 || chunk.includes("\n")) {
          clearScheduledFlush();
          flush();
          return;
        }

        scheduleFlush();
      },
      onComplete: () => {
        clearScheduledFlush();
        flush();
      }
    };
  }

  private buildJobUsageContext(
    jobId: string,
    input: Omit<LanguageModelUsageContext, "jobId" | "buildId"> = {}
  ): LanguageModelUsageContext {
    return {
      jobId,
      buildId: this.buildIdsByJobId.get(jobId) ?? null,
      ...input
    };
  }

  private buildPlanningSession(
    request: PlanningSessionStartRequest,
    questionDraft: z.infer<typeof PLANNING_QUESTION_DRAFT_SCHEMA>
  ): PlanningSession {
    const normalizedGoal = request.goal.trim().replace(/\s+/g, " ");

    const questions = questionDraft.questions.map((question) =>
      PlanningQuestionSchema.parse({
        id: `question.${slugify(question.conceptId)}`,
        conceptId: question.conceptId,
        category: question.category,
        prompt: question.prompt,
        options: question.options
      })
    );

    const session = PlanningSessionSchema.parse({
      sessionId: randomUUID(),
      goal: normalizedGoal,
      normalizedGoal,
      detectedLanguage: questionDraft.detectedLanguage,
      detectedDomain: questionDraft.detectedDomain,
      createdAt: this.now().toISOString(),
      questions
    });

    return session;
  }

  private buildGeneratedPlan(
    session: PlanningSession,
    draft: z.infer<typeof GENERATED_PROJECT_PLAN_DRAFT_SCHEMA>
  ): GeneratedProjectPlan {
    const normalizedSteps = draft.steps.map((step) => ({
      ...step,
      kind:
        (step.kind as string) === "component"
          ? "implementation"
          : step.kind
    }));

    return GeneratedProjectPlanSchema.parse({
      sessionId: session.sessionId,
      goal: session.goal,
      language: session.detectedLanguage,
      domain: session.detectedDomain,
      summary: draft.summary,
      knowledgeGraph: draft.knowledgeGraph,
      architecture: draft.architecture,
      steps: normalizedSteps,
      suggestedFirstStepId: draft.suggestedFirstStepId
    });
  }

  private resolvePlanningAnswers(
    session: PlanningSession,
    answers: PlanningSessionCompleteRequest["answers"]
  ): ResolvedPlanningAnswer[] {
    return answers.map((answer) => {
      const question = session.questions.find((entry) => entry.id === answer.questionId);

      if (!question) {
        throw new Error(`Unknown planning question ${answer.questionId}.`);
      }

      if (answer.answerType === "custom") {
        return {
          questionId: question.id,
          conceptId: question.conceptId,
          category: question.category,
          prompt: question.prompt,
          answerType: "custom",
          selectedOption: null,
          customResponse: answer.customResponse.trim(),
          availableOptions: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            confidenceSignal: option.confidenceSignal
          }))
        };
      }

      if (answer.answerType === "skipped") {
        return {
          questionId: question.id,
          conceptId: question.conceptId,
          category: question.category,
          prompt: question.prompt,
          answerType: "skipped",
          selectedOption: null,
          customResponse: null,
          availableOptions: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            confidenceSignal: option.confidenceSignal
          }))
        };
      }

      const selectedOption = question.options.find((option) => option.id === answer.optionId);

      if (!selectedOption) {
        throw new Error(
          `Unknown option ${answer.optionId} for planning question ${answer.questionId}.`
        );
      }

      return {
        questionId: question.id,
        conceptId: question.conceptId,
        category: question.category,
        prompt: question.prompt,
        answerType: "option",
        selectedOption: {
          id: selectedOption.id,
          label: selectedOption.label,
          description: selectedOption.description,
          confidenceSignal: selectedOption.confidenceSignal
        },
        customResponse: null,
        availableOptions: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          confidenceSignal: option.confidenceSignal
        }))
      };
    });
  }

  private buildPlanningAnswersSignature(answers: ResolvedPlanningAnswer[]): string {
    return JSON.stringify(
      answers.map((answer) => ({
        questionId: answer.questionId,
        conceptId: answer.conceptId,
        category: answer.category,
        answerType: answer.answerType,
        selectedOptionId: answer.selectedOption?.id ?? null,
        selectedConfidenceSignal: answer.selectedOption?.confidenceSignal ?? null,
        customResponse: answer.customResponse?.trim() ?? null
      }))
    );
  }

  private async readPlanningBuildCheckpoint(
    sessionId: string,
    answersSignature: string
  ): Promise<PlanningBuildCheckpoint | null> {
    const rawCheckpoint = await this.persistence.getPlanningBuildCheckpoint(sessionId);

    if (!rawCheckpoint) {
      return null;
    }

    const parsed = PLANNING_BUILD_CHECKPOINT_SCHEMA.safeParse(rawCheckpoint);

    if (!parsed.success) {
      this.logger.warn("Planning build checkpoint was invalid. Clearing it before retry.", {
        sessionId,
        issueCount: parsed.error.issues.length
      });
      await this.persistence.clearPlanningBuildCheckpoint(sessionId);
      return null;
    }

    if (parsed.data.answersSignature !== answersSignature) {
      this.logger.info("Planning build checkpoint does not match the latest answers. Ignoring it.", {
        sessionId,
        checkpointStage: parsed.data.stage
      });
      return null;
    }

    return parsed.data;
  }

  private async writePlanningBuildCheckpoint(
    sessionId: string,
    input: {
      answersSignature: string;
      stage: PlanningBuildCheckpoint["stage"];
      plan: GeneratedProjectPlan;
      blueprintDraft: GeneratedBlueprintBundleDraft | null;
      goalScope?: GoalScope | null;
      mergedResearch?: ResearchDigest | null;
      failure?: PlanningBuildCheckpoint["failure"];
    }
  ): Promise<void> {
    await this.persistence.setPlanningBuildCheckpoint(
      sessionId,
      PLANNING_BUILD_CHECKPOINT_SCHEMA.parse({
        sessionId,
        answersSignature: input.answersSignature,
        updatedAt: this.now().toISOString(),
        stage: input.stage,
        plan: input.plan,
        blueprintDraft: input.blueprintDraft,
        goalScope: input.goalScope ?? null,
        mergedResearch: input.mergedResearch ?? null,
        failure: input.failure ?? null
      })
    );
  }

  private async generatePlanningBlueprintDraft(input: {
    jobId: string;
    session: PlanningSession;
    plan: GeneratedProjectPlan | null;
    goalScope: GoalScope | null;
    answers: ResolvedPlanningAnswer[];
    knowledgeBase: UserKnowledgeBase;
    mergedResearch: ResearchDigest | null;
    answersSignature: string;
    requestAnswers: PlanningSessionCompleteRequest["answers"];
  }): Promise<GeneratedBlueprintBundleDraft> {
    if (!input.plan) {
      throw new Error("Cannot generate a blueprint before the project plan exists.");
    }

    const frontierPlanSteps = selectPlanFrontierSteps(input.plan, {
      startStepId: input.plan.suggestedFirstStepId,
      maxSteps: 3
    });
    const blueprintRequestContext = {
      stepCount: input.plan.steps.length,
      architectureNodeCount: input.plan.architecture.length,
      suggestedFirstStepId: input.plan.suggestedFirstStepId,
      firstStepTitle: frontierPlanSteps[0]?.title ?? input.plan.steps[0]?.title ?? null,
      frontierStepCount: frontierPlanSteps.length
    };

    const job = this.jobs.get(input.jobId);
    if (job) {
      this.emitEvent(job, {
        stage: "blueprint-synthesis",
        title: "Drafting the project bundle",
        detail: "The Architect is asking the model to write the completed project files, derive the learner-owned files, and attach hidden tests to each task.",
        level: "info",
        payload: blueprintRequestContext
      });
    }

    this.logger.info("Submitting blueprint synthesis request.", {
      jobId: input.jobId,
      sessionId: input.session.sessionId,
      goal: input.session.goal,
      ...blueprintRequestContext
    });

    const stream = this.createModelStreamForwarder(
      input.jobId,
      "blueprint-synthesis",
      "project bundle synthesis"
    );

    const initialBundleDraft = await (await this.getLlm()).parse({
      schema: GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA,
      schemaName: "construct_generated_blueprint_bundle",
      instructions: buildBlueprintGenerationInstructions(),
      prompt: JSON.stringify(
        {
          session: input.session,
          goalScope: input.goalScope,
          answers: input.answers,
          planSpine: input.plan,
          frontierPlanSteps,
          priorKnowledge: serializeKnowledgeBaseForPrompt(input.knowledgeBase),
          research: compactResearchDigest(input.mergedResearch)
        },
        null,
        2
      ),
      maxOutputTokens: 20_000,
      verbosity: "medium",
      stream,
      usage: this.buildJobUsageContext(input.jobId, {
        sessionId: input.session.sessionId,
        stage: "blueprint-synthesis",
        operation: "project bundle synthesis"
      })
    }).finally(() => {
      stream.onComplete?.();
    });

    const rawFrontierDraft = filterGeneratedBundleDraftToFrontier(
      initialBundleDraft,
      frontierPlanSteps
    );

    return this.finalizePlanningBlueprintDraft({
      jobId: input.jobId,
      stage: "blueprint-generation",
      stageTitle: "Project bundle drafted",
      session: input.session,
      plan: input.plan,
      goalScope: input.goalScope,
      mergedResearch: input.mergedResearch,
      requestAnswers: input.requestAnswers,
      answersSignature: input.answersSignature,
      rawDraft: rawFrontierDraft,
      successLogContext: "Received blueprint synthesis response.",
      successEventTitle: "Project bundle drafted",
      successEventDetail: "The Architect has returned a candidate project bundle and Construct is now materializing it into a runnable workspace."
    });
  }

  private async repairPlanningBlueprintDraft(input: {
    jobId: string;
    session: PlanningSession;
    plan: GeneratedProjectPlan | null;
    goalScope: GoalScope | null;
    answers: ResolvedPlanningAnswer[];
    knowledgeBase: UserKnowledgeBase;
    mergedResearch: ResearchDigest | null;
    failedDraft: GeneratedBlueprintBundleDraft;
    failure: PlanningBuildCheckpoint["failure"];
    answersSignature: string;
    requestAnswers: PlanningSessionCompleteRequest["answers"];
  }): Promise<GeneratedBlueprintBundleDraft> {
    if (!input.plan) {
      throw new Error("Cannot repair a blueprint before the project plan exists.");
    }
    const plan = input.plan;

    const frontierPlanSteps = selectPlanFrontierSteps(plan, {
      startStepId: plan.suggestedFirstStepId,
      maxSteps: 3
    });
    const repairContext = {
      failedStage: input.failure?.stage ?? "blueprint-generation",
      failureMessage:
        input.failure?.message ??
        "The saved project bundle draft failed validation and needs to be repaired.",
      frontierStepCount: frontierPlanSteps.length,
      firstStepTitle: frontierPlanSteps[0]?.title ?? plan.steps[0]?.title ?? null
    };
    const maxRepairAttempts = 3;

    this.logger.info("Repairing blueprint synthesis draft from saved checkpoint.", {
      jobId: input.jobId,
      sessionId: input.session.sessionId,
      goal: input.session.goal,
      ...repairContext
    });

    const repairedFrontierDraft = await this.withStage(
      input.jobId,
      "blueprint-repair",
      "Repairing the saved project bundle",
      "Construct is resuming from the saved architect draft and repairing only the broken blueprint bundle instead of restarting the whole planning run.",
      async () => {
        let previousDraft = input.failedDraft;
        let latestFrontierDraft = filterGeneratedBundleDraftToFrontier(previousDraft, frontierPlanSteps);
        const repairFailures = [repairContext.failureMessage];

        for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
          const latestFailureMessage = repairFailures[repairFailures.length - 1] ?? repairContext.failureMessage;
          const validationTarget = extractGeneratedBlueprintFileValidationTarget(latestFailureMessage);
          const stream = this.createModelStreamForwarder(
            input.jobId,
            "blueprint-repair",
            validationTarget ? "targeted file repair" : "project bundle repair"
          );

          const repairedBundleDraft = await (async () => {
            const repairLlm = await this.getRepairLlm();

            if (!validationTarget) {
              return repairLlm.parse({
                schema: GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA,
                schemaName: "construct_generated_blueprint_bundle",
                instructions: buildBlueprintRepairInstructions(),
                prompt: JSON.stringify(
                  {
                    session: input.session,
                    goalScope: input.goalScope,
                    answers: input.answers,
                    planSpine: plan,
                    frontierPlanSteps,
                    priorKnowledge: serializeKnowledgeBaseForPrompt(input.knowledgeBase),
                    research: compactResearchDigest(input.mergedResearch),
                    previousDraft,
                    validationFailure: {
                      ...repairContext,
                      attempt,
                      maxRepairAttempts,
                      previousRepairFailures: repairFailures
                    }
                  },
                  null,
                  2
                ),
                maxOutputTokens: 20_000,
                verbosity: "medium",
                stream,
                usage: this.buildJobUsageContext(input.jobId, {
                  sessionId: input.session.sessionId,
                  stage: "blueprint-repair",
                  operation: "project bundle repair"
                })
              });
            }

            const patch = await repairLlm.parse({
              schema: GENERATED_BLUEPRINT_FILE_PATCH_SCHEMA,
              schemaName: "construct_generated_blueprint_file_patch",
              instructions: buildBlueprintFilePatchRepairInstructions(),
              prompt: JSON.stringify(
                {
                  session: input.session,
                  goalScope: input.goalScope,
                  answers: input.answers,
                  planSpine: plan,
                  frontierPlanSteps,
                  priorKnowledge: serializeKnowledgeBaseForPrompt(input.knowledgeBase),
                  research: compactResearchDigest(input.mergedResearch),
                  previousDraft,
                  repairTarget: validationTarget,
                  validationFailure: {
                    ...repairContext,
                    attempt,
                    maxRepairAttempts,
                    previousRepairFailures: repairFailures
                  }
                },
                null,
                2
              ),
              maxOutputTokens: 8_000,
              verbosity: "medium",
              stream,
              usage: this.buildJobUsageContext(input.jobId, {
                sessionId: input.session.sessionId,
                stage: "blueprint-repair",
                operation: "targeted blueprint file repair"
              })
            });

            validateBlueprintFilePatchTargets(
              patch,
              [validationTarget],
              "Generated blueprint file repair"
            );
            return mergeGeneratedBlueprintFilePatch(previousDraft, patch);
          })().finally(() => {
            stream.onComplete?.();
          });

          latestFrontierDraft = filterGeneratedBundleDraftToFrontier(
            repairedBundleDraft,
            frontierPlanSteps
          );

          try {
            normalizeGeneratedBlueprintDraft(latestFrontierDraft);
            return latestFrontierDraft;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            previousDraft = latestFrontierDraft;
            repairFailures.push(errorMessage);

            this.logger.warn("Blueprint repair draft failed validation. Retrying within the same planning job.", {
              jobId: input.jobId,
              sessionId: input.session.sessionId,
              attempt,
              maxRepairAttempts,
              error: errorMessage
            });

            const job = this.jobs.get(input.jobId);
            if (job && attempt < maxRepairAttempts) {
              this.emitEvent(job, {
                stage: "blueprint-repair",
                title: `Repair draft failed validation (${attempt}/${maxRepairAttempts})`,
                detail: errorMessage,
                level: "warning",
                payload: {
                  attempt,
                  maxRepairAttempts
                }
              });
            }

            if (attempt >= maxRepairAttempts) {
              await this.recordInvalidPlanningBlueprintDraft({
                jobId: input.jobId,
                stage: "blueprint-repair",
                session: input.session,
                plan,
                goalScope: input.goalScope,
                mergedResearch: input.mergedResearch,
                requestAnswers: input.requestAnswers,
                answersSignature: input.answersSignature,
                rawDraft: latestFrontierDraft,
                errorMessage
              });
              throw error;
            }
          }
        }

        throw new Error("Construct exhausted internal blueprint repair attempts.");
      }
    );

    return this.finalizePlanningBlueprintDraft({
      jobId: input.jobId,
      stage: "blueprint-repair",
      stageTitle: "Saved project bundle repaired",
      session: input.session,
      plan,
      goalScope: input.goalScope,
      mergedResearch: input.mergedResearch,
      requestAnswers: input.requestAnswers,
      answersSignature: input.answersSignature,
      rawDraft: repairedFrontierDraft,
      successLogContext: "Recovered blueprint bundle from saved checkpoint.",
      successEventTitle: "Saved project bundle repaired",
      successEventDetail: "Construct repaired the saved architect draft and is continuing from the last good planning state."
    });
  }

  private async finalizePlanningBlueprintDraft(input: {
    jobId: string;
    stage: string;
    stageTitle: string;
    session: PlanningSession;
    plan: GeneratedProjectPlan;
    goalScope: GoalScope | null;
    mergedResearch: ResearchDigest | null;
    requestAnswers: PlanningSessionCompleteRequest["answers"];
    answersSignature: string;
    rawDraft: GeneratedBlueprintBundleDraft;
    successLogContext: string;
    successEventTitle: string;
    successEventDetail: string;
  }): Promise<GeneratedBlueprintBundleDraft> {
    const job = this.jobs.get(input.jobId);

    await this.mutateBlueprintBuildForJob(input.jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: input.session.sessionId,
          sessionId: input.session.sessionId,
          goal: input.session.goal,
          detectedLanguage: input.session.detectedLanguage,
          detectedDomain: input.session.detectedDomain,
          status: "running",
          currentStage: input.stage,
          currentStageTitle: input.stageTitle,
          currentStageStatus: "running",
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString()
        })),
      planningSession: input.session,
      answers: input.requestAnswers,
      plan: input.plan,
      blueprintDraft: input.rawDraft,
      supportFiles: toBlueprintArtifactFiles(input.rawDraft.supportFiles, "support"),
      canonicalFiles: toBlueprintArtifactFiles(input.rawDraft.canonicalFiles, "canonical"),
      learnerFiles: toBlueprintArtifactFiles(input.rawDraft.learnerFiles, "learner"),
      hiddenTests: toBlueprintArtifactFiles(input.rawDraft.hiddenTests, "hidden-tests"),
      status: "running",
      currentStage: input.stage,
      currentStageTitle: input.stageTitle,
      currentStageStatus: "running",
      updatedAt: this.now().toISOString(),
      lastError: null
    }));

    let bundleDraft: GeneratedBlueprintBundleDraft;

    try {
      bundleDraft = normalizeGeneratedBlueprintDraft(input.rawDraft);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.recordInvalidPlanningBlueprintDraft({
        jobId: input.jobId,
        stage: input.stage,
        session: input.session,
        plan: input.plan,
        goalScope: input.goalScope,
        mergedResearch: input.mergedResearch,
        requestAnswers: input.requestAnswers,
        answersSignature: input.answersSignature,
        rawDraft: input.rawDraft,
        errorMessage
      });
      throw error;
    }

    if (job) {
      this.emitEvent(job, {
        stage: "blueprint-synthesis",
        title: input.successEventTitle,
        detail: input.successEventDetail,
        level: "success",
        payload: {
          supportFileCount: bundleDraft.supportFiles.length,
          canonicalFileCount: bundleDraft.canonicalFiles.length,
          learnerFileCount: bundleDraft.learnerFiles.length,
          hiddenTestCount: bundleDraft.hiddenTests.length,
          stepCount: bundleDraft.steps.length
        }
      });
    }

    this.logger.info(input.successLogContext, {
      jobId: input.jobId,
      sessionId: input.session.sessionId,
      supportFileCount: bundleDraft.supportFiles.length,
      canonicalFileCount: bundleDraft.canonicalFiles.length,
      learnerFileCount: bundleDraft.learnerFiles.length,
      hiddenTestCount: bundleDraft.hiddenTests.length,
      stepCount: bundleDraft.steps.length
    });

    await this.writePlanningBuildCheckpoint(input.session.sessionId, {
      answersSignature: input.answersSignature,
      stage: "blueprint-drafted",
      plan: input.plan,
      blueprintDraft: bundleDraft,
      goalScope: input.goalScope,
      mergedResearch: input.mergedResearch,
      failure: null
    });
    await this.mutateBlueprintBuildForJob(input.jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: input.session.sessionId,
          sessionId: input.session.sessionId,
          goal: input.session.goal,
          detectedLanguage: input.session.detectedLanguage,
          detectedDomain: input.session.detectedDomain,
          status: "running",
          currentStage: input.stage,
          currentStageTitle: input.stageTitle,
          currentStageStatus: "completed",
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString()
        })),
      planningSession: input.session,
      answers: input.requestAnswers,
      plan: input.plan,
      blueprintDraft: bundleDraft,
      supportFiles: toBlueprintArtifactFiles(bundleDraft.supportFiles, "support"),
      canonicalFiles: toBlueprintArtifactFiles(bundleDraft.canonicalFiles, "canonical"),
      learnerFiles: toBlueprintArtifactFiles(bundleDraft.learnerFiles, "learner"),
      hiddenTests: toBlueprintArtifactFiles(bundleDraft.hiddenTests, "hidden-tests"),
      status: "running",
      currentStage: input.stage,
      currentStageTitle: input.stageTitle,
      currentStageStatus: "completed",
      updatedAt: this.now().toISOString(),
      lastError: null
    }));

    return bundleDraft;
  }

  private async recordInvalidPlanningBlueprintDraft(input: {
    jobId: string;
    stage: string;
    session: PlanningSession;
    plan: GeneratedProjectPlan;
    goalScope: GoalScope | null;
    mergedResearch: ResearchDigest | null;
    requestAnswers: PlanningSessionCompleteRequest["answers"];
    answersSignature: string;
    rawDraft: GeneratedBlueprintBundleDraft;
    errorMessage: string;
  }): Promise<void> {
    const failure = {
      stage: input.stage,
      message: input.errorMessage,
      recoverable: true,
      recordedAt: this.now().toISOString()
    } satisfies NonNullable<PlanningBuildCheckpoint["failure"]>;

    await this.writePlanningBuildCheckpoint(input.session.sessionId, {
      answersSignature: input.answersSignature,
      stage: "blueprint-draft-invalid",
      plan: input.plan,
      blueprintDraft: input.rawDraft,
      goalScope: input.goalScope,
      mergedResearch: input.mergedResearch,
      failure
    });
    await this.mutateBlueprintBuildForJob(input.jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: input.session.sessionId,
          sessionId: input.session.sessionId,
          goal: input.session.goal,
          detectedLanguage: input.session.detectedLanguage,
          detectedDomain: input.session.detectedDomain,
          status: "failed",
          currentStage: input.stage,
          currentStageTitle: "Saved blueprint draft needs repair",
          currentStageStatus: "failed",
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString()
        })),
      planningSession: input.session,
      answers: input.requestAnswers,
      plan: input.plan,
      blueprintDraft: input.rawDraft,
      supportFiles: toBlueprintArtifactFiles(input.rawDraft.supportFiles, "support"),
      canonicalFiles: toBlueprintArtifactFiles(input.rawDraft.canonicalFiles, "canonical"),
      learnerFiles: toBlueprintArtifactFiles(input.rawDraft.learnerFiles, "learner"),
      hiddenTests: toBlueprintArtifactFiles(input.rawDraft.hiddenTests, "hidden-tests"),
      currentStage: input.stage,
      currentStageTitle: "Saved blueprint draft needs repair",
      currentStageStatus: "failed",
      updatedAt: this.now().toISOString(),
      lastError: input.errorMessage
    }));
  }

  private async resumePlanningCheckpointStage(
    jobId: string,
    stage: string,
    title: string,
    detail: string
  ): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return;
    }

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "success"
    });
  }

  private resolvePersistablePlanningBlueprintDraft(
    draft: GeneratedBlueprintBundleDraft | null,
    fallbackDraft: GeneratedBlueprintBundleDraft | null
  ): GeneratedBlueprintBundleDraft {
    const direct = GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.safeParse(draft);

    if (direct.success) {
      return normalizeGeneratedBlueprintDraft(direct.data);
    }

    const fallback = GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.safeParse(fallbackDraft);

    if (fallback.success) {
      this.logger.warn("Planning graph draft was incomplete during persistence. Falling back to the saved checkpoint draft.", {
        directIssueCount: direct.success ? 0 : direct.error.issues.length
      });
      return normalizeGeneratedBlueprintDraft(fallback.data);
    }

    throw new Error("Cannot persist a blueprint before the lesson-authored draft exists.");
  }

  private async persistGeneratedBlueprint(
    jobId: string,
    session: PlanningSession,
    plan: GeneratedProjectPlan,
    draft: GeneratedBlueprintBundleDraft
  ): Promise<string> {
    const supportFiles = fileEntriesToRecord(draft.supportFiles);
    const canonicalFiles = fileEntriesToRecord(draft.canonicalFiles);
    const learnerFiles = fileEntriesToRecord(draft.learnerFiles);
    const hiddenTests = fileEntriesToRecord(draft.hiddenTests);
    const projectSlug = slugify(draft.projectSlug || draft.projectName || session.goal) || "generated-project";
    const projectRoot = path.join(
      this.generatedBlueprintsDirectory,
      `${session.sessionId}-${projectSlug}`
    );
    const blueprintPath = path.join(projectRoot, "project-blueprint.json");

    await this.withPayloadStage(
      jobId,
      "blueprint-layout",
      "Preparing the generated project layout",
      "Creating the canonical project directory and scaffold destination.",
      async () => {
        await rm(projectRoot, { recursive: true, force: true });
        await mkdir(projectRoot, { recursive: true });

        return {
          projectRoot,
          entrypointCount: draft.entrypoints.length,
          entrypoints: draft.entrypoints.slice(0, 4)
        };
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-support-files",
      "Writing support files",
      "Creating manifests, configs, and shared support files for the completed project.",
      async () => {
        await this.writeProjectFiles(projectRoot, supportFiles);
        return summarizeFileBatch(supportFiles);
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-canonical-files",
      "Writing the completed reference implementation",
      "Materializing the solved project files that define the canonical working system.",
      async () => {
        await this.writeProjectFiles(projectRoot, canonicalFiles);
        return summarizeFileBatch(canonicalFiles);
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-hidden-tests",
      "Creating hidden validation tests",
      "Writing targeted validations that will check only the learner-owned work for each task.",
      async () => {
        await this.writeProjectFiles(projectRoot, hiddenTests);
        return {
          ...summarizeFileBatch(hiddenTests),
          testCount: Object.keys(hiddenTests).length
        };
      }
    );

    const generatedAt = this.now().toISOString();
    const normalizedSteps = annotateGeneratedBlueprintSteps({
      steps: normalizeGeneratedBlueprintSteps(draft.steps),
      plan,
      entrypoint: draft.entrypoints[0] ?? null
    });
    const spine = buildStableSpine({
      plan,
      draft
    });
    const frontier = buildAdaptiveFrontier({
      steps: normalizedSteps,
      spine,
      generatedAt
    });

    const blueprint: ProjectBlueprint = ProjectBlueprintSchema.parse({
      id: `construct.generated.${session.sessionId}.${projectSlug}`,
      name: draft.projectName,
      version: "0.1.0",
      description: draft.description,
      projectRoot,
      sourceProjectRoot: projectRoot,
      language: draft.language,
      entrypoints: draft.entrypoints,
      files: learnerFiles,
      steps: normalizedSteps,
      spine,
      frontier,
      dependencyGraph: draft.dependencyGraph,
      metadata: {
        createdBy: "Construct Architect agent",
        createdAt: generatedAt,
        targetLanguage: draft.language,
        tags: Array.from(new Set([
          ...draft.tags,
          session.detectedDomain,
          session.detectedLanguage,
          "agent-generated"
        ]))
      }
    });
    const timestamp = generatedAt;
    await this.mutateBlueprintBuildForJob(jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: session.sessionId,
          sessionId: session.sessionId,
          goal: session.goal,
          detectedLanguage: session.detectedLanguage,
          detectedDomain: session.detectedDomain,
          status: "running",
          currentStage: "blueprint-materialization",
          currentStageTitle: "Materializing generated project",
          currentStageStatus: "running",
          createdAt: timestamp,
          updatedAt: timestamp
        })),
      planningSession: session,
      plan,
      blueprint,
      blueprintDraft: draft,
      supportFiles: toBlueprintArtifactFiles(draft.supportFiles, "support"),
      canonicalFiles: toBlueprintArtifactFiles(draft.canonicalFiles, "canonical"),
      learnerFiles: toBlueprintArtifactFiles(draft.learnerFiles, "learner"),
      hiddenTests: toBlueprintArtifactFiles(draft.hiddenTests, "hidden-tests"),
      status: "running",
      currentStage: "blueprint-materialization",
      currentStageTitle: "Materializing generated project",
      currentStageStatus: "running",
      updatedAt: timestamp,
      lastError: null
    }));

    await this.withPayloadStage(
      jobId,
      "blueprint-learner-mask",
      "Packaging learner-owned tasks",
      "Masking selected regions, attaching anchors, and mapping each hidden validation to the learner-facing steps.",
      async () => {
        await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
        return {
          stepCount: blueprint.steps.length,
          maskedFileCount: Object.keys(learnerFiles).length,
          samplePaths: Object.keys(learnerFiles).slice(0, 4),
          firstStepId: plan.suggestedFirstStepId
        };
      }
    );

    await this.runDependencyInstallStage(jobId, projectRoot, {
      ...supportFiles,
      ...canonicalFiles,
      ...hiddenTests
    });

    await this.withPayloadStage(
      jobId,
      "blueprint-activation",
      "Activating the generated workspace",
      "Saving the blueprint record, selecting it as active, and preparing the learner workspace for the first step.",
      async () => {
        await this.persistence.saveGeneratedBlueprintRecord({
          sessionId: session.sessionId,
          goal: session.goal,
          blueprintId: blueprint.id,
          blueprintPath,
          projectRoot,
          blueprintJson: JSON.stringify(blueprint),
          planJson: JSON.stringify(plan),
          bundleJson: JSON.stringify(draft),
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: true
        });
        await this.persistence.setActiveBlueprintState({
          blueprintPath,
          sessionId: session.sessionId,
          updatedAt: timestamp
        });
        await setActiveBlueprintPath({
          rootDirectory: this.rootDirectory,
          blueprintPath,
          sessionId: session.sessionId,
          now: this.now
        });

        return {
          blueprintId: blueprint.id,
          stepCount: blueprint.steps.length,
          hiddenTestCount: Object.keys(hiddenTests).length,
          suggestedFirstStepId: plan.suggestedFirstStepId
        };
      }
    );
    await this.mutateBlueprintBuildForJob(jobId, (current) => ({
      ...(current ??
        createBlueprintBuildRecord({
          id: session.sessionId,
          sessionId: session.sessionId,
          goal: session.goal,
          detectedLanguage: session.detectedLanguage,
          detectedDomain: session.detectedDomain,
          status: "completed",
          currentStage: "blueprint-activation",
          currentStageTitle: "Generated workspace activated",
          currentStageStatus: "completed",
          createdAt: timestamp,
          updatedAt: timestamp
        })),
      planningSession: session,
      plan,
      blueprint,
      blueprintDraft: draft,
      supportFiles: toBlueprintArtifactFiles(draft.supportFiles, "support"),
      canonicalFiles: toBlueprintArtifactFiles(draft.canonicalFiles, "canonical"),
      learnerFiles: toBlueprintArtifactFiles(draft.learnerFiles, "learner"),
      hiddenTests: toBlueprintArtifactFiles(draft.hiddenTests, "hidden-tests"),
      status: "completed",
      currentStage: "blueprint-activation",
      currentStageTitle: "Generated workspace activated",
      currentStageStatus: "completed",
      updatedAt: this.now().toISOString(),
      completedAt: this.now().toISOString(),
      lastError: null
    }));
    await this.recordBlueprintKnowledgeArtifacts(session, blueprint);
    this.logger.info("Persisted generated blueprint and activated it.", {
      sessionId: session.sessionId,
      blueprintPath,
      projectRoot,
      goal: session.goal,
      stepCount: blueprint.steps.length,
      canonicalFileCount: Object.keys(canonicalFiles).length,
      learnerFileCount: Object.keys(learnerFiles).length,
      hiddenTestCount: Object.keys(hiddenTests).length,
      suggestedFirstStepId: plan.suggestedFirstStepId
    });

    return blueprintPath;
  }

  private async persistPlanningArtifacts(
    session: PlanningSession,
    plan: GeneratedProjectPlan
  ): Promise<void> {
    await mkdir(this.generatedPlansDirectory, { recursive: true });
    const artifactPath = path.join(this.generatedPlansDirectory, `${session.sessionId}.json`);
    await writeFile(artifactPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    this.logger.info("Persisted generated planning artifact.", {
      sessionId: session.sessionId,
      artifactPath,
      stepCount: plan.steps.length,
      architectureNodeCount: plan.architecture.length
    });
  }

  private async writeBlueprintFile(
    blueprintPath: string,
    blueprint: ProjectBlueprint
  ): Promise<void> {
    const sanitizedBlueprint = {
      ...blueprint,
      files: sanitizeMaterializedFiles(blueprint.files)
    };

    await writeFile(blueprintPath, `${JSON.stringify(sanitizedBlueprint, null, 2)}\n`, "utf8");
  }

  private async writeProjectFiles(
    projectRoot: string,
    files: Record<string, string>
  ): Promise<void> {
    for (const [relativePath, contents] of Object.entries(files)) {
      const destinationPath = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(
        destinationPath,
        sanitizeMaterializedFileContent(relativePath, contents),
        "utf8"
      );
    }
  }

  private async readPlanningState(): Promise<PlanningStateFile> {
    return (
      (await this.persistence.getPlanningState()) ?? {
        session: null,
        plan: null,
        answers: []
      }
    );
  }

  private async writePlanningState(state: PlanningStateFile): Promise<void> {
    await this.persistence.setPlanningState(
      CurrentPlanningSessionResponseSchema.parse(state)
    );
  }

  private async readKnowledgeBase(): Promise<UserKnowledgeBase> {
    try {
      return (
        (await this.persistence.getKnowledgeBase()) ??
        createEmptyKnowledgeBase(this.now().toISOString())
      );
    } catch (error) {
      this.logger.warn("Knowledge base read failed. Resetting to empty recursive graph.", {
        error: error instanceof Error ? error.message : String(error)
      });

      const reset = createEmptyKnowledgeBase(this.now().toISOString());

      try {
        await this.persistence.setKnowledgeBase(reset);
      } catch (persistError) {
        this.logger.warn("Knowledge base reset could not be persisted.", {
          error: persistError instanceof Error ? persistError.message : String(persistError)
        });
      }

      return reset;
    }
  }

  private async extractGoalSelfReportKnowledge(
    current: UserKnowledgeBase,
    goal: string,
    usage?: LanguageModelUsageContext
  ): Promise<UserKnowledgeBase> {
    const timestamp = this.now().toISOString();
    const draft = await (await this.getLlm()).parse({
      schema: EXPLICIT_GOAL_SELF_REPORT_DRAFT_SCHEMA,
      schemaName: "construct_goal_self_report_signals",
      instructions: buildGoalSelfReportExtractionInstructions(),
      prompt: JSON.stringify(
        {
          goal,
          priorKnowledge: serializeKnowledgeBaseForPrompt(current)
        },
        null,
        2
      ),
      maxOutputTokens: 1_400,
      verbosity: "low",
      usage
    });

    if (draft.signals.length === 0) {
      return current;
    }

    const nextKnowledgeBase = applyKnowledgeSignals(
      current,
      draft.signals.map((signal) => ({
        conceptId: signal.conceptId,
        label: signal.label,
        category: signal.category,
        score: signal.score,
        rationale: signal.rationale,
        source: "self-report" as const,
        recordedAt: timestamp,
        labelPath: signal.labelPath,
        evidenceTitle: `Project brief signal for ${signal.label}`,
        projectGoal: goal,
        revisionNotes: [signal.rationale],
        revisitPrompt: `Revisit the original project brief to remember why ${signal.label} matters here.`
      }))
    );

    await this.persistence.setKnowledgeBase(nextKnowledgeBase);
    this.logger.info("Merged explicit self-report signals from project goal.", {
      goal,
      signalCount: draft.signals.length,
      conceptCount: countKnowledgeConceptNodes(nextKnowledgeBase.concepts)
    });

    return nextKnowledgeBase;
  }

  private async mergeKnowledgeBase(
    current: UserKnowledgeBase,
    session: PlanningSession,
    plan: GeneratedProjectPlan,
    resolvedAnswers: ResolvedPlanningAnswer[]
  ): Promise<void> {
    const timestamp = this.now().toISOString();
    const goal = {
      goal: session.goal,
      language: session.detectedLanguage,
      domain: session.detectedDomain,
      lastPlannedAt: timestamp,
      projectId: session.sessionId,
      projectName: session.goal
    };

    const answerSignals = resolvedAnswers.flatMap((answer) => {
      const conceptLabel =
        getKnowledgeConceptLabelPath(current.concepts, answer.conceptId)?.at(-1) ??
        labelForConceptId(answer.conceptId);
      const linkedStep =
        plan.steps.find((step) => step.concepts.includes(answer.conceptId)) ?? null;

      if (answer.selectedOption) {
        return [
          {
            conceptId: answer.conceptId,
            label: conceptLabel,
            category: answer.category,
            score: confidenceToScore(answer.selectedOption.confidenceSignal),
            rationale: `${answer.selectedOption.label}. ${answer.selectedOption.description}`,
            source: "self-report" as const,
            recordedAt: timestamp,
            evidenceTitle: `Project intake for ${conceptLabel}`,
            projectId: session.sessionId,
            projectName: session.goal,
            projectGoal: session.goal,
            stepId: linkedStep?.id ?? null,
            stepTitle: linkedStep?.title ?? null,
            filePath: linkedStep?.suggestedFiles[0] ?? null,
            revisionNotes: [answer.prompt, linkedStep?.objective ?? ""].filter(Boolean),
            revisitPrompt: answer.prompt
          }
        ];
      }

      if (answer.answerType === "skipped" || !answer.customResponse) {
        return [];
      }

      return [
        {
          conceptId: answer.conceptId,
          label: conceptLabel,
          category: answer.category,
          score: scoreCustomSelfReport(answer.customResponse),
          rationale: answer.customResponse,
          source: "self-report" as const,
          recordedAt: timestamp,
          labelPath: getKnowledgeConceptLabelPath(current.concepts, answer.conceptId) ?? undefined,
          evidenceTitle: `Project intake for ${conceptLabel}`,
          projectId: session.sessionId,
          projectName: session.goal,
          projectGoal: session.goal,
          stepId: linkedStep?.id ?? null,
          stepTitle: linkedStep?.title ?? null,
          filePath: linkedStep?.suggestedFiles[0] ?? null,
          revisionNotes: [answer.prompt, linkedStep?.objective ?? ""].filter(Boolean),
          revisitPrompt: answer.prompt
        }
      ];
    });

    const planSignals = plan.knowledgeGraph.concepts.map((concept) => {
      const linkedStep =
        plan.steps.find((step) => step.concepts.includes(concept.id)) ?? null;

      return {
        conceptId: concept.id,
        label: concept.label,
        category: concept.category,
        score: concept.masteryScore ?? confidenceToScore(concept.confidence ?? "shaky"),
        rationale: linkedStep?.objective ?? concept.rationale,
        source: "agent-inferred" as const,
        recordedAt: timestamp,
        labelPath: concept.labelPath,
        evidenceTitle: linkedStep ? `Project step: ${linkedStep.title}` : `Project map: ${concept.label}`,
        projectId: session.sessionId,
        projectName: session.goal,
        projectGoal: session.goal,
        stepId: linkedStep?.id ?? null,
        stepTitle: linkedStep?.title ?? null,
        filePath: linkedStep?.suggestedFiles[0] ?? null,
        revisionNotes: [
          concept.rationale,
          linkedStep?.rationale ?? "",
          ...(linkedStep?.implementationNotes ?? []).slice(0, 2)
        ].filter(Boolean),
        revisitPrompt:
          linkedStep?.objective ??
          `Revisit how ${concept.label} fits into ${session.goal}.`
      };
    });

    const nextKnowledgeBase = applyKnowledgeSignals(
      current,
      [...planSignals, ...answerSignals],
      { goal }
    );

    await this.persistence.setKnowledgeBase(nextKnowledgeBase);
    this.logger.info("Merged planning signals into learner knowledge base.", {
      sessionId: session.sessionId,
      goal: session.goal,
      conceptCount: countKnowledgeConceptNodes(nextKnowledgeBase.concepts),
      goalCount: nextKnowledgeBase.goals.length
    });
  }

  private async recordBlueprintKnowledgeArtifacts(
    session: PlanningSession,
    blueprint: ProjectBlueprint
  ): Promise<void> {
    const knowledgeBase = await this.readKnowledgeBase();
    const timestamp = this.now().toISOString();
    const flattenedConcepts = new Map(
      flattenKnowledgeConcepts(knowledgeBase.concepts).map((concept) => [concept.id, concept])
    );
    const runtimeSteps = getBlueprintRuntimeSteps(blueprint);
    const signals = runtimeSteps.flatMap((step) =>
      step.concepts.map((conceptId) => {
        const existing = flattenedConcepts.get(conceptId) ?? null;
        const codeExample = extractKnowledgeCodeExample(
          blueprint.files[step.anchor.file] ?? "",
          step.anchor.marker
        );

        return {
          conceptId,
          label: existing?.label ?? labelForConceptId(conceptId),
          category: existing?.category ?? inferKnowledgeCategory(conceptId),
          score: existing?.score ?? 58,
          rationale: step.summary,
          source: "agent-inferred" as const,
          recordedAt: timestamp,
          labelPath: getKnowledgeConceptLabelPath(knowledgeBase.concepts, conceptId) ?? undefined,
          evidenceTitle: `Revision anchor: ${step.title}`,
          projectId: session.sessionId,
          projectName: blueprint.name,
          projectGoal: session.goal,
          stepId: step.id,
          stepTitle: step.title,
          filePath: step.anchor.file,
          anchorMarker: step.anchor.marker,
          revisionNotes: [
            step.summary,
            ...step.constraints.slice(0, 2),
            ...step.tests.slice(0, 1).map((testPath) => `Validation lives in ${testPath}.`)
          ].filter(Boolean),
          codeExample,
          revisitPrompt: `Open ${step.title} to revisit ${existing?.label ?? labelForConceptId(conceptId)}.`
        };
      })
    );

    if (signals.length === 0) {
      return;
    }

    await this.persistence.setKnowledgeBase(applyKnowledgeSignals(knowledgeBase, signals));
  }

  private async runDependencyInstallStage(
    jobId: string,
    projectRoot: string,
    files: Record<string, string>
  ): Promise<DependencyInstallResult> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    this.emitEvent(job, {
      stage: "blueprint-dependency-install",
      title: "Preparing project dependencies",
      detail: "Installing the generated project's dependencies when a supported manifest is present.",
      level: "info"
    });

    const result = await this.getProjectInstaller().install(projectRoot, files);

    this.emitEvent(job, {
      stage: "blueprint-dependency-install",
      title:
        result.status === "installed"
          ? "Project dependencies installed"
          : result.status === "skipped"
            ? "Dependency installation skipped"
            : "Dependency installation needs attention",
      detail:
        result.detail ??
        (result.status === "installed"
          ? "The generated project dependencies are ready."
          : result.status === "skipped"
            ? "No supported dependency manifest was generated."
            : "The generated project was activated, but dependency installation did not finish cleanly."),
      level: result.status === "failed" ? "warning" : "success",
      payload: result
    });

    return result;
  }

  private async restoreGeneratedBlueprint(sessionId: string): Promise<string | null> {
    const record = await this.persistence.getGeneratedBlueprintRecord(sessionId);

    if (!record) {
      return null;
    }

    const restoredPath = await this.materializePersistedBlueprint(record);
    const updatedAt = this.now().toISOString();

    await this.persistence.setActiveBlueprintState({
      blueprintPath: restoredPath,
      sessionId,
      updatedAt
    });
    await setActiveBlueprintPath({
      rootDirectory: this.rootDirectory,
      blueprintPath: restoredPath,
      sessionId,
      now: this.now
    });

    this.logger.info("Restored active blueprint from persisted record.", {
      sessionId,
      blueprintPath: restoredPath
    });

    return restoredPath;
  }

  private async materializePersistedBlueprint(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<string> {
    const bundle = GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.parse(
      JSON.parse(record.bundleJson)
    );
    const blueprint = ProjectBlueprintSchema.parse(JSON.parse(record.blueprintJson));
    const projectRoot = record.projectRoot;
    const blueprintPath = path.join(projectRoot, "project-blueprint.json");

    await rm(projectRoot, { recursive: true, force: true });
    await mkdir(projectRoot, { recursive: true });
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.supportFiles));
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.canonicalFiles));
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.hiddenTests));

    const nextBlueprint = ProjectBlueprintSchema.parse({
      ...blueprint,
      projectRoot,
      sourceProjectRoot: projectRoot
    });

    await writeFile(
      blueprintPath,
      `${JSON.stringify(nextBlueprint, null, 2)}\n`,
      "utf8"
    );

    return blueprintPath;
  }
}

export class OpenAIStructuredLanguageModel implements StructuredLanguageModel {
  private readonly client: LanguageModelClient;
  private readonly model: string;
  private readonly logger: AgentLogger;
  private readonly persistence: AgentPersistence | null;

  constructor(input: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    logger: AgentLogger;
    persistence?: AgentPersistence;
    client?: LanguageModelClient;
  }) {
    this.client =
      input.client ??
      new ChatOpenAI({
        apiKey: input.apiKey,
        model: input.model,
        configuration: input.baseUrl
          ? {
              baseURL: input.baseUrl
            }
          : undefined
      });
    this.model = input.model;
    this.logger = input.logger;
    this.persistence = input.persistence ?? null;
  }

  async parse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
    usage?: LanguageModelUsageContext;
  }): Promise<z.infer<T>> {
    const startedAt = Date.now();
    this.logger.info("Starting OpenAI structured generation.", {
      model: this.model,
      schemaName: input.schemaName,
      promptChars: input.prompt.length,
      maxOutputTokens: input.maxOutputTokens ?? 4_000,
      verbosity: input.verbosity ?? "medium"
    });
    this.logger.trace?.("OpenAI generation request trace.", {
      model: this.model,
      schemaName: input.schemaName,
      instructions: input.instructions,
      prompt: input.prompt
    });
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const parsed = await this.invokeStructuredResponse(input);
        this.logger.info("Completed OpenAI structured generation.", {
          model: this.model,
          schemaName: input.schemaName,
          durationMs: Date.now() - startedAt,
          attempt,
          mode: "structured",
          response: summarizeStructuredOutput(input.schemaName, parsed)
        });
        return parsed;
      } catch (error) {
        lastError = toError(error);

        if (isStructuredOutputSchemaCompatibilityError(lastError)) {
          this.logger.warn("Structured output schema was incompatible. Retrying with JSON fallback.", {
            model: this.model,
            schemaName: input.schemaName,
            attempt,
            error: lastError.message
          });
          break;
        }

        if (isStructuredOutputParsingFailure(lastError)) {
          this.logger.warn(
            "Structured output returned malformed JSON. Attempting repair before fallback.",
            {
              model: this.model,
              schemaName: input.schemaName,
              attempt,
              error: lastError.message
            }
          );

          const repaired = await this.repairStructuredOutputFailure(input, lastError);
          this.logger.info("Completed OpenAI structured generation.", {
            model: this.model,
            schemaName: input.schemaName,
            durationMs: Date.now() - startedAt,
            attempt,
            mode: "structured-repair",
            response: summarizeStructuredOutput(input.schemaName, repaired)
          });
          return repaired;
        }

        if (attempt >= 2 || !isRetryableModelError(lastError)) {
          throw lastError;
        }

        this.logger.warn("Structured generation failed. Retrying request.", {
          model: this.model,
          schemaName: input.schemaName,
          attempt,
          error: lastError.message
        });
      }
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const parsed = await this.invokeJsonFallback(input);
        this.logger.info("Completed OpenAI structured generation.", {
          model: this.model,
          schemaName: input.schemaName,
          durationMs: Date.now() - startedAt,
          attempt,
          mode: "json-fallback",
          response: summarizeStructuredOutput(input.schemaName, parsed)
        });
        return parsed;
      } catch (error) {
        lastError = toError(error);

        if (attempt >= 2) {
          throw lastError;
        }

        this.logger.warn("JSON fallback generation failed. Retrying request.", {
          model: this.model,
          schemaName: input.schemaName,
          attempt,
          error: lastError.message
        });
      }
    }

    throw lastError ?? new Error("Structured generation failed.");
  }

  private async invokeStructuredResponse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
    usage?: LanguageModelUsageContext;
  }): Promise<z.infer<T>> {
    const structuredModel = this.client.withStructuredOutput(input.schema, {
      name: input.schemaName,
      method: "jsonSchema",
      includeRaw: true
    });
    const callbacks = this.buildStreamingCallbacks(input);
    const response = await structuredModel.invoke([
      [
        "system",
        [
          input.instructions,
          "Return only data that satisfies the requested schema.",
          `Keep the response concise and fit within ${input.maxOutputTokens ?? 4_000} output tokens.`,
          `Preferred verbosity: ${input.verbosity ?? "medium"}.`
        ].join("\n\n")
      ],
      ["user", input.prompt]
    ], {
      callbacks,
      runName: input.schemaName,
      tags: ["construct", "structured-output", input.schemaName],
      metadata: {
        schemaName: input.schemaName,
        mode: "structured"
      }
    });
    this.logger.trace?.("OpenAI structured response trace.", {
      model: this.model,
      schemaName: input.schemaName,
      response
    });

    const parsedResponse = extractStructuredParsedPayload(response);
    const rawResponse = extractStructuredRawPayload(response) ?? response;
    await this.recordUsageEvent(input, "structured", rawResponse);

    return input.schema.parse(parsedResponse ?? response);
  }

  private async invokeJsonFallback<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
    usage?: LanguageModelUsageContext;
  }): Promise<z.infer<T>> {
    const schemaContract = zodToJsonSchema(input.schema, input.schemaName);
    const callbacks = this.buildStreamingCallbacks(input);
    const response = await this.client.invoke([
      [
        "system",
        [
          input.instructions,
          "The structured output path failed. Recover by returning only a valid JSON object with no markdown fences or commentary.",
          "The JSON must satisfy this schema contract:",
          JSON.stringify(schemaContract, null, 2),
          `Keep the response concise and fit within ${input.maxOutputTokens ?? 4_000} output tokens.`,
          `Preferred verbosity: ${input.verbosity ?? "medium"}.`
        ].join("\n\n")
      ],
      ["user", input.prompt]
    ], {
      callbacks,
      runName: `${input.schemaName}:json-fallback`,
      tags: ["construct", "json-fallback", input.schemaName],
      metadata: {
        schemaName: input.schemaName,
        mode: "json-fallback"
      }
    });
    await this.recordUsageEvent(input, "json-fallback", response);

    const text = extractModelText(response.content);
    this.logger.trace?.("OpenAI JSON fallback response trace.", {
      model: this.model,
      schemaName: input.schemaName,
      content: text
    });

    try {
      const jsonPayload = JSON.parse(extractJsonObject(text));
      return input.schema.parse(jsonPayload);
    } catch (error) {
      this.logger.warn("JSON fallback returned invalid JSON. Attempting repair.", {
        model: this.model,
        schemaName: input.schemaName,
        error: toError(error).message
      });
      return this.repairJsonFallbackResponse(input, schemaContract, text);
    }
  }

  private async repairJsonFallbackResponse<T extends z.ZodTypeAny>(
    input: {
      schema: T;
      schemaName: string;
      instructions: string;
      prompt: string;
      maxOutputTokens?: number;
      verbosity?: "low" | "medium" | "high";
      stream?: {
        stage: string;
        label: string;
        onToken?: (chunk: string) => void;
        onComplete?: () => void;
      };
      usage?: LanguageModelUsageContext;
    },
    schemaContract: unknown,
    invalidText: string
  ): Promise<z.infer<T>> {
    const response = await this.client.invoke([
      [
        "system",
        [
          "You repair malformed model JSON outputs.",
          "Return only a valid JSON object with no markdown fences or commentary.",
          "Preserve the intended meaning of the draft, but make it syntactically valid and schema-compatible.",
          "Convert informal numeric words such as `fifty` into numbers when the schema requires numbers.",
          "The repaired JSON must satisfy this schema contract:",
          JSON.stringify(schemaContract, null, 2)
        ].join("\n\n")
      ],
      [
        "user",
        [
          "Original instructions:",
          input.instructions,
          "",
          "Original prompt:",
          input.prompt,
          "",
          "Malformed JSON draft:",
          invalidText
        ].join("\n")
      ]
    ], {
      runName: `${input.schemaName}:json-repair`,
      tags: ["construct", "json-repair", input.schemaName],
      metadata: {
        schemaName: input.schemaName,
        mode: "json-repair"
      }
    });
    await this.recordUsageEvent(input, "json-repair", response);

    const repairedText = extractModelText(response.content);
    this.logger.trace?.("OpenAI JSON repair response trace.", {
      model: this.model,
      schemaName: input.schemaName,
      content: repairedText
    });
    const repairedPayload = JSON.parse(extractJsonObject(repairedText));
    return input.schema.parse(repairedPayload);
  }

  private async repairStructuredOutputFailure<T extends z.ZodTypeAny>(
    input: {
      schema: T;
      schemaName: string;
      instructions: string;
      prompt: string;
      maxOutputTokens?: number;
      verbosity?: "low" | "medium" | "high";
      stream?: {
        stage: string;
        label: string;
        onToken?: (chunk: string) => void;
        onComplete?: () => void;
      };
      usage?: LanguageModelUsageContext;
    },
    error: Error
  ): Promise<z.infer<T>> {
    const malformedDraft = extractStructuredFailureDraft(error);

    if (!malformedDraft) {
      throw error;
    }

    return this.repairJsonFallbackResponse(
      input,
      zodToJsonSchema(input.schema, input.schemaName),
      malformedDraft
    );
  }

  private buildStreamingCallbacks(input: {
    schemaName: string;
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): BaseCallbackHandler[] | undefined {
    if (!input.stream?.onToken) {
      return undefined;
    }

    const handler = BaseCallbackHandler.fromMethods({
      handleLLMNewToken: (token) => {
        if (!token) {
          return;
        }

        input.stream?.onToken?.(token);
      }
    }) as BaseCallbackHandler & { lc_prefer_streaming?: boolean };

    Object.defineProperty(handler, "lc_prefer_streaming", {
      value: true,
      configurable: true
    });

    return [handler];
  }

  private async recordUsageEvent(
    input: {
      schemaName: string;
      usage?: LanguageModelUsageContext;
    },
    mode: string,
    response: unknown
  ): Promise<void> {
    if (!this.persistence) {
      return;
    }

    const usage = extractLanguageModelUsage(response);
    if (!usage) {
      return;
    }

    try {
      const resolvedProject =
        !input.usage?.projectId && input.usage?.blueprintPath
          ? await this.persistence.getProjectByBlueprintPath(input.usage.blueprintPath)
          : null;

      await this.persistence.recordApiUsageEvent({
        id: randomUUID(),
        provider: "openai",
        kind: "llm",
        model: this.model,
        operation: input.usage?.operation?.trim() || input.schemaName,
        stage: input.usage?.stage?.trim() || null,
        schemaName: input.schemaName,
        mode,
        projectId: input.usage?.projectId ?? resolvedProject?.id ?? null,
        projectName: input.usage?.projectName ?? resolvedProject?.name ?? null,
        projectGoal: input.usage?.projectGoal ?? resolvedProject?.goal ?? null,
        buildId: input.usage?.buildId ?? null,
        sessionId: input.usage?.sessionId ?? resolvedProject?.id ?? null,
        jobId: input.usage?.jobId ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningTokens: usage.reasoningTokens,
        costUsd: usage.costUsd,
        currency: usage.currency,
        metadata: usage.metadata,
        recordedAt: new Date().toISOString()
      });
    } catch (error) {
      this.logger.warn("Failed to record provider usage event.", {
        model: this.model,
        schemaName: input.schemaName,
        mode,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function extractStructuredParsedPayload(response: unknown): unknown {
  const record = asRecord(response);
  return record?.parsed;
}

function extractStructuredRawPayload(response: unknown): LanguageModelRawResponse | null {
  const record = asRecord(response);
  const raw = record?.raw;
  const rawRecord = asRecord(raw);

  if (!rawRecord || !("content" in rawRecord)) {
    return null;
  }

  return rawRecord as LanguageModelRawResponse;
}

function extractLanguageModelUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  currency: string | null;
  metadata: Record<string, unknown>;
} | null {
  const responseRecord = asRecord(response);

  if (!responseRecord) {
    return null;
  }

  const usageMetadata = asRecord(responseRecord["usage_metadata"]);
  const responseMetadata = asRecord(responseRecord["response_metadata"]);
  const tokenUsage =
    asRecord(responseMetadata?.tokenUsage) ??
    asRecord(responseMetadata?.token_usage) ??
    asRecord(responseMetadata?.usage);
  const inputDetails =
    asRecord(usageMetadata?.input_token_details) ??
    asRecord(tokenUsage?.inputTokenDetails) ??
    asRecord(tokenUsage?.input_token_details);
  const outputDetails =
    asRecord(usageMetadata?.output_token_details) ??
    asRecord(tokenUsage?.completionTokenDetails) ??
    asRecord(tokenUsage?.output_token_details);
  const billing = asRecord(responseMetadata?.billing);

  const inputTokens =
    readNumericMetric(
      usageMetadata?.input_tokens,
      tokenUsage?.promptTokens,
      tokenUsage?.prompt_tokens,
      tokenUsage?.inputTokens,
      tokenUsage?.input_tokens
    ) ?? 0;
  const outputTokens =
    readNumericMetric(
      usageMetadata?.output_tokens,
      tokenUsage?.completionTokens,
      tokenUsage?.completion_tokens,
      tokenUsage?.outputTokens,
      tokenUsage?.output_tokens
    ) ?? 0;
  const totalTokens =
    readNumericMetric(
      usageMetadata?.total_tokens,
      tokenUsage?.totalTokens,
      tokenUsage?.total_tokens
    ) ?? (inputTokens + outputTokens);
  const cachedInputTokens =
    readNumericMetric(
      inputDetails?.cached_tokens,
      inputDetails?.cache_read,
      inputDetails?.cachedTokens,
      inputDetails?.cacheReadTokens
    ) ?? 0;
  const reasoningTokens =
    readNumericMetric(
      outputDetails?.reasoning_tokens,
      outputDetails?.reasoning,
      outputDetails?.reasoningTokens
    ) ?? 0;
  const costUsd =
    readDecimalMetric(
      responseMetadata?.costUsd,
      responseMetadata?.cost_usd,
      billing?.costUsd,
      billing?.cost_usd
    ) ?? null;
  const currency =
    readStringMetric(responseMetadata?.currency, billing?.currency) ?? null;
  const usageSource = usageMetadata
    ? "usage_metadata"
    : tokenUsage
      ? "response_metadata"
      : "unavailable";

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
    costUsd,
    currency,
    metadata: {
      usageSource
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readNumericMetric(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.round(parsed));
      }
    }
  }

  return null;
}

function readDecimalMetric(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, value);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
      }
    }
  }

  return null;
}

function readStringMetric(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

class TavilySearchProvider implements SearchProvider {
  private readonly client;
  private readonly logger: AgentLogger;

  constructor(
    private readonly apiKey: string,
    private readonly depth: "basic" | "advanced" | "fast" | "ultra-fast",
    logger: AgentLogger
  ) {
    this.client = tavily({
      apiKey: this.apiKey
    });
    this.logger = logger;
  }

  async research(query: string): Promise<ResearchDigest> {
    const startedAt = Date.now();
    this.logger.info("Starting Tavily research.", {
      provider: "tavily",
      depth: this.depth,
      query
    });
    const response = await this.client.search(query, {
      searchDepth: this.depth,
      maxResults: 5,
      includeAnswer: "advanced",
      includeRawContent: false
    });

    const digest = {
      query,
      answer: response.answer,
      sources: response.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.publishedDate
      }))
    };
    this.logger.info("Completed Tavily research.", {
      provider: "tavily",
      depth: this.depth,
      query,
      durationMs: Date.now() - startedAt,
      sourceCount: digest.sources.length,
      sources: digest.sources.map((source) => source.title)
    });
    return digest;
  }
}

function buildSearchProvider(input: {
  provider: "tavily" | "exa";
  tavilyApiKey: string;
  depth: "basic" | "advanced" | "fast" | "ultra-fast";
  logger: AgentLogger;
}): SearchProvider {
  if (input.provider === "exa") {
    throw new Error("Search provider EXA is not implemented yet. Set CONSTRUCT_SEARCH_PROVIDER=tavily.");
  }

  return new TavilySearchProvider(input.tavilyApiKey, input.depth, input.logger);
}

function resolveAgentConfig(): AgentConfig {
  const provider = (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase();
  const searchProvider = (process.env.CONSTRUCT_SEARCH_PROVIDER ?? "tavily")
    .trim()
    .toLowerCase();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();
  const openAiModel = process.env.CONSTRUCT_OPENAI_MODEL?.trim() || "gpt-5.4";
  const openAiFastModel = process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim() || "gpt-5-nano";
  const openAiRepairModel =
    process.env.CONSTRUCT_OPENAI_REPAIR_MODEL?.trim() || openAiModel;

  if (provider !== "openai") {
    throw new Error(
      `Unsupported agent provider "${provider}". Construct currently supports CONSTRUCT_AGENT_PROVIDER=openai.`
    );
  }

  if (searchProvider !== "tavily" && searchProvider !== "exa") {
    throw new Error(
      `Unsupported search provider "${searchProvider}". Use CONSTRUCT_SEARCH_PROVIDER=tavily or exa.`
    );
  }

  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for the real Construct agent stack.");
  }

  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for Construct agent research.");
  }

  return {
    provider: "openai",
    searchProvider,
    openAiApiKey,
    openAiBaseUrl: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(),
    openAiModel,
    openAiFastModel,
    openAiRepairModel,
    tavilyApiKey,
    tavilySearchDepth:
      (process.env.CONSTRUCT_TAVILY_SEARCH_DEPTH?.trim() as
        | "basic"
        | "advanced"
        | "fast"
        | "ultra-fast"
        | undefined) ?? "advanced"
  };
}

function createConsoleAgentLogger(): AgentLogger {
  const debugLevel = resolveDebugLevel();

  return {
    info(message, context) {
      if (debugLevel < 1) {
        return;
      }
      console.log(formatAgentLogLine("INFO", message, context));
    },
    warn(message, context) {
      console.warn(formatAgentLogLine("WARN", message, context));
    },
    error(message, context) {
      console.error(formatAgentLogLine("ERROR", message, context));
    },
    debug(message, context) {
      if (debugLevel < 2) {
        return;
      }
      console.debug(formatAgentLogLine("DEBUG", message, context));
    },
    trace(message, context) {
      if (debugLevel < 3) {
        return;
      }
      console.debug(formatAgentLogLine("TRACE", message, context));
    }
  };
}

function formatAgentLogLine(
  level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE",
  message: string,
  context?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();

  if (!context || Object.keys(context).length === 0) {
    return `[construct-agent] ${timestamp} ${level} ${message}`;
  }

  return `[construct-agent] ${timestamp} ${level} ${message} ${formatLogContext(context)}`;
}

function resolveDebugLevel(): 0 | 1 | 2 | 3 {
  const raw = Number.parseInt(process.env.CONSTRUCT_DEBUG_LEVEL?.trim() ?? "1", 10);

  if (!Number.isFinite(raw)) {
    return 1;
  }

  if (raw <= 0) {
    return 0;
  }

  if (raw >= 3) {
    return 3;
  }

  return raw as 1 | 2;
}

function formatLogContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${stringifyLogValue(value)}`)
    .join(" ");
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isStructuredOutputSchemaCompatibilityError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    (message.includes("optional()") && message.includes("nullable()")) ||
    message.includes("all fields must be required") ||
    message.includes("structured outputs") ||
    message.includes("json schema is invalid") ||
    message.includes("invalid schema for response_format") ||
    message.includes("missing properties")
  );
}

function isRetryableModelError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("temporarily unavailable") ||
    message.includes("internal server error") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function isStructuredOutputParsingFailure(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes("output_parsing_failure") ||
    (message.includes("failed to parse") && message.includes("text:")) ||
    (message.includes("unexpected token") && message.includes("not valid json"))
  );
}

function extractModelText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object" && "text" in (content as Record<string, unknown>)) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return String(content ?? "");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const unwrapped = unwrapQuotedJsonCandidate(trimmed);
  const start = findFirstJsonStart(unwrapped);

  if (start < 0) {
    throw new Error("Model fallback response did not contain a JSON object.");
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < unwrapped.length; index += 1) {
    const char = unwrapped[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) {
      stack.pop();

      if (stack.length === 0) {
        return unwrapped.slice(start, index + 1);
      }
    }
  }

  return unwrapped.slice(start);
}

function unwrapQuotedJsonCandidate(text: string): string {
  if (!text.startsWith("\"")) {
    return text;
  }

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "string" ? parsed.trim() : text;
  } catch {
    return text;
  }
}

function findFirstJsonStart(text: string): number {
  const objectIndex = text.indexOf("{");
  const arrayIndex = text.indexOf("[");

  if (objectIndex < 0) {
    return arrayIndex;
  }

  if (arrayIndex < 0) {
    return objectIndex;
  }

  return Math.min(objectIndex, arrayIndex);
}

function extractStructuredFailureDraft(error: Error): string | null {
  const message = error.message;
  const textMarker = "Text:";
  const errorMarker = ". Error:";
  const textIndex = message.indexOf(textMarker);

  if (textIndex < 0) {
    return null;
  }

  const errorIndex = message.indexOf(errorMarker, textIndex);
  const rawDraft = message
    .slice(textIndex + textMarker.length, errorIndex >= 0 ? errorIndex : undefined)
    .trim();

  if (!rawDraft) {
    return null;
  }

  if (rawDraft.startsWith("\"") && rawDraft.endsWith("\"")) {
    return rawDraft.slice(1, -1);
  }

  return rawDraft;
}

function summarizeAgentEventPayload(event: AgentEvent): Record<string, unknown> | null {
  if (!event.payload) {
    return null;
  }

  if (
    typeof event.payload === "object" &&
    "stream" in event.payload &&
    (event.payload as Record<string, unknown>).stream === true
  ) {
    const payload = event.payload as Record<string, unknown>;
    const text = typeof payload.text === "string" ? payload.text : "";
    return {
      stream: true,
      label: typeof payload.label === "string" ? payload.label : undefined,
      chunkChars: text.length
    };
  }

  if (event.stage.startsWith("research")) {
    const payload = event.payload as {
      query?: unknown;
      sources?: Array<{ title?: string; url?: string }>;
    };

    return {
      query: typeof payload.query === "string" ? truncateText(payload.query, 180) : undefined,
      sourceCount: Array.isArray(payload.sources) ? payload.sources.length : undefined,
      sourceTitles: Array.isArray(payload.sources)
        ? payload.sources.slice(0, 5).map((source) => truncateText(String(source.title ?? ""), 80))
        : undefined
    };
  }

  if (event.stage.startsWith("blueprint")) {
    const payload = event.payload as Record<string, unknown>;

    return {
      fileCount: typeof payload.fileCount === "number" ? payload.fileCount : undefined,
      stepCount: typeof payload.stepCount === "number" ? payload.stepCount : undefined,
      architectureNodeCount:
        typeof payload.architectureNodeCount === "number"
          ? payload.architectureNodeCount
          : undefined,
      supportFileCount:
        typeof payload.supportFileCount === "number" ? payload.supportFileCount : undefined,
      canonicalFileCount:
        typeof payload.canonicalFileCount === "number" ? payload.canonicalFileCount : undefined,
      learnerFileCount:
        typeof payload.learnerFileCount === "number" ? payload.learnerFileCount : undefined,
      testCount: typeof payload.testCount === "number" ? payload.testCount : undefined,
      hiddenTestCount:
        typeof payload.hiddenTestCount === "number" ? payload.hiddenTestCount : undefined,
      packageManager:
        typeof payload.packageManager === "string" ? payload.packageManager : undefined,
      status: typeof payload.status === "string" ? payload.status : undefined,
      samplePaths: Array.isArray(payload.samplePaths)
        ? payload.samplePaths.slice(0, 4).map((entry) => truncateText(String(entry), 80))
        : undefined
    };
  }

  return {
    keys: Object.keys(event.payload)
  };
}

function summarizeJobResult(kind: AgentJobKind, result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  if (kind === "planning-questions") {
    const payload = result as {
      session?: { sessionId?: string; detectedLanguage?: string; detectedDomain?: string; questions?: unknown[] };
    };

    return {
      sessionId: payload.session?.sessionId,
      detectedLanguage: payload.session?.detectedLanguage,
      detectedDomain: payload.session?.detectedDomain,
      questionCount: Array.isArray(payload.session?.questions) ? payload.session.questions.length : undefined
    };
  }

  if (kind === "planning-plan") {
    const payload = result as {
      session?: { sessionId?: string };
      plan?: { suggestedFirstStepId?: string; steps?: unknown[]; architecture?: unknown[] };
    };

    return {
      sessionId: payload.session?.sessionId,
      suggestedFirstStepId: payload.plan?.suggestedFirstStepId,
      stepCount: Array.isArray(payload.plan?.steps) ? payload.plan.steps.length : undefined,
      architectureNodeCount: Array.isArray(payload.plan?.architecture)
        ? payload.plan.architecture.length
        : undefined
    };
  }

  if (kind === "runtime-guide") {
    const payload = result as {
      summary?: string;
      socraticQuestions?: unknown[];
      nextAction?: string;
    };

    return {
      summary: typeof payload.summary === "string" ? truncateText(payload.summary, 120) : undefined,
      socraticQuestionCount: Array.isArray(payload.socraticQuestions)
        ? payload.socraticQuestions.length
        : undefined,
      nextAction: typeof payload.nextAction === "string"
        ? truncateText(payload.nextAction, 120)
        : undefined
    };
  }

  return {
    keys: Object.keys(result)
  };
}

function summarizeStructuredOutput(schemaName: string, response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    return {
      schemaName,
      resultType: typeof response
    };
  }

  const payload = response as Record<string, unknown>;
  return {
    schemaName,
    keys: Object.keys(payload),
    summary: typeof payload.summary === "string" ? truncateText(payload.summary, 120) : undefined,
    questionCount: Array.isArray(payload.questions) ? payload.questions.length : undefined,
    stepCount: Array.isArray(payload.steps) ? payload.steps.length : undefined,
    architectureNodeCount: Array.isArray(payload.architecture) ? payload.architecture.length : undefined,
    canonicalFileCount: Array.isArray(payload.canonicalFiles) ? payload.canonicalFiles.length : undefined,
    learnerFileCount: Array.isArray(payload.learnerFiles) ? payload.learnerFiles.length : undefined,
    hiddenTestCount: Array.isArray(payload.hiddenTests) ? payload.hiddenTests.length : undefined,
    socraticQuestionCount: Array.isArray(payload.socraticQuestions)
      ? payload.socraticQuestions.length
      : undefined
  };
}

function summarizeFileBatch(files: Record<string, string>): {
  fileCount: number;
  samplePaths: string[];
} {
  return {
    fileCount: Object.keys(files).length,
    samplePaths: Object.keys(files).slice(0, 4)
  };
}

function fileEntriesToRecord(
  files: Array<z.infer<typeof GENERATED_FILE_ENTRY_SCHEMA>>
): Record<string, string> {
  const record: Record<string, string> = {};

  for (const file of files) {
    record[file.path] = file.content;
  }

  return record;
}

function countKnowledgeConceptNodes(concepts: StoredKnowledgeConcept[]): number {
  return concepts.reduce(
    (total, concept) => total + 1 + countKnowledgeConceptNodes(concept.children),
    0
  );
}

function scoreCustomSelfReport(response: string): number {
  const normalized = response.toLowerCase();

  if (
    /\b(from scratch|brand new|completely new|total beginner|beginner|never used|don't know|do not know)\b/.test(
      normalized
    )
  ) {
    return 26;
  }

  if (
    /\b(struggle|stumble|fuzzy|unclear|confusing|need help|need guidance|not comfortable|weak)\b/.test(
      normalized
    )
  ) {
    return 42;
  }

  if (
    /\b(comfortable|confident|used in production|have built|i know|experienced|solid)\b/.test(
      normalized
    )
  ) {
    return 76;
  }

  return 54;
}

function labelForConceptId(conceptId: string): string {
  const segments = conceptId.split(".").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? conceptId;
  return leaf
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractKnowledgeCodeExample(content: string, marker: string): string | null {
  if (!content.trim()) {
    return null;
  }

  const lines = content.split("\n");
  const markerIndex = lines.findIndex((line) => line.includes(marker));
  const start = markerIndex === -1 ? 0 : Math.max(0, markerIndex - 1);
  const end = markerIndex === -1 ? Math.min(lines.length, 8) : Math.min(lines.length, markerIndex + 7);
  const snippet = lines
    .slice(start, end)
    .join("\n")
    .trim();

  return snippet.length > 0 ? snippet : null;
}

function inferKnowledgeCategory(conceptId: string): "language" | "domain" | "workflow" {
  const root = conceptId.split(".")[0]?.toLowerCase() ?? "";

  if ([
    "rust",
    "typescript",
    "javascript",
    "python",
    "go",
    "java",
    "kotlin",
    "swift",
    "c",
    "cpp",
    "csharp"
  ].includes(root)) {
    return "language";
  }

  if ([
    "workflow",
    "tooling",
    "testing",
    "debugging",
    "git",
    "build",
    "deploy",
    "ci",
    "editor"
  ].includes(root)) {
    return "workflow";
  }

  return "domain";
}

function mergeResearchDigests(query: string, digests: Array<ResearchDigest | null>): ResearchDigest {
  const mergedSources = new Map<string, ResearchSource>();
  const answerParts: string[] = [];

  for (const digest of digests) {
    if (!digest) {
      continue;
    }

    if (digest.answer) {
      answerParts.push(digest.answer.trim());
    }

    for (const source of digest.sources) {
      const key = source.url || `${source.title}:${source.snippet}`;
      if (!mergedSources.has(key)) {
        mergedSources.set(key, source);
      }
    }
  }

  return {
    query,
    answer: answerParts.length > 0 ? answerParts.join("\n\n") : undefined,
    sources: Array.from(mergedSources.values())
  };
}

function createProjectInstaller(logger: AgentLogger): ProjectInstaller {
  return {
    async install(projectRoot, files) {
      if (files["package.json"]) {
        return runProjectInstallCommand({
          command: "pnpm",
          args: ["install", "--ignore-workspace", "--frozen-lockfile=false"],
          projectRoot,
          manifestPath: "package.json",
          packageManager: "pnpm",
          logger
        });
      }

      if (files["Cargo.toml"]) {
        return runProjectInstallCommand({
          command: "cargo",
          args: ["fetch"],
          projectRoot,
          manifestPath: "Cargo.toml",
          packageManager: "cargo",
          logger
        });
      }

      return {
        status: "skipped",
        packageManager: "none",
        detail: "No supported dependency manifest was generated."
      };
    }
  };
}

async function runProjectInstallCommand(input: {
  command: string;
  args: string[];
  projectRoot: string;
  manifestPath: string;
  packageManager: string;
  logger: AgentLogger;
}): Promise<DependencyInstallResult> {
  const { command, args, projectRoot, manifestPath, packageManager, logger } = input;

  logger.info("Starting generated project dependency install.", {
    projectRoot,
    packageManager,
    manifestPath
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
      });
    });

    logger.info("Completed generated project dependency install.", {
      projectRoot,
      packageManager,
      manifestPath
    });

    return {
      status: "installed",
      packageManager,
      manifestPath
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dependency install error.";
    logger.warn("Generated project dependency install failed.", {
      projectRoot,
      packageManager,
      manifestPath,
      detail: truncateText(message, 240)
    });

    return {
      status: "failed",
      packageManager,
      manifestPath,
      detail: truncateText(message, 240)
    };
  }
}

function compactResearchDigest(
  research: ResearchDigest | null
): {
  query: string;
  answer?: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
  }>;
} | null {
  if (!research) {
    return null;
  }

  return {
    query: truncateText(research.query, 220),
    answer: research.answer ? truncateText(research.answer, 800) : undefined,
    sources: research.sources.slice(0, 5).map((source) => ({
      title: truncateText(source.title, 140),
      url: source.url,
      snippet: truncateText(source.snippet, 320),
      publishedDate: source.publishedDate
    }))
  };
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeDraftLessonSlides(
  lessonSlides: Array<z.infer<typeof GENERATED_LESSON_SLIDE_DRAFT_SCHEMA>>,
  fallbackDoc: string
): Array<z.infer<typeof GENERATED_LESSON_SLIDE_DRAFT_SCHEMA>> {
  const fallbackSlide = {
    blocks: [
      {
        type: "markdown" as const,
        markdown: fallbackDoc.trim()
      }
    ]
  };
  const rawSlides = lessonSlides.length > 0 ? lessonSlides : [fallbackSlide];
  const normalizedSlides: Array<z.infer<typeof GENERATED_LESSON_SLIDE_DRAFT_SCHEMA>> = [];

  for (const slide of rawSlides) {
    const normalizedBlocks: Array<z.infer<typeof GENERATED_LESSON_SLIDE_BLOCK_DRAFT_SCHEMA>> = [];

    for (const block of slide.blocks) {
      if (block.type === "check") {
        normalizedBlocks.push({
          type: "check",
          placement: block.placement ?? "inline",
          check: block.check
        });
        continue;
      }

      const prepared = block.markdown.replaceAll("\\n", "\n").trim();
      if (!prepared) {
        continue;
      }

      const multiSlideMatches = Array.from(
        prepared.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?slide\s+\d+\s*:\s*/gi)
      );

      if (multiSlideMatches.length >= 2 && normalizedBlocks.length === 0) {
        const fragments = prepared
          .split(/(?:^|\n)\s*(?:[-*]\s*)?slide\s+\d+\s*:\s*/gi)
          .map((fragment) => fragment.trim())
          .filter(Boolean);

        for (const fragment of fragments) {
          normalizedSlides.push({
            blocks: [
              {
                type: "markdown",
                markdown: fragment
              }
            ]
          });
        }
        continue;
      }

      const markdownDividerFragments = prepared
        .split(/\n\s*---+\s*\n/g)
        .map((fragment) => fragment.trim())
        .filter(Boolean);

      if (markdownDividerFragments.length >= 2 && normalizedBlocks.length === 0) {
        normalizedSlides.push(
          ...markdownDividerFragments.map((fragment) => ({
            blocks: [
              {
                type: "markdown" as const,
                markdown: fragment
              }
            ]
          }))
        );
        continue;
      }

      normalizedBlocks.push({
        type: "markdown",
        markdown: prepared
      });
    }

    if (normalizedBlocks.length > 0) {
      normalizedSlides.push({
        blocks: normalizedBlocks
      });
    }
  }

  return normalizedSlides.length > 0 ? normalizedSlides : [fallbackSlide];
}

function normalizeGeneratedBlueprintDraft(
  draft: GeneratedBlueprintBundleDraft
): GeneratedBlueprintBundleDraft {
  validateGeneratedBlueprintDraftIntegrity(draft, "Generated blueprint draft");

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      lessonSlides: normalizeDraftLessonSlides(step.lessonSlides, step.doc)
    }))
  };
}

function normalizeGeneratedFrontierDraft(
  draft: GeneratedFrontierDraft,
  options?: {
    language?: string;
  }
): GeneratedFrontierDraft {
  validateGeneratedFrontierDraftIntegrity(
    draft,
    "Generated frontier draft",
    options?.language
  );

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      lessonSlides: normalizeDraftLessonSlides(step.lessonSlides, step.doc)
    }))
  };
}

function mergeLessonAuthoredStepDraft(
  step: GeneratedBlueprintStepDraft,
  authoredStep: z.infer<typeof LESSON_AUTHORED_STEP_DRAFT_SCHEMA>
): GeneratedBlueprintStepDraft {
  return {
    ...step,
    summary: authoredStep.summary,
    doc: authoredStep.doc,
    lessonSlides: normalizeDraftLessonSlides(authoredStep.lessonSlides, authoredStep.doc),
    checks: authoredStep.checks
  };
}

function validateGeneratedHiddenTests(
  hiddenTests: Array<{ path: string; content: string }>,
  context: string
): void {
  for (const hiddenTest of hiddenTests) {
    validateGeneratedHiddenTest(hiddenTest, context);
  }
}

function validateGeneratedBlueprintDraftIntegrity(
  draft: GeneratedBlueprintBundleDraft,
  context: string
): void {
  const supportFiles = validateGeneratedFileEntries(draft.supportFiles, "supportFiles", context);
  const canonicalFiles = validateGeneratedFileEntries(draft.canonicalFiles, "canonicalFiles", context);
  const learnerFiles = validateGeneratedFileEntries(draft.learnerFiles, "learnerFiles", context);
  const hiddenTests = validateGeneratedFileEntries(draft.hiddenTests, "hiddenTests", context);
  const supportPaths = new Set(supportFiles.keys());
  const canonicalPaths = new Set(canonicalFiles.keys());
  const learnerPaths = new Set(learnerFiles.keys());
  const hiddenTestPaths = new Set(hiddenTests.keys());

  validateNoGeneratedPathOverlap(supportPaths, canonicalPaths, "supportFiles", "canonicalFiles", context);
  validateNoGeneratedPathOverlap(supportPaths, learnerPaths, "supportFiles", "learnerFiles", context);
  validateNoGeneratedPathOverlap(supportPaths, hiddenTestPaths, "supportFiles", "hiddenTests", context);
  validateNoGeneratedPathOverlap(canonicalPaths, hiddenTestPaths, "canonicalFiles", "hiddenTests", context);
  validateNoGeneratedPathOverlap(learnerPaths, hiddenTestPaths, "learnerFiles", "hiddenTests", context);

  const missingCanonicalPaths = [...learnerPaths].filter((filePath) => !canonicalPaths.has(filePath));
  if (missingCanonicalPaths.length > 0) {
    throw new Error(
      `${context} returned learnerFiles without matching canonicalFiles for ${missingCanonicalPaths.join(", ")}.`
    );
  }

  const materializedPaths = new Set([
    ...supportPaths,
    ...canonicalPaths,
    ...learnerPaths
  ]);

  for (const entrypoint of draft.entrypoints.map((entry) => normalizePathValue(entry))) {
    if (!materializedPaths.has(entrypoint)) {
      throw new Error(
        `${context} returned entrypoint ${entrypoint} that does not exist in supportFiles, canonicalFiles, or learnerFiles.`
      );
    }
  }

  validateGeneratedStepReferences(draft.steps, learnerFiles, hiddenTestPaths, context);
  validateGeneratedJavaScriptTestHarness({
    language: draft.language,
    supportFiles,
    hiddenTests: draft.hiddenTests,
    context
  });
  validateGeneratedLearnerExerciseSeparation({
    learnerFiles,
    canonicalFiles,
    steps: draft.steps,
    context
  });
}

function validateGeneratedFrontierDraftIntegrity(
  draft: GeneratedFrontierDraft,
  context: string,
  language?: string
): void {
  const learnerFiles = validateGeneratedFileEntries(draft.learnerFiles, "learnerFiles", context);
  const hiddenTests = validateGeneratedFileEntries(draft.hiddenTests, "hiddenTests", context);
  const learnerPaths = new Set(learnerFiles.keys());
  const hiddenTestPaths = new Set(hiddenTests.keys());

  validateNoGeneratedPathOverlap(learnerPaths, hiddenTestPaths, "learnerFiles", "hiddenTests", context);
  validateGeneratedStepReferences(draft.steps, learnerFiles, hiddenTestPaths, context);
  validateGeneratedJavaScriptTestHarness({
    language,
    hiddenTests: draft.hiddenTests,
    context
  });
  validateGeneratedLearnerExerciseSeparation({
    learnerFiles,
    steps: draft.steps,
    context
  });
}

function validateGeneratedFileEntries(
  files: Array<{ path: string; content: string }>,
  group: "supportFiles" | "canonicalFiles" | "learnerFiles" | "hiddenTests",
  context: string
): Map<string, string> {
  const normalizedFiles = new Map<string, string>();

  for (const file of files) {
    const normalizedPath = normalizePathValue(file.path);

    if (normalizedFiles.has(normalizedPath)) {
      throw new Error(`${context} returned duplicate ${group} path ${normalizedPath}.`);
    }

    validateGeneratedFileEntry(file, group, context);
    normalizedFiles.set(normalizedPath, file.content);
  }

  return normalizedFiles;
}

function validateGeneratedFileEntry(
  file: { path: string; content: string },
  group: "supportFiles" | "canonicalFiles" | "learnerFiles" | "hiddenTests",
  context: string
): void {
  const normalizedPath = normalizePathValue(file.path);
  const trimmedContent = file.content.trim();

  if (group === "hiddenTests") {
    validateGeneratedHiddenTest(file, context);
    return;
  }

  if (looksLikePlaceholderGeneratedArtifact(normalizedPath, trimmedContent)) {
    throw new Error(
      `${context} returned placeholder ${group} content for ${normalizedPath}. ${group} must contain concrete project files.`
    );
  }

  if (normalizedPath.endsWith(".json")) {
    try {
      JSON.parse(file.content);
    } catch (error) {
      throw new Error(
        `${context} returned invalid JSON for ${group} file ${normalizedPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  validateGeneratedSourceSyntax(file, group, context);
}

function validateGeneratedJavaScriptTestHarness(input: {
  language?: string;
  supportFiles?: Map<string, string>;
  hiddenTests: Array<{ path: string; content: string }>;
  context: string;
}): void {
  const normalizedLanguage = (input.language ?? "").trim().toLowerCase();
  if (
    normalizedLanguage !== "javascript" &&
    normalizedLanguage !== "js" &&
    normalizedLanguage !== "jsx" &&
    normalizedLanguage !== "typescript" &&
    normalizedLanguage !== "ts" &&
    normalizedLanguage !== "tsx"
  ) {
    return;
  }

  const nodeTestPaths = input.hiddenTests
    .filter((file) => looksLikeGeneratedNodeTestSuite(file.content))
    .map((file) => normalizePathValue(file.path));

  if (nodeTestPaths.length > 0) {
    throw new Error(
      `${input.context} returned node:test-based hidden tests (${nodeTestPaths.join(", ")}). JavaScript/TypeScript blueprints must use the Jest contract Construct expects.`
    );
  }

  const manifest = input.supportFiles?.get("package.json");
  if (!manifest) {
    return;
  }

  try {
    const parsed = JSON.parse(manifest) as { scripts?: { test?: unknown } };
    if (
      typeof parsed.scripts?.test === "string" &&
      /\bnode\s+--test\b/.test(parsed.scripts.test)
    ) {
      throw new Error(
        `${input.context} returned a package.json test script that uses node --test. JavaScript/TypeScript blueprints must generate a Jest-compatible test harness.`
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /must generate a Jest-compatible test harness/i.test(error.message)
    ) {
      throw error;
    }
  }
}

function looksLikeGeneratedNodeTestSuite(source: string): boolean {
  return (
    /\bfrom\s+["']node:test["']/.test(source) ||
    /\brequire\(\s*["']node:test["']\s*\)/.test(source)
  );
}

function validateNoGeneratedPathOverlap(
  leftPaths: Set<string>,
  rightPaths: Set<string>,
  leftLabel: string,
  rightLabel: string,
  context: string
): void {
  const overlappingPaths = [...leftPaths].filter((filePath) => rightPaths.has(filePath));

  if (overlappingPaths.length > 0) {
    throw new Error(
      `${context} returned overlapping paths in ${leftLabel} and ${rightLabel}: ${overlappingPaths.join(", ")}.`
    );
  }
}

function validateGeneratedStepReferences(
  steps: GeneratedBlueprintBundleDraft["steps"] | GeneratedFrontierDraft["steps"],
  learnerFiles: Map<string, string>,
  hiddenTestPaths: Set<string>,
  context: string
): void {
  for (const step of steps) {
    const anchorFile = normalizePathValue(step.anchor.file);
    const anchorContent = learnerFiles.get(anchorFile);

    if (anchorContent === undefined) {
      throw new Error(
        `${context} step ${step.id} anchors ${anchorFile}, but that file is missing from learnerFiles.`
      );
    }

    if (!anchorContent.includes(step.anchor.marker)) {
      throw new Error(
        `${context} step ${step.id} anchor marker ${step.anchor.marker} is missing from learner file ${anchorFile}.`
      );
    }

    for (const testPath of step.tests.map((value) => normalizePathValue(value))) {
      if (!hiddenTestPaths.has(testPath)) {
        throw new Error(
          `${context} step ${step.id} references missing hidden test ${testPath}.`
        );
      }
    }
  }
}

const LEARNER_TASK_GAP_PATTERNS = [
  /\bTASK\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bNotImplemented(?:Error)?\b/i,
  /throw new Error\((["'`])Implement/i,
  /throw new Error\((["'`])TODO/i,
  /\btodo!\s*\(/i,
  /\bunimplemented!\s*\(/i
];

function validateGeneratedLearnerExerciseSeparation(input: {
  learnerFiles: Map<string, string>;
  steps: GeneratedBlueprintBundleDraft["steps"] | GeneratedFrontierDraft["steps"];
  context: string;
  canonicalFiles?: Map<string, string>;
}): void {
  const validatedFiles = new Set<string>();

  for (const step of input.steps) {
    const anchorFile = normalizePathValue(step.anchor.file);
    if (validatedFiles.has(anchorFile)) {
      continue;
    }
    validatedFiles.add(anchorFile);

    const learnerContent = input.learnerFiles.get(anchorFile);
    if (learnerContent === undefined) {
      continue;
    }

    const canonicalContent = input.canonicalFiles?.get(anchorFile);
    if (
      canonicalContent !== undefined &&
      normalizeGeneratedSourceForComparison(learnerContent)
        === normalizeGeneratedSourceForComparison(canonicalContent)
    ) {
      throw new Error(
        `${input.context} learnerFiles file ${anchorFile} already matches the canonical implementation.`
      );
    }

    if (!containsLearnerTaskGap(learnerContent, step.anchor.marker)) {
      throw new Error(
        `${input.context} learnerFiles file ${anchorFile} does not expose a learner-visible task gap near ${step.anchor.marker}.`
      );
    }
  }
}

function containsLearnerTaskGap(content: string, marker: string): boolean {
  const normalizedMarker = marker.trim();

  if (LEARNER_TASK_GAP_PATTERNS.some((pattern) => pattern.test(normalizedMarker))) {
    return true;
  }

  return LEARNER_TASK_GAP_PATTERNS.some((pattern) => pattern.test(content));
}

function normalizeGeneratedSourceForComparison(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function validateGeneratedHiddenTest(
  hiddenTest: { path: string; content: string },
  context: string
): void {
  const normalizedPath = normalizePathValue(hiddenTest.path);
  const trimmedContent = hiddenTest.content.trim();

  if (looksLikePlaceholderHiddenTest(trimmedContent)) {
    throw new Error(
      `${context} returned placeholder hidden test content for ${normalizedPath}. Hidden tests must contain real runnable validations.`
    );
  }

  if (!normalizedPath.endsWith(".js")) {
    return;
  }

  try {
    new Script(hiddenTest.content, {
      filename: normalizedPath
    });
  } catch (error) {
    throw new Error(
      `${context} returned invalid JavaScript for hidden test ${normalizedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function validateGeneratedSourceSyntax(
  file: { path: string; content: string },
  group: "supportFiles" | "canonicalFiles" | "learnerFiles",
  context: string
): void {
  const normalizedPath = normalizePathValue(file.path);
  const scriptKind = getGeneratedSourceScriptKind(normalizedPath);

  if (scriptKind === null) {
    return;
  }

  const sourceFile = ts.createSourceFile(
    normalizedPath,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const syntaxError = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  if (!syntaxError) {
    return;
  }

  throw new Error(
    `${context} returned invalid source syntax for ${group} file ${normalizedPath}: ${ts.flattenDiagnosticMessageText(
      syntaxError.messageText,
      "\n"
    )}`
  );
}

function getGeneratedSourceScriptKind(normalizedPath: string): ts.ScriptKind | null {
  if (normalizedPath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (
    normalizedPath.endsWith(".ts") ||
    normalizedPath.endsWith(".mts") ||
    normalizedPath.endsWith(".cts") ||
    normalizedPath.endsWith(".d.ts")
  ) {
    return ts.ScriptKind.TS;
  }

  if (normalizedPath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".mjs") ||
    normalizedPath.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }

  return null;
}

function looksLikePlaceholderHiddenTest(content: string): boolean {
  const normalizedContent = content.trim().toLowerCase();

  if (normalizedContent === ".placeholder" || normalizedContent === "placeholder") {
    return true;
  }

  return /^(?:\/\/|#|\/\*)\s*placeholder\b/.test(normalizedContent);
}

function looksLikePlaceholderGeneratedArtifact(pathValue: string, content: string): boolean {
  const normalizedContent = content.trim().toLowerCase();

  if (normalizedContent === ".placeholder" || normalizedContent === "placeholder") {
    return true;
  }

  if (/\.(md|mdx|txt)$/i.test(pathValue)) {
    return false;
  }

  if (/placeholder draft/i.test(content)) {
    return true;
  }

  if (/final version lives in canonicalfiles/i.test(normalizedContent)) {
    return true;
  }

  return /^(?:\/\/|#|\/\*)\s*(?:placeholder|stub|replace me)\b/im.test(content);
}

function normalizeGeneratedBlueprintSteps(
  steps: GeneratedBlueprintBundleDraft["steps"]
): ProjectBlueprint["steps"] {
  return steps.map((step) =>
    BlueprintStepSchema.parse({
      ...step,
      lessonSlides: normalizeGeneratedLessonSlides(step.lessonSlides, step.doc),
      anchor: {
        file: step.anchor.file,
        marker: step.anchor.marker,
        ...(step.anchor.startLine === null ? {} : { startLine: step.anchor.startLine }),
        ...(step.anchor.endLine === null ? {} : { endLine: step.anchor.endLine })
      },
      checks: normalizeGeneratedChecks(step.checks)
    })
  );
}

function annotateGeneratedBlueprintSteps(input: {
  steps: ProjectBlueprint["steps"];
  plan: GeneratedProjectPlan;
  entrypoint: string | null;
}): ProjectBlueprint["steps"] {
  return input.steps.map((step, index) => {
    const plannedStep = input.plan.steps.find((candidate) => candidate.id === step.id)
      ?? input.plan.steps[index]
      ?? null;
    const commitId = plannedStep ? toStableCommitId(plannedStep.id) : null;
    const milestoneId = plannedStep ? toStableMilestoneId(plannedStep.id) : null;
    const visibleFiles = uniquePaths([
      step.anchor.file,
      ...(plannedStep?.suggestedFiles ?? [])
    ]);

    return BlueprintStepSchema.parse({
      ...step,
      capabilityId: plannedStep?.id ?? null,
      milestoneId,
      commitId,
      explanationSlides: step.explanationSlides.length > 0 ? step.explanationSlides : step.lessonSlides,
      lessonSlides: step.lessonSlides.length > 0 ? step.lessonSlides : step.explanationSlides,
      visibleFiles,
      maskedRegions: [
        {
          anchor: step.anchor,
          strategy: "todo-stub",
          intent: step.summary,
          learnerVisible: true
        }
      ],
      preview: buildProjectPreview(
        step.title,
        plannedStep?.validationFocus?.[0] ?? step.summary,
        input.entrypoint
      )
    });
  });
}

function buildStableSpine(input: {
  plan: GeneratedProjectPlan;
  draft: GeneratedBlueprintBundleDraft;
}): NonNullable<ProjectBlueprint["spine"]> {
  const draftStepMap = new Map(input.draft.steps.map((step) => [step.id, step] as const));
  const capabilityIds = input.plan.steps.map((step) => step.id);
  const milestoneSteps =
    input.plan.steps.filter((step) => step.kind === "implementation").length > 0
      ? input.plan.steps.filter((step) => step.kind === "implementation")
      : input.plan.steps;

  return {
    finalEntrypoints: input.draft.entrypoints,
    capabilities: input.plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      summary: step.objective,
      rationale: step.rationale,
      dependsOn: step.dependsOn,
      concepts: step.concepts,
      visibleOutcome: step.validationFocus[0] ?? step.objective
    })),
    milestones: milestoneSteps.map((step) => ({
      id: toStableMilestoneId(step.id),
      title: step.title,
      summary: step.objective,
      visibleOutcome: step.validationFocus[0] ?? step.objective,
      capabilityIds: [step.id],
      preview: buildProjectPreview(step.title, step.validationFocus[0] ?? step.objective, input.draft.entrypoints[0] ?? null)
    })),
    commitGraph: input.plan.steps.map((step) => {
      const draftStep = draftStepMap.get(step.id) ?? null;

      return {
        id: toStableCommitId(step.id),
        title: step.title,
        summary: step.objective,
        commitMessage: `feat: ${step.title}`,
        capabilityIds: [step.id],
        milestoneId: milestoneSteps.some((candidate) => candidate.id === step.id)
          ? toStableMilestoneId(step.id)
          : null,
        dependsOn: step.dependsOn.map(toStableCommitId),
        visibleFiles: uniquePaths([
          ...(step.suggestedFiles ?? []),
          ...(draftStep ? [draftStep.anchor.file] : [])
        ]),
        maskedRegions: draftStep
          ? [
              {
                anchor: {
                  file: draftStep.anchor.file,
                  marker: draftStep.anchor.marker,
                  ...(draftStep.anchor.startLine === null
                    ? {}
                    : { startLine: draftStep.anchor.startLine }),
                  ...(draftStep.anchor.endLine === null
                    ? {}
                    : { endLine: draftStep.anchor.endLine })
                },
                strategy: "todo-stub" as const,
                intent: draftStep.summary,
                learnerVisible: true
              }
            ]
          : [],
        visibleOutcome: step.validationFocus[0] ?? step.objective,
        runnable: true,
        preview: buildProjectPreview(step.title, step.validationFocus[0] ?? step.objective, input.draft.entrypoints[0] ?? null)
      };
    }),
    routes: [
      {
        id: "route.recommended",
        title: "Recommended build path",
        summary: input.plan.summary,
        rationale: "Derived from the capability dependency order and the learner knowledge graph.",
        commitIds: input.plan.steps.map((step) => toStableCommitId(step.id)),
        capabilityIds,
        personalizedFor: input.plan.knowledgeGraph.gaps.slice(0, 6)
      }
    ],
    activeRouteId: "route.recommended",
    activeCommitId: input.plan.steps[0] ? toStableCommitId(input.plan.steps[0].id) : null,
    alwaysVisibleFiles: uniquePaths([
      ...input.draft.supportFiles.map((file) => file.path),
      ...input.draft.entrypoints
    ])
  };
}

function buildAdaptiveFrontier(input: {
  steps: ProjectBlueprint["steps"];
  spine: NonNullable<ProjectBlueprint["spine"]>;
  generatedAt: string;
  diagnostics?: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"];
  intervention?: NonNullable<ProjectBlueprint["frontier"]>["intervention"];
  activeStepId?: string | null;
}): NonNullable<ProjectBlueprint["frontier"]> {
  const resolvedFrontierSteps = input.steps.slice(0, 3);
  const requestedActiveStep = input.activeStepId
    ? resolvedFrontierSteps.find((step) => step.id === input.activeStepId) ?? null
    : null;
  const activeStep = requestedActiveStep ?? resolvedFrontierSteps[0] ?? null;

  return {
    generatedAt: input.generatedAt,
    summary:
      resolvedFrontierSteps.length > 1
        ? `The current build frontier focuses on ${resolvedFrontierSteps.map((step) => step.title).join(", ")}.`
        : resolvedFrontierSteps.length === 1
          ? `The current build frontier focuses on ${activeStep?.title ?? "the next capability"}.`
          : "The current build frontier is clear while Construct prepares the next capability.",
    activeStepId: activeStep?.id ?? null,
    activeCommitId: activeStep?.commitId ?? input.spine.activeCommitId,
    stepIds: resolvedFrontierSteps.map((step) => step.id),
    steps: resolvedFrontierSteps,
    diagnostics: input.diagnostics ?? [],
    intervention: input.intervention ?? {
      kind: "continue-to-code",
      summary: "The next visible project slice is ready to build.",
      reason: "Construct is starting with the current capability frontier and will adapt after evaluation points."
    },
    updating: false
  };
}

function selectPlanFrontierSteps(
  plan: GeneratedProjectPlan,
  options?: {
    startStepId?: string | null;
    maxSteps?: number;
  }
): GeneratedProjectPlan["steps"] {
  if (plan.steps.length === 0) {
    return [];
  }

  const maxSteps = Math.min(Math.max(options?.maxSteps ?? 3, 1), 3);
  const requestedStartStepId = options?.startStepId ?? plan.suggestedFirstStepId;
  const requestedStartIndex = requestedStartStepId
    ? plan.steps.findIndex((step) => step.id === requestedStartStepId)
    : -1;
  const startIndex = requestedStartIndex >= 0 ? requestedStartIndex : 0;

  return plan.steps.slice(startIndex, startIndex + maxSteps);
}

function trimGeneratedBundleDraftToFrontier(
  draft: GeneratedBlueprintBundleDraft,
  frontierPlanSteps: GeneratedProjectPlan["steps"]
): GeneratedBlueprintBundleDraft {
  return normalizeGeneratedBlueprintDraft(
    filterGeneratedBundleDraftToFrontier(draft, frontierPlanSteps)
  );
}

function filterGeneratedBundleDraftToFrontier(
  draft: GeneratedBlueprintBundleDraft,
  frontierPlanSteps: GeneratedProjectPlan["steps"]
): GeneratedBlueprintBundleDraft {
  if (frontierPlanSteps.length === 0) {
    return draft;
  }

  const allowedStepIds = new Set(frontierPlanSteps.map((step) => step.id));
  const trimmedSteps = draft.steps.filter((step) => allowedStepIds.has(step.id));
  const resolvedSteps = trimmedSteps.length > 0
    ? trimmedSteps
    : draft.steps.slice(0, Math.min(draft.steps.length, frontierPlanSteps.length));
  const allowedLearnerPaths = new Set(
    uniquePaths([
      ...frontierPlanSteps.flatMap((step) => step.suggestedFiles),
      ...resolvedSteps.map((step) => step.anchor.file)
    ])
  );
  const allowedTestPaths = new Set(uniquePaths(resolvedSteps.flatMap((step) => step.tests)));
  const filteredLearnerFiles = draft.learnerFiles.filter(
    (file) => allowedLearnerPaths.size === 0 || allowedLearnerPaths.has(normalizePathValue(file.path))
  );
  const filteredHiddenTests = draft.hiddenTests.filter(
    (file) => allowedTestPaths.size === 0 || allowedTestPaths.has(normalizePathValue(file.path))
  );

  return {
    ...draft,
    learnerFiles: filteredLearnerFiles.length > 0 ? filteredLearnerFiles : draft.learnerFiles,
    hiddenTests: filteredHiddenTests.length > 0 ? filteredHiddenTests : draft.hiddenTests,
    steps: resolvedSteps
  };
}

function trimGeneratedFrontierDraftToPlan(
  draft: GeneratedFrontierDraft,
  frontierPlanSteps: GeneratedProjectPlan["steps"]
): GeneratedFrontierDraft {
  if (frontierPlanSteps.length === 0) {
    return draft;
  }

  const allowedStepIds = new Set(frontierPlanSteps.map((step) => step.id));
  const trimmedSteps = draft.steps.filter((step) => allowedStepIds.has(step.id));
  const resolvedSteps = trimmedSteps.length > 0
    ? trimmedSteps
    : draft.steps.slice(0, Math.min(draft.steps.length, frontierPlanSteps.length));
  const allowedLearnerPaths = new Set(
    uniquePaths([
      ...frontierPlanSteps.flatMap((step) => step.suggestedFiles),
      ...resolvedSteps.map((step) => step.anchor.file)
    ])
  );
  const allowedTestPaths = new Set(uniquePaths(resolvedSteps.flatMap((step) => step.tests)));
  const filteredLearnerFiles = draft.learnerFiles.filter(
    (file) => allowedLearnerPaths.size === 0 || allowedLearnerPaths.has(normalizePathValue(file.path))
  );
  const filteredHiddenTests = draft.hiddenTests.filter(
    (file) => allowedTestPaths.size === 0 || allowedTestPaths.has(normalizePathValue(file.path))
  );

  return normalizeGeneratedFrontierDraft({
    learnerFiles: filteredLearnerFiles.length > 0 ? filteredLearnerFiles : draft.learnerFiles,
    hiddenTests: filteredHiddenTests.length > 0 ? filteredHiddenTests : draft.hiddenTests,
    steps: resolvedSteps
  });
}

function mergeBlueprintStepRegistry(
  existingSteps: ProjectBlueprint["steps"],
  nextSteps: ProjectBlueprint["steps"]
): ProjectBlueprint["steps"] {
  const nextStepIds = new Set(nextSteps.map((step) => step.id));
  return [...existingSteps.filter((step) => !nextStepIds.has(step.id)), ...nextSteps];
}

function mergeFrontierDraftSteps(
  existingSteps: GeneratedBlueprintBundleDraft["steps"],
  nextSteps: GeneratedBlueprintBundleDraft["steps"]
): GeneratedBlueprintBundleDraft["steps"] {
  const nextStepIds = new Set(nextSteps.map((step) => step.id));
  return [...existingSteps.filter((step) => !nextStepIds.has(step.id)), ...nextSteps];
}

function appendAdaptiveFrontierDiagnostic(
  diagnostics: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"],
  nextDiagnostic: NonNullable<ProjectBlueprint["frontier"]>["diagnostics"][number]
): NonNullable<ProjectBlueprint["frontier"]>["diagnostics"] {
  return [...diagnostics, nextDiagnostic].slice(-12);
}

function buildProjectPreview(
  title: string,
  summary: string,
  entrypoint: string | null
): ProjectBlueprint["steps"][number]["preview"] {
  return {
    kind: "trace",
    title,
    summary,
    command: entrypoint ? `pnpm test -- ${entrypoint}` : null,
    entrypoint,
    sampleOutput: null
  };
}

function toStableCommitId(stepId: string): string {
  return `commit.${slugify(stepId)}`;
}

function toStableMilestoneId(stepId: string): string {
  return `milestone.${slugify(stepId)}`;
}

function getPlanStepIndex(plan: GeneratedProjectPlan, stepId: string): number {
  return plan.steps.findIndex((step) => step.id === stepId);
}

function resolveFrontierPlanSteps(
  plan: GeneratedProjectPlan,
  frontierSteps: ProjectBlueprint["steps"]
): GeneratedProjectPlan["steps"] {
  const stepsById = new Map(plan.steps.map((step) => [step.id, step]));
  return frontierSteps
    .map((step) => stepsById.get(step.id) ?? null)
    .filter((step): step is GeneratedProjectPlan["steps"][number] => Boolean(step));
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((pathValue) => pathValue.replaceAll("\\", "/").replace(/^\.\/+/, "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeGeneratedLessonSlides(
  lessonSlides: GeneratedBlueprintStepDraft["lessonSlides"],
  fallbackDoc: string
): ProjectBlueprint["steps"][number]["lessonSlides"] {
  return normalizeDraftLessonSlides(lessonSlides, fallbackDoc).map((slide) => ({
    blocks: slide.blocks.map((block) => {
      if (block.type === "markdown") {
        return block;
      }

      return {
        type: "check" as const,
        placement: block.placement,
        check: normalizeGeneratedChecks([block.check])[0] as ComprehensionCheck
      };
    })
  }));
}

function buildLessonAuthoringBrief(
  step: GeneratedBlueprintStepDraft,
  stepIndex: number,
  totalSteps: number
): {
  id: string;
  title: string;
  summary: string;
  stepIndex: number;
  totalSteps: number;
  concepts: string[];
  implementationTarget: {
    file: string;
    anchor: string;
    tests: string[];
  };
  teachingNeeds: {
    existingSlideCount: number;
    checkPrompts: string[];
    exerciseSummary: string;
    recommendedSlideRange: string;
    requiredCoverage: string[];
  };
} {
  const requiredCoverage = [
    "What the core concept is in plain language",
    "What the larger library/system is before any internal jargon is assumed",
    "Why this concept matters in this specific project step",
    "How the concept behaves in code or data",
    "Definitions for any named abstractions or jargon before they are reused",
    "A worked example or conceptual code sketch",
    "Common mistakes or edge cases",
    "What exact file/function/behavior the learner is about to implement",
    "How the explanation connects directly to the exercise",
    "How this concept leads into the next concept or implementation boundary in the project"
  ];

  return {
    id: step.id,
    title: step.title,
    summary: step.summary,
    stepIndex: stepIndex + 1,
    totalSteps,
    concepts: step.concepts,
    implementationTarget: {
      file: step.anchor.file,
      anchor: step.anchor.marker,
      tests: step.tests
    },
    teachingNeeds: {
      existingSlideCount: step.lessonSlides.length,
      checkPrompts: step.checks.map((check) => check.prompt),
      exerciseSummary: truncateText(step.doc, 320),
      recommendedSlideRange: stepIndex === 0 ? "4-6 substantial slides" : "2-5 substantial slides",
      requiredCoverage
    }
  };
}

function normalizeGeneratedChecks(
  checks: Array<z.infer<typeof GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA>>
): ProjectBlueprint["steps"][number]["checks"] {
  return checks.map((check) => {
    if (check.type === "mcq") {
      return {
        id: check.id,
        type: check.type,
        prompt: check.prompt,
        answer: check.answer,
        options: check.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.rationale === null ? {} : { rationale: option.rationale })
        }))
      };
    }

    const { placeholder: _placeholder, ...rest } = check;
    return {
      ...rest,
      ...(check.placeholder === null ? {} : { placeholder: check.placeholder })
    };
  });
}

function pickRecordPaths(
  record: Record<string, string>,
  relativePaths: string[]
): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const relativePath of uniquePaths(relativePaths)) {
    const value = record[relativePath];
    if (typeof value === "string") {
      picked[relativePath] = value;
    }
  }

  return picked;
}

function recordToFileEntries(record: Record<string, string>): Array<{ path: string; content: string }> {
  return Object.entries(record).map(([filePath, content]) => ({
    path: filePath,
    content
  }));
}

function normalizePathValue(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

function replaceBlueprintStep(
  blueprint: ProjectBlueprint,
  step: ProjectBlueprint["steps"][number]
): ProjectBlueprint {
  return ProjectBlueprintSchema.parse({
    ...blueprint,
    steps: blueprint.steps.map((currentStep) =>
      currentStep.id === step.id ? step : currentStep
    ),
    frontier: blueprint.frontier
      ? {
          ...blueprint.frontier,
          activeStepId:
            blueprint.frontier.activeStepId === step.id
              ? step.id
              : blueprint.frontier.activeStepId,
          steps: blueprint.frontier.steps.map((currentStep) =>
            currentStep.id === step.id ? step : currentStep
          )
        }
      : null
  });
}

function getExistingLessonSlides(
  step: ProjectBlueprint["steps"][number]
): ProjectBlueprint["steps"][number]["lessonSlides"] {
  return step.lessonSlides.length > 0
    ? step.lessonSlides
    : [
        {
          blocks: [
            {
              type: "markdown",
              markdown: step.doc
            }
          ]
        }
      ];
}

function createBlueprintBuildRecord(input: Partial<BlueprintBuild> & {
  id: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
}): BlueprintBuild {
  return {
    id: input.id,
    sessionId: input.sessionId ?? null,
    userId: input.userId ?? getCurrentUserId(),
    goal: input.goal,
    detectedLanguage: input.detectedLanguage ?? null,
    detectedDomain: input.detectedDomain ?? null,
    status: input.status ?? "queued",
    currentStage: input.currentStage ?? null,
    currentStageTitle: input.currentStageTitle ?? null,
    currentStageStatus: input.currentStageStatus ?? null,
    lastError: input.lastError ?? null,
    langSmithProject: input.langSmithProject ?? resolveLangSmithProjectName(),
    traceUrl: input.traceUrl ?? null,
    planningSession: input.planningSession ?? null,
    answers: input.answers ?? [],
    plan: input.plan ?? null,
    blueprint: input.blueprint ?? null,
    blueprintDraft: input.blueprintDraft ?? null,
    supportFiles: input.supportFiles ?? [],
    canonicalFiles: input.canonicalFiles ?? [],
    learnerFiles: input.learnerFiles ?? [],
    hiddenTests: input.hiddenTests ?? [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    completedAt: input.completedAt ?? null,
    lastEventAt: input.lastEventAt ?? null
  };
}

function cloneJsonCompatible<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function stripStageStreamSuffix(stage: string): string {
  return stage.replace(/-stream$/, "");
}

function resolveLangSmithProjectName(): string | null {
  if (!isLangSmithEnabled()) {
    return null;
  }

  return (
    process.env.CONSTRUCT_LANGSMITH_PROJECT?.trim() ||
    process.env.LANGSMITH_PROJECT?.trim() ||
    process.env.LANGCHAIN_PROJECT?.trim() ||
    "construct-project-creation"
  );
}

function isLangSmithEnabled(): boolean {
  const tracingFlag =
    process.env.CONSTRUCT_LANGSMITH_ENABLED?.trim() ||
    process.env.LANGSMITH_TRACING?.trim() ||
    process.env.LANGCHAIN_TRACING_V2?.trim() ||
    "";
  const apiKey =
    process.env.LANGSMITH_API_KEY?.trim() ||
    process.env.LANGCHAIN_API_KEY?.trim() ||
    "";

  return Boolean(apiKey) && /^(1|true|yes|on)$/i.test(tracingFlag);
}

function toBlueprintArtifactFiles(
  files: Array<{ path: string; content: string }>,
  group: BlueprintBuild["supportFiles"][number]["group"]
): BlueprintBuild["supportFiles"] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    group
  }));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferGoalScopeFallback(goal: string): GoalScope {
  const normalized = goal.trim().toLowerCase();
  const smallScopeHints = [
    "small",
    "simple",
    "tiny",
    "basic",
    "minimal",
    "class",
    "single class",
    "single file",
    "module",
    "function"
  ];
  const complexScopeHints = [
    "compiler",
    "database",
    "distributed",
    "multi-agent",
    "ide",
    "operating system",
    "interpreter",
    "framework",
    "backend",
    "frontend",
    "full stack",
    "web app",
    "desktop app"
  ];

  const mentionsSmallScope = smallScopeHints.some((hint) => normalized.includes(hint));
  const mentionsComplexScope = complexScopeHints.some((hint) => normalized.includes(hint));
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (mentionsSmallScope && !mentionsComplexScope && wordCount <= 8) {
    return {
      scopeSummary: "Very small local artifact",
      artifactShape: normalized.includes("class") ? "class" : "module",
      complexityScore: 12,
      shouldResearch: false,
      recommendedQuestionCount: 2,
      recommendedMinSteps: 1,
      recommendedMaxSteps: 2,
      rationale: "The fallback scope check detected an explicitly small local request, so broad research should be skipped."
    };
  }

  if (mentionsComplexScope || wordCount >= 10) {
    return {
      scopeSummary: "Large multi-part project",
      artifactShape: "system",
      complexityScore: 82,
      shouldResearch: true,
      recommendedQuestionCount: 6,
      recommendedMinSteps: 5,
      recommendedMaxSteps: 10,
      rationale: "The fallback scope check detected a larger systems-style request, so full research is warranted."
    };
  }

  return {
    scopeSummary: "Normal project-sized request",
    artifactShape: normalized.includes("class") ? "class" : "app",
    complexityScore: 45,
    shouldResearch: true,
    recommendedQuestionCount: 4,
    recommendedMinSteps: 3,
    recommendedMaxSteps: 6,
    rationale: "The fallback scope check treated this as a normal project-sized request."
  };
}

function buildGoalScopeInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Decide how large the requested project should be before planning or research begins.",
    "Do not force the request into canned scope labels. Describe the scope in your own words using scopeSummary and artifactShape.",
    "artifactShape should be your own concise description of the primary artifact to build, such as 'todo class', 'single module', 'cli app', or 'compiler pipeline'.",
    "complexityScore is a 0-100 estimate of how large and multi-part the project really is.",
    "shouldResearch should be false only when broad web research would clearly be wasteful for this specific request.",
    "recommendedQuestionCount should be the minimum number of intake questions needed to personalize the path.",
    "recommendedMinSteps and recommendedMaxSteps should define the step budget the Architect should aim for.",
    "Be conservative with scope expansion. If the user asks for something small, keep it small unless the request itself requires more."
  ].join("\n");
}

function buildQuestionGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Your job is to prepare the intake phase for a serious local AI developer IDE.",
    "Given a project goal, prior stored learner knowledge, and optional lightweight web research, generate project-tailoring intake questions.",
    "priorKnowledge is a recursive concept graph. Parent topics roll up from child subtopics, so inspect the deepest relevant concepts before deciding what to ask.",
    "These are tailoring questions, not assessment questions and not quiz questions.",
    "Ask only the minimum questions needed to personalize the build path.",
    "The learner should feel like they are helping the Architect tune scope, pacing, depth, and support style for this exact project.",
    "Never ask the learner to recall the correct syntax, API, command, definition, keyword, or utility type name.",
    "Never write a question with a single objectively correct technical answer.",
    "Do not ask textbook questions like 'Which X does Y?' or 'What command creates Z?'.",
    "Instead ask which statement best matches their real experience, preference, likely blocker, desired support level, or where they want the Architect to slow down.",
    "Good questions often start with phrases like 'Which statement best matches...', 'What would help most when...', or 'Where should Construct go deeper while you build...'.",
    "For every question, generate exactly 3 answer options. Options should be specific to the question and written as first-person self-descriptions, not factual answer choices.",
    "Each option must include a confidenceSignal of comfortable, shaky, or new so Construct can normalize the answer without losing the richer user-facing wording.",
    "Do not generate a custom-answer option in the schema. The UI always provides a fourth freeform answer path separately.",
    "Detected language and domain must match the target project.",
    "Favor prerequisite concepts, likely blockers, workflow preferences, and depth decisions that actually affect implementation order or how much explanation the learner needs.",
    "Use goalScope.recommendedQuestionCount as the target number of questions.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how local or broad the intake should be.",
    "Do not ask about concepts that are already clearly comfortable in the prior knowledge base unless the new goal materially changes their meaning.",
    "If you need to ask about a concept like TypeScript utility types, ask about lived usage and desired support, for example: 'Which statement best matches your current experience using utility types like Partial<T> when shaping update payloads in real code?'"
  ].join("\n");
}

function buildGoalSelfReportExtractionInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Extract only explicit learner self-report signals from the raw project prompt.",
    "This is not a general project analysis pass. Do not infer skill from the requested project alone.",
    "Only capture knowledge signals the learner directly stated or strongly implied about themselves, such as being new to Rust, being comfortable with DFA/NFA, wanting more syntax hand-holding, or preferring larger problem-solving over small drills.",
    "If the prompt contains no explicit learner self-report, return an empty signals array.",
    "Each signal must target the most relevant concept or subtopic path possible, using dot-separated conceptId values such as rust, rust.ownership, compilers.lexing.dfa, or workflow.hand_holding.",
    "Use nested subtopics when the user statement is specific enough. Do not flatten everything to the top-level topic.",
    "label should be the human-readable concept name for the leaf node.",
    "labelPath should include the human-readable labels from the top-level concept to the leaf concept when you can determine them cleanly.",
    "score is a 0-100 mastery estimate based only on the learner's self-report.",
    "Low scores should be used for statements like 'very new', 'beginner', or 'never used'. High scores should be used only for explicit comfort or repeated experience.",
    "category must be one of language, domain, or workflow.",
    "rationale should quote or precisely summarize the self-report evidence from the prompt.",
    "Never create signals for project requirements, tooling names, or concepts the learner did not describe about themselves."
  ].join("\n");
}

function buildPlanGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Generate the stable spine for a serious developer IDE that teaches through real system construction.",
    "The learner will build the real project in-place, so every step must contribute to the final system.",
    "Think in terms of capabilities, milestones, staged commits, and dependency-aware visible outcomes.",
    "Do not assume the future frontier will stay static forever. The near-term route may adapt after evaluation points.",
    "priorKnowledge is a recursive learner graph with nested concepts and sub-concepts. Use the deepest relevant weak or strong nodes, not just the top-level topic names.",
    "Use the learner's answers and prior knowledge to change step order, not just explanations.",
    "The answers payload includes the original question, the available options, and either a selected option or a custom freeform learner response. Use that full context rather than treating answers as generic scores.",
    "Architecture components must reflect true dependency order.",
    "Each step must include concrete validation focus, implementation notes, quiz focus, and hidden validation focus.",
    "Prefer steps that unlock later modules and make the dependency chain explicit.",
    "If the learner is weak in a prerequisite concept, insert a skill step immediately before the implementation step that needs it.",
    "Keep the total number of steps within goalScope.recommendedMinSteps and goalScope.recommendedMaxSteps.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how narrow or broad the plan should be.",
    "The first step should usually teach and implement the first real code behavior or design decision in the artifact.",
    "Do not spend the first step on environment setup, dependency installation, version pinning, package metadata, or generic scaffolding unless the user's goal explicitly asks to learn setup/tooling.",
    "For small or local requests, keep the path tightly focused on the requested artifact. Do not inflate it with validation harness steps, environment validation steps, packaging steps, optional export steps, or side quests unless the user explicitly asked for those.",
    "Do not create standalone quiz-only, checks-only, or validation-only steps. Checks belong inside the teaching step they validate.",
    "Do not produce toy exercises disconnected from the project.",
    "Suggested first step must reference one of the generated steps."
  ].join("\n");
}

function buildBlueprintGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Generate a real project blueprint for the learner to implement in-place.",
    "Construct now follows a stable spine plus adaptive frontier architecture.",
    "The canonical final project must stay coherent, but only the next 1-3 visible steps should carry the deepest authored detail.",
    "The prompt includes planSpine for the full long-range dependency order and frontierPlanSteps for the only steps that should be deeply authored right now.",
    "priorKnowledge is a recursive learner graph. Use the most relevant subtopics to decide how much to explain, which examples to choose, and where the learner will need hand-holding.",
    "Return a runnable canonical project split into supportFiles, canonicalFiles, learnerFiles, and hiddenTests.",
    "Each of those file groups must be an array of objects shaped exactly like { path, content }.",
    "supportFiles are unmasked project files such as package.json, pyproject.toml, tsconfig, helper modules, and fixed runtime scaffolding.",
    "canonicalFiles are the solved versions of the learner-owned implementation files.",
    "learnerFiles must only cover the current frontierPlanSteps and must correspond to the same file paths as the canonical implementation for those frontier capabilities, but with focused TASK markers and incomplete implementations the learner must fill in.",
    "Every learnerFile must be visibly incomplete at the anchored task region. The learner should need to edit code before the hidden test for that step can pass.",
    "Do not return learnerFiles that already match canonicalFiles, already satisfy the hidden validation, or merely restate the solved implementation with a passive comment.",
    "Use an explicit unfinished task affordance at each anchor such as TASK/TODO markers with a failing stub, NotImplemented error, todo!(), unimplemented!(), or an equivalent language-appropriate unfinished implementation.",
    "supportFiles, canonicalFiles, and learnerFiles must not contain placeholder bodies, placeholder comments, placeholder drafts, 'final version lives elsewhere' stubs, or comment-only skeletons.",
    "If any returned supportFiles, canonicalFiles, or learnerFiles path ends in .ts, .tsx, .js, .jsx, .mts, .cts, .mjs, or .cjs, return syntactically valid source code immediately.",
    "hiddenTests must only cover the current frontierPlanSteps and stay runnable without exposing full solutions in the learnerFiles.",
    "hiddenTests must never contain placeholder bodies, placeholder comments, sentinel strings like `.placeholder`, or comment-only stubs.",
    "If a hidden test path ends in `.js`, return valid runnable JavaScript immediately.",
    "For JavaScript and TypeScript blueprints, hiddenTests must use Jest-style tests. Do not import from `node:test`, do not use Node's built-in test runner, and do not set package.json scripts.test to `node --test`.",
    "Every .json file in any returned file group must be parseable JSON.",
    "Every step anchor.file must exist in learnerFiles, every step anchor.marker must appear literally inside that learner file, every step test path must exist in hiddenTests, and every entrypoint must exist in supportFiles, canonicalFiles, or learnerFiles.",
    "The answers payload includes the original question, the available options, and either a selected option or a custom freeform learner response. Use that context to tune scope, docs, checks, and task ordering.",
    "Every returned step must point to a real learnerFile anchor in the current frontier and include lessonSlides, doc text, comprehension checks, constraints, and targeted tests.",
    "Do not deeply author every future step in the spine. Only the frontierPlanSteps should come back as learnerFiles, hiddenTests, and steps.",
    "lessonSlides are the main teaching surface. Each slide must be an object with a blocks array.",
    "A markdown block looks like { type: 'markdown', markdown: '...' }.",
    "An inline question block looks like { type: 'check', placement: 'inline' | 'end', check: <same comprehension check shape> }.",
    "Use inline check blocks only when the learner would benefit from answering a question inside the lesson itself before moving on. Inline checks add to the teaching flow; they do not replace the normal checks array.",
    "Teach the required concept from the learner's current level so they can actually solve the task afterward. Use rich markdown prose, bullet lists, ordered lists, blockquotes, horizontal rules, tables when useful, and fenced code snippets when helpful.",
    "lessonSlides should teach the concept in markdown before the task begins. Emit each slide as its own array entry. Do not collapse multiple slides into one string.",
    "Each slide should usually teach one primary concept or one tightly related concept cluster. The next slide should move to the next concept the learner needs for the project.",
    "The first step must open with at least four real teaching slides unless the user explicitly asked for setup/tooling rather than implementation.",
    "When the project is building a framework, library, runtime, parser, renderer, or other system with internal jargon, start by teaching what the overall system is in plain language before diving into names like VNode, AST, reconciler, reducer, hook, parser, or renderer internals.",
    "Do not assume the learner already understands technical words that appear in the step title, summary, doc, or code sketch. If you use a term like VNode, virtual DOM, reconciler, token, AST, reducer, or hook, define it clearly before you rely on it.",
    "For the first meaningful step, use a beginner-friendly sequence: first the big picture of what the system is, then why this concept exists, then how it works at a high level, then the deeper internal term(s), then what exact file/function/behavior the learner will implement next.",
    "The last one or two lesson slides before the exercise should make the implementation handoff obvious: name the file or anchor, explain what behavior the learner is about to build, and connect that code task back to the concept they just learned.",
    "Do not treat a slide like a presenter note or splash card. A slide should feel like a real docs page section that teaches a concept thoroughly enough for the learner to use it in the exercise.",
    "The first step should teach and implement the first meaningful code behavior or design decision, not environment setup or package scaffolding.",
    "Do not generate a first step about pinning versions, creating a venv, installing test tools, package metadata, or generic project layout unless the user's goal explicitly asks for that.",
    "lessonSlides must explain the why and how of the concept. They should not mainly say what the learner has to do next.",
    "Do not write slides like task instructions, setup checklists, TODO lists, or short reminders. The lesson should feel like a real explanation that teaches the idea itself.",
    "Do not start slides with 'Step 1', 'Step 2', or by repeating the step title as a markdown heading. The UI already shows course and step context.",
    "Avoid giant title-only slides. Prefer explanation-rich markdown that reads like technical documentation or a high-quality lesson chapter.",
    "Each slide should usually be substantial, not tiny. For non-trivial steps, most slides should feel like a docs section: multiple paragraphs plus at least one concrete structure such as a list, example, code sketch, comparison table, or callout.",
    "Most slides should include at least two markdown subheadings such as `## Why this matters`, `## How it works`, `## Example`, `## Common mistakes`, or `## How this helps in the exercise`.",
    "For the first step and for any brand-new concept, it is usually better to generate 4-6 substantial markdown slides than 1-2 shallow ones.",
    "When a concept is new or foundational, a single slide should often contain roughly 180-350 words of explanation unless the concept is genuinely small.",
    "If a slide is only one short paragraph, it is almost certainly too shallow. Expand it into a real explanation with multiple sections.",
    "Explain the mental model, the important APIs or language features involved, the invariants/constraints, common mistakes, and the exact behavior the later exercise will require.",
    "Whenever a concept will matter in code, include a worked example or conceptual code fence that shows the idea in action without dumping the full final solution.",
    "Close most slides by connecting the concept back to the upcoming task so the learner understands how the explanation will help them implement.",
    "Use code fences for conceptual sketches and worked examples when helpful, but do not dump the full solution into the lesson.",
    "Do not make slides read like flash cards, presenter notes, or splash screens. They should read like polished technical documentation written to teach, not to decorate.",
    "The learner should be able to read the slides alone and understand why the implementation is structured the way it is before reaching the task.",
    "A one-paragraph summary is not a lesson. Do not move to checks after a summary slide. The lesson must first establish the concept in enough depth that a beginner could explain it back.",
    "Before you create any comprehension check, make sure the lessonSlides have already explicitly taught every fact, API, language feature, and design reason that the check will ask about.",
    "Do not ask a check about a concept that was not clearly explained in the lessonSlides. For example, do not ask about a Python __main__ guard unless the slides explicitly teach import-time safety, script entrypoints, and why the guard exists.",
    "Checks should confirm understanding of the explanation, not assess unrelated recall. If a check could feel like an interview question or trivia question, rewrite either the lesson or the check.",
    "The first step should usually have only 1-2 checks, and they should directly follow from the lesson content. Prefer fewer, better-grounded checks over many shallow ones.",
    "If the learner is being taught a new capability, the slides should normally cover: what the concept is, why it matters in this project, a worked example, common mistakes, and how it maps to the upcoming exercise.",
    "If the request is something like 'build React from scratch', the first teaching slides should not begin at an unexplained internal abstraction. Start with what React-like rendering is for, what problem it solves, and only then unpack internal data structures like a VNode.",
    "Do not teach generic language fundamentals in the abstract. Tie every explanation back to the exact requested project and the current implementation boundary.",
    "If the project is something like a Rust SWC-style compiler pipeline, teach Rust concepts only insofar as they matter for parser data structures, ownership in ASTs, transformations, code generation, or interop for that exact project.",
    "Every slide should make the project connection obvious. A learner should be able to answer 'why am I learning this for this project right now?' after reading any slide.",
    "The slides inside a step should have smooth continuity. Each slide should clearly set up the next concept the learner needs, rather than feeling like random disconnected notes.",
    "The exercise handoff should feel like the natural next move after the lesson, not a disconnected coding task.",
    "For small or local requests, stay tightly scoped. Do not invent setup-heavy preliminaries, validation harness units, optional export features, platform checks, or packaging tasks before the first meaningful implementation step unless the user explicitly asked for them.",
    "doc should describe the exercise or implementation task itself, not repeat the whole concept lesson. It must clearly say what code the learner will change, what behavior the tests will verify, and how the task connects to the just-taught concept.",
    "The exercise should be solvable from the lessonSlides and checks that come before it. The quiz must be grounded in the lessonSlides, not random setup trivia or command memorization.",
    "Do not create a separate checks-only or quiz-only step. Keep slides, checks, and task together inside the same step.",
    "Every generated step should feel like part of a coherent build path: context first, then checks that follow from the explanation, then a real code task that directly uses what was just taught.",
    "Prioritize the first 1-3 steps for depth, precision, and visible output. Later steps can stay lighter as long as the dependency order stays coherent.",
    "Keep the implementation inside the step budget defined by goalScope.recommendedMinSteps and goalScope.recommendedMaxSteps.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how small or broad the generated project should be.",
    "Choose build order from true project dependencies and the learner profile, not a generic tutorial order.",
    "For TypeScript and JavaScript projects, generate Jest tests and the minimum package/tooling files required to run them.",
    "Do not emit placeholder prose instead of code. Return concrete file contents."
  ].join("\n");
}

function buildBlueprintRepairInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Repair a previously generated project blueprint draft without restarting the whole project design.",
    "You will receive previousDraft plus validationFailure describing exactly why the saved draft was rejected.",
    "Keep the same project goal, step order, teaching intent, and visible frontier unless the validationFailure makes a local rewrite necessary.",
    "Return the full corrected blueprint bundle again as supportFiles, canonicalFiles, learnerFiles, hiddenTests, steps, entrypoints, dependencyGraph, and tags.",
    "Resolve every validationFailure completely. Do not repeat the broken file separation, duplicate paths, invalid JSON, invalid source syntax, missing anchors, or missing hidden test references.",
    "supportFiles, canonicalFiles, learnerFiles, and hiddenTests must each contain unique paths, and the groups must not overlap.",
    "Every learnerFile must still have a matching canonicalFile for the same path.",
    "For JavaScript and TypeScript blueprints, repair the bundle back to a Jest-compatible test harness. Do not return `node:test` imports or `node --test` scripts.",
    "Every learnerFile must stay visibly incomplete at the anchor. Do not repair the draft by handing the learner the finished implementation.",
    "Do not return learnerFiles that already match canonicalFiles or that would already pass the step hidden test without learner edits.",
    "Keep explicit unfinished task affordances at the anchor such as TASK/TODO markers with a failing stub, NotImplemented error, todo!(), unimplemented!(), or an equivalent language-appropriate unfinished implementation.",
    "Every step anchor.file must exist in learnerFiles, every step anchor.marker must appear literally inside that learner file, every step test path must exist in hiddenTests, and every entrypoint must exist in supportFiles, canonicalFiles, or learnerFiles.",
    "Any file whose path ends in .json must contain strict parseable JSON only. Do not include comments, markdown fences, trailing prose, placeholder markers, or JavaScript object literal syntax.",
    "When validationFailure mentions invalid JSON, rewrite the entire offending JSON file so it parses cleanly with JSON.parse on the first attempt.",
    "If a previous file is already valid, preserve its intent instead of rewriting it gratuitously.",
    "Do not emit placeholder prose instead of code. Return concrete, runnable file contents and valid JSON only."
  ].join("\n");
}

function buildBlueprintFilePatchRepairInstructions(): string {
  return [
    "You are Construct's Architect repair agent.",
    "Repair only the file or files named in repairTarget.",
    "Return only the corrected file contents in the matching supportFiles, canonicalFiles, learnerFiles, or hiddenTests arrays.",
    "Leave every untouched file group as an empty array.",
    "Do not rename files, add extra files, delete files, or rewrite unrelated paths.",
    "Preserve the existing project goal, step order, teaching intent, and learner-visible task structure.",
    "If the failing file is a learnerFile, keep the learner task gap and anchor intact.",
    "If the failing file is a canonicalFile or supportFile, make it fully valid and runnable for its role.",
    "If the failing file ends in .json, return strict parseable JSON only with no comments, trailing prose, or fences.",
    "If the failing file is JavaScript or TypeScript, return syntactically valid source code immediately.",
    "Do not emit markdown fences or commentary. Return concrete file contents only."
  ].join("\n");
}

function buildAdaptiveFrontierUpdateDecisionInstructions(): string {
  return [
    "You are Construct's fast adaptation triage agent.",
    "Decide whether the latest learner signal requires an immediate adaptive-frontier rewrite, or whether Construct should only record the evidence and keep the current path.",
    "Prefer keep-path for a single isolated quiz or written-answer signal when the current frontier and upcoming steps still fit the learner.",
    "Choose refresh-current-frontier only when the visible current step or near-term support level should change right now.",
    "Choose advance-frontier only when a cleared code milestone should immediately unlock and reshape the next visible steps.",
    "Use the exact learner interaction, recentCapabilityEvidence, currentFrontier, and upcomingPlanSteps together.",
    "If the signal should mainly influence later decisions instead of the current visible path, keep the path and record the evidence now.",
    "reason should explain the architectural teaching consequence of the decision.",
    "detail should be a short user-facing sentence in plain language."
  ].join("\n");
}

function extractGeneratedBlueprintFileValidationTarget(
  message: string
): GeneratedBlueprintFileValidationTarget | null {
  const invalidJsonMatch = message.match(
    /returned invalid JSON for (supportFiles|canonicalFiles|learnerFiles|hiddenTests) file ([^:]+):\s*(.+)$/i
  );

  if (invalidJsonMatch) {
    return {
      kind: "invalid-json",
      group: invalidJsonMatch[1] as GeneratedBlueprintFileGroup,
      path: normalizePathValue(invalidJsonMatch[2] ?? ""),
      error: invalidJsonMatch[3] ?? message
    };
  }

  const invalidSourceMatch = message.match(
    /returned invalid source syntax for (supportFiles|canonicalFiles|learnerFiles) file ([^:]+):\s*(.+)$/i
  );

  if (invalidSourceMatch) {
    return {
      kind: "invalid-source-syntax",
      group: invalidSourceMatch[1] as GeneratedBlueprintFileGroup,
      path: normalizePathValue(invalidSourceMatch[2] ?? ""),
      error: invalidSourceMatch[3] ?? message
    };
  }

  const invalidHiddenTestMatch = message.match(
    /returned invalid JavaScript for hidden test ([^:]+):\s*(.+)$/i
  );

  if (invalidHiddenTestMatch) {
    return {
      kind: "invalid-hidden-test",
      group: "hiddenTests",
      path: normalizePathValue(invalidHiddenTestMatch[1] ?? ""),
      error: invalidHiddenTestMatch[2] ?? message
    };
  }

  return null;
}

function validateBlueprintFilePatchTargets(
  patch: GeneratedBlueprintFilePatchDraft,
  targets: GeneratedBlueprintFileValidationTarget[],
  context: string
): void {
  const allowedTargets = new Set(
    targets.map((target) => `${target.group}:${normalizePathValue(target.path)}`)
  );
  const seenTargets = new Set<string>();

  const visitGroup = (
    group: GeneratedBlueprintFileGroup,
    entries: Array<{ path: string; content: string }>
  ) => {
    for (const entry of entries) {
      const normalizedPath = normalizePathValue(entry.path);
      const targetKey = `${group}:${normalizedPath}`;

      if (!allowedTargets.has(targetKey)) {
        throw new Error(
          `${context} returned unexpected ${group} file ${normalizedPath}. Only the explicitly failing file paths may be repaired in this mode.`
        );
      }

      seenTargets.add(targetKey);
    }
  };

  visitGroup("supportFiles", patch.supportFiles);
  visitGroup("canonicalFiles", patch.canonicalFiles);
  visitGroup("learnerFiles", patch.learnerFiles);
  visitGroup("hiddenTests", patch.hiddenTests);

  const missingTargets = targets.filter(
    (target) => !seenTargets.has(`${target.group}:${normalizePathValue(target.path)}`)
  );

  if (missingTargets.length > 0) {
    throw new Error(
      `${context} did not return repairs for ${missingTargets
        .map((target) => `${target.group} file ${target.path}`)
        .join(", ")}.`
    );
  }
}

function mergeGeneratedBlueprintFileEntries(
  existingFiles: Array<{ path: string; content: string }>,
  patchedFiles: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  const patchedByPath = new Map(
    patchedFiles.map((file) => [normalizePathValue(file.path), file.content] as const)
  );
  const merged = existingFiles.map((file) => {
    const normalizedPath = normalizePathValue(file.path);
    const patchedContent = patchedByPath.get(normalizedPath);

    if (patchedContent === undefined) {
      return file;
    }

    patchedByPath.delete(normalizedPath);
    return {
      path: file.path,
      content: patchedContent
    };
  });

  for (const [normalizedPath, content] of patchedByPath.entries()) {
    merged.push({
      path: normalizedPath,
      content
    });
  }

  return merged;
}

function mergeGeneratedBlueprintFilePatch(
  draft: GeneratedBlueprintBundleDraft,
  patch: GeneratedBlueprintFilePatchDraft
): GeneratedBlueprintBundleDraft {
  return {
    ...draft,
    supportFiles: mergeGeneratedBlueprintFileEntries(draft.supportFiles, patch.supportFiles),
    canonicalFiles: mergeGeneratedBlueprintFileEntries(draft.canonicalFiles, patch.canonicalFiles),
    learnerFiles: mergeGeneratedBlueprintFileEntries(draft.learnerFiles, patch.learnerFiles),
    hiddenTests: mergeGeneratedBlueprintFileEntries(draft.hiddenTests, patch.hiddenTests)
  };
}

function buildAdaptiveFrontierGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Regenerate only the next adaptive frontier for a real project-building IDE.",
    "The stable spine already exists. Do not rewrite the entire project.",
    "Return only learnerFiles, hiddenTests, and steps for the selectedFrontierSteps in the prompt.",
    "learnerFiles must preserve the current working project state while introducing only the next masked implementation targets.",
    "Every learnerFile must remain visibly incomplete at the current anchor so the learner still has real work to do before the step passes.",
    "Do not dump solved code into learnerFiles, even if recentCapabilityEvidence is strong. The frontier may become lighter or narrower, but it must stay learner-owned.",
    "If a selected frontier step extends a file the learner already touched, carry forward the working code from currentWorkspaceFiles and add only the next focused TASK marker or placeholder region.",
    "learnerFiles must not contain placeholder bodies, placeholder comments, placeholder drafts, or comment-only skeletons outside the intentional TASK regions.",
    "If any returned learnerFiles path ends in .ts, .tsx, .js, .jsx, .mts, .cts, .mjs, or .cjs, return syntactically valid source code immediately.",
    "hiddenTests must validate only the currently selected frontier steps.",
    "hiddenTests must never contain placeholder bodies, placeholder comments, sentinel strings like `.placeholder`, or comment-only stubs.",
    "If a hidden test path ends in `.js`, return valid runnable JavaScript immediately.",
    "For JavaScript and TypeScript frontiers, hiddenTests must stay Jest-compatible. Do not switch the project to `node:test` or `node --test`.",
    "Every step anchor.file must exist in learnerFiles, every step anchor.marker must appear literally inside that learner file, and every step test path must exist in hiddenTests.",
    "Every returned step must include a real anchor, substantial explanation slides, grounded checks, constraints, and targeted tests.",
    "Use priorKnowledge, recentCapabilityEvidence, the current frontier, and the stated reason to decide how much hand-holding or decomposition the learner now needs.",
    "recentCapabilityEvidence contains the latest quizzes, written answers, submission outcomes, and recent recovery patterns. React to that concrete evidence, not just the average score.",
    "If recentCapabilityEvidence shows the learner first missed a concept and then recovered it, preserve momentum while still reinforcing the exact concept boundary they struggled with.",
    "The selectedFrontierSteps are the only steps that should be deeply authored right now. Do not author the rest of the spine.",
    "If a rewritten step introduces a jargon-heavy abstraction such as VNode, AST, reconciler, reducer, token, hook, or parser internals, first explain the larger system and the abstraction in plain language before asking the learner to reason about or implement it.",
    "Foundational rewritten steps should still feel like a chapter: what this is, why it matters here, how it works, then what exact file/function/behavior the learner will implement next.",
    "Keep the project feeling like a real system under construction, not a detached tutorial.",
    "The returned steps should read like serious build guidance: explain why this capability matters now, how it fits the architecture, and exactly what behavior the learner is unlocking.",
    "Do not dump the full solution into the explanation slides.",
    "Return concrete file contents and valid JSON only."
  ].join("\n");
}

function buildLessonAuthoringInstructions(context: {
  stepIndex: number;
  totalSteps: number;
}): string {
  return [
    "You are Construct's Architect agent.",
    "You are in the lesson-authoring phase of project generation.",
    `You are authoring a single step chapter (${context.stepIndex + 1} of ${context.totalSteps}).`,
    "The project structure, learner files, hidden tests, anchors, and overall step order already exist.",
    "priorKnowledge is a recursive learner graph with nested subtopics and scores. Match the lesson to the deepest relevant concept gaps or strengths, not only the parent label.",
    "Your job is to rewrite the step teaching content so this step reads like a serious docs chapter before the learner reaches checks or code.",
    "Return only the authored content for this single step: summary, doc, lessonSlides, and checks.",
    "The answers payload includes the original question, the available options, and either a selected option or a custom freeform learner response. Use that context to decide how much to explain, what examples to choose, and where to slow down.",
    "Rewrite lessonSlides, doc, and checks so they match the learner's level and the real code task.",
    "lessonSlides must be rich markdown and should read like documentation or a high-quality course chapter.",
    "Each slide must be an object with a blocks array.",
    "A markdown block looks like { type: 'markdown', markdown: '...' }.",
    "An inline question block looks like { type: 'check', placement: 'inline' | 'end', check: <same comprehension check shape> }.",
    "Use inline question blocks only when the learner would benefit from checking understanding inside the lesson before moving forward. Inline checks should feel embedded in the explanation, not like a separate quiz screen pasted into the slide.",
    "Treat each slide as a docs page section for one concept the learner must understand before implementing the task.",
    "Use markdown structure deliberately: headings, paragraphs, bullet lists, ordered lists, blockquotes, tables when helpful, and fenced code blocks for worked examples or conceptual sketches.",
    "Do not repeat the step title as the main heading of every slide. The UI already shows step context.",
    "Avoid shallow slides. Most non-trivial slides should feel like a docs section with real explanation, not a caption or summary card.",
    "Do not write single-heading slides with a short paragraph underneath. That is too shallow for Construct.",
    "If the step title or draft uses internal jargon or named abstractions, do not assume the learner knows those terms. Define them explicitly before using them casually.",
    "When the project is building a framework, library, renderer, parser, runtime, or other system with internal jargon, the chapter must begin with the bigger picture of what the system is and why the learner would build it before diving into inner machinery.",
    "A good slide usually explains the mental model, why it matters in this project, the important API or language behavior, common mistakes, and how that idea shows up in the upcoming implementation.",
    "Within a step, different slides should usually cover different required concepts. Do not use consecutive slides to repeat the same short summary.",
    "Different slides should progress the learner from one required concept to the next. Think 'next concept page' rather than 'next decorative slide'.",
    "Make the continuity obvious. Every slide should connect back to the previous concept and forward to the next one the learner needs for this exact project.",
    "When a step introduces a new concept, write enough for a learner to understand it without having to infer missing background.",
    "For foundational steps, use an intentional teaching order: first 'what is this in plain language?', then 'why does it matter here?', then 'how does it work?', then 'what exactly are we about to implement?'.",
    "The last one or two slides before the learner reaches checks or code should explicitly bridge into the exercise by naming the file or anchor, the behavior to implement, and how the concept maps to that code.",
    "For most real implementation steps, each slide should contain multiple paragraphs and at least one supporting structure such as a list, comparison, callout, or fenced code example.",
    "Most slides should also contain at least two markdown section headings such as `## Why this matters`, `## How it works`, `## Example`, `## Common mistakes`, `## Step-by-step reasoning`, or `## How this maps to the exercise`.",
    "A strong slide should usually feel like this: introduce the concept, explain why it matters here, walk through a concrete example, warn about a common mistake, then bridge directly into how the learner will use it in the task.",
    "If a concept deserves docs-level treatment, do not compress it into one paragraph. Expand it until the learner can read the slide alone and understand the idea.",
    "If the learner is a beginner in this concept, hand-hold. Explain assumptions, define the terms you use, and spell out the reasoning instead of expecting them to infer it.",
    "When the exercise depends on a language feature or API, explicitly teach that feature or API in the slide itself with an example before the learner reaches the check.",
    "If a slide is mostly summary text, rewrite it into a richer chapter section with clearer headings and more explanation.",
    "Most foundational slides should land around 220-450 words unless the concept is genuinely tiny.",
    "A one-paragraph overview is not a valid lesson slide for a non-trivial concept. Expand it into a real docs page with multiple sections.",
    "If a later check asks about a concept like a __main__ guard, idempotent state, or a CLI entrypoint, the lesson slides must explicitly teach that concept first.",
    "Do not ask trivia or recall questions. Checks should confirm understanding of what the lesson actually taught.",
    "Use fewer, stronger checks. The first step should usually have 1 or 2 grounded checks, not a scatter of thin ones.",
    "The doc field should become a crisp implementation handoff. It should explain exactly what file or anchor is being changed, what behavior to implement, and what the tests are verifying. It should not re-teach the whole lesson.",
    "The doc field should assume the lesson already did the teaching. It should now hand the learner into the exercise with clarity.",
    "For the first step and any foundational step, prefer 4 to 6 substantial slides unless the concept is genuinely tiny.",
    "Before the first check in the first step, there should usually be at least three concept-heavy slides and often four or more.",
    "If the teaching is still too shallow to justify a check, reduce or remove the checks rather than quizzing early.",
    "Slides should look good when rendered as docs. Use markdown headings inside slides to break the explanation into sections such as 'Why this matters', 'How it works', 'Example', 'Common mistakes', or 'How this helps in the task'.",
    "Do not move to checks after a single summary slide unless the concept is truly trivial. In most real steps, the learner should read multiple substantial docs-style slides before the first check.",
    "The learner should finish a slide feeling taught, not merely informed. Write with the intent of making them capable of succeeding in the exercise immediately afterward.",
    "Make the chapter feel hand-holding. Remove hidden leaps in understanding and connect each explanation explicitly to the code they will write next.",
    "If the current step is something like VNode creation, AST construction, reducer updates, parser tokens, or another internal abstraction, the chapter should first explain the larger system and why that abstraction exists before asking the learner to implement it.",
    "Do not teach generic fundamentals detached from the requested project. If you teach a language feature, immediately tie it to how it will be used in this step's implementation.",
    "The doc field must be a clean exercise handoff: after reading the slides, the learner should understand exactly why the task exists, what concept they are about to apply, what file they will edit, and what behavior the tests will verify.",
    "If the current draft already contains useful material, expand and refine it instead of discarding the implementation intent.",
    "Do not alter the code files or hidden tests. Only improve the authored teaching path so the learner is taught before being assessed or asked to code."
  ].join("\n");
}

function buildBlueprintDeepDiveInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "The learner is stuck on a real implementation step and needs a deeper conceptual walkthrough before retrying the task.",
    "Generate additional markdown lesson slides and follow-up comprehension checks for the exact blocker in this step.",
    "Do not replace the task. Strengthen the teaching that comes before the task.",
    "Return technically accurate markdown slides that build from the learner's current confusion and latest failure signal.",
    "Do not repeat the step title as a heading. The UI already shows the step context.",
    "The slides should usually be 2-4 substantial markdown slides, not a one-line reminder and not a giant essay.",
    "Each slide should add real teaching depth: explain the mental model, the exact failure mode, a worked example, the relevant APIs or syntax, and the reasoning needed to succeed on the task.",
    "Write the slides as polished markdown documentation with multiple paragraphs and supporting structure such as lists, blockquotes, and fenced code examples where helpful.",
    "Teach the idea itself. Do not respond with a checklist of what the learner should do next.",
    "If the learner got a check wrong, explicitly teach the exact concept that the check is trying to verify before returning them to that check.",
    "The checks should verify the new explanation before the learner returns to the implementation.",
    "Use the failure count, hints used, revealed hints, task result, and prior knowledge to decide what to deepen.",
    "Assume the new slides and checks will be prepended to the existing step."
  ].join("\n");
}

function buildShortAnswerCheckReviewInstructions(): string {
  return [
    "You are Construct's lesson review agent.",
    "Review a learner's short-answer response for a concept check inside a teaching IDE.",
    "Be semantically lenient and evaluate understanding, not wording similarity.",
    "Use the rubric and the step context to decide whether the learner understood the concept well enough to continue.",
    "Mark status complete only when the learner's answer demonstrates the core idea needed for the upcoming exercise.",
    "If the answer is partially right but misses an essential concept, mark needs-revision.",
    "Do not demand exact terminology when the underlying understanding is present.",
    "Your message should sound like a tutor: clear, direct, and supportive.",
    "coveredCriteria should contain the rubric ideas the learner did address.",
    "missingCriteria should contain the rubric ideas still missing from the learner answer.",
    "Never output skipped. Only output complete or needs-revision."
  ].join("\n");
}

function buildRuntimeGuideInstructions(): string {
  return [
    "You are Construct's runtime Guide agent, a calm senior engineer helping the learner implement real project code.",
    "Use Socratic guidance first.",
    "Never give a full runnable solution.",
    "Return exactly 1 to 3 Socratic questions.",
    "Hints must escalate from a light nudge to pseudocode to a concrete scaffold description without fully solving the task.",
    "Observations should reference the test result, constraints, or code snippet when possible.",
    "Next action must be a single practical move the learner can take immediately."
  ].join("\n");
}

function buildRuntimeGuideProgressNotes(request: RuntimeGuideRequest): string[] {
  const latestFailure = request.taskResult?.failures[0] ?? null;

  return [
    `Reviewing ${request.filePath} around the ${request.anchorMarker} anchor.`,
    request.constraints.length > 0
      ? `Checking the current implementation against ${request.constraints.length} step constraint${request.constraints.length === 1 ? "" : "s"}.`
      : "Checking the current implementation against the step contract.",
    latestFailure
      ? `Comparing the latest failure, "${latestFailure.testName}", with what the step is supposed to guarantee.`
      : request.tests.length > 0
        ? `Mapping the current code against ${request.tests.length} validation contract${request.tests.length === 1 ? "" : "s"}.`
        : "Inspecting the current code path before drafting guidance.",
    "Turning that into Socratic questions, escalated hints, and one smallest next action."
  ];
}
