import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ApiUsageDashboardResponseSchema,
  ApiUsageEventSchema,
  BlueprintBuildDetailResponseSchema,
  BlueprintBuildEventRecordSchema,
  BlueprintBuildListResponseSchema,
  BlueprintBuildSchema,
  BlueprintBuildStageSchema,
  CurrentPlanningSessionResponseSchema,
  FeatureFlagKeySchema,
  FeatureFlagsResponseSchema,
  GeneratedProjectPlanSchema,
  ProjectAttemptStatusSchema,
  ProjectBlueprintSchema,
  ProjectSummarySchema,
  UserKnowledgeBaseSchema,
  getBlueprintRuntimeSteps,
  type ApiUsageDashboardResponse,
  type ApiUsageEvent,
  type BlueprintBuild,
  type BlueprintBuildDetailResponse,
  type BlueprintBuildEventRecord,
  type BlueprintBuildStage,
  type BlueprintBuildSummary,
  type CurrentPlanningSessionResponse,
  type FeatureFlag,
  type FeatureFlagKey,
  type GeneratedProjectPlan,
  type ProjectAttemptStatus,
  type ProjectStatus as SharedProjectStatus,
  type ProjectSummary,
  type UserKnowledgeBase
} from "@construct/shared";
import { z } from "zod";

import { createEmptyKnowledgeBase } from "./knowledgeGraph";
import { getPrismaClient } from "./prisma";
import { getCurrentUserId } from "./authContext";

const ActiveBlueprintStateSchema = z.object({
  blueprintPath: z.string().min(1),
  updatedAt: z.string().datetime(),
  sessionId: z.string().min(1).optional()
});

const PersistedGeneratedBlueprintRecordSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1),
  blueprintId: z.string().min(1),
  blueprintPath: z.string().min(1),
  projectRoot: z.string().min(1),
  blueprintJson: z.string().min(1),
  planJson: z.string().min(1),
  bundleJson: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isActive: z.boolean().default(false)
});

const PersistedGeneratedBlueprintRecordListSchema = z.array(
  PersistedGeneratedBlueprintRecordSchema
);

const PersistedProjectRecordSchema = ProjectSummarySchema.omit({
  completedStepsCount: true
}).extend({
  blueprintId: z.string().min(1),
  completedStepIds: z.array(z.string().min(1)).default([]),
  blueprintJson: z.string().min(1),
  planJson: z.string().min(1),
  bundleJson: z.string().min(1)
});

const PersistedProjectRecordListSchema = z.array(PersistedProjectRecordSchema);
const PersistedBlueprintBuildListSchema = z.array(BlueprintBuildSchema);
const PersistedBlueprintBuildStageListSchema = z.array(BlueprintBuildStageSchema);
const PersistedBlueprintBuildEventListSchema = z.array(BlueprintBuildEventRecordSchema);
const PersistedApiUsageEventListSchema = z.array(ApiUsageEventSchema);
const PersistedFeatureFlagListSchema = z.array(
  z.object({
    key: FeatureFlagKeySchema,
    enabled: z.boolean(),
    updatedAt: z.string().datetime()
  })
);

export type ActiveBlueprintState = z.infer<typeof ActiveBlueprintStateSchema>;
export type PersistedGeneratedBlueprintRecord = z.infer<
  typeof PersistedGeneratedBlueprintRecordSchema
>;

type PersistedProjectRecord = z.infer<typeof PersistedProjectRecordSchema>;

export type ProjectProgressUpdate = {
  blueprintPath: string;
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  totalSteps: number;
  markStepCompleted?: boolean;
  lastAttemptStatus?: ProjectAttemptStatus | null;
};

export type AgentPersistence = {
  getPlanningState(): Promise<CurrentPlanningSessionResponse | null>;
  setPlanningState(state: CurrentPlanningSessionResponse): Promise<void>;
  getPlanningBuildCheckpoint(sessionId: string): Promise<unknown | null>;
  setPlanningBuildCheckpoint(sessionId: string, checkpoint: unknown): Promise<void>;
  clearPlanningBuildCheckpoint(sessionId: string): Promise<void>;
  getKnowledgeBase(): Promise<UserKnowledgeBase | null>;
  setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void>;
  getActiveBlueprintState(): Promise<ActiveBlueprintState | null>;
  setActiveBlueprintState(state: ActiveBlueprintState): Promise<void>;
  getGeneratedBlueprintRecord(sessionId: string): Promise<PersistedGeneratedBlueprintRecord | null>;
  saveGeneratedBlueprintRecord(record: PersistedGeneratedBlueprintRecord): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  getActiveProject(): Promise<ProjectSummary | null>;
  getProject(projectId: string): Promise<ProjectSummary | null>;
  getProjectByBlueprintPath(blueprintPath: string): Promise<ProjectSummary | null>;
  setActiveProject(projectId: string): Promise<ProjectSummary | null>;
  updateProjectProgress(update: ProjectProgressUpdate): Promise<ProjectSummary | null>;
  getBlueprintBuild(buildId: string): Promise<BlueprintBuild | null>;
  getBlueprintBuildBySession(sessionId: string): Promise<BlueprintBuild | null>;
  upsertBlueprintBuild(build: BlueprintBuild): Promise<void>;
  upsertBlueprintBuildStage(stage: BlueprintBuildStage): Promise<void>;
  appendBlueprintBuildEvent(event: BlueprintBuildEventRecord): Promise<void>;
  recordApiUsageEvent(event: ApiUsageEvent): Promise<void>;
  listFeatureFlags(): Promise<FeatureFlag[]>;
  setFeatureFlag(input: { key: FeatureFlagKey; enabled: boolean }): Promise<FeatureFlag[]>;
  getBlueprintBuildDetail(buildId: string): Promise<BlueprintBuildDetailResponse>;
  listBlueprintBuilds(): Promise<BlueprintBuildSummary[]>;
  getApiUsageDashboard(): Promise<ApiUsageDashboardResponse>;
};

type AgentPersistenceLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

type AgentPersistenceInput = {
  rootDirectory: string;
  logger: AgentPersistenceLogger;
};

type StorageBackend = "local" | "prisma";

export function createAgentPersistence(input: AgentPersistenceInput): AgentPersistence {
  const backend = resolveStorageBackend();

  input.logger.info("Initializing agent persistence.", {
    backend,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim())
  });

  if (backend === "prisma") {
    const databaseUrl = process.env.DATABASE_URL?.trim();

    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when CONSTRUCT_STORAGE_BACKEND=prisma."
      );
    }

    return new PrismaAgentPersistence(input.logger);
  }

  return new LocalFileAgentPersistence(input.rootDirectory, input.logger);
}

class LocalFileAgentPersistence implements AgentPersistence {
  private readonly stateDirectory: string;
  private readonly planningStatePath: string;
  private readonly planningBuildCheckpointPath: string;
  private readonly knowledgeBasePath: string;
  private readonly activeBlueprintStatePath: string;
  private readonly blueprintRecordsPath: string;
  private readonly projectsPath: string;
  private readonly blueprintBuildsPath: string;
  private readonly blueprintBuildStagesPath: string;
  private readonly blueprintBuildEventsPath: string;
  private readonly apiUsageEventsPath: string;
  private readonly featureFlagsPath: string;
  private readonly logger: AgentPersistenceLogger;

  constructor(rootDirectory: string, logger: AgentPersistenceLogger) {
    this.stateDirectory = path.join(rootDirectory, ".construct", "state");
    this.planningStatePath = path.join(this.stateDirectory, "agent-planner.json");
    this.planningBuildCheckpointPath = path.join(
      this.stateDirectory,
      "planning-build-checkpoints.json"
    );
    this.knowledgeBasePath = path.join(this.stateDirectory, "user-knowledge.json");
    this.activeBlueprintStatePath = path.join(this.stateDirectory, "active-blueprint.json");
    this.blueprintRecordsPath = path.join(this.stateDirectory, "generated-blueprints.json");
    this.projectsPath = path.join(this.stateDirectory, "projects.json");
    this.blueprintBuildsPath = path.join(this.stateDirectory, "blueprint-builds.json");
    this.blueprintBuildStagesPath = path.join(this.stateDirectory, "blueprint-build-stages.json");
    this.blueprintBuildEventsPath = path.join(this.stateDirectory, "blueprint-build-events.json");
    this.apiUsageEventsPath = path.join(this.stateDirectory, "api-usage-events.json");
    this.featureFlagsPath = path.join(this.stateDirectory, "feature-flags.json");
    this.logger = logger;
  }

  async getPlanningState(): Promise<CurrentPlanningSessionResponse | null> {
    if (!existsSync(this.planningStatePath)) {
      return null;
    }

    const raw = await readFile(this.planningStatePath, "utf8");
    return CurrentPlanningSessionResponseSchema.parse(JSON.parse(raw));
  }

  async setPlanningState(state: CurrentPlanningSessionResponse): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(this.planningStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async getPlanningBuildCheckpoint(sessionId: string): Promise<unknown | null> {
    const checkpoints = await this.readPlanningBuildCheckpoints();
    return checkpoints[sessionId] ?? null;
  }

  async setPlanningBuildCheckpoint(sessionId: string, checkpoint: unknown): Promise<void> {
    const checkpoints = await this.readPlanningBuildCheckpoints();
    checkpoints[sessionId] = checkpoint;
    await this.writePlanningBuildCheckpoints(checkpoints);
  }

  async clearPlanningBuildCheckpoint(sessionId: string): Promise<void> {
    const checkpoints = await this.readPlanningBuildCheckpoints();
    if (!(sessionId in checkpoints)) {
      return;
    }

    delete checkpoints[sessionId];
    await this.writePlanningBuildCheckpoints(checkpoints);
  }

  async getKnowledgeBase(): Promise<UserKnowledgeBase | null> {
    if (!existsSync(this.knowledgeBasePath)) {
      return null;
    }

    try {
      const raw = await readFile(this.knowledgeBasePath, "utf8");
      const parsed = UserKnowledgeBaseSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }

      this.logger.warn("Stored knowledge base was invalid. Resetting to empty recursive graph.", {
        backend: "local",
        userId: getCurrentUserId(),
        issueCount: parsed.error.issues.length
      });
    } catch (error) {
      this.logger.warn("Stored knowledge base could not be read. Resetting to empty recursive graph.", {
        backend: "local",
        userId: getCurrentUserId(),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const reset = createEmptyKnowledgeBase(new Date().toISOString());
    await this.setKnowledgeBase(reset);
    return reset;
  }

  async setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.knowledgeBasePath,
      `${JSON.stringify(knowledgeBase, null, 2)}\n`,
      "utf8"
    );
  }

  async getActiveBlueprintState(): Promise<ActiveBlueprintState | null> {
    if (!existsSync(this.activeBlueprintStatePath)) {
      return null;
    }

    const raw = await readFile(this.activeBlueprintStatePath, "utf8");
    return ActiveBlueprintStateSchema.parse(JSON.parse(raw));
  }

  async setActiveBlueprintState(state: ActiveBlueprintState): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.activeBlueprintStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );

    const records = await this.readBlueprintRecords();
    const nextRecords = records.map((record) => ({
      ...record,
      isActive:
        record.sessionId === state.sessionId || record.blueprintPath === state.blueprintPath
    }));
    await this.writeBlueprintRecords(nextRecords);

    const projects = await this.readProjects();
    const nextProjects = sortProjectRecords(
      projects.map((project) => ({
        ...project,
        isActive:
          project.id === state.sessionId || project.blueprintPath === state.blueprintPath,
        lastOpenedAt:
          project.id === state.sessionId || project.blueprintPath === state.blueprintPath
            ? state.updatedAt
            : project.lastOpenedAt
      }))
    );
    await this.writeProjects(nextProjects);
  }

  async getGeneratedBlueprintRecord(
    sessionId: string
  ): Promise<PersistedGeneratedBlueprintRecord | null> {
    const records = await this.readBlueprintRecords();
    return records.find((record) => record.sessionId === sessionId) ?? null;
  }

  async saveGeneratedBlueprintRecord(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<void> {
    const parsed = PersistedGeneratedBlueprintRecordSchema.parse(record);
    const records = await this.readBlueprintRecords();
    const nextRecords = records.filter(
      (existingRecord) => existingRecord.sessionId !== parsed.sessionId
    );
    nextRecords.unshift(parsed);
    await this.writeBlueprintRecords(nextRecords);

    const projects = await this.readProjects();
    const existingProject = projects.find((project) => project.id === parsed.sessionId) ?? null;
    const nextProjects = upsertProjectRecord(
      projects,
      buildProjectRecordFromGeneratedRecord(parsed, existingProject)
    );
    await this.writeProjects(nextProjects);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const projects = await this.readProjects();
    return sortProjectRecords(projects)
      .map(toProjectSummary)
      .filter((project): project is ProjectSummary => Boolean(project));
  }

  async getActiveProject(): Promise<ProjectSummary | null> {
    const projects = await this.readProjects();
    return toProjectSummary(projects.find((project) => project.isActive) ?? null);
  }

  async getProject(projectId: string): Promise<ProjectSummary | null> {
    const projects = await this.readProjects();
    return toProjectSummary(projects.find((project) => project.id === projectId) ?? null);
  }

  async getProjectByBlueprintPath(blueprintPath: string): Promise<ProjectSummary | null> {
    const projects = await this.readProjects();
    const resolvedBlueprintPath = path.resolve(blueprintPath);
    return toProjectSummary(
      projects.find((project) => path.resolve(project.blueprintPath) === resolvedBlueprintPath) ??
        null
    );
  }

  async setActiveProject(projectId: string): Promise<ProjectSummary | null> {
    const projects = await this.readProjects();
    const timestamp = new Date().toISOString();
    const nextProjects = sortProjectRecords(
      projects.map((project) => {
        const isActive = project.id === projectId;
        return {
          ...project,
          isActive,
          lastOpenedAt: isActive ? timestamp : project.lastOpenedAt,
          updatedAt: isActive ? timestamp : project.updatedAt
        };
      })
    );
    const nextActiveProject =
      nextProjects.find((project) => project.id === projectId) ?? null;

    await this.writeProjects(nextProjects);

    if (nextActiveProject) {
      await this.setActiveBlueprintState({
        blueprintPath: nextActiveProject.blueprintPath,
        sessionId: nextActiveProject.id,
        updatedAt: timestamp
      });
    }

    return toProjectSummary(nextActiveProject);
  }

  async updateProjectProgress(update: ProjectProgressUpdate): Promise<ProjectSummary | null> {
    const projects = await this.readProjects();
    const normalizedBlueprintPath = path.resolve(update.blueprintPath);
    let nextProject: PersistedProjectRecord | null = null;
    const timestamp = new Date().toISOString();
    const nextProjects = sortProjectRecords(
      projects.map((project) => {
        if (path.resolve(project.blueprintPath) !== normalizedBlueprintPath) {
          return project;
        }

        const completedStepIds = update.markStepCompleted
          ? Array.from(new Set([...project.completedStepIds, update.stepId]))
          : project.completedStepIds;
        const status = deriveProjectStatus(completedStepIds.length, update.totalSteps);

        nextProject = {
          ...project,
          currentStepId: update.stepId,
          currentStepTitle: update.stepTitle,
          currentStepIndex: update.stepIndex,
          totalSteps: update.totalSteps,
          completedStepIds,
          status,
          lastAttemptStatus: update.lastAttemptStatus ?? project.lastAttemptStatus,
          updatedAt: timestamp,
          lastOpenedAt: timestamp
        };

        return nextProject;
      })
    );

    await this.writeProjects(nextProjects);
    return toProjectSummary(nextProject);
  }

  async getBlueprintBuild(buildId: string): Promise<BlueprintBuild | null> {
    const builds = await this.readBlueprintBuilds();
    return builds.find((build) => build.id === buildId) ?? null;
  }

  async getBlueprintBuildBySession(sessionId: string): Promise<BlueprintBuild | null> {
    const builds = await this.readBlueprintBuilds();
    return builds.find((build) => build.sessionId === sessionId) ?? null;
  }

  async upsertBlueprintBuild(build: BlueprintBuild): Promise<void> {
    const parsed = BlueprintBuildSchema.parse(build);
    const builds = await this.readBlueprintBuilds();
    const nextBuilds = builds.filter((entry) => entry.id !== parsed.id);
    nextBuilds.unshift(parsed);
    await this.writeBlueprintBuilds(sortBlueprintBuilds(nextBuilds));
  }

  async upsertBlueprintBuildStage(stage: BlueprintBuildStage): Promise<void> {
    const parsed = BlueprintBuildStageSchema.parse(stage);
    const stages = await this.readBlueprintBuildStages();
    const nextStages = stages.filter(
      (entry) => !(entry.buildId === parsed.buildId && entry.stage === parsed.stage)
    );
    nextStages.push(parsed);
    await this.writeBlueprintBuildStages(sortBlueprintBuildStages(nextStages));
  }

  async appendBlueprintBuildEvent(event: BlueprintBuildEventRecord): Promise<void> {
    const parsed = BlueprintBuildEventRecordSchema.parse(event);
    const events = await this.readBlueprintBuildEvents();
    events.push(parsed);
    await this.writeBlueprintBuildEvents(sortBlueprintBuildEvents(events));
  }

  async recordApiUsageEvent(event: ApiUsageEvent): Promise<void> {
    const parsed = ApiUsageEventSchema.parse(event);
    const events = await this.readApiUsageEvents();
    events.push(parsed);
    await this.writeApiUsageEvents(sortApiUsageEvents(events));
  }

  async listFeatureFlags(): Promise<FeatureFlag[]> {
    return resolveFeatureFlags(await this.readFeatureFlags());
  }

  async setFeatureFlag(input: { key: FeatureFlagKey; enabled: boolean }): Promise<FeatureFlag[]> {
    const key = FeatureFlagKeySchema.parse(input.key);
    const flags = await this.readFeatureFlags();
    const updatedAt = new Date().toISOString();
    const nextFlags = [
      ...flags.filter((flag) => flag.key !== key),
      {
        key,
        enabled: input.enabled,
        updatedAt
      }
    ].sort((left, right) => left.key.localeCompare(right.key));

    await this.writeFeatureFlags(nextFlags);
    return resolveFeatureFlags(nextFlags);
  }

  async getBlueprintBuildDetail(buildId: string): Promise<BlueprintBuildDetailResponse> {
    const [build, stages, events] = await Promise.all([
      this.getBlueprintBuild(buildId),
      this.readBlueprintBuildStages(),
      this.readBlueprintBuildEvents()
    ]);

    return BlueprintBuildDetailResponseSchema.parse({
      build,
      stages: stages.filter((stage) => stage.buildId === buildId),
      events: events.filter((event) => event.buildId === buildId)
    });
  }

  async listBlueprintBuilds(): Promise<BlueprintBuildSummary[]> {
    const builds = await this.readBlueprintBuilds();
    return BlueprintBuildListResponseSchema.parse({
      builds: sortBlueprintBuilds(builds)
    }).builds;
  }

  async getApiUsageDashboard(): Promise<ApiUsageDashboardResponse> {
    const [events, projects, builds] = await Promise.all([
      this.readApiUsageEvents(),
      this.readProjects(),
      this.readBlueprintBuilds()
    ]);

    return buildApiUsageDashboard({
      events,
      projects: projects.map(toProjectSummary).filter((project): project is ProjectSummary => Boolean(project)),
      builds
    });
  }

  private async readBlueprintRecords(): Promise<PersistedGeneratedBlueprintRecord[]> {
    if (!existsSync(this.blueprintRecordsPath)) {
      return [];
    }

    const raw = await readFile(this.blueprintRecordsPath, "utf8");
    return PersistedGeneratedBlueprintRecordListSchema.parse(JSON.parse(raw));
  }

  private async writeBlueprintRecords(
    records: PersistedGeneratedBlueprintRecord[]
  ): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.blueprintRecordsPath,
      `${JSON.stringify(records, null, 2)}\n`,
      "utf8"
    );
  }

  private async readProjects(): Promise<PersistedProjectRecord[]> {
    if (!existsSync(this.projectsPath)) {
      return [];
    }

    const raw = await readFile(this.projectsPath, "utf8");
    return PersistedProjectRecordListSchema.parse(JSON.parse(raw));
  }

  private async writeProjects(records: PersistedProjectRecord[]): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(this.projectsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private async readBlueprintBuilds(): Promise<BlueprintBuild[]> {
    if (!existsSync(this.blueprintBuildsPath)) {
      return [];
    }

    const raw = await readFile(this.blueprintBuildsPath, "utf8");
    return PersistedBlueprintBuildListSchema.parse(JSON.parse(raw));
  }

  private async writeBlueprintBuilds(builds: BlueprintBuild[]): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.blueprintBuildsPath,
      `${JSON.stringify(builds, null, 2)}\n`,
      "utf8"
    );
  }

  private async readBlueprintBuildStages(): Promise<BlueprintBuildStage[]> {
    if (!existsSync(this.blueprintBuildStagesPath)) {
      return [];
    }

    const raw = await readFile(this.blueprintBuildStagesPath, "utf8");
    return PersistedBlueprintBuildStageListSchema.parse(JSON.parse(raw));
  }

  private async writeBlueprintBuildStages(stages: BlueprintBuildStage[]): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.blueprintBuildStagesPath,
      `${JSON.stringify(stages, null, 2)}\n`,
      "utf8"
    );
  }

  private async readBlueprintBuildEvents(): Promise<BlueprintBuildEventRecord[]> {
    if (!existsSync(this.blueprintBuildEventsPath)) {
      return [];
    }

    const raw = await readFile(this.blueprintBuildEventsPath, "utf8");
    return PersistedBlueprintBuildEventListSchema.parse(JSON.parse(raw));
  }

  private async writeBlueprintBuildEvents(events: BlueprintBuildEventRecord[]): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.blueprintBuildEventsPath,
      `${JSON.stringify(events, null, 2)}\n`,
      "utf8"
    );
  }

  private async readApiUsageEvents(): Promise<ApiUsageEvent[]> {
    if (!existsSync(this.apiUsageEventsPath)) {
      return [];
    }

    const raw = await readFile(this.apiUsageEventsPath, "utf8");
    return PersistedApiUsageEventListSchema.parse(JSON.parse(raw));
  }

  private async writeApiUsageEvents(events: ApiUsageEvent[]): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.apiUsageEventsPath,
      `${JSON.stringify(events, null, 2)}\n`,
      "utf8"
    );
  }

  private async readFeatureFlags(): Promise<
    Array<{ key: FeatureFlagKey; enabled: boolean; updatedAt: string }>
  > {
    if (!existsSync(this.featureFlagsPath)) {
      return [];
    }

    const raw = await readFile(this.featureFlagsPath, "utf8");
    return PersistedFeatureFlagListSchema.parse(JSON.parse(raw));
  }

  private async writeFeatureFlags(
    flags: Array<{ key: FeatureFlagKey; enabled: boolean; updatedAt: string }>
  ): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(this.featureFlagsPath, `${JSON.stringify(flags, null, 2)}\n`, "utf8");
  }

  private async readPlanningBuildCheckpoints(): Promise<Record<string, unknown>> {
    if (!existsSync(this.planningBuildCheckpointPath)) {
      return {};
    }

    const raw = await readFile(this.planningBuildCheckpointPath, "utf8");
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  }

  private async writePlanningBuildCheckpoints(
    checkpoints: Record<string, unknown>
  ): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.planningBuildCheckpointPath,
      `${JSON.stringify(checkpoints, null, 2)}\n`,
      "utf8"
    );
  }
}

class PrismaAgentPersistence implements AgentPersistence {
  private readonly prisma = getPrismaClient();
  private readonly logger: AgentPersistenceLogger;

  constructor(logger: AgentPersistenceLogger) {
    this.logger = logger;
  }

  async getPlanningState(): Promise<CurrentPlanningSessionResponse | null> {
    const userId = getCurrentUserId();
    const row = await this.prisma.constructState.findUnique({
      where: {
        key: toStateKey(userId, "planning_state")
      }
    });

    return row ? CurrentPlanningSessionResponseSchema.parse(JSON.parse(row.valueJson)) : null;
  }

  async setPlanningState(state: CurrentPlanningSessionResponse): Promise<void> {
    const userId = getCurrentUserId();
    await this.prisma.constructState.upsert({
      where: {
        key: toStateKey(userId, "planning_state")
      },
      create: {
        key: toStateKey(userId, "planning_state"),
        valueJson: JSON.stringify(state)
      },
      update: {
        valueJson: JSON.stringify(state)
      }
    });
  }

  async getPlanningBuildCheckpoint(sessionId: string): Promise<unknown | null> {
    const userId = getCurrentUserId();
    const row = await this.prisma.constructState.findUnique({
      where: {
        key: toStateKey(userId, `planning_build_checkpoint:${sessionId}`)
      }
    });

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.valueJson);
    } catch (error) {
      this.logger.warn("Stored planning build checkpoint could not be read. Clearing it.", {
        backend: "prisma",
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.clearPlanningBuildCheckpoint(sessionId);
      return null;
    }
  }

  async setPlanningBuildCheckpoint(sessionId: string, checkpoint: unknown): Promise<void> {
    const userId = getCurrentUserId();
    await this.prisma.constructState.upsert({
      where: {
        key: toStateKey(userId, `planning_build_checkpoint:${sessionId}`)
      },
      create: {
        key: toStateKey(userId, `planning_build_checkpoint:${sessionId}`),
        valueJson: JSON.stringify(checkpoint)
      },
      update: {
        valueJson: JSON.stringify(checkpoint)
      }
    });
  }

  async clearPlanningBuildCheckpoint(sessionId: string): Promise<void> {
    const userId = getCurrentUserId();
    await this.prisma.constructState.deleteMany({
      where: {
        key: toStateKey(userId, `planning_build_checkpoint:${sessionId}`)
      }
    });
  }

  async getKnowledgeBase(): Promise<UserKnowledgeBase | null> {
    const userId = getCurrentUserId();
    const row = await this.prisma.constructState.findUnique({
      where: {
        key: toStateKey(userId, "knowledge_base")
      }
    });

    if (!row) {
      return null;
    }

    try {
      const parsed = UserKnowledgeBaseSchema.safeParse(JSON.parse(row.valueJson));
      if (parsed.success) {
        return parsed.data;
      }

      this.logger.warn("Stored knowledge base was invalid. Resetting to empty recursive graph.", {
        backend: "prisma",
        userId,
        issueCount: parsed.error.issues.length
      });
    } catch (error) {
      this.logger.warn("Stored knowledge base could not be read. Resetting to empty recursive graph.", {
        backend: "prisma",
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const reset = createEmptyKnowledgeBase(new Date().toISOString());
    await this.setKnowledgeBase(reset);
    return reset;
  }

  async setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void> {
    const userId = getCurrentUserId();
    await this.prisma.constructState.upsert({
      where: {
        key: toStateKey(userId, "knowledge_base")
      },
      create: {
        key: toStateKey(userId, "knowledge_base"),
        valueJson: JSON.stringify(knowledgeBase)
      },
      update: {
        valueJson: JSON.stringify(knowledgeBase)
      }
    });
  }

  async getActiveBlueprintState(): Promise<ActiveBlueprintState | null> {
    const userId = getCurrentUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        isActive: true
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    if (!project) {
      return null;
    }

    return ActiveBlueprintStateSchema.parse({
      blueprintPath: project.blueprintPath,
      updatedAt: project.updatedAt.toISOString(),
      sessionId: project.id
    });
  }

  async setActiveBlueprintState(state: ActiveBlueprintState): Promise<void> {
    const userId = getCurrentUserId();
    const resolvedBlueprintPath = path.resolve(state.blueprintPath);
    const activeProjectWhere = state.sessionId
      ? {
          OR: [
            {
              id: state.sessionId
            },
            {
              blueprintPath: resolvedBlueprintPath
            }
          ]
        }
      : {
          blueprintPath: resolvedBlueprintPath
        };

    await this.prisma.$transaction([
      this.prisma.project.updateMany({
        where: {
          userId
        },
        data: {
          isActive: false
        }
      }),
      this.prisma.project.updateMany({
        where: {
          userId,
          ...activeProjectWhere
        },
        data: {
          isActive: true,
          lastOpenedAt: new Date(state.updatedAt)
        }
      })
    ]);
  }

  async getGeneratedBlueprintRecord(
    sessionId: string
  ): Promise<PersistedGeneratedBlueprintRecord | null> {
    const userId = getCurrentUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        id: sessionId
      }
    });

    return project ? toGeneratedBlueprintRecord(project) : null;
  }

  async saveGeneratedBlueprintRecord(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<void> {
    const parsed = PersistedGeneratedBlueprintRecordSchema.parse(record);
    const userId = getCurrentUserId();
    const existingProject = await this.prisma.project.findFirst({
      where: {
        userId,
        id: parsed.sessionId
      }
    });
    const projectRecord = buildProjectRecordFromGeneratedRecord(
      parsed,
      existingProject ? toPersistedProjectRecordFromPrisma(existingProject) : null
    );

    const operations = [];

    if (parsed.isActive) {
      operations.push(
        this.prisma.project.updateMany({
          where: {
            userId
          },
          data: {
            isActive: false
          }
        })
      );
    }

    operations.push(
      this.prisma.project.upsert({
        where: {
          id: projectRecord.id
        },
        create: mapProjectCreateInput(userId, projectRecord),
        update: mapProjectUpdateInput(projectRecord)
      })
    );

    await this.prisma.$transaction(operations);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const userId = getCurrentUserId();
    const projects = await this.prisma.project.findMany({
      where: {
        userId
      },
      orderBy: [
        {
          lastOpenedAt: "desc"
        },
        {
          updatedAt: "desc"
        }
      ]
    });

    return projects.map(toProjectSummaryFromPrisma);
  }

  async getActiveProject(): Promise<ProjectSummary | null> {
    const userId = getCurrentUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        isActive: true
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    return project ? toProjectSummaryFromPrisma(project) : null;
  }

  async getProject(projectId: string): Promise<ProjectSummary | null> {
    const userId = getCurrentUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        id: projectId
      }
    });

    return project ? toProjectSummaryFromPrisma(project) : null;
  }

  async getProjectByBlueprintPath(blueprintPath: string): Promise<ProjectSummary | null> {
    const userId = getCurrentUserId();
    const resolvedBlueprintPath = path.resolve(blueprintPath);
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        blueprintPath: resolvedBlueprintPath
      }
    });

    return project ? toProjectSummaryFromPrisma(project) : null;
  }

  async setActiveProject(projectId: string): Promise<ProjectSummary | null> {
    const timestamp = new Date();
    const userId = getCurrentUserId();

    await this.prisma.$transaction([
      this.prisma.project.updateMany({
        where: {
          userId
        },
        data: {
          isActive: false
        }
      }),
      this.prisma.project.updateMany({
        where: {
          userId,
          id: projectId
        },
        data: {
          isActive: true,
          lastOpenedAt: timestamp
        }
      })
    ]);

    return this.getProject(projectId);
  }

  async updateProjectProgress(update: ProjectProgressUpdate): Promise<ProjectSummary | null> {
    const resolvedBlueprintPath = path.resolve(update.blueprintPath);
    const userId = getCurrentUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        userId,
        blueprintPath: resolvedBlueprintPath
      }
    });

    if (!project) {
      return null;
    }

    const currentCompletedStepIds = parseCompletedStepIdsFromPrisma(project.completedStepIds);
    const completedStepIds = update.markStepCompleted
      ? Array.from(new Set([...currentCompletedStepIds, update.stepId]))
      : currentCompletedStepIds;
    const status = sharedStatusToPrismaStatus(
      deriveProjectStatus(completedStepIds.length, update.totalSteps)
    );
    const updatedProject = await this.prisma.project.update({
      where: {
        id: project.id
      },
      data: {
        currentStepId: update.stepId,
        currentStepTitle: update.stepTitle,
        currentStepIndex: update.stepIndex,
        totalSteps: update.totalSteps,
        completedStepIds: JSON.stringify(completedStepIds),
        status,
        lastAttemptStatus: update.lastAttemptStatus ?? project.lastAttemptStatus,
        lastOpenedAt: new Date()
      }
    });

    return toProjectSummaryFromPrisma(updatedProject);
  }

  async getBlueprintBuild(buildId: string): Promise<BlueprintBuild | null> {
    const userId = getCurrentUserId();
    const build = await this.prisma.blueprintBuild.findFirst({
      where: {
        userId,
        id: buildId
      }
    });

    return build ? toBlueprintBuildFromPrisma(build) : null;
  }

  async getBlueprintBuildBySession(sessionId: string): Promise<BlueprintBuild | null> {
    const userId = getCurrentUserId();
    const build = await this.prisma.blueprintBuild.findFirst({
      where: {
        userId,
        sessionId
      }
    });

    return build ? toBlueprintBuildFromPrisma(build) : null;
  }

  async upsertBlueprintBuild(build: BlueprintBuild): Promise<void> {
    const parsed = BlueprintBuildSchema.parse(build);

    await this.prisma.blueprintBuild.upsert({
      where: {
        id: parsed.id
      },
      create: mapBlueprintBuildCreateInput(parsed),
      update: mapBlueprintBuildUpdateInput(parsed)
    });
  }

  async upsertBlueprintBuildStage(stage: BlueprintBuildStage): Promise<void> {
    const parsed = BlueprintBuildStageSchema.parse(stage);

    await this.prisma.blueprintBuildStage.upsert({
      where: {
        buildId_stage: {
          buildId: parsed.buildId,
          stage: parsed.stage
        }
      },
      create: mapBlueprintBuildStageCreateInput(parsed),
      update: mapBlueprintBuildStageUpdateInput(parsed)
    });
  }

  async appendBlueprintBuildEvent(event: BlueprintBuildEventRecord): Promise<void> {
    const parsed = BlueprintBuildEventRecordSchema.parse(event);

    await this.prisma.blueprintBuildEvent.create({
      data: mapBlueprintBuildEventCreateInput(parsed)
    });
  }

  async recordApiUsageEvent(event: ApiUsageEvent): Promise<void> {
    const parsed = ApiUsageEventSchema.parse(event);
    const userId = getCurrentUserId();

    await this.prisma.apiUsageEvent.create({
      data: mapApiUsageEventCreateInput(userId, parsed)
    });
  }

  async listFeatureFlags(): Promise<FeatureFlag[]> {
    const userId = getCurrentUserId();
    const rows = await this.prisma.userFeatureFlag.findMany({
      where: {
        userId
      },
      orderBy: {
        key: "asc"
      }
    });

    return resolveFeatureFlags(
      rows.map((row) => ({
        key: FeatureFlagKeySchema.parse(row.key),
        enabled: row.enabled,
        updatedAt: row.updatedAt.toISOString()
      }))
    );
  }

  async setFeatureFlag(input: { key: FeatureFlagKey; enabled: boolean }): Promise<FeatureFlag[]> {
    const key = FeatureFlagKeySchema.parse(input.key);
    const userId = getCurrentUserId();

    await this.prisma.userFeatureFlag.upsert({
      where: {
        userId_key: {
          userId,
          key
        }
      },
      create: {
        id: `${userId}:${key}`,
        userId,
        key,
        enabled: input.enabled
      },
      update: {
        enabled: input.enabled
      }
    });

    return this.listFeatureFlags();
  }

  async getBlueprintBuildDetail(buildId: string): Promise<BlueprintBuildDetailResponse> {
    const userId = getCurrentUserId();
    const [build, stages, events] = await Promise.all([
      this.prisma.blueprintBuild.findFirst({
        where: {
          userId,
          id: buildId
        }
      }),
      this.prisma.blueprintBuildStage.findMany({
        where: {
          build: {
            userId
          },
          buildId
        },
        orderBy: [
          {
            startedAt: "asc"
          },
          {
            updatedAt: "asc"
          }
        ]
      }),
      this.prisma.blueprintBuildEvent.findMany({
        where: {
          build: {
            userId
          },
          buildId
        },
        orderBy: {
          timestamp: "asc"
        }
      })
    ]);

    return BlueprintBuildDetailResponseSchema.parse({
      build: build ? toBlueprintBuildFromPrisma(build) : null,
      stages: stages.map(toBlueprintBuildStageFromPrisma),
      events: events.map(toBlueprintBuildEventFromPrisma)
    });
  }

  async listBlueprintBuilds(): Promise<BlueprintBuildSummary[]> {
    const userId = getCurrentUserId();
    const builds = await this.prisma.blueprintBuild.findMany({
      where: {
        userId
      },
      orderBy: [
        {
          updatedAt: "desc"
        },
        {
          createdAt: "desc"
        }
      ]
    });

    return BlueprintBuildListResponseSchema.parse({
      builds: builds.map(toBlueprintBuildFromPrisma)
    }).builds;
  }

  async getApiUsageDashboard(): Promise<ApiUsageDashboardResponse> {
    const userId = getCurrentUserId();
    const [events, projects, builds] = await Promise.all([
      this.prisma.apiUsageEvent.findMany({
        where: {
          userId
        },
        orderBy: {
          recordedAt: "desc"
        }
      }),
      this.prisma.project.findMany({
        where: {
          userId
        }
      }),
      this.prisma.blueprintBuild.findMany({
        where: {
          userId
        }
      })
    ]);

    return buildApiUsageDashboard({
      events: events.map(toApiUsageEventFromPrisma),
      projects: projects.map(toProjectSummaryFromPrisma),
      builds: builds.map(toBlueprintBuildFromPrisma)
    });
  }
}

function resolveStorageBackend(): StorageBackend {
  const configuredBackend = process.env.CONSTRUCT_STORAGE_BACKEND?.trim().toLowerCase();

  if (configuredBackend === "local") {
    return "local";
  }

  if (configuredBackend === "prisma" || configuredBackend === "neon") {
    return "prisma";
  }

  return process.env.DATABASE_URL?.trim() ? "prisma" : "local";
}

function buildProjectRecordFromGeneratedRecord(
  record: PersistedGeneratedBlueprintRecord,
  existingRecord: PersistedProjectRecord | null = null
): PersistedProjectRecord {
  const blueprint = ProjectBlueprintSchema.parse(JSON.parse(record.blueprintJson));
  const plan = GeneratedProjectPlanSchema.parse(JSON.parse(record.planJson));
  const progress = resolveBlueprintProgress(blueprint, plan);
  const timestamp = record.updatedAt;
  const completedStepIds = existingRecord?.completedStepIds ?? [];
  const status = deriveProjectStatus(completedStepIds.length, progress.totalSteps);

  return PersistedProjectRecordSchema.parse({
    id: record.sessionId,
    goal: record.goal,
    name: blueprint.name,
    description: blueprint.description,
    language: blueprint.language,
    blueprintId: record.blueprintId,
    blueprintPath: path.resolve(record.blueprintPath),
    projectRoot: path.resolve(record.projectRoot),
    currentStepId: progress.id,
    currentStepTitle: progress.title,
    currentStepIndex: progress.index,
    totalSteps: progress.totalSteps,
    completedStepIds,
    status,
    lastAttemptStatus: existingRecord?.lastAttemptStatus ?? null,
    blueprintJson: record.blueprintJson,
    planJson: record.planJson,
    bundleJson: record.bundleJson,
    createdAt: existingRecord?.createdAt ?? record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.isActive
      ? timestamp
      : existingRecord?.lastOpenedAt ?? null,
    isActive: record.isActive
  });
}

function upsertProjectRecord(
  records: PersistedProjectRecord[],
  record: PersistedProjectRecord
): PersistedProjectRecord[] {
  const nextRecords = records.filter((existing) => existing.id !== record.id);
  nextRecords.unshift(record);

  if (!record.isActive) {
    return sortProjectRecords(nextRecords);
  }

  return sortProjectRecords(
    nextRecords.map((existing) => ({
      ...existing,
      isActive: existing.id === record.id
    }))
  );
}

function sortProjectRecords(records: PersistedProjectRecord[]): PersistedProjectRecord[] {
  return [...records].sort((left, right) => {
    const leftTimestamp = left.lastOpenedAt ?? left.updatedAt;
    const rightTimestamp = right.lastOpenedAt ?? right.updatedAt;
    return Date.parse(rightTimestamp) - Date.parse(leftTimestamp);
  });
}

function deriveProjectStatus(
  completedStepsCount: number,
  totalSteps: number
): SharedProjectStatus {
  if (totalSteps > 0 && completedStepsCount >= totalSteps) {
    return "completed";
  }

  return "in-progress";
}

function toProjectSummary(record: PersistedProjectRecord | null): ProjectSummary | null {
  if (!record) {
    return null;
  }

  return ProjectSummarySchema.parse({
    id: record.id,
    goal: record.goal,
    name: record.name,
    description: record.description,
    language: record.language,
    blueprintPath: record.blueprintPath,
    projectRoot: record.projectRoot,
    currentStepId: record.currentStepId,
    currentStepTitle: record.currentStepTitle,
    currentStepIndex: record.currentStepIndex,
    totalSteps: record.totalSteps,
    completedStepsCount: record.completedStepIds.length,
    status: record.status,
    lastAttemptStatus: record.lastAttemptStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    isActive: record.isActive
  });
}

function sharedStatusToPrismaStatus(status: SharedProjectStatus): string {
  switch (status) {
    case "draft":
      return "DRAFT";
    case "completed":
      return "COMPLETED";
    case "archived":
      return "ARCHIVED";
    case "in-progress":
    default:
      return "IN_PROGRESS";
  }
}

function prismaStatusToSharedStatus(status: string): SharedProjectStatus {
  if (status === "DRAFT") {
    return "draft";
  }

  if (status === "COMPLETED") {
    return "completed";
  }

  if (status === "ARCHIVED") {
    return "archived";
  }

  return "in-progress";
}

function mapProjectCreateInput(userId: string, record: PersistedProjectRecord) {
  return {
    id: record.id,
    userId,
    goal: record.goal,
    name: record.name,
    slug: slugify(record.name || record.goal),
    description: record.description,
    language: record.language,
    blueprintId: record.blueprintId,
    blueprintPath: path.resolve(record.blueprintPath),
    projectRoot: path.resolve(record.projectRoot),
    currentStepId: record.currentStepId,
    currentStepTitle: record.currentStepTitle,
    currentStepIndex: record.currentStepIndex,
    totalSteps: record.totalSteps,
    completedStepIds: JSON.stringify(record.completedStepIds),
    status: sharedStatusToPrismaStatus(record.status),
    lastAttemptStatus: record.lastAttemptStatus,
    blueprintJson: record.blueprintJson,
    planJson: record.planJson,
    bundleJson: record.bundleJson,
    isActive: record.isActive,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    lastOpenedAt: record.lastOpenedAt ? new Date(record.lastOpenedAt) : null
  };
}

function mapProjectUpdateInput(record: PersistedProjectRecord) {
  return {
    goal: record.goal,
    name: record.name,
    slug: slugify(record.name || record.goal),
    description: record.description,
    language: record.language,
    blueprintId: record.blueprintId,
    blueprintPath: path.resolve(record.blueprintPath),
    projectRoot: path.resolve(record.projectRoot),
    currentStepId: record.currentStepId,
    currentStepTitle: record.currentStepTitle,
    currentStepIndex: record.currentStepIndex,
    totalSteps: record.totalSteps,
    completedStepIds: JSON.stringify(record.completedStepIds),
    status: sharedStatusToPrismaStatus(record.status),
    lastAttemptStatus: record.lastAttemptStatus,
    blueprintJson: record.blueprintJson,
    planJson: record.planJson,
    bundleJson: record.bundleJson,
    isActive: record.isActive,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    lastOpenedAt: record.lastOpenedAt ? new Date(record.lastOpenedAt) : null
  };
}

function toProjectSummaryFromPrisma(project: {
  id: string;
  goal: string;
  name: string;
  description: string;
  language: string;
  blueprintPath: string;
  projectRoot: string;
  currentStepId: string | null;
  currentStepTitle: string | null;
  currentStepIndex: number | null;
  totalSteps: number;
  completedStepIds: string;
  status: string;
  lastAttemptStatus: string | null;
  blueprintJson: string;
  planJson: string;
  bundleJson: string;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
  isActive: boolean;
}): ProjectSummary {
  const blueprint = parseBlueprintSummary(project.blueprintJson);
  const derivedStep = parseCurrentStepSummary(project.blueprintJson, project.planJson);
  const lastAttemptStatus = project.lastAttemptStatus
    ? ProjectAttemptStatusSchema.parse(project.lastAttemptStatus)
    : null;
  const completedStepIds = parseCompletedStepIdsFromPrisma(project.completedStepIds);
  const name = project.name.trim() || blueprint.name;
  const description = project.description.trim() || blueprint.description;
  const language = project.language.trim() || blueprint.language;
  const currentStepId = project.currentStepId ?? derivedStep.id;
  const currentStepTitle = project.currentStepTitle ?? derivedStep.title;
  const currentStepIndex = project.currentStepIndex ?? derivedStep.index;
  const totalSteps = project.totalSteps > 0 ? project.totalSteps : derivedStep.totalSteps;

  return ProjectSummarySchema.parse({
    id: project.id,
    goal: project.goal,
    name,
    description,
    language,
    blueprintPath: project.blueprintPath,
    projectRoot: project.projectRoot,
    currentStepId,
    currentStepTitle,
    currentStepIndex,
    totalSteps,
    completedStepsCount: completedStepIds.length,
    status: prismaStatusToSharedStatus(project.status),
    lastAttemptStatus,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    lastOpenedAt: project.lastOpenedAt?.toISOString() ?? null,
    isActive: project.isActive
  });
}

function toPersistedProjectRecordFromPrisma(project: {
  id: string;
  goal: string;
  name: string;
  description: string;
  language: string;
  blueprintId: string;
  blueprintPath: string;
  projectRoot: string;
  currentStepId: string | null;
  currentStepTitle: string | null;
  currentStepIndex: number | null;
  totalSteps: number;
  completedStepIds: string;
  status: string;
  lastAttemptStatus: string | null;
  blueprintJson: string;
  planJson: string;
  bundleJson: string;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
  isActive: boolean;
}): PersistedProjectRecord {
  return PersistedProjectRecordSchema.parse({
    id: project.id,
    goal: project.goal,
    name: project.name,
    description: project.description,
    language: project.language,
    blueprintId: project.blueprintId,
    blueprintPath: project.blueprintPath,
    projectRoot: project.projectRoot,
    currentStepId: project.currentStepId,
    currentStepTitle: project.currentStepTitle,
    currentStepIndex: project.currentStepIndex,
    totalSteps: project.totalSteps,
    completedStepIds: parseCompletedStepIdsFromPrisma(project.completedStepIds),
    status: prismaStatusToSharedStatus(project.status),
    lastAttemptStatus: project.lastAttemptStatus
      ? ProjectAttemptStatusSchema.parse(project.lastAttemptStatus)
      : null,
    blueprintJson: project.blueprintJson,
    planJson: project.planJson,
    bundleJson: project.bundleJson,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    lastOpenedAt: project.lastOpenedAt?.toISOString() ?? null,
    isActive: project.isActive
  });
}

function toGeneratedBlueprintRecord(project: {
  id: string;
  goal: string;
  blueprintId: string;
  blueprintPath: string;
  projectRoot: string;
  blueprintJson: string;
  planJson: string;
  bundleJson: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}): PersistedGeneratedBlueprintRecord {
  return PersistedGeneratedBlueprintRecordSchema.parse({
    sessionId: project.id,
    goal: project.goal,
    blueprintId: project.blueprintId,
    blueprintPath: project.blueprintPath,
    projectRoot: project.projectRoot,
    blueprintJson: project.blueprintJson,
    planJson: project.planJson,
    bundleJson: project.bundleJson,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    isActive: project.isActive
  });
}

function sortBlueprintBuilds(builds: BlueprintBuild[]): BlueprintBuild[] {
  return [...builds].sort((left, right) => {
    const leftTimestamp = left.lastEventAt ?? left.updatedAt ?? left.createdAt;
    const rightTimestamp = right.lastEventAt ?? right.updatedAt ?? right.createdAt;
    return Date.parse(rightTimestamp) - Date.parse(leftTimestamp);
  });
}

function sortBlueprintBuildStages(stages: BlueprintBuildStage[]): BlueprintBuildStage[] {
  return [...stages].sort((left, right) => {
    if (left.buildId !== right.buildId) {
      return left.buildId.localeCompare(right.buildId);
    }

    return Date.parse(left.startedAt) - Date.parse(right.startedAt);
  });
}

function sortBlueprintBuildEvents(
  events: BlueprintBuildEventRecord[]
): BlueprintBuildEventRecord[] {
  return [...events].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  );
}

function sortApiUsageEvents(events: ApiUsageEvent[]): ApiUsageEvent[] {
  return [...events].sort(
    (left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt)
  );
}

const FEATURE_FLAG_CATALOG = {
  "adaptive-project-improvements": {
    title: "Knowledge sync",
    description:
      "Allow Construct to use quiz answers and task outcomes to decide whether the current project path should adapt.",
    defaultEnabled: true
  }
} satisfies Record<
  FeatureFlagKey,
  {
    title: string;
    description: string;
    defaultEnabled: boolean;
  }
>;

function resolveFeatureFlags(
  persistedFlags: Array<{ key: FeatureFlagKey; enabled: boolean; updatedAt: string }>
): FeatureFlag[] {
  const persistedByKey = new Map(persistedFlags.map((flag) => [flag.key, flag]));
  const fallbackTimestamp = new Date(0).toISOString();

  return FeatureFlagsResponseSchema.parse({
    flags: Object.entries(FEATURE_FLAG_CATALOG).map(([key, config]) => {
      const persisted = persistedByKey.get(key as FeatureFlagKey);
      return {
        key,
        title: config.title,
        description: config.description,
        enabled: persisted?.enabled ?? config.defaultEnabled,
        updatedAt: persisted?.updatedAt ?? fallbackTimestamp
      };
    })
  }).flags;
}

function buildApiUsageDashboard(input: {
  events: ApiUsageEvent[];
  projects: ProjectSummary[];
  builds: BlueprintBuild[];
}): ApiUsageDashboardResponse {
  const projectsById = new Map(input.projects.map((project) => [project.id, project]));
  const sessionIdsByBuildId = new Map(
    input.builds.flatMap((build) => (build.sessionId ? [[build.id, build.sessionId]] : []))
  );
  const resolvedEvents = sortApiUsageEvents(
    input.events.map((event) =>
      resolveApiUsageEventProject(event, projectsById, sessionIdsByBuildId)
    )
  );
  const providerSummaries = new Map<string, ApiUsageEvent[]>();
  const projectSummaries = new Map<string, ApiUsageEvent[]>();

  for (const event of resolvedEvents) {
    providerSummaries.set(event.provider, [...(providerSummaries.get(event.provider) ?? []), event]);

    if (event.projectId) {
      projectSummaries.set(event.projectId, [...(projectSummaries.get(event.projectId) ?? []), event]);
    }
  }

  return ApiUsageDashboardResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    totals: summarizeApiUsageTotals(resolvedEvents),
    providers: Array.from(providerSummaries.entries())
      .map(([provider, events]) => ({
        provider,
        ...summarizeApiUsageTotals(events),
        models: sortUniqueStrings(events.map((event) => event.model)),
        lastUsedAt: events[0]?.recordedAt ?? null
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens),
    projects: Array.from(projectSummaries.entries())
      .map(([projectId, events]) => ({
        projectId,
        projectName: events.find((event) => event.projectName)?.projectName ?? null,
        projectGoal: events.find((event) => event.projectGoal)?.projectGoal ?? null,
        providers: sortUniqueStrings(events.map((event) => event.provider)),
        models: sortUniqueStrings(events.map((event) => event.model)),
        lastUsedAt: events[0]?.recordedAt ?? null,
        ...summarizeApiUsageTotals(events)
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens),
    recentEvents: resolvedEvents.slice(0, 40)
  });
}

function resolveApiUsageEventProject(
  event: ApiUsageEvent,
  projectsById: Map<string, ProjectSummary>,
  sessionIdsByBuildId: Map<string, string>
): ApiUsageEvent {
  const sessionId = event.sessionId ?? (event.buildId ? sessionIdsByBuildId.get(event.buildId) ?? null : null);
  const projectId = event.projectId ?? sessionId ?? null;
  const project = projectId ? projectsById.get(projectId) ?? null : null;

  return ApiUsageEventSchema.parse({
    ...event,
    sessionId,
    projectId,
    projectName: event.projectName ?? project?.name ?? null,
    projectGoal: event.projectGoal ?? project?.goal ?? null
  });
}

function summarizeApiUsageTotals(events: ApiUsageEvent[]) {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let pricedEventCount = 0;
  let unpricedEventCount = 0;
  let costUsdTotal = 0;
  let currency: string | null = null;

  for (const event of events) {
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    totalTokens += event.totalTokens;
    cachedInputTokens += event.cachedInputTokens;
    reasoningTokens += event.reasoningTokens;

    if (typeof event.costUsd === "number") {
      pricedEventCount += 1;
      costUsdTotal += event.costUsd;
      currency = currency && event.currency && currency !== event.currency ? null : (currency ?? event.currency ?? null);
    } else {
      unpricedEventCount += 1;
    }
  }

  return {
    eventCount: events.length,
    pricedEventCount,
    unpricedEventCount,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
    costUsd: pricedEventCount > 0 ? Number(costUsdTotal.toFixed(6)) : null,
    currency
  };
}

function sortUniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value): value is string => value.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function mapBlueprintBuildCreateInput(build: BlueprintBuild) {
  return {
    id: build.id,
    sessionId: build.sessionId,
    userId: build.userId,
    goal: build.goal,
    detectedLanguage: build.detectedLanguage,
    detectedDomain: build.detectedDomain,
    status: build.status,
    currentStage: build.currentStage,
    currentStageTitle: build.currentStageTitle,
    currentStageStatus: build.currentStageStatus,
    lastError: build.lastError,
    langSmithProject: build.langSmithProject,
    traceUrl: build.traceUrl,
    planningSessionJson: build.planningSession
      ? JSON.stringify(build.planningSession)
      : null,
    answersJson: JSON.stringify(build.answers),
    planJson: build.plan ? JSON.stringify(build.plan) : null,
    blueprintJson: build.blueprint ? JSON.stringify(build.blueprint) : null,
    blueprintDraftJson: build.blueprintDraft ? JSON.stringify(build.blueprintDraft) : null,
    supportFilesJson: JSON.stringify(build.supportFiles),
    canonicalFilesJson: JSON.stringify(build.canonicalFiles),
    learnerFilesJson: JSON.stringify(build.learnerFiles),
    hiddenTestsJson: JSON.stringify(build.hiddenTests),
    createdAt: new Date(build.createdAt),
    updatedAt: new Date(build.updatedAt),
    completedAt: build.completedAt ? new Date(build.completedAt) : null,
    lastEventAt: build.lastEventAt ? new Date(build.lastEventAt) : null
  };
}

function mapBlueprintBuildUpdateInput(build: BlueprintBuild) {
  return {
    sessionId: build.sessionId,
    userId: build.userId,
    goal: build.goal,
    detectedLanguage: build.detectedLanguage,
    detectedDomain: build.detectedDomain,
    status: build.status,
    currentStage: build.currentStage,
    currentStageTitle: build.currentStageTitle,
    currentStageStatus: build.currentStageStatus,
    lastError: build.lastError,
    langSmithProject: build.langSmithProject,
    traceUrl: build.traceUrl,
    planningSessionJson: build.planningSession
      ? JSON.stringify(build.planningSession)
      : null,
    answersJson: JSON.stringify(build.answers),
    planJson: build.plan ? JSON.stringify(build.plan) : null,
    blueprintJson: build.blueprint ? JSON.stringify(build.blueprint) : null,
    blueprintDraftJson: build.blueprintDraft ? JSON.stringify(build.blueprintDraft) : null,
    supportFilesJson: JSON.stringify(build.supportFiles),
    canonicalFilesJson: JSON.stringify(build.canonicalFiles),
    learnerFilesJson: JSON.stringify(build.learnerFiles),
    hiddenTestsJson: JSON.stringify(build.hiddenTests),
    createdAt: new Date(build.createdAt),
    updatedAt: new Date(build.updatedAt),
    completedAt: build.completedAt ? new Date(build.completedAt) : null,
    lastEventAt: build.lastEventAt ? new Date(build.lastEventAt) : null
  };
}

function mapBlueprintBuildStageCreateInput(stage: BlueprintBuildStage) {
  return {
    id: stage.id,
    buildId: stage.buildId,
    stage: stage.stage,
    title: stage.title,
    status: stage.status,
    detail: stage.detail,
    inputJson: stage.inputJson === null ? null : JSON.stringify(stage.inputJson),
    outputJson: stage.outputJson === null ? null : JSON.stringify(stage.outputJson),
    metadataJson: stage.metadataJson === null ? null : JSON.stringify(stage.metadataJson),
    traceUrl: stage.traceUrl,
    startedAt: new Date(stage.startedAt),
    updatedAt: new Date(stage.updatedAt),
    completedAt: stage.completedAt ? new Date(stage.completedAt) : null
  };
}

function mapBlueprintBuildStageUpdateInput(stage: BlueprintBuildStage) {
  return {
    title: stage.title,
    status: stage.status,
    detail: stage.detail,
    inputJson: stage.inputJson === null ? null : JSON.stringify(stage.inputJson),
    outputJson: stage.outputJson === null ? null : JSON.stringify(stage.outputJson),
    metadataJson: stage.metadataJson === null ? null : JSON.stringify(stage.metadataJson),
    traceUrl: stage.traceUrl,
    startedAt: new Date(stage.startedAt),
    updatedAt: new Date(stage.updatedAt),
    completedAt: stage.completedAt ? new Date(stage.completedAt) : null
  };
}

function mapBlueprintBuildEventCreateInput(event: BlueprintBuildEventRecord) {
  return {
    id: event.id,
    buildId: event.buildId,
    jobId: event.jobId,
    kind: event.kind,
    stage: event.stage,
    title: event.title,
    detail: event.detail,
    level: event.level,
    payloadJson: event.payload === null ? null : JSON.stringify(event.payload),
    traceUrl: event.traceUrl,
    timestamp: new Date(event.timestamp)
  };
}

function mapApiUsageEventCreateInput(userId: string, event: ApiUsageEvent) {
  return {
    id: event.id,
    userId,
    provider: event.provider,
    kind: event.kind,
    model: event.model,
    operation: event.operation,
    stage: event.stage,
    schemaName: event.schemaName,
    mode: event.mode,
    projectId: event.projectId,
    projectName: event.projectName,
    projectGoal: event.projectGoal,
    buildId: event.buildId,
    sessionId: event.sessionId,
    jobId: event.jobId,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    totalTokens: event.totalTokens,
    cachedInputTokens: event.cachedInputTokens,
    reasoningTokens: event.reasoningTokens,
    costUsd: event.costUsd,
    currency: event.currency,
    metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
    recordedAt: new Date(event.recordedAt)
  };
}

function toBlueprintBuildFromPrisma(build: {
  id: string;
  sessionId: string | null;
  userId: string;
  goal: string;
  detectedLanguage: string | null;
  detectedDomain: string | null;
  status: string;
  currentStage: string | null;
  currentStageTitle: string | null;
  currentStageStatus: string | null;
  lastError: string | null;
  langSmithProject: string | null;
  traceUrl: string | null;
  planningSessionJson: string | null;
  answersJson: string;
  planJson: string | null;
  blueprintJson: string | null;
  blueprintDraftJson: string | null;
  supportFilesJson: string;
  canonicalFilesJson: string;
  learnerFilesJson: string;
  hiddenTestsJson: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  lastEventAt: Date | null;
}): BlueprintBuild {
  return BlueprintBuildSchema.parse({
    id: build.id,
    sessionId: build.sessionId,
    userId: build.userId,
    goal: build.goal,
    detectedLanguage: build.detectedLanguage,
    detectedDomain: build.detectedDomain,
    status: build.status,
    currentStage: build.currentStage,
    currentStageTitle: build.currentStageTitle,
    currentStageStatus: build.currentStageStatus,
    lastError: build.lastError,
    langSmithProject: build.langSmithProject,
    traceUrl: build.traceUrl,
    planningSession: parseJsonValue(build.planningSessionJson),
    answers: parseJsonValue(build.answersJson, []),
    plan: parseJsonValue(build.planJson),
    blueprint: parseJsonValue(build.blueprintJson),
    blueprintDraft: parseJsonValue(build.blueprintDraftJson),
    supportFiles: parseJsonValue(build.supportFilesJson, []),
    canonicalFiles: parseJsonValue(build.canonicalFilesJson, []),
    learnerFiles: parseJsonValue(build.learnerFilesJson, []),
    hiddenTests: parseJsonValue(build.hiddenTestsJson, []),
    createdAt: build.createdAt.toISOString(),
    updatedAt: build.updatedAt.toISOString(),
    completedAt: build.completedAt?.toISOString() ?? null,
    lastEventAt: build.lastEventAt?.toISOString() ?? null
  });
}

function toBlueprintBuildStageFromPrisma(stage: {
  id: string;
  buildId: string;
  stage: string;
  title: string;
  status: string;
  detail: string | null;
  inputJson: string | null;
  outputJson: string | null;
  metadataJson: string | null;
  traceUrl: string | null;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): BlueprintBuildStage {
  return BlueprintBuildStageSchema.parse({
    id: stage.id,
    buildId: stage.buildId,
    stage: stage.stage,
    title: stage.title,
    status: stage.status,
    detail: stage.detail,
    inputJson: parseJsonValue(stage.inputJson),
    outputJson: parseJsonValue(stage.outputJson),
    metadataJson: parseJsonValue(stage.metadataJson),
    traceUrl: stage.traceUrl,
    startedAt: stage.startedAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
    completedAt: stage.completedAt?.toISOString() ?? null
  });
}

function toBlueprintBuildEventFromPrisma(event: {
  id: string;
  buildId: string;
  jobId: string | null;
  kind: string | null;
  stage: string;
  title: string;
  detail: string | null;
  level: string;
  payloadJson: string | null;
  traceUrl: string | null;
  timestamp: Date;
}): BlueprintBuildEventRecord {
  return BlueprintBuildEventRecordSchema.parse({
    id: event.id,
    buildId: event.buildId,
    jobId: event.jobId,
    kind: event.kind,
    stage: event.stage,
    title: event.title,
    detail: event.detail,
    level: event.level,
    payload: parseJsonValue(event.payloadJson),
    traceUrl: event.traceUrl,
    timestamp: event.timestamp.toISOString()
  });
}

function toApiUsageEventFromPrisma(event: {
  id: string;
  provider: string;
  kind: string;
  model: string;
  operation: string;
  stage: string | null;
  schemaName: string | null;
  mode: string | null;
  projectId: string | null;
  projectName: string | null;
  projectGoal: string | null;
  buildId: string | null;
  sessionId: string | null;
  jobId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  currency: string | null;
  metadataJson: string | null;
  recordedAt: Date;
}): ApiUsageEvent {
  return ApiUsageEventSchema.parse({
    id: event.id,
    provider: event.provider,
    kind: event.kind,
    model: event.model,
    operation: event.operation,
    stage: event.stage,
    schemaName: event.schemaName,
    mode: event.mode,
    projectId: event.projectId,
    projectName: event.projectName,
    projectGoal: event.projectGoal,
    buildId: event.buildId,
    sessionId: event.sessionId,
    jobId: event.jobId,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    totalTokens: event.totalTokens,
    cachedInputTokens: event.cachedInputTokens,
    reasoningTokens: event.reasoningTokens,
    costUsd: event.costUsd,
    currency: event.currency,
    metadata: parseJsonValue(event.metadataJson),
    recordedAt: event.recordedAt.toISOString()
  });
}

function parseCompletedStepIdsFromPrisma(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonValue<T>(value: string | null, fallback: T | null = null): T | null {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseBlueprintSummary(rawBlueprint: string): {
  name: string;
  description: string;
  language: string;
} {
  try {
    const blueprint = ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
    return {
      name: blueprint.name,
      description: blueprint.description,
      language: blueprint.language
    };
  } catch {
    return {
      name: "Project",
      description: "Agent-generated project",
      language: "Unknown"
    };
  }
}

function parseCurrentStepSummary(
  rawBlueprint: string,
  rawPlan: string
): {
  id: string | null;
  title: string | null;
  index: number | null;
  totalSteps: number;
} {
  try {
    const blueprint = ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
    const plan = GeneratedProjectPlanSchema.parse(JSON.parse(rawPlan));
    return resolveBlueprintProgress(blueprint, plan);
  } catch {
    return {
      id: null,
      title: null,
      index: null,
      totalSteps: 0
    };
  }
}

function resolveBlueprintProgress(
  blueprint: z.infer<typeof ProjectBlueprintSchema>,
  plan: GeneratedProjectPlan
): {
  id: string | null;
  title: string | null;
  index: number | null;
  totalSteps: number;
} {
  const runtimeSteps = getBlueprintRuntimeSteps(blueprint);
  if (blueprint.frontier && runtimeSteps.length === 0 && blueprint.frontier.activeStepId === null) {
    return {
      id: null,
      title: null,
      index: null,
      totalSteps: blueprint.spine?.commitGraph.length ?? plan.steps.length
    };
  }

  const preferredStepId = blueprint.frontier?.activeStepId ?? plan.suggestedFirstStepId;
  const step =
    runtimeSteps.find((entry) => entry.id === preferredStepId) ??
    blueprint.steps.find((entry) => entry.id === preferredStepId) ??
    runtimeSteps[0] ??
    blueprint.steps[0] ??
    null;

  if (!step) {
    return {
      id: null,
      title: null,
      index: null,
      totalSteps: 0
    };
  }

  const commitIndex =
    step.commitId && blueprint.spine
      ? blueprint.spine.commitGraph.findIndex((commit) => commit.id === step.commitId)
      : -1;
  const stepIndex =
    commitIndex >= 0
      ? commitIndex
      : Math.max(
          0,
          runtimeSteps.findIndex((entry) => entry.id === step.id)
        );

  return {
    id: step.id,
    title: step.title,
    index: stepIndex,
    totalSteps: blueprint.spine?.commitGraph.length ?? runtimeSteps.length
  };
}

function toStateKey(userId: string, key: string): string {
  return `${userId}:${key}`;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}
