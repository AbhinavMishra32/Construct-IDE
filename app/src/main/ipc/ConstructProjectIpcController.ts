import path from "node:path";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import type { IpcMain, WebContents } from "electron";

import type { StoredSettings } from "../config/constructConfig";
import { applyLiveFlowProjectSnapshot } from "../flow/ConstructFlowProjectSnapshotStore";
import { ConstructProjectGitService } from "../projects/ConstructProjectGitService";
import { isFlowProject, isTapeProject, type ProjectSummary, type StoredProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService, isIgnoredWorkspacePath } from "../projects/ConstructProjectWorkspaceService";

const LSP_EXTERNAL_SOURCE_MAX_BYTES = 10 * 1024 * 1024;

export class ConstructProjectIpcController {
  private activeWatcher: FSWatcher | null = null;
  private watchTimeout: NodeJS.Timeout | null = null;
  private watchChangedPaths = new Set<string>();

  constructor(private readonly options: {
    ipcMain: IpcMain;
    readSettings: () => Promise<StoredSettings>;
    readProjects: () => Promise<StoredProject[]>;
    readProject: (projectId: string) => Promise<StoredProject | null>;
    readProjectSummaries: () => Promise<ProjectSummary[]>;
    writeProjects: (projects: StoredProject[]) => Promise<void>;
    writeProject: (project: StoredProject) => Promise<void>;
    workspace: ConstructProjectWorkspaceService;
    git: ConstructProjectGitService;
    workspacePathForProject: (projectId: string) => string;
    setActiveWebContents: (webContents: WebContents) => void;
    getAppSourceRoot: () => string;
  }) {}

  private setupWatcher(workspacePath: string, webContents: WebContents): void {
    if (this.activeWatcher) {
      try {
        this.activeWatcher.close();
      } catch (err) {
        console.error("[watcher] error closing active watcher", err);
      }
      this.activeWatcher = null;
    }
    if (this.watchTimeout) {
      clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    this.watchChangedPaths.clear();

    try {
      this.activeWatcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
        const relativePath = typeof filename === "string" ? filename.replace(/\\/g, "/") : null;
        if (isIgnoredWorkspacePath(relativePath)) {
          return;
        }

        if (relativePath) {
          this.watchChangedPaths.add(relativePath);
        }
        if (this.watchTimeout) {
          clearTimeout(this.watchTimeout);
        }
        this.watchTimeout = setTimeout(() => {
          try {
            if (!webContents.isDestroyed()) {
              const paths = Array.from(this.watchChangedPaths);
              this.watchChangedPaths.clear();
              webContents.send("construct:project:file-changed", {
                eventType,
                path: paths[0] ?? null,
                paths
              });
            }
          } catch (err) {
            console.error("[watcher] error sending file-changed event", err);
          }
        }, 300);
      });
      console.log(`[watcher] started watching workspace: ${workspacePath}`);
    } catch (err) {
      console.error(`[watcher] failed to start watcher for workspace ${workspacePath}`, err);
    }
  }

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:project:import", async (_event, input) => {
      const settings = await this.options.readSettings();
      const existing = await this.options.readProject(input.program.id);
      const now = new Date().toISOString();
      const workspacePath = this.options.workspace.resolveImportWorkspacePath(input, settings);

      if (existing) {
        if (isFlowProject(existing)) {
          throw new Error(`Project "${input.program.id}" is a Flow project and cannot be replaced by a tape import.`);
        }
        const project = {
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
        project.progress = this.options.workspace.calculateProgress(project);
        await this.options.workspace.materializeInitialFiles(project);
        if (input.initializeGit === true) {
          await this.options.git.initializeRepository(project.workspacePath);
        }
        await this.options.writeProject(project);
        return project;
      }

      const project: StoredProject = {
        kind: "tape",
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

      await this.options.workspace.materializeInitialFiles(project);
      if (input.initializeGit === true) {
        await this.options.git.initializeRepository(project.workspacePath);
      }
      await this.options.writeProject(project);
      return project;
    });

    ipcMain.handle("construct:project:ensure", async (_event, input) => {
      const existing = await this.options.readProject(input.program.id);
      const now = new Date().toISOString();

      if (existing) {
        if (isFlowProject(existing)) {
          throw new Error(`Project "${input.program.id}" is a Flow project and cannot be replaced by a tape.`);
        }
        existing.source = input.source;
        existing.program = input.program;
        existing.title = input.program.title;
        existing.description = input.program.description;
        existing.sourcePath = typeof input.sourcePath === "string" ? input.sourcePath : existing.sourcePath ?? null;
        existing.progress = this.options.workspace.calculateProgress(existing);
        await this.options.workspace.materializeInitialFiles(existing);
        await this.options.writeProject(existing);
        return existing;
      }

      const project: StoredProject = {
        kind: "tape",
        id: input.program.id,
        title: input.program.title,
        description: input.program.description,
        progress: 0,
        lastOpenedAt: null,
        workspacePath: this.options.workspacePathForProject(input.program.id),
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

      await this.options.workspace.materializeInitialFiles(project);
      project.lastOpenedAt = now;
      await this.options.writeProject(project);
      return project;
    });

    ipcMain.handle("construct:project:list", async () => {
      return this.options.readProjectSummaries();
    });

    ipcMain.handle("construct:project:open", async (_event, id: string) => {
      console.log("[construct] open project requested", { id });
      let project = await this.projectById(id);

      project.lastOpenedAt = new Date().toISOString();
      if (this.options.workspace.isInsidePath(project.workspacePath, this.options.getAppSourceRoot())) {
        const nextWorkspacePath = this.options.workspacePathForProject(project.id);
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
        if (this.options.workspace.isInsidePath(activePath, workspace)) {
          project.activeFilePath = path.relative(workspace, activePath).split(path.sep).join("/");
        } else {
          console.warn("[construct] active file escaped workspace; resetting to first project file", {
            id: project.id,
            activeFilePath: project.activeFilePath,
            workspacePath: project.workspacePath
          });
          project.activeFilePath = isTapeProject(project) ? project.program.files[0]?.path ?? null : null;
        }
      }
      const liveProject = applyLiveFlowProjectSnapshot(project);
      if (liveProject !== project) {
        project = liveProject;
      }
      await this.options.workspace.materializeInitialFiles(project);
      await this.options.writeProject(project);
      this.options.setActiveWebContents(_event.sender);
      console.log("[construct] open project resolved", {
        id: project.id,
        title: project.title,
        kind: project.kind ?? "tape",
        stepCount: isTapeProject(project) ? project.program.steps.length : null,
        fileCount: isTapeProject(project) ? project.program.files.length : null,
        activeFilePath: project.activeFilePath,
        currentStepIndex: isTapeProject(project) ? project.currentStepIndex : null,
        currentBlockIndex: isTapeProject(project) ? project.currentBlockIndex : null
      });

      this.setupWatcher(project.workspacePath, _event.sender);

      return project;
    });

    ipcMain.handle("construct:project:close", async () => {
      if (this.activeWatcher) {
        try {
          this.activeWatcher.close();
          console.log("[watcher] stopped watching workspace");
        } catch (err) {
          console.error("[watcher] error closing watcher on project close", err);
        }
        this.activeWatcher = null;
      }
      if (this.watchTimeout) {
        clearTimeout(this.watchTimeout);
        this.watchTimeout = null;
      }
      this.watchChangedPaths.clear();
      return { success: true };
    });

    ipcMain.handle("construct:project:update", async (_event, input) => {
      const currentProject = applyLiveFlowProjectSnapshot(await this.projectById(input.id));
      const project = {
        ...currentProject,
        ...input.patch
      };
      project.progress = this.options.workspace.calculateProgress(project);
      await this.options.writeProject(project);
      return project;
    });

    ipcMain.handle("construct:project:read-tape", async (_event, projectId: string) => {
      const project = await this.projectById(projectId);
      if (!isTapeProject(project)) {
        throw new Error("Flow projects do not have a project tape.");
      }
      const source = project.sourcePath && existsSync(project.sourcePath)
        ? await readFile(project.sourcePath, "utf8")
        : project.source;
      return {
        projectId: project.id,
        sourcePath: project.sourcePath,
        source
      };
    });

    ipcMain.handle("construct:project:update-tape", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      if (!isTapeProject(project)) {
        throw new Error("Flow projects do not have a project tape.");
      }
      if (input.program?.id !== project.id) {
        throw new Error(`Tape project id must remain "${project.id}".`);
      }

      project.source = String(input.source ?? "");
      project.originalSource = typeof input.originalSource === "string" ? input.originalSource : project.source;
      project.authoringFixes = Array.isArray(input.authoringFixes) ? input.authoringFixes : [];
      project.program = input.program;
      project.title = input.program.title;
      project.description = input.program.description;
      project.currentStepIndex = Math.min(project.currentStepIndex, Math.max(0, project.program.steps.length - 1));
      project.currentBlockIndex = Math.min(
        project.currentBlockIndex,
        Math.max(0, (project.program.steps[project.currentStepIndex]?.blocks.length ?? 1) - 1)
      );
      project.progress = this.options.workspace.calculateProgress(project);

      if (project.sourcePath) {
        await mkdir(path.dirname(project.sourcePath), { recursive: true });
        await writeFile(project.sourcePath, project.source, "utf8");
      }
      await this.options.workspace.materializeInitialFiles(project);
      await this.options.writeProject(project);
      return project;
    });

    ipcMain.handle("construct:project:list-files", async (_event, projectId: string) => {
      const project = await this.projectById(projectId);
      await mkdir(project.workspacePath, { recursive: true });
      return this.options.workspace.listWorkspaceTree(project);
    });

    ipcMain.handle("construct:project:read-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      const fileStat = await stat(target);

      if (!fileStat.isFile()) {
        throw new Error(`Not a file: ${input.path}`);
      }

      return {
        path: input.path,
        content: await readFile(target, "utf8")
      };
    });

    ipcMain.handle("construct:lsp:read-source-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      if (!input || typeof input.path !== "string" || !input.path) {
        throw new Error("A source file path is required.");
      }

      const target = path.resolve(input.path);
      if (!isAllowedLspSourcePath(project.workspacePath, target)) {
        throw new Error(`LSP source path is outside allowed source roots: ${input.path}`);
      }

      const fileStat = await stat(target);
      if (!fileStat.isFile()) {
        throw new Error(`Not a file: ${input.path}`);
      }
      if (fileStat.size > LSP_EXTERNAL_SOURCE_MAX_BYTES) {
        throw new Error(`LSP source file is too large to open safely: ${input.path}`);
      }

      return {
        path: target,
        content: await readFile(target, "utf8")
      };
    });

    ipcMain.handle("construct:project:write-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return {
        path: input.path,
        content: input.content
      };
    });

    ipcMain.handle("construct:project:delete-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      const fileStat = await stat(target);
      if (fileStat.isDirectory()) {
        await rm(target, { recursive: true, force: true });
      } else {
        await rm(target, { force: true });
      }
    });

    ipcMain.handle("construct:project:rename-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const oldTarget = this.options.workspace.safeProjectPath(project, input.oldPath);
      const newTarget = this.options.workspace.safeProjectPath(project, input.newPath);
      await mkdir(path.dirname(newTarget), { recursive: true });
      await rename(oldTarget, newTarget);
    });

    ipcMain.handle("construct:project:create-folder", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      await mkdir(target, { recursive: true });
    });

    ipcMain.handle("construct:project:duplicate-file", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      const srcTarget = this.options.workspace.safeProjectPath(project, input.path);
      const destTarget = this.options.workspace.safeProjectPath(project, input.destPath);
      await mkdir(path.dirname(destTarget), { recursive: true });
      await cp(srcTarget, destTarget, { recursive: true });
    });

    ipcMain.handle("construct:project:git-status", async (_event, projectId: string) => {
      const project = await this.projectById(projectId);
      return this.options.git.getStatus(project);
    });

    ipcMain.handle("construct:project:git-commit", async (_event, input) => {
      const project = await this.projectById(input.projectId);
      return this.options.git.commitMilestone(
        project,
        String(input.message ?? ""),
        Array.isArray(input.paths) ? input.paths.map(String) : []
      );
    });

    ipcMain.handle("construct:project:git-push", async (_event, projectId: string) => {
      const project = await this.projectById(projectId);
      return this.options.git.push(project);
    });

    ipcMain.handle("construct:project:delete", async (_event, input: { projectId: string; force?: boolean }) => {
      const projects = await this.options.readProjects();
      const index = projects.findIndex((p) => p.id === input.projectId);
      if (index < 0) {
        throw new Error(`Unknown Construct project: ${input.projectId}`);
      }
      const project = projects[index];
      const deletionRisk = await this.options.git.inspectDeletionRisk(project);

      if (!input.force) {
        return deletionRisk;
      }

      if (existsSync(project.workspacePath)) {
        await rm(project.workspacePath, { recursive: true, force: true });
      }

      projects.splice(index, 1);
      await this.options.writeProjects(projects);

      return { deleted: true as const };
    });
  }

  private async projectById(projectId: string): Promise<StoredProject> {
    const project = await this.options.readProject(projectId);
    if (!project) {
      throw new Error(`Unknown Construct project: ${projectId}`);
    }
    return project;
  }
}

function isAllowedLspSourcePath(workspacePath: string, target: string): boolean {
  if (isPathInside(workspacePath, target)) {
    return true;
  }

  if (path.extname(target) !== ".rs") {
    return false;
  }

  return lspExternalSourceRoots().some((root) => isPathInside(root, target));
}

function lspExternalSourceRoots(): string[] {
  const cargoHome = process.env.CARGO_HOME || path.join(homedir(), ".cargo");
  const rustupHome = process.env.RUSTUP_HOME || path.join(homedir(), ".rustup");
  return [
    path.join(cargoHome, "registry", "src"),
    path.join(cargoHome, "git", "checkouts"),
    path.join(rustupHome, "toolchains")
  ];
}

function isPathInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
