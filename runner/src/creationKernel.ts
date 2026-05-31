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
  courseCreator: CourseCreatorPolicy;
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

export type CourseCreatorStage = "plan" | "blueprint" | "frontier" | "lesson";

export type CourseCreatorPolicy = {
  id: string;
  role: string;
  systemPrompt: string;
  abilities: string[];
  globalDirectives: string[];
  stageDirectives: Record<CourseCreatorStage, string[]>;
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

const DEFAULT_COURSE_CREATOR_SYSTEM_PROMPT = [
  "Create real build courses by acting as the central course designer, project architect, and lesson author.",
  "The course shape is controlled by this policy, not by scattered domain-specific prompt rules.",
  "Default style: progressive construction. Start with the simplest honest version of the requested artifact, use examples/tests to expose its shortcomings, then add exactly the next capability that fixes the current shortcoming.",
  "Every generated file, step, explanation, check, and hidden test must serve that course shape."
].join("\n");

function getCourseCreatorSystemPromptOverride(): string | null {
  const override = process.env.CONSTRUCT_COURSE_CREATOR_SYSTEM_PROMPT?.trim();
  return override && override.length > 0 ? override : null;
}

export function buildDefaultCourseCreatorPolicy(): CourseCreatorPolicy {
  return {
    id: "central-progressive-build-course",
    role: "central-course-creator",
    systemPrompt: getCourseCreatorSystemPromptOverride() ?? DEFAULT_COURSE_CREATOR_SYSTEM_PROMPT,
    abilities: [
      "choose the course architecture and step sequence inside the locked artifact",
      "choose the first learner-visible slice and the later upgrade path",
      "write solved files, learner-owned files, tests, checks, and lessons as one coherent course design",
      "change course style when the course creator system prompt changes, without requiring domain-specific code changes",
      "keep all stage outputs aligned to the same course shape"
    ],
    globalDirectives: [
      "The course creator policy is the source of truth for pedagogy and course shape.",
      "Do not encode course style as one-off domain exceptions in individual stages.",
      "The default first slice should be the smallest honest behavior the learner can understand and implement.",
      "Later slices should be motivated by concrete shortcomings from examples, tests, or observed behavior.",
      "Do not start with a polished production shell and one TODO hole unless the policy explicitly asks for production-first teaching.",
      "Every new field, helper, method, abstraction, validation rule, or dependency should appear when the lesson can explain why that piece now exists."
    ],
    stageDirectives: {
      plan: [
        "Design the whole step sequence from the course creator policy.",
        "Make the dependency chain and upgrade pressure explicit: simple version, shortcoming, next capability.",
        "Do not hardcode the default progressive style to one domain; apply the policy to whatever artifact is locked."
      ],
      blueprint: [
        "Generate learner files, canonical files, hidden tests, and step metadata that all follow the same course creator policy.",
        "The first frontier should expose only the current learner-owned concept boundary.",
        "If a future production concept is not the current slice, keep it out of the learner file or leave it solved/invisible until its step."
      ],
      frontier: [
        "Regenerate only the next frontier according to the same course creator policy that produced the spine.",
        "If the current frontier violates the policy, rewrite the frontier shape instead of patching around the symptom.",
        "Use recent learner evidence to adjust explanation and slice size, not artifact identity."
      ],
      lesson: [
        "Teach the exact current slice selected by the course creator policy.",
        "Explain why each visible code piece exists before asking the learner to implement it.",
        "Bridge from the current limitation to the next step, but do not teach future production machinery as if it were required now."
      ]
    }
  };
}

export function formatCourseCreatorPolicyForPrompt(stage: CourseCreatorStage): string[] {
  const policy = buildDefaultCourseCreatorPolicy();
  return [
    "Course creator policy:",
    `- id: ${policy.id}`,
    `- role: ${policy.role}`,
    "Course creator system prompt:",
    policy.systemPrompt,
    "Course creator abilities:",
    ...policy.abilities.map((ability) => `- ${ability}`),
    "Global course directives:",
    ...policy.globalDirectives.map((directive) => `- ${directive}`),
    `Stage directives for ${stage}:`,
    ...policy.stageDirectives[stage].map((directive) => `- ${directive}`)
  ];
}

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
    courseCreator: buildDefaultCourseCreatorPolicy(),
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
      "act as the central course creator described by creationContract.courseCreator",
      "design a dependency-ordered project spine inside the locked artifact",
      "generate the runnable solved project",
      "derive the current learner-owned diff from that solved project",
      "write practical teaching for the exact current diff"
    ],
    hardRules: [
      "The model may not replace the requested artifact with a tutorial surrogate.",
      "The model may not use intake answers to mutate artifact identity.",
      "The model may change pacing and lesson depth, but not what is being built.",
      "The course creator policy controls the course shape across plan, blueprint, frontier, and lesson stages.",
      "Changing the course creator system prompt should be enough to change the generated course style without changing stage-specific code.",
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
