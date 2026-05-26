export const CREATION_V2_STAGE_ORDER = [
  "artifact-lock",
  "project-spec",
  "solved-project",
  "step-plan",
  "learner-diff",
  "lesson"
] as const;

export type CreationV2Stage = (typeof CREATION_V2_STAGE_ORDER)[number];

export type ArtifactKind =
  | "app"
  | "api"
  | "cli"
  | "library"
  | "framework"
  | "runtime"
  | "parser"
  | "compiler"
  | "renderer"
  | "system"
  | "unknown";

export type ArtifactLockDecision = {
  label: string;
  kind: ArtifactKind;
  buildSubstrate: string | null;
  requestedTechnology: string[];
  artifactNouns: string[];
  needsClarification: boolean;
  clarificationReason: string | null;
  suggestedClarification: string | null;
};

export type CreationV2Outline = {
  artifact: ArtifactLockDecision;
  stages: Array<{
    id: CreationV2Stage;
    summary: string;
  }>;
  invariants: string[];
};

const FRAMEWORK_OR_SYSTEM_KEYWORDS = [
  "react",
  "reactjs",
  "next",
  "nextjs",
  "nest",
  "nestjs",
  "vue",
  "svelte",
  "angular",
  "compiler",
  "parser",
  "runtime",
  "renderer",
  "framework",
  "library",
  "bundler"
] as const;

const ARTIFACT_NOUN_KEYWORDS = [
  "app",
  "api",
  "backend",
  "server",
  "cli",
  "sdk",
  "service",
  "site",
  "website",
  "dashboard",
  "tool",
  "editor",
  "agent",
  "worker",
  "crawler",
  "search engine",
  "database",
  "compiler",
  "parser",
  "runtime",
  "renderer",
  "framework",
  "library"
] as const;

function normalizeGoal(goal: string): string {
  return goal.trim().toLowerCase();
}

function collectKeywords(goal: string, keywords: readonly string[]): string[] {
  const normalized = normalizeGoal(goal);
  return keywords.filter((keyword) => normalized.includes(keyword));
}

function inferArtifactKind(artifactNouns: string[], technologyKeywords: string[]): ArtifactKind {
  const joined = [...artifactNouns, ...technologyKeywords].join(" ");

  if (joined.includes("compiler")) return "compiler";
  if (joined.includes("parser")) return "parser";
  if (joined.includes("renderer")) return "renderer";
  if (joined.includes("runtime")) return "runtime";
  if (joined.includes("framework")) return "framework";
  if (joined.includes("library")) return "library";
  if (joined.includes("cli")) return "cli";
  if (joined.includes("api") || joined.includes("backend") || joined.includes("server")) return "api";
  if (joined.includes("app") || joined.includes("site") || joined.includes("website") || joined.includes("dashboard")) {
    return "app";
  }
  if (joined.includes("system") || joined.includes("agent") || joined.includes("worker")) return "system";

  return "unknown";
}

function inferBuildSubstrate(goal: string): string | null {
  const normalized = normalizeGoal(goal);

  if (normalized.includes("typescript")) return "typescript";
  if (normalized.includes("javascript")) return "javascript";
  if (normalized.includes("python")) return "python";
  if (normalized.includes("rust")) return "rust";
  if (normalized.includes("go")) return "go";

  return null;
}

export function resolveArtifactLock(goal: string): ArtifactLockDecision {
  const requestedTechnology = collectKeywords(goal, FRAMEWORK_OR_SYSTEM_KEYWORDS);
  const artifactNouns = collectKeywords(goal, ARTIFACT_NOUN_KEYWORDS);
  const kind = inferArtifactKind(artifactNouns, requestedTechnology);
  const buildSubstrate = inferBuildSubstrate(goal);

  const technologyOnlyRequest =
    requestedTechnology.length > 0 &&
    artifactNouns.length === 0;

  const needsClarification =
    technologyOnlyRequest &&
    !requestedTechnology.some(
      (keyword) => keyword === "compiler" || keyword === "parser" || keyword === "runtime" || keyword === "renderer"
    );

  const clarificationReason = needsClarification
    ? "The request names a technology but does not clearly say whether the artifact is the technology itself or an app built with it."
    : null;

  const suggestedClarification = needsClarification
    ? "Do you want Construct to build the framework/runtime itself, or to build an app using it?"
    : null;

  return {
    label: goal.trim(),
    kind,
    buildSubstrate,
    requestedTechnology,
    artifactNouns,
    needsClarification,
    clarificationReason,
    suggestedClarification
  };
}

export function shouldClarifyRequestedArtifact(goal: string): boolean {
  return resolveArtifactLock(goal).needsClarification;
}

export function buildCreationV2Outline(goal: string): CreationV2Outline {
  const artifact = resolveArtifactLock(goal);

  return {
    artifact,
    stages: [
      {
        id: "artifact-lock",
        summary: "Decide exactly what artifact the user wants and forbid silent substitution later."
      },
      {
        id: "project-spec",
        summary: "Define the canonical module graph, responsibilities, and dependency order for the finished artifact."
      },
      {
        id: "solved-project",
        summary: "Generate the runnable solved project before any learner masking or teaching prose."
      },
      {
        id: "step-plan",
        summary: "Slice the solved project into real milestones without mutating project identity."
      },
      {
        id: "learner-diff",
        summary: "Expose only the current learner-owned implementation gap and its step-local tests."
      },
      {
        id: "lesson",
        summary: "Teach the exact current diff in a practical style without redesigning the artifact."
      }
    ],
    invariants: [
      "Later stages must not substitute a tutorial-friendly artifact for the requested artifact.",
      "Teaching may explain project shape but may not redefine the project.",
      "Adaptation may change pacing and depth, but not artifact identity."
    ]
  };
}
