import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import type { IpcMain } from "electron";

import type { StoredSettings } from "../config/constructConfig";
import { ConstructFlowMemoryService, FLOW_MEMORY_FILES } from "../flow/ConstructFlowMemoryService";
import { rememberFlowProjectSnapshot } from "../flow/ConstructFlowProjectSnapshotStore";
import { applyFlowQuestionResponse, ConstructFlowService } from "../flow/ConstructFlowService";
import type { ProjectWriteOptions } from "../projects/ConstructProjectRepository";
import type { StoredFlowProject, StoredProject } from "../projects/ConstructProjectTypes";
import { isFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import type {
  ConstructFlowAgentInput,
  ConstructFlowProjectSettings,
  ConstructFlowRewindInput,
  ConstructFlowSessionEvent,
  FlowMemoryFileName
} from "../../shared/constructFlow";

export class ConstructFlowIpcController {
  private flowProjectWriteQueue: Promise<void> = Promise.resolve();
  private readonly pendingFlowProjectWriteTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingFlowProjectWriteReasons = new Map<string, string>();

  constructor(private readonly options: {
    ipcMain: IpcMain;
    readSettings: () => Promise<StoredSettings>;
    readProjects: () => Promise<StoredProject[]>;
    writeProjects: (projects: StoredProject[]) => Promise<void>;
    writeProject: (project: StoredProject, options?: ProjectWriteOptions) => Promise<void>;
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
      const title = String(input?.title ?? "Flow Project").trim() || "Flow Project";
      const goal = String(input?.goal ?? input?.description ?? "").trim() || "Build and understand this project.";
      const projectSettings = normalizeProjectSettings(input?.projectSettings);
      const id = uniqueProjectId(slugify(title), projects);
      const requestedWorkspace = typeof input?.workspacePath === "string" && input.workspacePath.trim()
        ? path.resolve(input.workspacePath)
        : this.options.workspacePathForProject(id);
      const workspacePath = this.options.workspace.isInsidePath(requestedWorkspace, this.options.getAppSourceRoot())
        ? path.join(settings.workspaceRoot, id)
        : requestedWorkspace;
      const project: StoredFlowProject = {
        kind: "flow",
        id,
        title,
        description: goal,
        progress: 0,
        lastOpenedAt: now,
        workspacePath,
        sourcePath: null,
        activeFilePath: null,
        fileTreeExpanded: [],
        completedAt: null,
        flow: {
          goal,
          stackPreference: typeof input?.stackPreference === "string" ? input.stackPreference : undefined,
          autonomyPreference: input?.autonomyPreference === "guided" || input?.autonomyPreference === "agentic"
            ? input.autonomyPreference
            : "balanced",
          permissionsPreference: input?.permissionsPreference === "agentic" || input?.permissionsPreference === "workspace"
            ? input.permissionsPreference
            : projectSettings.agentEdits,
          projectSettings,
          memoryDirectory: ".construct",
          threadId: randomUUID(),
          researchEnabled: typeof input?.researchFirst === "boolean" ? input.researchFirst : false,
          researchCompletedAt: null,
          pathNodes: [],
          currentPathNodeId: null,
          pathCreatedAt: null,
          pathUpdatedAt: null,
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
        const publishSessionEvent = this.createPersistedSessionEventSink(event.sender, project);
        this.options.flow.runResearchAgent(project, publishSessionEvent)
          .then(async () => this.queueProjectWrite(project, "research-completed"))
          .catch((error) => {
            console.error("[construct-flow] background research failed", error);
          });
      } else {
        const publishSessionEvent = this.createPersistedSessionEventSink(event.sender, project);
        await this.options.flow.runMainAgent(project, {
          projectId: project.id,
          startReason: "new-project",
          message: "Start this new Flow project. Use the project goal, project settings, and current workspace context to decide the next helpful mentor step."
        }, publishSessionEvent);
        await this.queueProjectWrite(project, "new-project-main-agent");
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
      await this.queueProjectWrite(project, "memory-update");
      return result;
    });

    ipcMain.handle("construct:flow:run-agent", async (event, input: ConstructFlowAgentInput) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      this.options.setActiveWebContents(event.sender);
      if (input.questionResponse && applyFlowQuestionResponse(project, input.questionResponse)) {
        await this.queueProjectWrite(project, "question-response-received");
      }
      const result = await this.options.flow.runMainAgent(
        project,
        input,
        this.createPersistedSessionEventSink(event.sender, project)
      );
      await this.queueProjectWrite(project, "run-agent-completed");
      return result;
    });

    ipcMain.handle("construct:flow:research", async (event, input) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      this.options.setActiveWebContents(event.sender);
      const result = await this.options.flow.runResearchAgent(
        project,
        this.createPersistedSessionEventSink(event.sender, project)
      );
      await this.queueProjectWrite(project, "research-completed");
      return { ...result, project };
    });

    ipcMain.handle("construct:flow:submit-task", async (_event, input) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      const submission = await this.options.flow.submitPracticeTask(
        project,
        String(input?.taskId ?? ""),
        typeof input?.note === "string" ? input.note : undefined,
        typeof input?.subtaskId === "string" ? input.subtaskId : undefined
      );
      await this.queueProjectWrite(project, "task-submission");
      return submission;
    });

    ipcMain.handle("construct:flow:rewind-session", async (_event, input: ConstructFlowRewindInput) => {
      const projects = await this.options.readProjects();
      const project = this.findFlowProject(projects, String(input?.projectId ?? ""));
      const sessionId = String(input?.sessionId ?? "");
      const index = project.flow.sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        throw new Error(`Unknown Flow session: ${sessionId}`);
      }

      const target = project.flow.sessions[index];
      const userMessage = target.messages.find((message) => message.role === "user");
      if (!userMessage || target.origin === "system" || target.origin === "task-submission") {
        throw new Error("Only editable learner chat messages can be rewound.");
      }

      const removedTaskIds = new Set(
        project.flow.sessions
          .slice(index)
          .flatMap((session) => session.practiceTasks)
          .map((task) => task.id)
      );
      project.flow.sessions = project.flow.sessions.slice(0, index);
      if (removedTaskIds.size > 0 && project.flow.pathNodes) {
        project.flow.pathNodes = project.flow.pathNodes.map((node) => ({
          ...node,
          taskIds: node.taskIds?.filter((taskId) => !removedTaskIds.has(taskId))
        }));
      }
      project.flow.updatedAt = new Date().toISOString();
      await this.queueProjectWrite(project, "rewind-session");
      return project;
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

  private createPersistedSessionEventSink(
    webContents: Electron.WebContents,
    project: StoredFlowProject
  ) {
    let pendingRendererPayload: ConstructFlowSessionEvent | null = null;
    let pendingRendererTimer: NodeJS.Timeout | null = null;
    const flushRendererUpdate = () => {
      if (pendingRendererTimer) {
        clearTimeout(pendingRendererTimer);
        pendingRendererTimer = null;
      }
      const payload = pendingRendererPayload;
      pendingRendererPayload = null;
      if (payload && !webContents.isDestroyed()) {
        webContents.send("construct:flow:session-event", payload);
      }
    };

    return (payload: ConstructFlowSessionEvent) => {
      applyFlowSessionSnapshot(project, payload);

      if (payload.type === "updated") {
        pendingRendererPayload = payload;
        if (!pendingRendererTimer) {
          pendingRendererTimer = setTimeout(flushRendererUpdate, 120);
          pendingRendererTimer.unref?.();
        }
      } else {
        flushRendererUpdate();
        if (!webContents.isDestroyed()) {
          webContents.send("construct:flow:session-event", payload);
        }
      }

      if (payload.type === "updated") {
        this.scheduleCoalescedProjectWrite(project, `session-${payload.type}`, {
          changedFlowSessionId: payload.session.id,
          includeProjectRecord: false,
          includeFlowSessions: false
        });
        return;
      }

      this.cancelCoalescedProjectWrite(project.id);
      void this.queueProjectWrite(project, `session-${payload.type}`, {
        changedFlowSessionId: payload.session.id,
        includeProjectRecord: true,
        includeFlowSessions: false,
        ensureIndexed: true
      });
    };
  }

  private scheduleCoalescedProjectWrite(
    project: StoredFlowProject,
    reason: string,
    options: ProjectWriteOptions
  ): void {
    rememberFlowProjectSnapshot(project);
    this.pendingFlowProjectWriteReasons.set(project.id, reason);
    const existing = this.pendingFlowProjectWriteTimers.get(project.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingFlowProjectWriteTimers.delete(project.id);
      const latestReason = this.pendingFlowProjectWriteReasons.get(project.id) ?? reason;
      this.pendingFlowProjectWriteReasons.delete(project.id);
      void this.queueProjectWrite(project, latestReason, options);
    }, 1_000);
    timer.unref?.();
    this.pendingFlowProjectWriteTimers.set(project.id, timer);
  }

  private cancelCoalescedProjectWrite(projectId: string): void {
    const timer = this.pendingFlowProjectWriteTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.pendingFlowProjectWriteTimers.delete(projectId);
    this.pendingFlowProjectWriteReasons.delete(projectId);
  }

  private queueProjectWrite(project: StoredFlowProject, reason: string, options: ProjectWriteOptions = {
    includeProjectRecord: true,
    includeFlowSessions: true,
    ensureIndexed: true,
    pruneStaleFlowSessions: true
  }): Promise<void> {
    rememberFlowProjectSnapshot(project);
    const write = this.flowProjectWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await this.options.writeProject(project, options);
        rememberFlowProjectSnapshot(project);
      });
    this.flowProjectWriteQueue = write.catch((error) => {
      console.error("[construct-flow] failed to persist Flow project snapshot", {
        projectId: project.id,
        reason,
        error
      });
    });
    return write;
  }
}

export function applyFlowSessionSnapshot(project: StoredFlowProject, payload: ConstructFlowSessionEvent): void {
  const index = project.flow.sessions.findIndex((session) => session.id === payload.session.id);
  if (index >= 0) {
    Object.assign(project.flow.sessions[index], payload.session);
  } else {
    project.flow.sessions.push(payload.session);
  }
  if (payload.type === "completed" && payload.session.threadId === `${project.flow.threadId}:research`) {
    project.flow.researchEnabled = true;
    project.flow.researchCompletedAt = payload.session.updatedAt ?? new Date().toISOString();
  }
  project.flow.updatedAt = payload.session.updatedAt ?? new Date().toISOString();
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

const defaultFlowProjectSettings: ConstructFlowProjectSettings = {
  projectType: "app",
  codebaseState: "empty",
  projectPhase: "build",
  setupScope: "standard",
  packageManager: "auto",
  testStrategy: "unit",
  docsLevel: "standard",
  gitStrategy: "initialize",
  agentEdits: "ask",
  openWorkspace: true
};

function normalizeProjectSettings(input: unknown): ConstructFlowProjectSettings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    projectType: readOption(value.projectType, ["app", "library", "cli", "agent", "research"], defaultFlowProjectSettings.projectType),
    codebaseState: readOption(value.codebaseState, ["empty", "existing", "mixed"], defaultFlowProjectSettings.codebaseState),
    projectPhase: readOption(value.projectPhase, ["explore", "build", "refactor", "ship"], defaultFlowProjectSettings.projectPhase),
    setupScope: readOption(value.setupScope, ["minimal", "standard", "complete"], defaultFlowProjectSettings.setupScope),
    packageManager: readOption(value.packageManager, ["auto", "pnpm", "npm", "yarn", "bun"], defaultFlowProjectSettings.packageManager),
    testStrategy: readOption(value.testStrategy, ["none", "smoke", "unit", "full"], defaultFlowProjectSettings.testStrategy),
    docsLevel: readOption(value.docsLevel, ["none", "brief", "standard", "detailed"], defaultFlowProjectSettings.docsLevel),
    gitStrategy: readOption(value.gitStrategy, ["skip", "initialize", "existing"], defaultFlowProjectSettings.gitStrategy),
    agentEdits: readOption(value.agentEdits, ["ask", "workspace", "agentic"], defaultFlowProjectSettings.agentEdits),
    openWorkspace: typeof value.openWorkspace === "boolean" ? value.openWorkspace : defaultFlowProjectSettings.openWorkspace
  };
}

function readOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}
