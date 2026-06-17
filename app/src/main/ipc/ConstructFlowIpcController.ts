import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import type { IpcMain } from "electron";

import type { StoredSettings } from "../config/constructConfig";
import { ConstructFlowMemoryService, FLOW_MEMORY_FILES } from "../flow/ConstructFlowMemoryService";
import { ConstructFlowService } from "../flow/ConstructFlowService";
import type { StoredFlowProject, StoredProject } from "../projects/ConstructProjectTypes";
import { isFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import type { ConstructFlowAgentInput, FlowMemoryFileName } from "../../shared/constructFlow";

export class ConstructFlowIpcController {
  constructor(private readonly options: {
    ipcMain: IpcMain;
    readSettings: () => Promise<StoredSettings>;
    readProjects: () => Promise<StoredProject[]>;
    writeProjects: (projects: StoredProject[]) => Promise<void>;
    workspace: ConstructProjectWorkspaceService;
    flowMemory: ConstructFlowMemoryService;
    flow: ConstructFlowService;
    workspacePathForProject: (projectId: string) => string;
    setActiveWebContents: (webContents: Electron.WebContents) => void;
    getAppSourceRoot: () => string;
  }) {}

  register(): void {
    const { ipcMain } = this.options;

    ipcMain.handle("construct:flow:create", async (event, input) => {
      const projects = await this.options.readProjects();
      const settings = await this.options.readSettings();
      const now = new Date().toISOString();
      const id = uniqueProjectId(slugify(String(input?.title ?? "flow-project")), projects);
      const requestedWorkspace = typeof input?.workspacePath === "string" && input.workspacePath.trim()
        ? path.resolve(input.workspacePath)
        : this.options.workspacePathForProject(id);
      const workspacePath = this.options.workspace.isInsidePath(requestedWorkspace, this.options.getAppSourceRoot())
        ? path.join(settings.workspaceRoot, id)
        : requestedWorkspace;
      const project: StoredFlowProject = {
        kind: "flow",
        id,
        title: String(input?.title ?? "Flow Project").trim() || "Flow Project",
        description: String(input?.goal ?? input?.description ?? "").trim() || "Construct Flow project",
        progress: 0,
        lastOpenedAt: now,
        workspacePath,
        sourcePath: null,
        activeFilePath: null,
        fileTreeExpanded: [],
        completedAt: null,
        flow: {
          goal: String(input?.goal ?? input?.description ?? "").trim() || "Build and understand this project.",
          stackPreference: typeof input?.stackPreference === "string" ? input.stackPreference : undefined,
          autonomyPreference: input?.autonomyPreference === "guided" || input?.autonomyPreference === "agentic" ? input.autonomyPreference : "balanced",
          permissionsPreference: input?.permissionsPreference === "agentic" || input?.permissionsPreference === "workspace" ? input.permissionsPreference : "ask",
          memoryDirectory: ".construct/flow-memory",
          threadId: randomUUID(),
          researchEnabled: input?.researchFirst !== false,
          researchCompletedAt: null,
          sessions: [],
          createdAt: now,
          updatedAt: now
        }
      };

      await mkdir(project.workspacePath, { recursive: true });
      await this.options.flowMemory.ensure(project);
      projects.push(project);
      await this.options.writeProjects(projects);
      this.options.setActiveWebContents(event.sender);

      if (project.flow.researchEnabled) {
        await this.options.flow.runResearchAgent(project, (payload) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("construct:flow:session-event", payload);
          }
        });
        await this.options.writeProjects(projects);
      }

      return project;
    });

    ipcMain.handle("construct:flow:memory-read", async (_event, input) => {
      const project = await this.flowProjectById(String(input?.projectId ?? ""));
      const files = Array.isArray(input?.files)
        ? input.files.filter((file: unknown): file is FlowMemoryFileName => FLOW_MEMORY_FILES.includes(file as FlowMemoryFileName))
        : undefined;
      return this.options.flowMemory.read(project, files);
    });

    ipcMain.handle("construct:flow:memory-update", async (_event, input) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      const updates = Array.isArray(input?.updates) ? input.updates : [];
      const result = await this.options.flowMemory.update(project, updates);
      project.flow.updatedAt = new Date().toISOString();
      await this.options.writeProjects(projects);
      return result;
    });

    ipcMain.handle("construct:flow:run-agent", async (event, input: ConstructFlowAgentInput) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      this.options.setActiveWebContents(event.sender);
      const result = await this.options.flow.runMainAgent(project, input, (payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("construct:flow:session-event", payload);
        }
      });
      await this.options.writeProjects(projects);
      return result;
    });

    ipcMain.handle("construct:flow:research", async (event, input) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      this.options.setActiveWebContents(event.sender);
      const result = await this.options.flow.runResearchAgent(project, (payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("construct:flow:session-event", payload);
        }
      });
      await this.options.writeProjects(projects);
      return result;
    });

    ipcMain.handle("construct:flow:submit-task", async (_event, input) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      const submission = await this.options.flow.submitPracticeTask(project, String(input?.taskId ?? ""), typeof input?.note === "string" ? input.note : undefined);
      await this.options.writeProjects(projects);
      return submission;
    });
  }

  private async flowProjectById(projectId: string): Promise<StoredFlowProject> {
    return this.findFlowProject(await this.options.readProjects(), projectId);
  }

  private findFlowProject(projects: StoredProject[], projectId: string): StoredFlowProject {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`Unknown Construct project: ${projectId}`);
    }
    if (!isFlowProject(project)) {
      throw new Error(`Project "${projectId}" is not a Flow project.`);
    }
    return project;
  }
}

function uniqueProjectId(base: string, projects: StoredProject[]): string {
  const existing = new Set(projects.map((project) => project.id));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "flow-project";
}
