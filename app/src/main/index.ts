import path from "node:path";
import { exec, execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { homedir } from "node:os";

import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage, nativeTheme } from "electron";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";

import {
  runConstructVerifierAgent,
  type VerificationLogEntry,
  type VerificationResult
} from "./constructVerifierAgent";
import { runConstructAuthoringReviewAgent } from "./constructAuthoringReviewAgent";
import {
  runConstructSelectionExplainAgent,
  type SelectionExplanationLogEntry
} from "./constructSelectionExplainAgent";
import { sendCodeGhostStreamToRenderer } from "./constructCodeGhostAgent";
import { featureSettingsView } from "./constructAiFeatures";
import { ConstructLearningStore } from "./constructLearningStore";
import { runConstructInteract } from "./constructInteractAgent";
import type {
  ConstructInteractRuntimeInput,
  ConstructInteractSession,
  KnowledgeBaseRecord,
  LearningStatePatch
} from "../shared/constructLearning";

if (typeof process.loadEnvFile === "function") {
  const envPath = path.resolve(__dirname, "../../.env");
  try { process.loadEnvFile(envPath); } catch { /* .env doesn't exist */ }
}

// Intercept console logs in Electron Main process and forward them to the renderer
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function sendLogToRenderer(level: "info" | "warn" | "error", ...args: any[]) {
  try {
    const message = args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      if (typeof arg === "object" && arg !== null) {
        try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
      }
      return String(arg);
    }).join(" ");

    // activeWebContents is declared as a global let variable further down
    if (activeWebContents && !activeWebContents.isDestroyed()) {
      activeWebContents.send("construct:main:log", {
        level,
        message,
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    originalError("Error in sendLogToRenderer:", err);
  }
}

function logCrashSurface(scope: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[crash:${scope}] ${error.message}`, error.stack ?? "");
    return;
  }

  console.error(`[crash:${scope}]`, error);
}

console.log = (...args: any[]) => {
  originalLog(...args);
  sendLogToRenderer("info", ...args);
};

console.error = (...args: any[]) => {
  originalError(...args);
  sendLogToRenderer("error", ...args);
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  sendLogToRenderer("warn", ...args);
};

process.on("uncaughtException", (error) => {
  logCrashSurface("main:uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  logCrashSurface("main:unhandledRejection", reason);
});

process.on("warning", (warning) => {
  console.warn("[process warning]", warning.name, warning.message, warning.stack ?? "");
});

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const shouldOpenDevTools = process.env.CONSTRUCT_OPEN_DEVTOOLS === "1";
const ignoredWorkspaceEntries = new Set([
  ".git",
  ".construct",
  ".next",
  "dist",
  "node_modules"
]);
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

type StoredProject = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  source: string;
  originalSource?: string;
  authoringFixes?: Array<{
    id: string;
    title: string;
    description: string;
    kind: string;
    safety: "safe-auto" | "suggested" | "semantic";
    line?: number;
    appliedAt: string;
  }>;
  sourcePath: string | null;
  program: {
    id: string;
    title: string;
    description: string;
    files: Array<{ path: string; content: string }>;
    concepts?: unknown[];
    references?: Array<{
      id: string;
      title: string;
      body: string;
    }>;
    targets?: unknown[];
    steps: Array<{
      id?: string;
      title?: string;
      blocks: Array<{
        id: string;
        kind?: string;
        path?: string;
        title?: string;
        task?: string;
        content?: string;
      }>;
    }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  assistance: Record<string, StoredBlockAssistance>;
  verificationResults: Record<string, VerificationResult>;
  completedBlocks: Record<string, boolean>;
  completedAt: string | null;
};

type StoredBlockAssistance = {
  revealLineCount: number;
  revealBlockCount: number;
  referenceCardsOpened: string[];
  referenceCardsPinned: string[];
  extraExplanationCount: number;
  recallAttemptCount: number;
  verificationFailureCount: number;
};

type StoredSettings = {
  workspaceRoot: string;
  releaseVersion: string;
  ai: {
    provider: "openai" | "openrouter";
    openAiApiKey: string;
    openAiModel: string;
    openRouterApiKey: string;
    openRouterModel: string;
    featureModels: Record<string, string>;
  };
};

type TerminalSessionMeta = {
  projectId: string;
  workspacePath: string;
  shellPath: string;
  startedAt: number;
};

const terminalSessions = new Map<string, pty.IPty>();
const terminalSessionMeta = new Map<string, TerminalSessionMeta>();
const latestTerminalOutputByProject = new Map<string, string>();

function sendToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

type AgentLogChannel = "verifier" | "authoring-review" | "selection-explain" | "interact" | "code-ghost";

function sendAgentLog(agent: AgentLogChannel, message: string, level: "info" | "warn" | "error" | "debug" = "info"): void {
  sendToRenderers("construct:project:agent-log", { agent, message, level });
}

function sendAgentStructuredLog(
  agent: AgentLogChannel,
  title: string,
  payload: unknown,
  level: "info" | "warn" | "error" | "debug" = "debug"
): void {
  sendAgentLog(agent, `${title}\n${formatAgentPayload(payload)}`, level);
}

function formatAgentPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      if (typeof value === "string" && value.length > 60_000) {
        return `${value.slice(0, 60_000)}\n... [truncated]`;
      }
      return value;
    }, 2);
  } catch {
    return String(payload);
  }
}

function legacyConstructProjectsRoot(): string | null {
  if (process.platform === "darwin") {
    const candidate = path.join(homedir(), "Library", "Application Support", "@construct", "app", "construct-projects");
    if (existsSync(path.join(candidate, "projects.json"))) {
      return candidate;
    }
  }
  return null;
}

async function migrateLegacyUserData(): Promise<void> {
  if (existsSync(path.join(constructProjectsRoot(), "projects.json"))) {
    return;
  }

  const legacy = legacyConstructProjectsRoot();
  if (!legacy) {
    return;
  }

  console.log("[construct] migrating project data from legacy location", { from: legacy, to: constructProjectsRoot() });
  await mkdir(constructProjectsRoot(), { recursive: true });
  try {
    const entries = await readdir(legacy, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(legacy, entry.name);
      const dst = path.join(constructProjectsRoot(), entry.name);
      if (entry.isDirectory()) {
        await cp(src, dst, { recursive: true, force: false });
      } else {
        await cp(src, dst, { force: false });
      }
    }
    console.log("[construct] migration complete");
  } catch (error) {
    console.error("[construct] migration failed", error);
  }
}

function constructProjectsRoot(): string {
  return path.join(app.getPath("userData"), "construct-projects");
}

function projectsManifestPath(): string {
  return path.join(constructProjectsRoot(), "projects.json");
}

function settingsPath(): string {
  return path.join(constructProjectsRoot(), "settings.json");
}

function learningStatePath(): string {
  return path.join(constructProjectsRoot(), "learning-state.json");
}

function learningStore(): ConstructLearningStore {
  return new ConstructLearningStore(learningStatePath());
}

function workspacePathForProject(projectId: string): string {
  return path.join(constructProjectsRoot(), "workspaces", projectId);
}

function defaultWorkspaceParent(): string {
  return path.join(constructProjectsRoot(), "workspaces");
}

function isInsidePath(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveImportWorkspacePath(input: {
  program: { id: string };
  sourcePath?: string | null;
  workspacePath?: string | null;
}, settings: StoredSettings): string {
  const fallback = path.join(settings.workspaceRoot, input.program.id);
  const requested =
    typeof input.workspacePath === "string" && input.workspacePath.trim()
      ? path.resolve(input.workspacePath)
      : fallback;
  const appSourceRoot = path.resolve(app.getAppPath(), "src");

  if (isInsidePath(requested, appSourceRoot)) {
    console.warn("[construct] import workspace was inside app source; using configured workspace root instead", {
      requested,
      fallback
    });
    return fallback;
  }

  if (typeof input.sourcePath === "string" && isInsidePath(path.resolve(input.sourcePath), appSourceRoot)) {
    const sourceDirectory = path.dirname(path.resolve(input.sourcePath));
    if (isInsidePath(requested, sourceDirectory)) {
      console.warn("[construct] sample workspace was beside app source .construct file; using configured workspace root instead", {
        requested,
        fallback
      });
      return fallback;
    }
  }

  return requested;
}

async function readProjects(): Promise<StoredProject[]> {
  await mkdir(constructProjectsRoot(), { recursive: true });

  if (!existsSync(projectsManifestPath())) {
    return [];
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (JSON.parse(await readFile(projectsManifestPath(), "utf8")) as StoredProject[])
        .map(normalizeStoredProject);
    } catch (error) {
      if (attempt === 2) {
        console.error("[construct-projects] Failed to read project manifest.", error);
        return [];
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return [];
}

function normalizeStoredProject(project: StoredProject): StoredProject {
  return {
    ...project,
    program: {
      ...project.program,
      references: project.program.references ?? [],
      targets: project.program.targets ?? []
    },
    assistance: project.assistance ?? {},
    verificationResults: project.verificationResults ?? {},
    fileTreeExpanded: project.fileTreeExpanded ?? [],
    typingProgress: project.typingProgress ?? {},
    editAnchors: project.editAnchors ?? {},
    completedBlocks: project.completedBlocks ?? {},
    completedAt: project.completedAt ?? null
  };
}

async function writeProjects(projects: StoredProject[]): Promise<void> {
  await mkdir(constructProjectsRoot(), { recursive: true });
  const target = projectsManifestPath();
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function readSettings(): Promise<StoredSettings> {
  await mkdir(constructProjectsRoot(), { recursive: true });

  if (!existsSync(settingsPath())) {
    return defaultSettings();
  }

  try {
    const parsed = JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<StoredSettings>;
    return normalizeSettings(parsed);
  } catch {
    return defaultSettings();
  }
}

async function writeSettings(settings: StoredSettings): Promise<void> {
  await mkdir(constructProjectsRoot(), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function defaultSettings(): StoredSettings {
  return {
    workspaceRoot: defaultWorkspaceParent(),
    releaseVersion: process.env.npm_package_version?.trim() || "0.0.3",
    ai: {
      provider: "openai",
      openAiApiKey: "",
      openAiModel: "gpt-5-mini",
      openRouterApiKey: "",
      openRouterModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
      featureModels: {}
    }
  };
}

function normalizeSettings(input: Partial<StoredSettings> | null | undefined): StoredSettings {
  const defaults = defaultSettings();

  const migrateModel = (model: string): string => {
    if (model === "openai/gpt-5-mini" || model === "gpt-5-mini") {
      return defaults.ai.openRouterModel;
    }
    return model;
  };

  return {
    workspaceRoot: input?.workspaceRoot || defaults.workspaceRoot,
    releaseVersion: input?.releaseVersion || defaults.releaseVersion,
    ai: {
      provider: input?.ai?.provider === "openrouter" ? "openrouter" : "openai",
      openAiApiKey: input?.ai?.openAiApiKey?.trim?.() || "",
      openAiModel: input?.ai?.openAiModel?.trim?.() || defaults.ai.openAiModel,
      openRouterApiKey: input?.ai?.openRouterApiKey?.trim?.() || "",
      openRouterModel: migrateModel(input?.ai?.openRouterModel?.trim?.() || defaults.ai.openRouterModel),
      featureModels: input?.ai?.featureModels && typeof input.ai.featureModels === "object"
        ? Object.fromEntries(
            Object.entries(input.ai.featureModels)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
              .map(([key, value]) => [key, migrateModel(value)])
          )
        : {}
    }
  };
}

async function fetchOpenAiModels(apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenAI model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{ id: string }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.id
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function fetchOpenRouterModels(apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model lookup failed (${response.status}).`);
  }

  const payload = await response.json() as {
    data?: Array<{
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
      pricing?: {
        prompt?: string;
        completion?: string;
      };
    }>;
  };

  return (payload.data ?? [])
    .map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      description: model.description ?? null,
      contextLength: model.context_length ?? null,
      pricing: model.pricing
        ? `Prompt ${model.pricing.prompt ?? "?"} • Completion ${model.pricing.completion ?? "?"}`
        : null
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function calculateProgress(project: StoredProject): number {
  const blockCount = project.program.steps.reduce(
    (total, step) => total + step.blocks.length,
    0
  );

  if (blockCount === 0) {
    return 0;
  }

  const completed = Object.values(project.completedBlocks).filter(Boolean).length;
  return Math.min(100, Math.round((completed / blockCount) * 100));
}

function safeProjectPath(project: Pick<StoredProject, "workspacePath">, relativePath: string): string {
  const workspace = path.resolve(project.workspacePath);
  const normalized = path.normalize(relativePath);

  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid project file path: ${relativePath}`);
  }

  const resolved = path.resolve(workspace, normalized);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Project file escaped workspace: ${relativePath}`);
  }

  return resolved;
}

async function materializeInitialFiles(project: StoredProject): Promise<void> {
  await mkdir(project.workspacePath, { recursive: true });
  const initialContentByPath = new Map(project.program.files.map((file) => [file.path, file.content]));

  for (const file of project.program.files) {
    const target = safeProjectPath(project, file.path);
    await mkdir(path.dirname(target), { recursive: true });

    if (!existsSync(target)) {
      await writeFile(target, file.content, "utf8");
      continue;
    }

    const existing = await readFile(target, "utf8").catch(() => "");
    if (shouldRepairInitialFile(file.path, existing, file.content, initialContentByPath)) {
      console.warn("[construct] repairing corrupted initial project file", {
        projectId: project.id,
        path: file.path,
        workspacePath: project.workspacePath
      });
      await writeFile(target, file.content, "utf8");
    }
  }

  await persistAuthoringArtifacts(project);
}

async function persistAuthoringArtifacts(project: StoredProject): Promise<void> {
  const directory = safeProjectPath(project, ".construct");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "project.construct"), project.source, "utf8");
  await writeFile(path.join(directory, "original.construct"), project.originalSource ?? project.source, "utf8");
  await writeFile(path.join(directory, "repairs.json"), `${JSON.stringify(project.authoringFixes ?? [], null, 2)}\n`, "utf8");
}

function shouldRepairInitialFile(
  filePath: string,
  existing: string,
  expected: string,
  initialContentByPath: Map<string, string>
): boolean {
  if (!existing || existing === expected) {
    return false;
  }

  for (const [otherPath, otherContent] of initialContentByPath) {
    if (otherPath !== filePath && existing === otherContent) {
      return true;
    }
  }

  if (filePath.endsWith("package.json")) {
    try {
      JSON.parse(existing);
      return false;
    } catch {
      try {
        JSON.parse(expected);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

async function listWorkspaceTree(project: StoredProject, root = ""): Promise<unknown[]> {
  const absoluteRoot = safeProjectPath(project, root || ".");
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const artifactRoot = absolutePathArtifactRoot(project);
  const nodes = await Promise.all(
    entries
      .filter((entry) => !ignoredWorkspaceEntries.has(entry.name))
      .filter((entry) => !(root === "" && artifactRoot === entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map(async (entry) => {
        const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
        const node = {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? "directory" : "file",
          children: entry.isDirectory()
            ? await listWorkspaceTree(project, path.join(root, entry.name))
            : undefined
        };

        return node;
      })
  );

  return nodes;
}

function absolutePathArtifactRoot(project: StoredProject): string | null {
  const workspaceSegments = path.resolve(project.workspacePath).split(path.sep).filter(Boolean);
  if (workspaceSegments.length < 2) {
    return null;
  }

  const [firstSegment, ...rest] = workspaceSegments;
  const artifactProbe = path.join(project.workspacePath, firstSegment, ...rest);
  return existsSync(artifactProbe) ? firstSegment : null;
}

function findProject(projects: StoredProject[], id: string): StoredProject {
  const project = projects.find((candidate) => candidate.id === id);

  if (!project) {
    throw new Error(`Unknown Construct project: ${id}`);
  }

  return project;
}

async function initializeGitRepository(workspacePath: string): Promise<void> {
  if (existsSync(path.join(workspacePath, ".git"))) {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: workspacePath });
}

async function getProjectGitStatus(project: StoredProject): Promise<{
  isRepo: boolean;
  branch: string | null;
  hasRemote: boolean;
  dirtyFiles: string[];
}> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: project.workspacePath });
  } catch {
    return {
      isRepo: false,
      branch: null,
      hasRemote: false,
      dirtyFiles: []
    };
  }

  const branch = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.workspacePath })
    .then(({ stdout }) => String(stdout).trim() || null)
    .catch(() => null);
  const hasRemote = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: project.workspacePath })
    .then(() => true)
    .catch(() => false);
  const dirtyFiles = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: project.workspacePath })
    .then(({ stdout }) => String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const value = line.slice(3);
        const renameIndex = value.indexOf(" -> ");
        return renameIndex >= 0 ? value.slice(renameIndex + 4) : value;
      }))
    .catch(() => []);

  return {
    isRepo: true,
    branch,
    hasRemote,
    dirtyFiles
  };
}

async function commitProjectMilestone(
  project: StoredProject,
  message: string,
  paths: string[]
): Promise<{ success: boolean; output: string; commitHash?: string }> {
  const gitStatus = await getProjectGitStatus(project);
  if (!gitStatus.isRepo) {
    return {
      success: false,
      output: "This project workspace is not a git repository."
    };
  }

  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    return {
      success: false,
      output: "Commit message is required."
    };
  }

  const includePaths = paths
    .map((includePath) => String(includePath || "").trim())
    .filter(Boolean);
  const existingPaths: string[] = [];

  for (const includePath of includePaths) {
    safeProjectPath(project, includePath);
    if (existsSync(path.resolve(project.workspacePath, includePath))) {
      existingPaths.push(includePath);
    }
  }

  if (includePaths.length > 0 && existingPaths.length === 0) {
    return {
      success: false,
      output: `None of the included paths exist yet: ${includePaths.join(", ")}`
    };
  }

  const addArgs = includePaths.length > 0 ? ["add", "--", ...existingPaths] : ["add", "-A"];
  await execFileAsync("git", addArgs, { cwd: project.workspacePath });

  const staged = await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: project.workspacePath })
    .then(({ stdout }) => String(stdout).trim());
  if (!staged) {
    return {
      success: false,
      output: "No staged changes are available for this milestone."
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("git", ["commit", "-m", normalizedMessage], {
      cwd: project.workspacePath,
      maxBuffer: 2 * 1024 * 1024
    });
    const commitHash = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: project.workspacePath })
      .then(({ stdout }) => String(stdout).trim())
      .catch(() => undefined);
    return {
      success: true,
      output: [stdout, stderr].map(String).join("").trim(),
      commitHash
    };
  } catch (error: any) {
    return {
      success: false,
      output: String(error?.stderr || error?.stdout || error?.message || error)
    };
  }
}

async function pushProjectGit(project: StoredProject): Promise<{ success: boolean; output: string }> {
  const gitStatus = await getProjectGitStatus(project);
  if (!gitStatus.isRepo) {
    return {
      success: false,
      output: "This project workspace is not a git repository."
    };
  }

  if (!gitStatus.hasRemote) {
    return {
      success: false,
      output: "No git remote named origin is configured for this workspace."
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("git", ["push"], {
      cwd: project.workspacePath,
      maxBuffer: 2 * 1024 * 1024
    });
    return {
      success: true,
      output: [stdout, stderr].map(String).join("").trim()
    };
  } catch (error: any) {
    return {
      success: false,
      output: String(error?.stderr || error?.stdout || error?.message || error)
    };
  }
}

function summarizeProject(project: StoredProject) {
  const currentStep = project.program.steps[project.currentStepIndex] ?? null;
  const currentBlock = currentStep?.blocks[project.currentBlockIndex] ?? null;
  const blockCount = project.program.steps.reduce((total, step) => total + step.blocks.length, 0);
  const completedBlockCount = Object.values(project.completedBlocks ?? {}).filter(Boolean).length;
  const verificationResults = Object.values(project.verificationResults ?? {});

  return {
    id: project.id,
    title: project.title,
    description: project.description,
    progress: project.progress,
    lastOpenedAt: project.lastOpenedAt,
    workspacePath: project.workspacePath,
    sourcePath: project.sourcePath ?? null,
    currentStepIndex: project.currentStepIndex,
    currentBlockIndex: project.currentBlockIndex,
    currentStepTitle: currentStep?.title ?? null,
    currentBlockKind: currentBlock?.kind ?? null,
    currentBlockLabel: currentBlock?.path ?? currentBlock?.title ?? currentBlock?.task ?? currentBlock?.content?.slice(0, 80) ?? null,
    activeFilePath: project.activeFilePath ?? null,
    stepCount: project.program.steps.length,
    blockCount,
    completedBlockCount,
    fileCount: project.program.files.length,
    conceptCount: project.program.concepts?.length ?? 0,
    referenceCount: project.program.references?.length ?? 0,
    verificationPassCount: verificationResults.filter((result) => result.passed).length,
    verificationFailCount: verificationResults.filter((result) => !result.passed).length,
    authoringFixCount: project.authoringFixes?.length ?? 0,
    completedAt: project.completedAt ?? null
  };
}

function appendTerminalOutput(projectId: string, data: string): void {
  const previous = latestTerminalOutputByProject.get(projectId) ?? "";
  const next = `${previous}${data}`;
  latestTerminalOutputByProject.set(projectId, next.slice(-30_000));
}

function addVerificationLog(
  logs: VerificationLogEntry[],
  status: VerificationLogEntry["status"],
  message: string,
  detail?: string
): void {
  const entry = {
    at: new Date().toISOString(),
    status,
    message,
    detail
  };
  logs.push(entry);
  console.log("[construct verifier]", status, message, detail ? { detail } : "");
  sendToRenderers("construct:project:verify-log", { entry });
}

function withVerificationLogs(
  result: VerificationResult,
  logs: VerificationLogEntry[]
): VerificationResult {
  return {
    ...result,
    logs
  };
}

function summarizeTerminalForLog(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const summary = lines.slice(-8).join("\n");
  return summary.length > 1200 ? `${summary.slice(0, 1200)}…` : summary || "(no output)";
}

async function runVerificationCommand(
  project: StoredProject,
  command: string
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: project.workspacePath,
      maxBuffer: 2 * 1024 * 1024,
      shell: process.env.SHELL || "/bin/zsh"
    });

    return [
      `$ ${command}`,
      stdout,
      stderr
    ].filter(Boolean).join("\n");
  } catch (error) {
    const failed = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };

    return [
      `$ ${command}`,
      `[exit ${failed.code ?? "unknown"}]`,
      failed.stdout ?? "",
      failed.stderr ?? "",
      failed.message
    ].filter(Boolean).join("\n");
  }
}

type LspLanguage = "typescript" | "python";
type LspStatus = "not-installed" | "running" | "stopped" | "installing";
type LspStartResult = {
  languages: LspLanguage[];
  workspacePath: string;
};
type LspStatusReport = Record<LspLanguage, {
  command: string;
  installCommand: string;
  installed: boolean;
  label: string;
  resolvedPath: string | null;
  status: LspStatus;
}>;
type LspServerState = {
  buffer: string;
  pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>;
  process: ChildProcess | null;
  workspacePath: string | null;
};

const lspConfigs: Record<LspLanguage, {
  command: string;
  installPackages: string[];
  label: string;
  scriptPath: string[];
}> = {
  typescript: {
    command: "typescript-language-server --stdio",
    installPackages: ["typescript-language-server", "typescript"],
    label: "TypeScript / JavaScript",
    scriptPath: ["typescript-language-server", "lib", "cli.mjs"]
  },
  python: {
    command: "pyright-langserver --stdio",
    installPackages: ["pyright"],
    label: "Python",
    scriptPath: ["pyright", "langserver.index.js"]
  }
};

const lspServers: Record<LspLanguage, LspServerState> = {
  typescript: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null },
  python: { buffer: "", pendingRequests: new Map(), process: null, workspacePath: null }
};
let activeWebContents: Electron.WebContents | null = null;
let isInstallingLsp = false;
let lspInstallProcess: ChildProcess | null = null;

function findNodeModuleScript(workspacePath: string, relativeScriptPath: string[]): string | null {
  const candidates = [
    path.join(workspacePath, "node_modules", ...relativeScriptPath),
    path.join(__dirname, "..", "node_modules", ...relativeScriptPath),
    path.join(app.getAppPath(), "node_modules", ...relativeScriptPath),
    path.join(process.cwd(), "node_modules", ...relativeScriptPath),
    path.join(process.cwd(), "app", "node_modules", ...relativeScriptPath)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  console.warn(`[LSP] Could not resolve ${relativeScriptPath.join("/")} from candidates:\n${candidates.join("\n")}`);
  return null;
}

function lspLanguageForPath(filePath: string): LspLanguage | null {
  const lower = filePath.toLowerCase().split("?")[0] ?? filePath.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) {
    return "python";
  }

  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".json")
  ) {
    return "typescript";
  }

  return null;
}

function languagesForProject(project: StoredProject): LspLanguage[] {
  const languages = new Set<LspLanguage>();

  for (const file of project.program.files ?? []) {
    const language = lspLanguageForPath(file.path);
    if (language) {
      languages.add(language);
    }
  }

  if (project.activeFilePath) {
    const language = lspLanguageForPath(project.activeFilePath);
    if (language) {
      languages.add(language);
    }
  }

  return [...languages];
}

function emitLspLog(language: LspLanguage, level: "info" | "warn" | "error", text: string) {
  const line = `[${lspConfigs[language].label}] ${text}`;
  if (activeWebContents && !activeWebContents.isDestroyed()) {
    activeWebContents.send("construct:lsp:stderr", { language, level, text: line });
  }
}

function stopLspServer(language?: LspLanguage) {
  const languages = language ? [language] : (Object.keys(lspServers) as LspLanguage[]);

  for (const currentLanguage of languages) {
    const server = lspServers[currentLanguage];
    if (server.process) {
      console.log(`[LSP] Stopping ${lspConfigs[currentLanguage].command}`);
      emitLspLog(currentLanguage, "info", `Stopping ${lspConfigs[currentLanguage].command}`);
      try {
        server.process.kill();
      } catch (err) {
        console.error("[LSP] Error killing process:", err);
      }
      server.process = null;
    }
    server.buffer = "";
    server.workspacePath = null;
    for (const pending of server.pendingRequests.values()) {
      pending.reject(new Error("LSP server stopped"));
    }
    server.pendingRequests.clear();
  }
}

function startLspServer(workspacePath: string, language: LspLanguage): boolean {
  const server = lspServers[language];
  if (server.process && server.workspacePath === workspacePath) {
    return true;
  }

  stopLspServer(language);

  console.log(`[LSP] Starting ${lspConfigs[language].command} in:`, workspacePath);
  emitLspLog(language, "info", `Starting ${lspConfigs[language].command} in ${workspacePath}`);

  const lspScript = findNodeModuleScript(workspacePath, lspConfigs[language].scriptPath);

  if (!lspScript) {
    const message = `${lspConfigs[language].label} server is not installed. Expected ${lspConfigs[language].scriptPath.join("/")}`;
    console.error("[LSP] " + message);
    emitLspLog(language, "error", message);
    return false;
  }

  console.log(`[LSP] Using ${language} server script path: ${lspScript}`);
  emitLspLog(language, "info", `Using server script ${lspScript}`);

  server.process = spawn(process.execPath, [lspScript, "--stdio"], {
    cwd: workspacePath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    }
  });
  server.workspacePath = workspacePath;

  server.process.stdout?.on("data", (chunk: Buffer) => {
    handleLspData(language, chunk);
  });

  server.process.stderr?.on("data", (data: Buffer) => {
    const text = data.toString("utf8");
    console.warn(`[LSP ${language} stderr]:`, text);
    emitLspLog(language, "warn", text);
  });

  server.process.on("close", (code, signal) => {
    const detail = `Process exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`;
    console.log(`[LSP] ${language} ${detail}`);
    emitLspLog(language, code === 0 ? "info" : "warn", detail);
    server.process = null;
    server.buffer = "";
    server.workspacePath = null;
    for (const pending of server.pendingRequests.values()) {
      pending.reject(new Error("LSP server stopped"));
    }
    server.pendingRequests.clear();
  });

  server.process.on("error", (err) => {
    console.error(`[LSP] ${language} process error:`, err);
    emitLspLog(language, "error", err instanceof Error ? err.message : String(err));
    stopLspServer(language);
  });

  return true;
}

function startAvailableLspServers(project: StoredProject): LspStartResult {
  const languages = languagesForProject(project);
  const startedLanguages: LspLanguage[] = [];

  if (languages.length === 0) {
    console.log("[LSP] No supported language files found for project", { id: project.id });
  }

  for (const language of languages) {
    if (findNodeModuleScript(project.workspacePath, lspConfigs[language].scriptPath)) {
      if (startLspServer(project.workspacePath, language)) {
        startedLanguages.push(language);
      }
    } else {
      emitLspLog(language, "warn", `Skipping ${lspConfigs[language].label}; server is not installed.`);
    }
  }

  for (const language of Object.keys(lspConfigs) as LspLanguage[]) {
    if (!languages.includes(language)) {
      stopLspServer(language);
    }
  }

  return {
    languages: startedLanguages,
    workspacePath: project.workspacePath
  };
}

function inferLspLanguage(payload: any): LspLanguage {
  if (payload?.languageId === "python" || payload?.languageId === "typescript") {
    return payload.languageId;
  }

  const uri = payload?.params?.textDocument?.uri;
  if (typeof uri === "string") {
    const clean = uri.split("?")[0]?.toLowerCase() ?? "";
    if (clean.endsWith(".py") || clean.endsWith(".pyi")) {
      return "python";
    }
  }

  return "typescript";
}

function getLspStatus(projectId?: string): LspStatusReport {
  const wsPath = projectId ? workspacePathForProject(projectId) : process.cwd();
  const report = {} as LspStatusReport;

  for (const language of Object.keys(lspConfigs) as LspLanguage[]) {
    const server = lspServers[language];
    const resolvedPath = findNodeModuleScript(wsPath, lspConfigs[language].scriptPath);
    const installed = resolvedPath != null;
    const status: LspStatus = server.process
      ? "running"
      : isInstallingLsp
        ? "installing"
        : installed
          ? "stopped"
          : "not-installed";

    report[language] = {
      command: lspConfigs[language].command,
      installCommand: `npm install --save-dev ${lspConfigs[language].installPackages.join(" ")}`,
      installed,
      label: lspConfigs[language].label,
      resolvedPath,
      status
    };
  }

  return report;
}

type DebugProcessSnapshot = {
  id: string;
  kind: "terminal" | "lsp" | "installer";
  label: string;
  pid: number | null;
  status: "running" | "stopped";
  workspacePath?: string | null;
  command?: string;
  cpuPercent?: number | null;
  memoryMb?: number | null;
  elapsed?: string | null;
};

async function collectDebugProcessSnapshots(): Promise<DebugProcessSnapshot[]> {
  const snapshots: DebugProcessSnapshot[] = [];

  for (const [sessionId, session] of terminalSessions) {
    const meta = terminalSessionMeta.get(sessionId);
    snapshots.push({
      id: sessionId,
      kind: "terminal",
      label: `Terminal ${sessionId.slice(0, 8)}`,
      pid: typeof session.pid === "number" ? session.pid : null,
      status: "running",
      workspacePath: meta?.workspacePath ?? null,
      command: meta?.shellPath
    });
  }

  for (const language of Object.keys(lspServers) as LspLanguage[]) {
    const server = lspServers[language];
    snapshots.push({
      id: `lsp:${language}`,
      kind: "lsp",
      label: lspConfigs[language].label,
      pid: server.process?.pid ?? null,
      status: server.process ? "running" : "stopped",
      workspacePath: server.workspacePath,
      command: lspConfigs[language].command
    });
  }

  if (lspInstallProcess) {
    snapshots.push({
      id: "installer:lsp",
      kind: "installer",
      label: "LSP dependency installer",
      pid: lspInstallProcess.pid ?? null,
      status: "running",
      command: "npm install language servers"
    });
  }

  await hydrateProcessResources(snapshots);
  return snapshots;
}

async function hydrateProcessResources(snapshots: DebugProcessSnapshot[]): Promise<void> {
  const pids = snapshots
    .map((snapshot) => snapshot.pid)
    .filter((pid): pid is number => typeof pid === "number" && pid > 0);

  if (pids.length === 0) {
    return;
  }

  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "pid=,%cpu=,rss=,etime=,command=",
      "-p",
      pids.join(",")
    ]);
    const byPid = new Map<number, { cpuPercent: number | null; memoryMb: number | null; elapsed: string | null; command: string | null }>();

    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) {
        continue;
      }

      const pid = Number(match[1]);
      byPid.set(pid, {
        cpuPercent: Number(match[2]),
        memoryMb: Math.round((Number(match[3]) / 1024) * 10) / 10,
        elapsed: match[4] || null,
        command: match[5] || null
      });
    }

    for (const snapshot of snapshots) {
      if (!snapshot.pid) {
        continue;
      }
      const resource = byPid.get(snapshot.pid);
      if (!resource) {
        continue;
      }
      snapshot.cpuPercent = resource.cpuPercent;
      snapshot.memoryMb = resource.memoryMb;
      snapshot.elapsed = resource.elapsed;
      snapshot.command = snapshot.command ?? resource.command ?? undefined;
    }
  } catch (error) {
    console.warn("[debug] Unable to collect process resources:", error);
  }
}

async function installLsp(workspacePath: string): Promise<boolean> {
  if (isInstallingLsp) {
    return false;
  }
  isInstallingLsp = true;
  console.log("[LSP Installer] Starting npm install in workspace:", workspacePath);

  const packages = Array.from(new Set(Object.values(lspConfigs).flatMap((config) => config.installPackages)));

  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    const npmProcess = spawn(shell, ["-c", `npm install --save-dev ${packages.join(" ")}`], {
      cwd: workspacePath,
      env: {
        ...process.env
      }
    });
    lspInstallProcess = npmProcess;

    npmProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      console.log("[LSP Installer stdout]:", text);
      if (activeWebContents && !activeWebContents.isDestroyed()) {
        activeWebContents.send("construct:lsp:install-progress", { language: "all", type: "stdout", text });
      }
    });

    npmProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      console.warn("[LSP Installer stderr]:", text);
      if (activeWebContents && !activeWebContents.isDestroyed()) {
        activeWebContents.send("construct:lsp:install-progress", { language: "all", type: "stderr", text });
      }
    });

    npmProcess.on("close", (code) => {
      isInstallingLsp = false;
      lspInstallProcess = null;
      console.log(`[LSP Installer] Process finished with exit code: ${code}`);
      resolve(code === 0);
    });

    npmProcess.on("error", (err) => {
      isInstallingLsp = false;
      lspInstallProcess = null;
      console.error("[LSP Installer] Process spawn error:", err);
      resolve(false);
    });
  });
}

function handleLspData(language: LspLanguage, chunk: Buffer) {
  const server = lspServers[language];
  server.buffer += chunk.toString("utf8");
  while (true) {
    const contentLengthIndex = server.buffer.indexOf("Content-Length:");
    if (contentLengthIndex === -1) {
      break;
    }

    const headerEndIndex = server.buffer.indexOf("\r\n\r\n", contentLengthIndex);
    if (headerEndIndex === -1) {
      break;
    }

    const contentLengthStr = server.buffer.slice(contentLengthIndex + 15, headerEndIndex).trim();
    const contentLength = parseInt(contentLengthStr, 10);
    if (isNaN(contentLength)) {
      server.buffer = "";
      break;
    }

    const bodyStartIndex = headerEndIndex + 4;
    if (server.buffer.length < bodyStartIndex + contentLength) {
      break;
    }

    const body = server.buffer.slice(bodyStartIndex, bodyStartIndex + contentLength);
    server.buffer = server.buffer.slice(bodyStartIndex + contentLength);

    try {
      const message = JSON.parse(body);
      handleLspMessage(language, message);
    } catch (err) {
      console.error("[LSP] Failed to parse JSON body:", err);
      emitLspLog(language, "error", `Failed to parse server JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function handleLspMessage(language: LspLanguage, message: any) {
  const server = lspServers[language];
  if (message.id !== undefined && message.method !== undefined) {
    const result = lspClientRequestResult(message.method, message.params);
    if (server.process?.stdin) {
      const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      server.process.stdin.write(`Content-Length: ${Buffer.byteLength(response, "utf8")}\r\n\r\n${response}`);
      emitLspLog(language, "info", `Responded to server request ${message.method} (${message.id})`);
    }
  } else if (message.id !== undefined) {
    const pending = server.pendingRequests.get(message.id);
    if (pending) {
      server.pendingRequests.delete(message.id);
      pending.resolve(message);
    }
  } else if (message.method !== undefined) {
    if (activeWebContents && !activeWebContents.isDestroyed()) {
      activeWebContents.send("construct:lsp:notification", { ...message, languageId: language });
    }
  }
}

function lspClientRequestResult(method: string, params: any): unknown {
  switch (method) {
    case "workspace/configuration":
      return Array.isArray(params?.items)
        ? params.items.map((item: { section?: string }) => item.section === "formattingOptions"
          ? { tabSize: 2, insertSpaces: true, trimTrailingWhitespace: true, insertFinalNewline: true }
          : null)
        : [];
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
      return null;
    case "workspace/applyEdit":
      return { applied: false, failureReason: "Construct does not apply language-server workspace edits automatically." };
    default:
      return null;
  }
}

function installConstructProjectIpcHandlers(): void {
  ipcMain.handle("construct:lsp:get-status", async (_event, projectId: string) => {
    return getLspStatus(projectId);
  });

  ipcMain.handle("construct:lsp:install", async (_event, projectId: string) => {
    try {
      const projects = await readProjects();
      const project = findProject(projects, projectId);
      activeWebContents = _event.sender;
      return await installLsp(project.workspacePath);
    } catch (err) {
      console.error("[LSP Installer] Error:", err);
      return false;
    }
  });

  ipcMain.handle("construct:lsp:start-server", async (_event, projectId: string) => {
    try {
      const projects = await readProjects();
      const project = findProject(projects, projectId);
      activeWebContents = _event.sender;
      return startAvailableLspServers(project);
    } catch (err) {
      console.error("[LSP] Start server error:", err);
      return {
        languages: [],
        workspacePath: ""
      };
    }
  });

  ipcMain.handle("construct:lsp:stop-server", async () => {
    stopLspServer();
  });

  ipcMain.handle("construct:theme:set", async (_event, theme: "light" | "dark" | "system") => {
    nativeTheme.themeSource = theme;
  });

  ipcMain.handle("construct:lsp:request", async (_event, payload: any) => {
    return new Promise((resolve, reject) => {
      const language = inferLspLanguage(payload);
      const server = lspServers[language];
      if (!server.process || !server.process.stdin) {
        reject(new Error(`${lspConfigs[language].label} LSP process not running`));
        return;
      }

      activeWebContents = _event.sender;

      if (payload.id !== undefined) {
        server.pendingRequests.set(payload.id, { resolve, reject });
      }

      const { languageId: _languageId, ...message } = payload;
      const jsonStr = JSON.stringify(message);
      const formatted = `Content-Length: ${Buffer.byteLength(jsonStr, "utf8")}\r\n\r\n${jsonStr}`;

      server.process.stdin.write(formatted, "utf8");

      if (payload.id === undefined) {
        resolve(null);
      }
    });
  });

  ipcMain.handle("construct:debug:processes", async () => {
    return collectDebugProcessSnapshots();
  });

  ipcMain.handle("construct:dialog:open-construct-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open .construct project",
      properties: ["openFile"],
      filters: [
        { name: "Construct Projects", extensions: ["construct"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths[0] == null) {
      return null;
    }

    const sourcePath = result.filePaths[0];
    return {
      path: sourcePath,
      source: await readFile(sourcePath, "utf8")
    };
  });

  ipcMain.handle("construct:dialog:select-workspace-directory", async (_event, input) => {
    const result = await dialog.showOpenDialog({
      title: "Choose project workspace",
      defaultPath: typeof input?.defaultPath === "string" ? input.defaultPath : defaultWorkspaceParent(),
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths[0] == null) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("construct:settings:get", async () => {
    return readSettings();
  });

  ipcMain.handle("construct:settings:set-workspace-root", async (_event, input) => {
    const workspaceRoot = path.resolve(String(input.workspaceRoot || defaultWorkspaceParent()));
    await mkdir(workspaceRoot, { recursive: true });
    const projects = await readProjects();
    const currentSettings = await readSettings();

    for (const project of projects) {
      const currentWorkspace = path.resolve(project.workspacePath);
      if (currentWorkspace === workspaceRoot || currentWorkspace.startsWith(`${workspaceRoot}${path.sep}`)) {
        continue;
      }

      const nextWorkspace = path.join(workspaceRoot, project.id);
      if (existsSync(currentWorkspace) && !existsSync(nextWorkspace)) {
        await cp(currentWorkspace, nextWorkspace, { recursive: true });
      }
      await mkdir(nextWorkspace, { recursive: true });
      project.workspacePath = nextWorkspace;
    }

    const settings = {
      ...currentSettings,
      workspaceRoot
    };
    await writeSettings(settings);
    await writeProjects(projects);

    return {
      settings,
      projects: projects.map(summarizeProject)
    };
  });

  ipcMain.handle("construct:settings:update-ai", async (_event, input) => {
    const current = await readSettings();
    const next = normalizeSettings({
      ...current,
      ai: {
        ...current.ai,
        ...(typeof input?.ai === "object" && input.ai ? input.ai : {})
      }
    });
    await writeSettings(next);
    return next;
  });

  ipcMain.handle("construct:settings:list-ai-features", async () => {
    return featureSettingsView((await readSettings()).ai);
  });

  ipcMain.handle("construct:settings:list-models", async (_event, input) => {
    const provider = input?.provider === "openrouter" ? "openrouter" : "openai";
    const apiKey = String(input?.apiKey ?? "").trim();

    if (!apiKey) {
      throw new Error(`Enter a ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key first.`);
    }

    return provider === "openrouter"
      ? fetchOpenRouterModels(apiKey)
      : fetchOpenAiModels(apiKey);
  });

  ipcMain.handle("construct:learning:get-state", async () => {
    return learningStore().getState();
  });

  ipcMain.handle("construct:learning:get-project", async (_event, projectId: string) => {
    return learningStore().getProjectLearnerState(projectId);
  });

  ipcMain.handle("construct:learning:apply-patch", async (_event, patch: LearningStatePatch) => {
    return learningStore().applyPatch(patch);
  });

  ipcMain.handle("construct:learning:weak-concepts", async (_event, input?: { projectId?: string }) => {
    return learningStore().getWeakConcepts(input?.projectId);
  });

  ipcMain.handle("construct:learning:knowledge-save", async (_event, record: KnowledgeBaseRecord) => {
    return learningStore().saveKnowledgeConcept(record);
  });

  ipcMain.handle("construct:learning:knowledge-open", async (_event, record: KnowledgeBaseRecord) => {
    return learningStore().openKnowledgeConcept(record);
  });

  ipcMain.handle("construct:learning:knowledge-remove", async (_event, input: { projectId: string; conceptId: string }) => {
    return learningStore().removeKnowledgeConcept(input.projectId, input.conceptId);
  });

  ipcMain.handle("construct:project:interact", async (_event, input: Omit<ConstructInteractRuntimeInput, "learningState">) => {
    const store = learningStore();
    const learningState = await store.getState();
    sendAgentLog("interact", `Evaluating interaction for block ${input.blockId}`);
    sendAgentStructuredLog("interact", "Interaction request", {
      ...input,
      learningState
    });
    console.log("[Construct Interact] evaluating", input.projectId, input.blockId);
    const result = await runConstructInteract({
      ...input,
      learningState
    }, (entry) => {
      sendAgentLog("interact", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
    });
    sendAgentLog("interact", `Interaction result: ${result.status} (confidence=${result.confidence}, reply=${result.reply?.slice(0, 80) ?? "none"}...)`);
    sendAgentStructuredLog("interact", "Interaction result payload", result);
    const now = new Date().toISOString();
    const session: ConstructInteractSession = {
      id: randomUUID(),
      projectId: input.projectId,
      blockId: input.blockId,
      prompt: input.prompt,
      answer: input.answer,
      status: result.status,
      confidence: result.confidence,
      reply: result.reply,
      coveredConceptIds: result.coveredConceptIds,
      missingConceptIds: result.missingConceptIds,
      assistanceLevel: result.assistanceLevel,
      createdAt: now
    };

    if (result.statePatch) {
      await store.applyPatch(result.statePatch);
    }
    const state = await store.recordConstructInteractAttempt(session);
    console.log("[Construct Interact] result", result.status, result.confidence, result.shouldAdvance ? "advance" : "stay");
    return {
      ...result,
      session,
      learningState: state
    };
  });

  ipcMain.handle("construct:project:import", async (_event, input) => {
    const projects = await readProjects();
    const settings = await readSettings();
    const existingIndex = projects.findIndex((project) => project.id === input.program.id);
    const now = new Date().toISOString();
    const workspacePath = resolveImportWorkspacePath(input, settings);

    if (existingIndex >= 0) {
      const existing = projects[existingIndex];
      projects[existingIndex] = {
        ...existing,
        source: input.source,
        originalSource: typeof input.originalSource === "string" ? input.originalSource : existing.originalSource ?? input.source,
        authoringFixes: Array.isArray(input.authoringFixes) ? input.authoringFixes : existing.authoringFixes ?? [],
        sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : existing.sourcePath ?? null,
        program: input.program,
        title: input.program.title,
        description: input.program.description,
        workspacePath,
        lastOpenedAt: now
      };
      projects[existingIndex].progress = calculateProgress(projects[existingIndex]);
      await materializeInitialFiles(projects[existingIndex]);
      if (input.initializeGit === true) {
        await initializeGitRepository(projects[existingIndex].workspacePath);
      }
      await writeProjects(projects);
      return projects[existingIndex];
    }

    const project: StoredProject = {
      id: input.program.id,
      title: input.program.title,
      description: input.program.description,
      progress: 0,
      lastOpenedAt: now,
      workspacePath,
      source: input.source,
      originalSource: typeof input.originalSource === "string" ? input.originalSource : input.source,
      authoringFixes: Array.isArray(input.authoringFixes) ? input.authoringFixes : [],
      sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : null,
      program: input.program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: input.program.files[0]?.path ?? null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      assistance: {},
      verificationResults: {},
      completedBlocks: {},
      completedAt: null
    };

    await materializeInitialFiles(project);
    if (input.initializeGit === true) {
      await initializeGitRepository(project.workspacePath);
    }
    projects.push(project);
    await writeProjects(projects);
    return project;
  });

  ipcMain.handle("construct:project:ensure", async (_event, input) => {
    const projects = await readProjects();
    const existing = projects.find((project) => project.id === input.program.id);
    const now = new Date().toISOString();

    if (existing) {
      existing.source = input.source;
      existing.program = input.program;
      existing.title = input.program.title;
      existing.description = input.program.description;
      existing.sourcePath = typeof input.sourcePath === "string" ? input.sourcePath : existing.sourcePath ?? null;
      existing.progress = calculateProgress(existing);
      await materializeInitialFiles(existing);
      await writeProjects(projects);
      return existing;
    }

    const project: StoredProject = {
      id: input.program.id,
      title: input.program.title,
      description: input.program.description,
      progress: 0,
      lastOpenedAt: null,
      workspacePath: workspacePathForProject(input.program.id),
      source: input.source,
      sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : null,
      program: input.program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: input.program.files[0]?.path ?? null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      assistance: {},
      verificationResults: {},
      completedBlocks: {},
      completedAt: null
    };

    await materializeInitialFiles(project);
    project.lastOpenedAt = now;
    projects.push(project);
    await writeProjects(projects);
    return project;
  });

  ipcMain.handle("construct:project:list", async () => {
    return (await readProjects()).map(summarizeProject);
  });

  ipcMain.handle("construct:project:open", async (_event, id: string) => {
    console.log("[construct] open project requested", { id });
    const projects = await readProjects();
    const project = findProject(projects, id);

    project.lastOpenedAt = new Date().toISOString();
    if (isInsidePath(project.workspacePath, path.resolve(app.getAppPath(), "src"))) {
      const nextWorkspacePath = workspacePathForProject(project.id);
      console.warn("[construct] project workspace was inside app source; migrating workspace reference", {
        id: project.id,
        previousWorkspacePath: project.workspacePath,
        nextWorkspacePath
      });
      project.workspacePath = nextWorkspacePath;
    }
    if (project.activeFilePath && path.isAbsolute(project.activeFilePath)) {
      const workspace = path.resolve(project.workspacePath);
      const activePath = path.resolve(project.activeFilePath);
      if (isInsidePath(activePath, workspace)) {
        project.activeFilePath = path.relative(workspace, activePath).split(path.sep).join("/");
      } else {
        console.warn("[construct] active file escaped workspace; resetting to first project file", {
          id: project.id,
          activeFilePath: project.activeFilePath,
          workspacePath: project.workspacePath
        });
        project.activeFilePath = project.program.files[0]?.path ?? null;
      }
    }
    await materializeInitialFiles(project);
    await writeProjects(projects);
    activeWebContents = _event.sender;
    console.log("[construct] open project resolved", {
      id: project.id,
      title: project.title,
      stepCount: project.program.steps.length,
      fileCount: project.program.files.length,
      activeFilePath: project.activeFilePath,
      currentStepIndex: project.currentStepIndex,
      currentBlockIndex: project.currentBlockIndex
    });
    return project;
  });

  ipcMain.handle("construct:project:update", async (_event, input) => {
    const projects = await readProjects();
    const index = projects.findIndex((project) => project.id === input.id);

    if (index < 0) {
      throw new Error(`Unknown Construct project: ${input.id}`);
    }

    projects[index] = {
      ...projects[index],
      ...input.patch
    };
    projects[index].progress = calculateProgress(projects[index]);
    await writeProjects(projects);
    return projects[index];
  });

  ipcMain.handle("construct:project:list-files", async (_event, projectId: string) => {
    const project = findProject(await readProjects(), projectId);
    await mkdir(project.workspacePath, { recursive: true });
    return listWorkspaceTree(project);
  });

  ipcMain.handle("construct:project:read-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    const fileStat = await stat(target);

    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    return {
      path: input.path,
      content: await readFile(target, "utf8")
    };
  });

  ipcMain.handle("construct:project:write-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content, "utf8");
    return {
      path: input.path,
      content: input.content
    };
  });

  ipcMain.handle("construct:project:delete-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    const fileStat = await stat(target);
    if (fileStat.isDirectory()) {
      await rm(target, { recursive: true, force: true });
    } else {
      await rm(target, { force: true });
    }
  });

  ipcMain.handle("construct:project:rename-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const oldTarget = safeProjectPath(project, input.oldPath);
    const newTarget = safeProjectPath(project, input.newPath);
    await mkdir(path.dirname(newTarget), { recursive: true });
    await rename(oldTarget, newTarget);
  });

  ipcMain.handle("construct:project:create-folder", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    await mkdir(target, { recursive: true });
  });

  ipcMain.handle("construct:project:duplicate-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const srcTarget = safeProjectPath(project, input.path);
    const destTarget = safeProjectPath(project, input.destPath);
    await mkdir(path.dirname(destTarget), { recursive: true });
    await cp(srcTarget, destTarget, { recursive: true });
  });

  ipcMain.handle("construct:project:git-status", async (_event, projectId: string) => {
    const project = findProject(await readProjects(), projectId);
    return getProjectGitStatus(project);
  });

  ipcMain.handle("construct:project:git-commit", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    return commitProjectMilestone(
      project,
      String(input.message ?? ""),
      Array.isArray(input.paths) ? input.paths.map(String) : []
    );
  });

  ipcMain.handle("construct:project:git-push", async (_event, projectId: string) => {
    const project = findProject(await readProjects(), projectId);
    return pushProjectGit(project);
  });

  ipcMain.handle("construct:project:delete", async (_event, input: { projectId: string; force?: boolean }) => {
    const projects = await readProjects();
    const index = projects.findIndex((p) => p.id === input.projectId);
    if (index < 0) {
      throw new Error(`Unknown Construct project: ${input.projectId}`);
    }
    const project = projects[index];

    const gitDir = path.join(project.workspacePath, ".git");
    const hasGit = existsSync(gitDir);
    let branch: string | null = null;
    let hasRemote = false;
    let hasUncommittedChanges = false;
    let unpushedCommits = 0;

    if (hasGit) {
      try {
        const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.workspacePath });
        branch = branchOut.trim() || null;
      } catch { /* not a repo */ }
      try {
        const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd: project.workspacePath });
        hasUncommittedChanges = statusOut.trim().length > 0;
      } catch { /* ignore */ }
      try {
        await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: project.workspacePath });
        hasRemote = true;
        await execFileAsync("git", ["fetch", "origin"], { cwd: project.workspacePath }).catch(() => {});
        const { stdout: ahead } = await execFileAsync("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: project.workspacePath }).catch(() => ({ stdout: "0" }));
        unpushedCommits = parseInt(ahead.trim(), 10) || 0;
      } catch { /* no remote */ }
    }

    if (!input.force) {
      return { hasGit, branch, hasRemote, hasUncommittedChanges, unpushedCommits };
    }

    if (existsSync(project.workspacePath)) {
      await rm(project.workspacePath, { recursive: true, force: true });
    }

    projects.splice(index, 1);
    await writeProjects(projects);

    return { deleted: true as const };
  });

  ipcMain.handle("construct:project:verify-recall", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const recall = input.recall;
    const verify = recall?.verify;
    const logs: VerificationLogEntry[] = [];
    sendAgentLog("verifier", `Verification started for recall block ${verify?.id ?? "unknown"}`);

    if (!verify || verify.kind !== "agent") {
      addVerificationLog(logs, "failed", "Verification contract is not supported", "Expected ::verify kind=\"agent\".");
      sendAgentLog("verifier", "Verification contract is not supported (expected kind=\"agent\")", "error");
      return withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: "This Construct build only supports agent verification for recall blocks.",
        evidence: [],
        suggestion: "Use a ::verify block with kind=\"agent\"."
      }, logs);
    }

    addVerificationLog(logs, "running", "Loaded verification contract", String(verify.id ?? "agent verifier"));
    addVerificationLog(logs, "done", "Loaded recall task", String(recall.task ?? "No task text supplied."));
    addVerificationLog(
      logs,
      "done",
      "Loaded support context",
      String(recall.support ?? "").trim() || "No support text supplied."
    );

    const referenceCount = Array.isArray(input.references) ? input.references.length : 0;
    addVerificationLog(
      logs,
      referenceCount > 0 ? "done" : "warning",
      "Collected reference cards",
      referenceCount > 0 ? `${referenceCount} reference card${referenceCount === 1 ? "" : "s"} supplied.` : "No reference cards supplied."
    );

    const conceptCount = Array.isArray(input.concepts) ? input.concepts.length : 0;
    const savedKnowledgeCount = Array.isArray(input.savedKnowledge) ? input.savedKnowledge.length : 0;
    addVerificationLog(
      logs,
      conceptCount > 0 ? "done" : "warning",
      "Collected concept context",
      conceptCount > 0
        ? `${conceptCount} concept card${conceptCount === 1 ? "" : "s"} linked to this task.`
        : "No concept cards were linked to this recall task."
    );
    addVerificationLog(
      logs,
      savedKnowledgeCount > 0 ? "done" : "warning",
      "Checked saved knowledge",
      savedKnowledgeCount > 0
        ? `${savedKnowledgeCount} saved card${savedKnowledgeCount === 1 ? "" : "s"} available to the verifier.`
        : "No saved knowledge cards are available yet."
    );

    const declaredFiles = Array.isArray(verify.evidence?.files) ? verify.evidence.files : [];
    addVerificationLog(
      logs,
      "running",
      "Collecting declared evidence files",
      declaredFiles.length > 0 ? declaredFiles.join(", ") : "No files declared in ::evidence."
    );
    const files = await Promise.all(
      declaredFiles.map(async (relativePath: string) => {
        try {
          const target = safeProjectPath(project, relativePath);
          const content = await readFile(target, "utf8");
          addVerificationLog(logs, "done", `Read ${relativePath}`, `${content.length} characters`);
          return {
            path: relativePath,
            content
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addVerificationLog(logs, "warning", `Could not read ${relativePath}`, message);
          return {
            path: relativePath,
            content: `[missing or unreadable file: ${message}]`
          };
        }
      })
    );
    addVerificationLog(logs, "done", "Evidence collection finished", `${files.length} file${files.length === 1 ? "" : "s"} supplied to the verifier.`);

    const terminalCommand =
      typeof verify.evidence?.terminalCommand === "string"
        ? verify.evidence.terminalCommand
        : undefined;
    const latestAnswer =
      verify.evidence?.answer === "latest" || recall.mode === "reply"
        ? String(input.answer ?? "")
        : undefined;
    let terminalOutput = latestTerminalOutputByProject.get(project.id) ?? "";

    if (terminalCommand) {
      addVerificationLog(logs, "running", "Running verification command", terminalCommand);
      terminalOutput = await runVerificationCommand(project, terminalCommand);
      appendTerminalOutput(project.id, terminalOutput);
      addVerificationLog(
        logs,
        terminalOutput.includes("[exit ") ? "failed" : "done",
        terminalOutput.includes("[exit ") ? "Command exited with a failure" : "Command completed",
        summarizeTerminalForLog(terminalOutput)
      );
    } else if (verify.evidence?.terminalOutput === "latest") {
      addVerificationLog(
        logs,
        "done",
        "Using latest terminal output",
        terminalOutput ? summarizeTerminalForLog(terminalOutput) : "No terminal output has been captured for this project yet."
      );
    } else {
      addVerificationLog(logs, "done", "No terminal command declared", "The agent will judge from files and rubric only.");
    }

    try {
      addVerificationLog(logs, "running", "Evaluating rubric", String(verify.rubric ?? "No rubric supplied."));
      addVerificationLog(logs, "running", "Asking Construct Verifier Agent", "Comparing goal, rubric, files, terminal output, task, support, and reference cards.");
      const verifierInput = {
        goal: String(verify.goal ?? ""),
        rubric: String(verify.rubric ?? ""),
        task: String(recall.task ?? ""),
        support: String(recall.support ?? ""),
        references: Array.isArray(input.references)
          ? input.references.map((reference: { id?: unknown; title?: unknown; body?: unknown }) => ({
              id: String(reference.id ?? ""),
              title: String(reference.title ?? ""),
              body: String(reference.body ?? "")
            }))
          : [],
        concepts: Array.isArray(input.concepts)
          ? input.concepts.map((concept: { id?: unknown; title?: unknown; summary?: unknown; why?: unknown; example?: unknown }) => ({
              id: String(concept.id ?? ""),
              title: String(concept.title ?? ""),
              summary: String(concept.summary ?? ""),
              why: String(concept.why ?? ""),
              example: String(concept.example ?? "")
            }))
          : [],
        savedKnowledge: Array.isArray(input.savedKnowledge)
          ? input.savedKnowledge.map((concept: { id?: unknown; title?: unknown; summary?: unknown; why?: unknown; example?: unknown }) => ({
              id: String(concept.id ?? ""),
              title: String(concept.title ?? ""),
              summary: String(concept.summary ?? ""),
              why: String(concept.why ?? ""),
              example: String(concept.example ?? "")
            }))
          : [],
        files,
        terminalCommand,
        terminalOutput,
        answer: latestAnswer,
        messages: {
          success: String(verify.messages?.success ?? ""),
          failure: String(verify.messages?.failure ?? "")
        }
      };
      sendAgentStructuredLog("verifier", "Verifier request", verifierInput);
      const result = await runConstructVerifierAgent(verifierInput, (entry) => {
        sendAgentLog("verifier", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      await learningStore().recordRecallAttempt({
        id: randomUUID(),
        projectId: project.id,
        recallId: String(recall.id ?? verify.id),
        mode: recall.mode === "reply" ? "reply" : "code",
        answer: latestAnswer,
        passed: result.passed,
        status: result.status,
        confidence: result.confidence,
        conceptIds: Array.isArray(recall.concepts) ? recall.concepts.map(String) : [],
        createdAt: new Date().toISOString()
      });
      addVerificationLog(
        logs,
        result.passed ? "done" : "failed",
        result.passed ? "Verifier passed the recall task" : result.status === "almost" ? "Verifier found the solution is close" : "Verifier did not pass the recall task",
        result.reason
      );
      sendAgentLog("verifier", `Verification ${result.passed ? "passed" : "failed"} (confidence=${result.confidence}): ${result.reason?.slice(0, 120) ?? "no reason"}`);
      sendAgentStructuredLog("verifier", "Verifier result payload", result);
      return withVerificationLogs(result, logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addVerificationLog(logs, "failed", "Verifier agent failed to return a result", message);
      sendAgentLog("verifier", `Verification failed: ${message}`, "error");
      return withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: `Construct verifier could not complete: ${message}`,
        evidence: [
          terminalCommand ? `terminal command: ${terminalCommand}` : "terminal command: none",
          `files supplied: ${files.map((file) => file.path).join(", ") || "none"}`
        ],
        suggestion: "Check verifier credentials and rerun verification when the project evidence is ready."
      }, logs);
    }
  });

  ipcMain.handle("construct:project:review-authoring", async (_event, input) => {
    const diagnosticCount = Array.isArray(input?.diagnostics) ? input.diagnostics.length : 0;
    const snippetCount = Array.isArray(input?.snippets) ? input.snippets.length : 0;
    sendAgentLog("authoring-review", `Reviewing tape (spec=${input?.spec ?? "tape-0.3"}, ${diagnosticCount} diagnostics, ${snippetCount} snippets)`);
    sendAgentStructuredLog("authoring-review", "Authoring review request", {
      spec: String(input?.spec ?? "tape-0.3"),
      projectView: input?.projectView ?? {},
      diagnostics: Array.isArray(input?.diagnostics) ? input.diagnostics : [],
      snippets: Array.isArray(input?.snippets) ? input.snippets : []
    });
    console.log("[construct authoring] reviewing compact project view", {
      spec: input?.spec,
      diagnosticCount,
      snippetCount
    });
    try {
      const result = await runConstructAuthoringReviewAgent({
        spec: String(input?.spec ?? "tape-0.3"),
        projectView: input?.projectView ?? {},
        diagnostics: Array.isArray(input?.diagnostics) ? input.diagnostics : [],
        snippets: Array.isArray(input?.snippets) ? input.snippets : []
      }, (entry) => {
        sendAgentLog("authoring-review", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      sendAgentLog("authoring-review", `Review complete: ${Array.isArray(result) ? result.length : 0} suggestions`);
      sendAgentStructuredLog("authoring-review", "Authoring review result payload", result);
      return result;
    } catch (error) {
      sendAgentLog("authoring-review", `Review failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      throw error;
    }
  });

  ipcMain.handle("construct:project:explain-selection", async (_event, input) => {
    const project = findProject(await readProjects(), String(input?.projectId ?? ""));
    const requestId = String(input?.requestId ?? randomUUID());
    sendAgentLog("selection-explain", `Explaining selection from ${input?.selection?.source ?? "workspace"} (${input?.selection?.sourceLabel ?? "unknown"})`);
    sendAgentStructuredLog("selection-explain", "Selection explanation request", {
      requestId,
      projectId: project.id,
      workspacePath: project.workspacePath,
      selection: input?.selection ?? {},
      learningContext: input?.learningContext ?? {}
    });
    console.log("[selection explain] request started", {
      requestId,
      projectId: project.id,
      source: input?.selection?.source,
      filePath: input?.selection?.filePath
    });

    const progress = (entry: Omit<SelectionExplanationLogEntry, "at">) => {
      const payload = { requestId, entry: { ...entry, at: new Date().toISOString() } };
      sendToRenderers("construct:project:explain-selection-log", payload);
      const level = entry.status === "failed" ? "error" : entry.status === "running" ? "info" : "debug";
      sendAgentLog("selection-explain", `[${entry.status}] ${entry.message}${entry.detail ? ` - ${entry.detail}` : ""}`, level);
      console.log("[selection explain]", entry.status, entry.message, entry.detail ?? "");
    };

    try {
      const result = await runConstructSelectionExplainAgent({
        projectId: project.id,
        workspacePath: project.workspacePath,
        selection: {
          text: String(input?.selection?.text ?? ""),
          source: String(input?.selection?.source ?? "workspace"),
          sourceLabel: String(input?.selection?.sourceLabel ?? "Construct workspace"),
          contextText: String(input?.selection?.contextText ?? "").slice(0, 18_000),
          filePath: typeof input?.selection?.filePath === "string" ? input.selection.filePath : undefined,
          language: typeof input?.selection?.language === "string" ? input.selection.language : undefined,
          lineStart: Number.isInteger(input?.selection?.lineStart) ? input.selection.lineStart : undefined,
          lineEnd: Number.isInteger(input?.selection?.lineEnd) ? input.selection.lineEnd : undefined
        },
        learningContext: input?.learningContext ?? {}
      }, progress, (entry) => {
        sendAgentLog("selection-explain", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      });
      sendAgentStructuredLog("selection-explain", "Selection explanation result payload", result);
      return result;
    } catch (error) {
      progress({ status: "failed", message: "Explanation failed", detail: error instanceof Error ? error.message : String(error), tool: "agent" });
      throw error;
    }
  });

  ipcMain.on("construct:project:code-ghost:explain", (event, input) => {
    const requestId = String(input?.requestId ?? "");
    const lineNumber = Number(input?.lineNumber ?? 0);

    if (!requestId || !lineNumber) {
      event.sender.send("construct:project:code-ghost:token", {
        requestId, lineNumber, token: "", done: true, error: "Invalid request"
      });
      return;
    }

    sendAgentLog("code-ghost", `Ghost completion requested at line ${lineNumber} (${input?.language ?? "unknown"})`);
    sendAgentStructuredLog("code-ghost", "Code ghost request", {
      requestId,
      lineNumber,
      lineContent: String(input?.lineContent ?? ""),
      language: String(input?.language ?? "unknown"),
      linesBefore: Array.isArray(input?.linesBefore) ? input.linesBefore.map(String) : [],
      linesAfter: Array.isArray(input?.linesAfter) ? input.linesAfter.map(String) : []
    });
    sendCodeGhostStreamToRenderer(
      event.sender,
      {
        lineContent: String(input?.lineContent ?? ""),
        language: String(input?.language ?? "unknown"),
        linesBefore: Array.isArray(input?.linesBefore) ? input.linesBefore.map(String) : [],
        linesAfter: Array.isArray(input?.linesAfter) ? input.linesAfter.map(String) : []
      },
      "construct:project:code-ghost:token",
      requestId,
      lineNumber,
      (entry) => {
        sendAgentLog("code-ghost", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
      }
    ).catch((err) => {
      sendAgentLog("code-ghost", `Ghost completion failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      console.error("[code ghost] fatal:", err);
      try { event.sender.send("construct:project:code-ghost:token", { requestId, lineNumber, token: "", done: true, error: String(err) }); } catch {}
    });
  });

  ipcMain.handle("construct:project:terminal-create", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const sessionId = randomUUID();
    const shellPath = process.env.SHELL || "/bin/zsh";
    const child = pty.spawn(shellPath, ["-i"], {
      name: "xterm-256color",
      cols: typeof input.cols === "number" ? input.cols : 80,
      rows: typeof input.rows === "number" ? input.rows : 24,
      cwd: project.workspacePath,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8"
      }
    });

    terminalSessions.set(sessionId, child);
    terminalSessionMeta.set(sessionId, {
      projectId: project.id,
      workspacePath: project.workspacePath,
      shellPath,
      startedAt: Date.now()
    });
    child.onData((data) => {
      appendTerminalOutput(project.id, data);
      sendToRenderers("construct:project:terminal-data", {
        sessionId,
        data
      });
    });
    child.onExit(({ exitCode }) => {
      terminalSessions.delete(sessionId);
      terminalSessionMeta.delete(sessionId);
      sendToRenderers("construct:project:terminal-exit", {
        sessionId,
        exitCode
      });
    });

    return { sessionId };
  });

  ipcMain.handle("construct:project:terminal-input", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.write(input.data);
  });

  ipcMain.handle("construct:project:terminal-resize", async (_event, input) => {
    const session = terminalSessions.get(input.sessionId);
    if (session && input.cols > 0 && input.rows > 0) {
      try {
        session.resize(input.cols, input.rows);
      } catch {
        // Ignore resize races when the pty is tearing down.
      }
    }
  });

  ipcMain.handle("construct:project:terminal-kill", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.kill();
    terminalSessions.delete(input.sessionId);
    terminalSessionMeta.delete(input.sessionId);
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: process.platform === "darwin" ? "menu" : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    titleBarStyle: "hiddenInset",
    title: "Construct",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  if (process.platform === "darwin" && app.dock && existsSync(iconPath)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch (err) {
      console.error("Failed to set dock icon:", err);
    }
  }

  window.once("ready-to-show", () => window.show());

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const logLevel = level >= 3 ? "error" : level >= 2 ? "warn" : "info";
    console[logLevel]("[renderer console]", message, { sourceId, line });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[crash:renderer]", details);
  });

  window.webContents.on("unresponsive", () => {
    console.warn("[crash:renderer] window became unresponsive");
  });

  window.webContents.on("responsive", () => {
    console.log("[renderer] window became responsive");
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[renderer] failed to load", { errorCode, errorDescription, validatedURL });
  });

  app.on("child-process-gone", (_event, details) => {
    console.error("[crash:child-process]", details);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch((error) => {
      console.error("[shell] failed to open external URL", { url, error });
    });
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (shouldOpenDevTools) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  void window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  await migrateLegacyUserData();
  installConstructProjectIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopLspServer();
});
