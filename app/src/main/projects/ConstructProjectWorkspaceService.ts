import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import type { StoredSettings } from "../config/constructConfig";
import {
  isFlowProject,
  isTapeProject,
  type ProjectLearnedConceptSummary,
  type ProjectSummary,
  type StoredProject,
  type StoredTapeProject,
  type WorkspaceTreeNode
} from "./ConstructProjectTypes";

const ignoredWorkspaceDirectoryNames = new Set([
  ".git",
  ".construct",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "dist",
  "env",
  "node_modules",
  "target",
  "venv"
]);

const ignoredWorkspaceFileNames = new Set([
  ".DS_Store"
]);

export function isIgnoredWorkspaceEntry(entry: { name: string; directory?: boolean; isDirectory?: () => boolean }): boolean {
  const isDirectory = entry.directory ?? entry.isDirectory?.() ?? false;
  if (isDirectory && ignoredWorkspaceDirectoryNames.has(entry.name)) {
    return true;
  }

  return ignoredWorkspaceFileNames.has(entry.name);
}

export function isIgnoredWorkspacePath(relativePath: string | null | undefined): boolean {
  if (!relativePath) {
    return false;
  }

  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some((segment) => ignoredWorkspaceDirectoryNames.has(segment) || ignoredWorkspaceFileNames.has(segment));
}

export class ConstructProjectWorkspaceService {
  constructor(
    private readonly getWorkspaceRoot: () => string,
    private readonly getAppSourceRoot: () => string
  ) {}

  workspacePathForProject(projectId: string): string {
    return path.join(this.getWorkspaceRoot(), projectId);
  }

  isInsidePath(candidate: string, parent: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  resolveImportWorkspacePath(input: {
    program: { id: string };
    sourcePath?: string | null;
    workspacePath?: string | null;
  }, settings: StoredSettings): string {
    const fallback = path.join(settings.workspaceRoot, input.program.id);
    const requested =
      typeof input.workspacePath === "string" && input.workspacePath.trim()
        ? path.resolve(input.workspacePath)
        : fallback;
    const appSourceRoot = this.getAppSourceRoot();

    if (this.isInsidePath(requested, appSourceRoot)) {
      console.warn("[construct] import workspace was inside app source; using configured workspace root instead", {
        requested,
        fallback
      });
      return fallback;
    }

    if (typeof input.sourcePath === "string" && this.isInsidePath(path.resolve(input.sourcePath), appSourceRoot)) {
      const sourceDirectory = path.dirname(path.resolve(input.sourcePath));
      if (this.isInsidePath(requested, sourceDirectory)) {
        console.warn("[construct] sample workspace was beside app source .construct file; using configured workspace root instead", {
          requested,
          fallback
        });
        return fallback;
      }
    }

    return requested;
  }

  calculateProgress(project: StoredProject): number {
    if (isFlowProject(project)) {
      if (project.completedAt) return 100;
      const nodes = project.flow.pathNodes ?? [];
      if (!nodes.length) return project.progress ?? 0;
      const completed = nodes.filter((node) => node.status === "completed").length;
      return Math.min(100, Math.round((completed / nodes.length) * 100));
    }

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

  safeProjectPath(project: Pick<StoredProject, "workspacePath">, relativePath: string): string {
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

  async materializeInitialFiles(project: StoredProject): Promise<void> {
    await mkdir(project.workspacePath, { recursive: true });
    if (!isTapeProject(project)) {
      return;
    }

    const initialContentByPath = new Map(project.program.files.map((file) => [file.path, file.content]));

    for (const file of project.program.files) {
      const target = this.safeProjectPath(project, file.path);
      await mkdir(path.dirname(target), { recursive: true });

      if (!existsSync(target)) {
        await writeFile(target, file.content, "utf8");
        continue;
      }

      const existing = await readFile(target, "utf8").catch(() => "");
      if (this.shouldRepairInitialFile(file.path, existing, file.content, initialContentByPath)) {
        console.warn("[construct] repairing corrupted initial project file", {
          projectId: project.id,
          path: file.path,
          workspacePath: project.workspacePath
        });
        await writeFile(target, file.content, "utf8");
      }
    }

    await this.persistAuthoringArtifacts(project);
  }

  async persistAuthoringArtifacts(project: StoredTapeProject): Promise<void> {
    const directory = this.safeProjectPath(project, ".construct");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "project.construct"), project.source, "utf8");
    await writeFile(path.join(directory, "original.construct"), project.originalSource ?? project.source, "utf8");
    await writeFile(path.join(directory, "repairs.json"), `${JSON.stringify(project.authoringFixes ?? [], null, 2)}\n`, "utf8");
  }

  async listWorkspaceTree(project: StoredProject, root = ""): Promise<WorkspaceTreeNode[]> {
    const absoluteRoot = this.safeProjectPath(project, root || ".");
    const entries = await readdir(absoluteRoot, { withFileTypes: true });
    const artifactRoot = this.absolutePathArtifactRoot(project);
    const nodes = await Promise.all(
      entries
        .filter((entry) => !isIgnoredWorkspaceEntry(entry))
        .filter((entry) => !(root === "" && artifactRoot === entry.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map(async (entry) => {
          const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
          return {
            name: entry.name,
            path: relativePath,
            type: entry.isDirectory() ? "directory" : "file",
            children: entry.isDirectory()
              ? await this.listWorkspaceTree(project, path.join(root, entry.name))
              : undefined
          } satisfies WorkspaceTreeNode;
        })
    );

    return nodes;
  }

  summarizeProject(project: StoredProject): ProjectSummary {
    if (isFlowProject(project)) {
      return {
        kind: "flow",
        id: project.id,
        title: project.title,
        description: project.description,
        progress: project.progress,
        lastOpenedAt: project.lastOpenedAt,
        createdAt: project.flow.createdAt,
        workspacePath: project.workspacePath,
        sourcePath: project.sourcePath ?? null,
        currentStepIndex: undefined,
        currentBlockIndex: undefined,
        currentStepTitle: null,
        currentBlockKind: null,
        currentBlockLabel: project.flow.goal,
        activeFilePath: project.activeFilePath ?? null,
        stepCount: undefined,
        blockCount: undefined,
        completedBlockCount: undefined,
        fileCount: undefined,
        conceptCount: undefined,
        referenceCount: undefined,
        verificationPassCount: 0,
        verificationFailCount: 0,
        authoringFixCount: 0,
        completedAt: project.completedAt ?? null,
        learnedConcepts: [],
        flowGoal: project.flow.goal,
        flowMemoryFileCount: 4,
        flowSessionCount: project.flow.sessions.length,
        flowLastActivityAt: project.flow.updatedAt
      };
    }

    const currentStep = project.program.steps[project.currentStepIndex] ?? null;
    const currentBlock = currentStep?.blocks[project.currentBlockIndex] ?? null;
    const blockCount = project.program.steps.reduce((total, step) => total + step.blocks.length, 0);
    const completedBlockCount = Object.values(project.completedBlocks ?? {}).filter(Boolean).length;
    const verificationResults = Object.values(project.verificationResults ?? {});
    const learnedConcepts = collectTapeConceptSummaries(project);

    return {
      kind: "tape",
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
      completedAt: project.completedAt ?? null,
      learnedConcepts
    };
  }

  async migrateProjectsToWorkspaceRoot(projects: StoredProject[], workspaceRoot: string): Promise<void> {
    await mkdir(workspaceRoot, { recursive: true });

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
  }

  private absolutePathArtifactRoot(project: StoredProject): string | null {
    const workspaceSegments = path.resolve(project.workspacePath).split(path.sep).filter(Boolean);
    if (workspaceSegments.length < 2) {
      return null;
    }

    const [firstSegment, ...rest] = workspaceSegments;
    const artifactProbe = path.join(project.workspacePath, firstSegment, ...rest);
    return existsSync(artifactProbe) ? firstSegment : null;
  }

  private shouldRepairInitialFile(
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
}

function collectTapeConceptSummaries(project: StoredTapeProject): ProjectLearnedConceptSummary[] {
  return (project.program.concepts ?? [])
    .map(toProjectLearnedConceptSummary)
    .filter((concept): concept is ProjectLearnedConceptSummary => Boolean(concept))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function toProjectLearnedConceptSummary(value: unknown): ProjectLearnedConceptSummary | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : id ? titleFromConceptId(id) : null;
  if (!id || !title) return null;

  return {
    id,
    title,
    kind: typeof record.kind === "string" && record.kind.trim() ? record.kind.trim() : "concept",
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined,
    language: typeof record.language === "string" ? (record.language as ProjectLearnedConceptSummary["language"]) : undefined,
    technology: typeof record.technology === "string" && record.technology.trim() ? record.technology.trim() : undefined,
    masteryLevel: typeof record.masteryLevel === "number" ? (record.masteryLevel as ProjectLearnedConceptSummary["masteryLevel"]) : undefined,
    masteryText: typeof record.masteryText === "string" && record.masteryText.trim() ? record.masteryText.trim() : undefined,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : undefined,
    lastModifiedAt: typeof record.lastModifiedAt === "string" ? record.lastModifiedAt : undefined
  };
}

function titleFromConceptId(id: string): string {
  return id
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
