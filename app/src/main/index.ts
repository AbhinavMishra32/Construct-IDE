import path from "node:path";

import { app, BrowserWindow, ipcMain, type WebContents } from "electron";

import { ConstructInteractService } from "./ai/ConstructInteractService";
import { AgentLogService } from "./ai/AgentLogService";
import { ConstructAuthoringReviewService } from "./ai/ConstructAuthoringReviewService";
import { ConstructCodeGhostService } from "./ai/ConstructCodeGhostService";
import { ConstructLitellmService } from "./ai/ConstructLitellmService";
import { ConstructSelectionExplainService } from "./ai/ConstructSelectionExplainService";
import { ConstructVerifierService } from "./ai/ConstructVerifierService";
import { providerLogService } from "./ai/ProviderLogService";
import { MainProcessLogBridge } from "./app/MainProcessLogBridge";
import { ConstructWindowManager } from "./app/ConstructWindowManager";
import {
  configureConstructCloudProductionEndpointLock,
  configureConstructDataPaths,
  createConstructDataPaths,
  enforceConstructCloudProductionEndpoint,
  readConstructSettings,
  writeConstructSettings,
  type ConstructDataPaths,
  type StoredSettings
} from "./config/constructConfig";
import { ConstructAgentIpcController } from "./ipc/ConstructAgentIpcController";
import { ConstructFlowIpcController } from "./ipc/ConstructFlowIpcController";
import { ConstructLearningIpcController } from "./ipc/ConstructLearningIpcController";
import { ConstructLitellmIpcController } from "./ipc/ConstructLitellmIpcController";
import { ConstructLspIpcController } from "./ipc/ConstructLspIpcController";
import { ConstructProjectIpcController } from "./ipc/ConstructProjectIpcController";
import { ConstructSettingsIpcController } from "./ipc/ConstructSettingsIpcController";
import { ConstructSystemIpcController } from "./ipc/ConstructSystemIpcController";
import { ConstructTerminalIpcController } from "./ipc/ConstructTerminalIpcController";
import { ConstructLearningStore } from "./constructLearningStore";
import { createConstructAgentRuntime } from "./constructAgentRuntime";
import { ConstructConceptPolicyService } from "./learning/ConstructConceptPolicyService";
import { ConstructLspService } from "./lsp/ConstructLspService";
import { ProcessInspector } from "./infra/ProcessInspector";
import { constructObservabilityService } from "./observability/ConstructObservabilityService";
import { ConstructProjectGitService } from "./projects/ConstructProjectGitService";
import { ConstructProjectRepository, type ProjectWriteOptions } from "./projects/ConstructProjectRepository";
import {
  ConstructProjectWorkspaceService
} from "./projects/ConstructProjectWorkspaceService";
import { LegacyProjectDataMigrator } from "./projects/LegacyProjectDataMigrator";
import type { StoredProject } from "./projects/ConstructProjectTypes";
import {
  createConstructStorageService,
  WillSaveStateReason,
  type IStorageService
} from "./storage/storage";
import {
  createConstructDomainStorage,
  type ConstructDomainStorage
} from "./storage/ConstructDomainStorage";
import { ConstructTerminalService } from "./terminal/ConstructTerminalService";
import { ConstructFlowMemoryService } from "./flow/ConstructFlowMemoryService";
import { ConstructFlowService } from "./flow/ConstructFlowService";

try {
  // @ts-ignore
  if (typeof process.loadEnvFile === "function") {
    // @ts-ignore
    process.loadEnvFile();
  }
} catch {
  // Ignore if .env does not exist.
}

let activeWebContents: WebContents | null = null;
const logBridge = new MainProcessLogBridge({
  activeWebContents: () => activeWebContents
});
logBridge.install();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const shouldOpenDevTools = process.env.CONSTRUCT_OPEN_DEVTOOLS === "1";
configureConstructCloudProductionEndpointLock(true);

function sendToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

const agentLogService = new AgentLogService((channel, payload) => sendToRenderers(channel, payload));
const litellmService = new ConstructLitellmService();
const observabilityService = constructObservabilityService;
const workspaceService = new ConstructProjectWorkspaceService(
  () => defaultWorkspaceParent(),
  () => path.resolve(app.getAppPath(), "src")
);
const gitService = new ConstructProjectGitService(workspaceService);
const terminalService = new ConstructTerminalService((channel, payload) => sendToRenderers(channel, payload));
const flowMemoryService = new ConstructFlowMemoryService(workspaceService);
const constructInteractService = new ConstructInteractService({
  learningStore,
  latestTerminalOutput: (projectId) => terminalService.latestOutput(projectId),
  workspace: workspaceService,
  logs: agentLogService,
  observability: observabilityService
});
const constructFlowService = new ConstructFlowService({
  workspace: workspaceService,
  flowMemory: flowMemoryService,
  latestTerminalOutput: (projectId) => terminalService.latestOutput(projectId),
  logs: agentLogService,
  learningStore,
  conceptPolicy: () => new ConstructConceptPolicyService({
    learningStore,
    agentRuntime: createConstructAgentRuntime,
    readSettings,
    readProjectMemory: (project) => flowMemoryService.read(project, ["learner.md"])
  }),
  readSettings
});
const verifierService = new ConstructVerifierService({
  logs: agentLogService,
  workspace: workspaceService,
  terminal: terminalService,
  learningStore,
  sendToRenderers,
  observability: observabilityService
});
const authoringReviewService = new ConstructAuthoringReviewService(agentLogService, observabilityService);
const selectionExplainService = new ConstructSelectionExplainService({
  logs: agentLogService,
  sendToRenderers,
  observability: observabilityService
});
const codeGhostService = new ConstructCodeGhostService(agentLogService, observabilityService);
const processInspector = new ProcessInspector();
const windowManager = new ConstructWindowManager({
  bundleDir: __dirname,
  isDev,
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
  openDevTools: shouldOpenDevTools
});
let lspServiceInstance: ConstructLspService | null = null;
let storageServiceInstance: IStorageService | null = null;
let domainStorageInstance: ConstructDomainStorage | null = null;
let shutdownStarted = false;

function projectRepository(): ConstructProjectRepository {
  return new ConstructProjectRepository(constructDataPaths(), storageService(), domainStorage());
}

function getLspService(): ConstructLspService {
  if (!lspServiceInstance) {
    lspServiceInstance = new ConstructLspService({
      appPath: app.getAppPath(),
      bundleDir: __dirname,
      cwd: process.cwd(),
      workspacePathForProject
    });
  }

  return lspServiceInstance;
}

function learningStatePath(): string {
  return constructDataPaths().learningStatePath;
}

function learningStore(): ConstructLearningStore {
  return new ConstructLearningStore({
    storage: storageService(),
    domainStorage: domainStorage(),
    legacyPath: learningStatePath()
  });
}

function workspacePathForProject(projectId: string): string {
  return workspaceService.workspacePathForProject(projectId);
}

function defaultWorkspaceParent(): string {
  return constructDataPaths().workspacesRoot;
}

function constructDataPaths(): ConstructDataPaths {
  return createConstructDataPaths(app.getPath("userData"));
}

async function readProjects(): Promise<StoredProject[]> {
  return projectRepository().readAll();
}

async function readProject(projectId: string): Promise<StoredProject | null> {
  return projectRepository().readOne(projectId);
}

async function readProjectSummaries() {
  return projectRepository().readSummaries();
}

async function writeProjects(projects: StoredProject[]): Promise<void> {
  return projectRepository().writeAll(projects);
}

async function writeProject(project: StoredProject, options?: ProjectWriteOptions): Promise<void> {
  return projectRepository().writeOne(project, options);
}

async function readSettings(): Promise<StoredSettings> {
  return enforceConstructCloudProductionEndpoint(
    await readConstructSettings(constructDataPaths(), storageService()),
    app.isPackaged
  );
}

async function writeSettings(settings: StoredSettings): Promise<StoredSettings> {
  const written = await writeConstructSettings(
    enforceConstructCloudProductionEndpoint(settings, app.isPackaged),
    constructDataPaths(),
    storageService()
  );
  await observabilityService.configure(written);
  return written;
}

function storageService(): IStorageService {
  if (!storageServiceInstance) {
    storageServiceInstance = createConstructStorageService(constructDataPaths().storageDatabasePath, {
      flushDelayMs: 10_000,
      periodicFlushIntervalMs: 60_000
    });
  }
  return storageServiceInstance;
}

function domainStorage(): ConstructDomainStorage {
  if (!domainStorageInstance) {
    domainStorageInstance = createConstructDomainStorage(constructDataPaths().storageDatabasePath);
  }
  return domainStorageInstance;
}

function summarizeProject(project: StoredProject) {
  return workspaceService.summarizeProject(project);
}

function stopLspServer(): void {
  getLspService().stop();
}

async function collectDebugProcessSnapshots() {
  return processInspector.hydrate([
    ...terminalService.snapshots(),
    ...getLspService().snapshots()
  ]);
}

function installConstructProjectIpcHandlers(): void {
  const findProjectById = async (projectId: string) => {
    const project = await readProject(projectId);
    if (!project) {
      throw new Error(`Unknown Construct project: ${projectId}`);
    }
    return project;
  };

  new ConstructLspIpcController({
    ipcMain,
    lsp: getLspService(),
    findProject: findProjectById,
    setActiveWebContents: (webContents) => {
      activeWebContents = webContents;
    }
  }).register();

  new ConstructTerminalIpcController({
    ipcMain,
    terminal: terminalService,
    findProject: findProjectById
  }).register();

  new ConstructSystemIpcController({
    ipcMain,
    defaultWorkspaceParent,
    collectDebugProcessSnapshots,
    storage: storageService()
  }).register();

  new ConstructSettingsIpcController({
    ipcMain,
    defaultWorkspaceParent,
    readSettings,
    writeSettings,
    readProjects,
    writeProjects,
    workspace: workspaceService,
    summarizeProject
  }).register();

  new ConstructLearningIpcController({
    ipcMain,
    learningStore
  }).register();

  new ConstructProjectIpcController({
    ipcMain,
    readSettings,
    readProjects,
    readProject,
    readProjectSummaries,
    writeProjects,
    writeProject,
    workspace: workspaceService,
    git: gitService,
    workspacePathForProject,
    setActiveWebContents: (webContents) => {
      activeWebContents = webContents;
    },
    getAppSourceRoot: () => path.resolve(app.getAppPath(), "src")
  }).register();

  new ConstructFlowIpcController({
    ipcMain,
    readSettings,
    readProject,
    readProjectSummaries,
    writeProject,
    workspace: workspaceService,
    flowMemory: flowMemoryService,
    flow: constructFlowService,
    workspacePathForProject,
    setActiveWebContents: (webContents) => {
      activeWebContents = webContents;
    },
    getAppSourceRoot: () => path.resolve(app.getAppPath(), "src")
  }).register();

  new ConstructAgentIpcController({
    ipcMain,
    readProject,
    interact: constructInteractService,
    verifier: verifierService,
    authoringReview: authoringReviewService,
    selectionExplain: selectionExplainService,
    codeGhost: codeGhostService
  }).register();

  new ConstructLitellmIpcController({
    ipcMain,
    litellm: litellmService
  }).register(() => activeWebContents);

  // Set up provider log service with web contents provider
  providerLogService.setWebContentsProvider(() => activeWebContents);
}


app.whenReady().then(async () => {
  configureConstructDataPaths(constructDataPaths());
  await storageService().initialize();
  await domainStorage().initialize();
  await new LegacyProjectDataMigrator(constructDataPaths()).migrateIfNeeded();
  await observabilityService.configure(await readSettings());
  installConstructProjectIpcHandlers();
  windowManager.createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  event.preventDefault();
  stopLspServer();
  void (async () => {
    await Promise.allSettled([
      litellmService.stop(),
      observabilityService.shutdown()
    ]);
    await storageService().flush(WillSaveStateReason.SHUTDOWN);
    domainStorage().close();
    await storageService().close();
  })().finally(() => {
    app.quit();
  });
});
