import {
  CREATION_V2_STAGE_ORDER,
  resolveArtifactLock,
  type ArtifactKind,
  type ArtifactLockDecision,
  type CreationV2Stage
} from "./creationPipelineV2";

export type CreationEngagementMode = "implementation-first" | "learning-first" | "balanced";

export type CreationGoalScopeDecision = {
  engagementMode: CreationEngagementMode;
  scopeSummary: string;
  artifactShape: string;
  complexityScore: number;
  shouldResearch: boolean;
  recommendedQuestionCount: number;
  recommendedMinSteps: number;
  recommendedMaxSteps: number;
  rationale: string;
};

export type CreationQuestionDraft = {
  detectedLanguage: string;
  detectedDomain: string;
  questions: Array<{
    conceptId: string;
    category: "language" | "domain" | "workflow";
    prompt: string;
    options: Array<{
      id: string;
      label: string;
      description: string;
      confidenceSignal: "comfortable" | "shaky" | "new";
    }>;
  }>;
};

export type UnifiedCreationContract = {
  architecture: "artifact-first-project-compiler";
  artifact: ArtifactLockDecision;
  goalScope: CreationGoalScopeDecision;
  stageOrder: CreationV2Stage[];
  modelResponsibilities: string[];
  deterministicResponsibilities: string[];
  hardRules: string[];
  stagePolicy: {
    intake: "deterministic";
    scope: "deterministic";
    research: "disabled-by-default";
    plan: "model-inside-contract";
    blueprint: "model-inside-contract";
    lesson: "model-inside-contract";
  };
};

const IMPLEMENTATION_HINTS = [
  "build",
  "implement",
  "create",
  "make",
  "ship",
  "develop",
  "clone",
  "recreate",
  "port"
];

const LEARNING_HINTS = [
  "learn",
  "teach",
  "understand",
  "explain",
  "tutorial",
  "guide",
  "walkthrough",
  "course",
  "lesson",
  "study"
];

const COMPLEX_ARTIFACT_HINTS = [
  "ide",
  "framework",
  "runtime",
  "compiler",
  "interpreter",
  "database",
  "distributed",
  "multi-agent",
  "operating system",
  "desktop app",
  "full stack",
  "backend",
  "agent"
];

const SMALL_ARTIFACT_HINTS = [
  "small",
  "simple",
  "tiny",
  "basic",
  "minimal",
  "single file",
  "single class",
  "function",
  "utility",
  "module",
  "limiter"
];

function normalizeGoal(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesAny(value: string, hints: readonly string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}

function inferEngagementMode(normalizedGoal: string): CreationEngagementMode {
  const wantsImplementation = includesAny(normalizedGoal, IMPLEMENTATION_HINTS);
  const wantsLearning = includesAny(normalizedGoal, LEARNING_HINTS);

  if (wantsImplementation && !wantsLearning) {
    return "implementation-first";
  }

  if (wantsLearning && !wantsImplementation) {
    return "learning-first";
  }

  return "balanced";
}

function formatArtifactShape(artifact: ArtifactLockDecision): string {
  if (artifact.kind !== "unknown") {
    return `${artifact.kind}${artifact.buildSubstrate ? ` in ${artifact.buildSubstrate}` : ""}`;
  }

  if (artifact.requestedTechnology.length > 0) {
    return `${artifact.requestedTechnology.join(" + ")} artifact`;
  }

  return "project artifact";
}

function inferDetectedLanguage(goal: string, artifact: ArtifactLockDecision): string {
  const normalized = normalizeGoal(goal);

  if (artifact.buildSubstrate) {
    return artifact.buildSubstrate;
  }

  if (normalized.includes("typescript") || normalized.includes("ts")) return "typescript";
  if (normalized.includes("javascript") || normalized.includes("js")) return "javascript";
  if (normalized.includes("python")) return "python";
  if (normalized.includes("rust")) return "rust";
  if (normalized.includes("go")) return "go";

  return "typescript";
}

function inferDetectedDomain(artifact: ArtifactLockDecision): string {
  const domainByKind: Record<ArtifactKind, string> = {
    app: "application",
    api: "backend api",
    cli: "cli tool",
    library: "library",
    framework: "framework",
    runtime: "runtime",
    parser: "parser",
    compiler: "compiler",
    renderer: "renderer",
    system: "system",
    unknown: "software project"
  };

  return domainByKind[artifact.kind];
}

export function inferCreationGoalScope(
  goal: string,
  artifact: ArtifactLockDecision = resolveArtifactLock(goal)
): CreationGoalScopeDecision {
  const normalized = normalizeGoal(goal);
  const engagementMode = inferEngagementMode(normalized);
  const hasSmallHint = includesAny(normalized, SMALL_ARTIFACT_HINTS);
  const hasComplexHint = includesAny(normalized, COMPLEX_ARTIFACT_HINTS) || artifact.kind === "framework" || artifact.kind === "runtime" || artifact.kind === "compiler";
  const wordCount = normalized.split(" ").filter(Boolean).length;
  const artifactShape = formatArtifactShape(artifact);

  if (hasSmallHint && !hasComplexHint) {
    return {
      engagementMode,
      scopeSummary: "Small real artifact",
      artifactShape,
      complexityScore: 18,
      shouldResearch: false,
      recommendedQuestionCount: 2,
      recommendedMinSteps: 1,
      recommendedMaxSteps: 3,
      rationale: "Creation now treats compact utility and algorithm work as local artifact construction, so broad research is disabled."
    };
  }

  if (hasComplexHint || wordCount >= 12) {
    return {
      engagementMode,
      scopeSummary: "Multi-part real artifact",
      artifactShape,
      complexityScore: 76,
      shouldResearch: false,
      recommendedQuestionCount: artifact.needsClarification ? 2 : 2,
      recommendedMinSteps: engagementMode === "learning-first" ? 5 : 3,
      recommendedMaxSteps: engagementMode === "learning-first" ? 10 : 7,
      rationale: "Creation now uses the artifact itself as the source of truth and avoids broad research unless a later explicit research stage is added."
    };
  }

  return {
    engagementMode,
    scopeSummary: "Normal real artifact",
    artifactShape,
    complexityScore: 42,
    shouldResearch: false,
    recommendedQuestionCount: 2,
    recommendedMinSteps: engagementMode === "learning-first" ? 4 : 2,
    recommendedMaxSteps: engagementMode === "learning-first" ? 8 : 5,
    rationale: "Creation now keeps scope local and artifact-first by default instead of asking the model to invent a course-sized plan."
  };
}

export function buildDeterministicCreationQuestionDraft(input: {
  goal: string;
  artifact: ArtifactLockDecision;
  goalScope: CreationGoalScopeDecision;
}): CreationQuestionDraft {
  const detectedLanguage = inferDetectedLanguage(input.goal, input.artifact);
  const detectedDomain = inferDetectedDomain(input.artifact);
  const questions: CreationQuestionDraft["questions"] = [];

  if (input.artifact.needsClarification) {
    questions.push({
      conceptId: "artifact.identity",
      category: "workflow",
      prompt: "Which artifact should Construct lock before it builds anything?",
      options: [
        {
          id: "build-technology",
          label: "Build the technology",
          description: "I want the named framework, runtime, or library itself implemented as the project.",
          confidenceSignal: "comfortable"
        },
        {
          id: "build-with-technology",
          label: "Build with it",
          description: "I want a real app or tool that uses the named technology as the stack.",
          confidenceSignal: "shaky"
        },
        {
          id: "smallest-faithful-artifact",
          label: "Smallest faithful version",
          description: "I want the smallest honest implementation that still matches the original request.",
          confidenceSignal: "new"
        }
      ]
    });
  } else {
    questions.push({
      conceptId: "artifact.first-slice",
      category: "workflow",
      prompt: "What should the first visible build slice optimize for?",
      options: [
        {
          id: "first-working-behavior",
          label: "Working behavior",
          description: "Start with the first meaningful behavior that makes the artifact feel alive.",
          confidenceSignal: "comfortable"
        },
        {
          id: "foundation-before-behavior",
          label: "Foundation first",
          description: "Start with the smallest real type, contract, or helper the rest of the artifact needs.",
          confidenceSignal: "shaky"
        },
        {
          id: "slow-setup",
          label: "Slow setup",
          description: "Only slow down for setup or tooling when it is truly needed to make the artifact runnable.",
          confidenceSignal: "new"
        }
      ]
    });
  }

  questions.push({
    conceptId: "teaching.depth",
    category: "workflow",
    prompt: "How much teaching should Construct layer over the code?",
    options: [
      {
        id: "concise-build-notes",
        label: "Concise build notes",
        description: "Explain the current code move clearly, then let me implement.",
        confidenceSignal: "comfortable"
      },
      {
        id: "teach-the-why",
        label: "Teach the why",
        description: "Explain the concept and the code shape before handing me the task.",
        confidenceSignal: "shaky"
      },
      {
        id: "first-principles",
        label: "First principles",
        description: "Slow down around unfamiliar internals, invariants, and edge cases.",
        confidenceSignal: "new"
      }
    ]
  });

  return {
    detectedLanguage,
    detectedDomain,
    questions
  };
}

export function buildUnifiedCreationContract(input: {
  goal: string;
  artifact?: ArtifactLockDecision | null;
  goalScope?: CreationGoalScopeDecision | null;
}): UnifiedCreationContract {
  const artifact = input.artifact ?? resolveArtifactLock(input.goal);
  const goalScope = input.goalScope ?? inferCreationGoalScope(input.goal, artifact);

  return {
    architecture: "artifact-first-project-compiler",
    artifact,
    goalScope,
    stageOrder: [...CREATION_V2_STAGE_ORDER],
    deterministicResponsibilities: [
      "lock the requested artifact",
      "classify project scope",
      "generate minimal non-quiz intake controls",
      "decide whether external research is allowed"
    ],
    modelResponsibilities: [
      "design a dependency-ordered project spine inside the locked artifact",
      "generate the runnable solved project",
      "derive the current learner-owned diff from that solved project",
      "write practical teaching for the exact current diff"
    ],
    hardRules: [
      "The model may not replace the requested artifact with a tutorial surrogate.",
      "The model may not use intake answers to mutate artifact identity.",
      "The model may change pacing and lesson depth, but not what is being built.",
      "The solved project is the source of truth; teaching is layered on top.",
      "Repair may fix files and step boundaries, but may not redesign the project."
    ],
    stagePolicy: {
      intake: "deterministic",
      scope: "deterministic",
      research: "disabled-by-default",
      plan: "model-inside-contract",
      blueprint: "model-inside-contract",
      lesson: "model-inside-contract"
    }
  };
}

export function shouldRunCreationResearch(_contract: UnifiedCreationContract): boolean {
  return false;
}
