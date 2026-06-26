import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import type { ConstructDataPaths } from "../config/constructConfig";
import {
  APPLICATION_SCOPE,
  migrateJsonValueToStorage,
  StorageTarget,
  type IStorageEntry,
  type IStorageService
} from "../storage/storage";
import { readLegacyJsonFile, type ConstructDomainStorage } from "../storage/ConstructDomainStorage";
import { isFlowProject, type ProjectSummary, type StoredProject } from "./ConstructProjectTypes";
import type { ConstructFlowSession } from "../../shared/constructFlow";

const LEGACY_PROJECTS_STORAGE_KEY = "construct.projects";
const PROJECT_INDEX_STORAGE_KEY = "construct.projects.index";
const PROJECT_RECORD_STORAGE_PREFIX = "construct.project.";
const FLOW_SESSION_INDEX_STORAGE_PREFIX = "construct.flow.sessions.";
const FLOW_SESSION_RECORD_STORAGE_PREFIX = "construct.flow.session.";

type ProjectStorageIndex = {
  version: 1;
  projectIds: string[];
  updatedAt: string;
};

type FlowSessionStorageIndex = {
  version: 1;
  sessionIds: string[];
  updatedAt: string;
};

export type ProjectWriteOptions = {
  changedFlowSessionId?: string;
  includeFlowSessions?: boolean;
  includeProjectRecord?: boolean;
  ensureIndexed?: boolean;
  pruneStaleFlowSessions?: boolean;
};

const DEFAULT_PROJECT_WRITE_OPTIONS: ProjectWriteOptions = {
  includeProjectRecord: true,
  includeFlowSessions: true,
  ensureIndexed: true,
  pruneStaleFlowSessions: true
};

export class ConstructProjectRepository {
  constructor(
    private readonly paths: ConstructDataPaths,
    private readonly storage?: IStorageService,
    private readonly domainStorage?: ConstructDomainStorage
  ) {}

  async readAll(): Promise<StoredProject[]> {
    await mkdir(this.paths.projectsRoot, { recursive: true });

    if (this.domainStorage) {
      const migrated = await this.ensureDomainProjects();
      if (migrated) {
        return migrated;
      }
      return this.domainStorage.readProjects().map((project) => this.normalize(project));
    }

    if (this.storage) {
      const segmented = this.readSegmentedProjects();
      if (segmented) {
        return segmented;
      }

      const legacy = await this.readLegacyProjectsFromStorageOrDisk();
      if (legacy) {
        await this.writeAll(legacy);
        return legacy;
      }

      return [];
    }

    if (!existsSync(this.paths.projectsManifestPath)) {
      return [];
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return (JSON.parse(await readFile(this.paths.projectsManifestPath, "utf8")) as StoredProject[])
          .map((project) => this.normalize(project));
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

  async writeAll(projects: StoredProject[]): Promise<void> {
    if (this.domainStorage) {
      this.domainStorage.writeProjects(projects.map((project) => this.normalize(project)));
      return;
    }

    if (this.storage) {
      this.writeSegmentedProjects(projects.map((project) => this.normalize(project)));
      return;
    }

    await mkdir(this.paths.projectsRoot, { recursive: true });
    const target = this.paths.projectsManifestPath;
    const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async writeOne(project: StoredProject, options: ProjectWriteOptions = DEFAULT_PROJECT_WRITE_OPTIONS): Promise<void> {
    if (this.domainStorage) {
      this.domainStorage.writeProject(this.normalize(project), options);
      return;
    }

    if (this.storage) {
      this.writeSegmentedProject(this.normalize(project), options);
      return;
    }

    const projects = await this.readAll();
    const normalized = this.normalize(project);
    const index = projects.findIndex((candidate) => candidate.id === normalized.id);
    if (index >= 0) {
      projects[index] = normalized;
    } else {
      projects.push(normalized);
    }
    await this.writeAll(projects);
  }

  async readOne(projectId: string): Promise<StoredProject | null> {
    await mkdir(this.paths.projectsRoot, { recursive: true });
    if (this.domainStorage) {
      await this.ensureDomainProjects();
      const project = this.domainStorage.readProject(projectId);
      return project ? this.normalize(project) : null;
    }
    return (await this.readAll()).find((project) => project.id === projectId) ?? null;
  }

  async readSummaries(): Promise<ProjectSummary[]> {
    await mkdir(this.paths.projectsRoot, { recursive: true });
    if (this.domainStorage) {
      await this.ensureDomainProjects();
      return this.domainStorage.readProjectSummaries();
    }
    return (await this.readAll()).map((project) => this.summarizeFallback(project));
  }

  find(projects: StoredProject[], id: string): StoredProject {
    const project = projects.find((candidate) => candidate.id === id);

    if (!project) {
      throw new Error(`Unknown Construct project: ${id}`);
    }

    return project;
  }

  normalize(project: StoredProject): StoredProject {
    if (isFlowProject(project)) {
      return {
        ...project,
        kind: "flow",
        sourcePath: project.sourcePath ?? null,
        activeFilePath: project.activeFilePath ?? null,
        fileTreeExpanded: project.fileTreeExpanded ?? [],
        completedAt: project.completedAt ?? null,
        flow: {
          ...project.flow,
          memoryDirectory: ".construct",
          researchCompletedAt: project.flow.researchCompletedAt ?? null,
          sessions: project.flow.sessions ?? [],
          updatedAt: project.flow.updatedAt ?? project.flow.createdAt ?? new Date().toISOString()
        }
      };
    }

    return {
      ...project,
      kind: project.kind ?? "tape",
      sourcePath: project.sourcePath ?? null,
      activeFilePath: project.activeFilePath ?? project.program.files[0]?.path ?? null,
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

  private readSegmentedProjects(): StoredProject[] | null {
    if (!this.storage) return null;

    const index = this.readProjectIndex();
    if (!index) return null;

    const projects: StoredProject[] = [];
    for (const projectId of index.projectIds) {
      const stored = this.storage.getObject<StoredProject>(projectRecordKey(projectId), APPLICATION_SCOPE);
      if (!stored) continue;
      const project = this.normalize(stored);
      if (isFlowProject(project)) {
        project.flow.sessions = this.readFlowSessions(project);
      }
      projects.push(project);
    }

    return projects;
  }

  private async ensureDomainProjects(): Promise<StoredProject[] | null> {
    if (!this.domainStorage) return null;
    if (this.domainStorage.hasProjects()) return null;

    const segmented = this.storage ? this.readSegmentedProjects() : null;
    const legacy = segmented
      ?? await this.readLegacyProjectsFromStorageOrDisk()
      ?? readLegacyJsonFile<StoredProject[]>(this.paths.projectsManifestPath)?.map((project) => this.normalize(project))
      ?? null;
    if (!legacy?.length) return [];

    this.domainStorage.writeProjects(legacy.map((project) => this.normalize(project)));
    this.domainStorage.removeLegacyProjectRows();
    return legacy.map((project) => this.normalize(project));
  }

  private async readLegacyProjectsFromStorageOrDisk(): Promise<StoredProject[] | null> {
    if (!this.storage) return null;

    const stored = this.storage.getObject<StoredProject[]>(LEGACY_PROJECTS_STORAGE_KEY, APPLICATION_SCOPE);
    if (Array.isArray(stored)) {
      return stored.map((project) => this.normalize(project));
    }

    const migrated = await migrateJsonValueToStorage<StoredProject[]>({
      storage: this.storage,
      key: LEGACY_PROJECTS_STORAGE_KEY,
      scope: APPLICATION_SCOPE,
      target: StorageTarget.USER,
      legacyPath: this.paths.projectsManifestPath,
      normalize: (value) => Array.isArray(value) ? value.map((project) => this.normalize(project)) : []
    });

    return migrated ?? null;
  }

  private readProjectIndex(): ProjectStorageIndex | null {
    if (!this.storage) return null;

    const stored = this.storage.getObject<ProjectStorageIndex | string[]>(PROJECT_INDEX_STORAGE_KEY, APPLICATION_SCOPE);
    if (Array.isArray(stored)) {
      const projectIds = stored.filter((projectId): projectId is string => typeof projectId === "string" && projectId.trim().length > 0);
      return { version: 1, projectIds, updatedAt: new Date(0).toISOString() };
    }
    if (stored && typeof stored === "object" && Array.isArray(stored.projectIds)) {
      return {
        version: 1,
        projectIds: stored.projectIds.filter((projectId): projectId is string => typeof projectId === "string" && projectId.trim().length > 0),
        updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : new Date(0).toISOString()
      };
    }
    return null;
  }

  private readFlowSessions(project: Extract<StoredProject, { kind: "flow" }>): ConstructFlowSession[] {
    if (!this.storage) return project.flow.sessions ?? [];

    const inlineSessions = Array.isArray(project.flow.sessions) ? project.flow.sessions : [];
    const inlineById = new Map(inlineSessions.map((session) => [session.id, session]));
    const sessionIndex = this.readFlowSessionIndex(project.id);
    const orderedIds = sessionIndex?.sessionIds ?? inlineSessions.map((session) => session.id);
    const sessions: ConstructFlowSession[] = [];
    const seen = new Set<string>();

    for (const sessionId of orderedIds) {
      const stored = this.storage.getObject<ConstructFlowSession>(flowSessionRecordKey(project.id, sessionId), APPLICATION_SCOPE);
      const session = stored ?? inlineById.get(sessionId);
      if (!session || seen.has(session.id)) continue;
      sessions.push(session);
      seen.add(session.id);
    }

    for (const session of inlineSessions) {
      if (!seen.has(session.id)) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  private readFlowSessionIndex(projectId: string): FlowSessionStorageIndex | null {
    if (!this.storage) return null;

    const stored = this.storage.getObject<FlowSessionStorageIndex | string[]>(flowSessionIndexKey(projectId), APPLICATION_SCOPE);
    if (Array.isArray(stored)) {
      const sessionIds = stored.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0);
      return { version: 1, sessionIds, updatedAt: new Date(0).toISOString() };
    }
    if (stored && typeof stored === "object" && Array.isArray(stored.sessionIds)) {
      return {
        version: 1,
        sessionIds: stored.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0),
        updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : new Date(0).toISOString()
      };
    }
    return null;
  }

  private writeSegmentedProjects(projects: StoredProject[]): void {
    if (!this.storage) return;

    const now = new Date().toISOString();
    const keepKeys = new Set<string>([PROJECT_INDEX_STORAGE_KEY]);
    const entries: IStorageEntry[] = [{
      key: PROJECT_INDEX_STORAGE_KEY,
      value: { version: 1, projectIds: projects.map((project) => project.id), updatedAt: now } satisfies ProjectStorageIndex,
      scope: APPLICATION_SCOPE,
      target: StorageTarget.USER
    }];

    for (const project of projects) {
      for (const entry of this.projectStorageEntries(project, now)) {
        entries.push(entry);
        keepKeys.add(entry.key);
      }
    }

    this.storage.storeAll(entries);
    for (const key of this.storage.keys(APPLICATION_SCOPE)) {
      if (isSegmentedProjectStorageKey(key) && !keepKeys.has(key)) {
        this.storage.remove(key, APPLICATION_SCOPE);
      }
    }
    this.storage.remove(LEGACY_PROJECTS_STORAGE_KEY, APPLICATION_SCOPE);
  }

  private writeSegmentedProject(project: StoredProject, options: ProjectWriteOptions): void {
    if (!this.storage) return;

    const now = new Date().toISOString();
    const entries: IStorageEntry[] = [];
    const keepKeys = new Set<string>();

    if (options.ensureIndexed) {
      const projectIndex = this.readProjectIndex();
      const projectIds = projectIndex?.projectIds ?? [];
      const nextProjectIds = projectIds.includes(project.id) ? projectIds : [...projectIds, project.id];
      entries.push({
        key: PROJECT_INDEX_STORAGE_KEY,
        value: { version: 1, projectIds: nextProjectIds, updatedAt: now } satisfies ProjectStorageIndex,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER
      });
    }

    for (const entry of this.projectStorageEntries(project, now, options)) {
      entries.push(entry);
      keepKeys.add(entry.key);
    }

    this.storage.storeAll(entries);
    if (options.pruneStaleFlowSessions) {
      this.pruneStaleSessionKeys(project, keepKeys);
    }
    if (options.ensureIndexed) {
      this.storage.remove(LEGACY_PROJECTS_STORAGE_KEY, APPLICATION_SCOPE);
    }
  }

  private projectStorageEntries(
    project: StoredProject,
    now: string,
    options: ProjectWriteOptions = { includeFlowSessions: true }
  ): IStorageEntry[] {
    if (!isFlowProject(project)) {
      return options.includeProjectRecord === false ? [] : [{
        key: projectRecordKey(project.id),
        value: project,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER
      }];
    }

    const sessionIds = project.flow.sessions.map((session) => session.id);
    const shell = {
      ...project,
      flow: {
        ...project.flow,
        sessions: []
      }
    };
    const sessionsToWrite = options.includeFlowSessions
      ? project.flow.sessions
      : options.changedFlowSessionId
        ? project.flow.sessions.filter((session) => session.id === options.changedFlowSessionId)
        : [];
    const entries: IStorageEntry[] = [
      {
        key: flowSessionIndexKey(project.id),
        value: { version: 1, sessionIds, updatedAt: now } satisfies FlowSessionStorageIndex,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER
      },
      ...sessionsToWrite.map((session): IStorageEntry => ({
        key: flowSessionRecordKey(project.id, session.id),
        value: session,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER
      }))
    ];

    if (options.includeProjectRecord !== false) {
      entries.unshift({
        key: projectRecordKey(project.id),
        value: shell,
        scope: APPLICATION_SCOPE,
        target: StorageTarget.USER
      });
    }

    return entries;
  }

  private pruneStaleSessionKeys(project: StoredProject, keepKeys: Set<string>): void {
    if (!this.storage) return;

    if (!isFlowProject(project)) {
      this.storage.remove(flowSessionIndexKey(project.id), APPLICATION_SCOPE);
      for (const key of this.storage.keys(APPLICATION_SCOPE)) {
        if (key.startsWith(flowSessionRecordPrefix(project.id))) {
          this.storage.remove(key, APPLICATION_SCOPE);
        }
      }
      return;
    }

    for (const key of this.storage.keys(APPLICATION_SCOPE)) {
      if (key === flowSessionIndexKey(project.id) || key.startsWith(flowSessionRecordPrefix(project.id))) {
        if (!keepKeys.has(key)) {
          this.storage.remove(key, APPLICATION_SCOPE);
        }
      }
    }
  }

  private summarizeFallback(project: StoredProject): ProjectSummary {
    if (isFlowProject(project)) {
      return {
        kind: "flow",
        id: project.id,
        title: project.title,
        description: project.description,
        progress: project.progress,
        lastOpenedAt: project.lastOpenedAt,
        workspacePath: project.workspacePath,
        sourcePath: project.sourcePath,
        activeFilePath: project.activeFilePath,
        verificationPassCount: 0,
        verificationFailCount: 0,
        authoringFixCount: 0,
        completedAt: project.completedAt,
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
    return {
      kind: "tape",
      id: project.id,
      title: project.title,
      description: project.description,
      progress: project.progress,
      lastOpenedAt: project.lastOpenedAt,
      workspacePath: project.workspacePath,
      sourcePath: project.sourcePath,
      currentStepIndex: project.currentStepIndex,
      currentBlockIndex: project.currentBlockIndex,
      currentStepTitle: currentStep?.title ?? null,
      currentBlockKind: currentBlock?.kind ?? null,
      currentBlockLabel: currentBlock?.path ?? currentBlock?.title ?? currentBlock?.task ?? currentBlock?.content?.slice(0, 80) ?? null,
      activeFilePath: project.activeFilePath,
      stepCount: project.program.steps.length,
      blockCount,
      completedBlockCount,
      fileCount: project.program.files.length,
      conceptCount: project.program.concepts?.length ?? 0,
      referenceCount: project.program.references?.length ?? 0,
      verificationPassCount: verificationResults.filter((result) => result.passed).length,
      verificationFailCount: verificationResults.filter((result) => !result.passed).length,
      authoringFixCount: project.authoringFixes?.length ?? 0,
      completedAt: project.completedAt
    };
  }
}

function projectRecordKey(projectId: string): string {
  return `${PROJECT_RECORD_STORAGE_PREFIX}${projectId}`;
}

function flowSessionIndexKey(projectId: string): string {
  return `${FLOW_SESSION_INDEX_STORAGE_PREFIX}${projectId}`;
}

function flowSessionRecordKey(projectId: string, sessionId: string): string {
  return `${flowSessionRecordPrefix(projectId)}${sessionId}`;
}

function flowSessionRecordPrefix(projectId: string): string {
  return `${FLOW_SESSION_RECORD_STORAGE_PREFIX}${projectId}.`;
}

function isSegmentedProjectStorageKey(key: string): boolean {
  return key === PROJECT_INDEX_STORAGE_KEY ||
    key.startsWith(PROJECT_RECORD_STORAGE_PREFIX) ||
    key.startsWith(FLOW_SESSION_INDEX_STORAGE_PREFIX) ||
    key.startsWith(FLOW_SESSION_RECORD_STORAGE_PREFIX);
}
