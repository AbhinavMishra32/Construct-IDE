import path from "node:path";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import type { IpcMain, WebContents } from "electron";

import type { StoredSettings } from "../config/constructConfig";
import { ConstructProjectGitService } from "../projects/ConstructProjectGitService";
import { isFlowProject, isTapeProject, type ProjectSummary, type StoredProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";

export class ConstructProjectIpcController {
  private activeWatcher: FSWatcher | null = null;
  private watchTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly options: {
    ipcMain: IpcMain;
    readSettings: () => Promise<StoredSettings>;
    readProjects: () => Promise<StoredProject[]>;
    writeProjects: (projects: StoredProject[]) => Promise<void>;
    findProject: (projects: StoredProject[], projectId: string) => StoredProject;
    workspace: ConstructProjectWorkspaceService;
    git: ConstructProjectGitService;
    workspacePathForProject: (projectId: string) => string;
    summarizeProject: (project: StoredProject) => ProjectSummary;
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

    try {
      this.activeWatcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
        if (filename && (
          filename.includes("node_modules") ||
          filename.includes(".git") ||
          filename.includes(".turbo") ||
          filename.includes(".DS_Store")
        )) {
          return;
        }

        if (this.watchTimeout) {
          clearTimeout(this.watchTimeout);
        }
        this.watchTimeout = setTimeout(() => {
          try {
            if (!webContents.isDestroyed()) {
              webContents.send("construct:project:file-changed");
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
      const projects = await this.options.readProjects();
      const settings = await this.options.readSettings();
      const existingIndex = projects.findIndex((project) => project.id === input.program.id);
      const now = new Date().toISOString();
      const workspacePath = this.options.workspace.resolveImportWorkspacePath(input, settings);

      if (existingIndex >= 0) {
        const existing = projects[existingIndex];
        if (isFlowProject(existing)) {
          throw new Error(`Project "${input.program.id}" is a Flow project and cannot be replaced by a tape import.`);
        }
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
        projects[existingIndex].progress = this.options.workspace.calculateProgress(projects[existingIndex]);
        await this.options.workspace.materializeInitialFiles(projects[existingIndex]);
        if (input.initializeGit === true) {
          await this.options.git.initializeRepository(projects[existingIndex].workspacePath);
        }
        await this.options.writeProjects(projects);
        return projects[existingIndex];
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
      projects.push(project);
      await this.options.writeProjects(projects);
      return project;
    });

    ipcMain.handle("construct:project:ensure", async (_event, input) => {
      const projects = await this.options.readProjects();
      const existing = projects.find((project) => project.id === input.program.id);
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
        await this.options.writeProjects(projects);
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
      projects.push(project);
      await this.options.writeProjects(projects);
      return project;
    });

    ipcMain.handle("construct:project:list", async () => {
      return (await this.options.readProjects()).map(this.options.summarizeProject);
    });

    ipcMain.handle("construct:project:open", async (_event, id: string) => {
      console.log("[construct] open project requested", { id });
      const projects = await this.options.readProjects();
      const project = this.options.findProject(projects, id);

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
      await this.options.workspace.materializeInitialFiles(project);
      await this.options.writeProjects(projects);
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
      return { success: true };
    });

    ipcMain.handle("construct:project:update", async (_event, input) => {
      const projects = await this.options.readProjects();
      const index = projects.findIndex((project) => project.id === input.id);

      if (index < 0) {
        throw new Error(`Unknown Construct project: ${input.id}`);
      }

      projects[index] = {
        ...projects[index],
        ...input.patch
      };
      projects[index].progress = this.options.workspace.calculateProgress(projects[index]);
      await this.options.writeProjects(projects);
      return projects[index];
    });

    ipcMain.handle("construct:project:read-tape", async (_event, projectId: string) => {
      const project = this.options.findProject(await this.options.readProjects(), projectId);
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
      const projects = await this.options.readProjects();
      const project = this.options.findProject(projects, input.projectId);
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
      await this.options.writeProjects(projects);
      return project;
    });

    ipcMain.handle("construct:project:list-files", async (_event, projectId: string) => {
      const project = this.options.findProject(await this.options.readProjects(), projectId);
      await mkdir(project.workspacePath, { recursive: true });
      return this.options.workspace.listWorkspaceTree(project);
    });

    ipcMain.handle("construct:project:read-file", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
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

    ipcMain.handle("construct:project:write-file", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return {
        path: input.path,
        content: input.content
      };
    });

    ipcMain.handle("construct:project:delete-file", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      const fileStat = await stat(target);
      if (fileStat.isDirectory()) {
        await rm(target, { recursive: true, force: true });
      } else {
        await rm(target, { force: true });
      }
    });

    ipcMain.handle("construct:project:rename-file", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      const oldTarget = this.options.workspace.safeProjectPath(project, input.oldPath);
      const newTarget = this.options.workspace.safeProjectPath(project, input.newPath);
      await mkdir(path.dirname(newTarget), { recursive: true });
      await rename(oldTarget, newTarget);
    });

    ipcMain.handle("construct:project:create-folder", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      const target = this.options.workspace.safeProjectPath(project, input.path);
      await mkdir(target, { recursive: true });
    });

    ipcMain.handle("construct:project:duplicate-file", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      const srcTarget = this.options.workspace.safeProjectPath(project, input.path);
      const destTarget = this.options.workspace.safeProjectPath(project, input.destPath);
      await mkdir(path.dirname(destTarget), { recursive: true });
      await cp(srcTarget, destTarget, { recursive: true });
    });

    ipcMain.handle("construct:project:git-status", async (_event, projectId: string) => {
      const project = this.options.findProject(await this.options.readProjects(), projectId);
      return this.options.git.getStatus(project);
    });

    ipcMain.handle("construct:project:git-commit", async (_event, input) => {
      const project = this.options.findProject(await this.options.readProjects(), input.projectId);
      return this.options.git.commitMilestone(
        project,
        String(input.message ?? ""),
        Array.isArray(input.paths) ? input.paths.map(String) : []
      );
    });

    ipcMain.handle("construct:project:git-push", async (_event, projectId: string) => {
      const project = this.options.findProject(await this.options.readProjects(), projectId);
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
}
