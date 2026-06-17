import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { ConstructInteractService } from "./ai/ConstructInteractService";
import { AgentLogService } from "./ai/AgentLogService";
import { ConstructAuthoringReviewService } from "./ai/ConstructAuthoringReviewService";
import { ConstructCodeGhostService } from "./ai/ConstructCodeGhostService";
import { ConstructLitellmService } from "./ai/ConstructLitellmService";
import { ConstructSelectionExplainService } from "./ai/ConstructSelectionExplainService";
import { ConstructVerifierService } from "./ai/ConstructVerifierService";
import { MainProcessLogBridge } from "./app/MainProcessLogBridge";
import { ConstructWindowManager } from "./app/ConstructWindowManager";
import {
  configureConstructDataPaths,
  createConstructDataPaths,
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
import { ConstructLspService } from "./lsp/ConstructLspService";
import { ProcessInspector } from "./infra/ProcessInspector";
import { ConstructObservabilityService } from "./observability/ConstructObservabilityService";
import { ConstructProjectGitService } from "./projects/ConstructProjectGitService";
import { ConstructProjectRepository } from "./projects/ConstructProjectRepository";
import {
  ConstructProjectWorkspaceService
} from "./projects/ConstructProjectWorkspaceService";
import { LegacyProjectDataMigrator } from "./projects/LegacyProjectDataMigrator";
import type { StoredProject } from "./projects/ConstructProjectTypes";
import { ConstructTerminalService } from "./terminal/ConstructTerminalService";
import { ConstructFlowMemoryService } from "./flow/ConstructFlowMemoryService";
import { ConstructFlowService } from "./flow/ConstructFlowService";

let activeWebContents: Electron.WebContents | null = null;
const logBridge = new MainProcessLogBridge({
  activeWebContents: () => activeWebContents
});
logBridge.install();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const shouldOpenDevTools = process.env.CONSTRUCT_OPEN_DEVTOOLS === "1";

function sendToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

const agentLogService = new AgentLogService((channel, payload) => sendToRenderers(channel, payload));
const litellmService = new ConstructLitellmService();
const observabilityService = new ConstructObservabilityService();
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
  logs: agentLogService
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

function projectRepository(): ConstructProjectRepository {
  return new ConstructProjectRepository(constructDataPaths());
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
  return new ConstructLearningStore(learningStatePath());
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

async function writeProjects(projects: StoredProject[]): Promise<void> {
  return projectRepository().writeAll(projects);
}

async function readSettings(): Promise<StoredSettings> {
  return readConstructSettings(constructDataPaths());
}

async function writeSettings(settings: StoredSettings): Promise<StoredSettings> {
  return writeConstructSettings(settings, constructDataPaths());
}

function findProject(projects: StoredProject[], id: string): StoredProject {
  return projectRepository().find(projects, id);
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
    return findProject(await readProjects(), projectId);
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
    collectDebugProcessSnapshots
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
    writeProjects,
    findProject,
    workspace: workspaceService,
    git: gitService,
    workspacePathForProject,
    summarizeProject,
    setActiveWebContents: (webContents) => {
      activeWebContents = webContents;
    },
    getAppSourceRoot: () => path.resolve(app.getAppPath(), "src")
  }).register();

  new ConstructFlowIpcController({
    ipcMain,
    readSettings,
    readProjects,
    writeProjects,
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
    readProjects,
    findProject,
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
}


app.whenReady().then(async () => {
  configureConstructDataPaths(constructDataPaths());
  await new LegacyProjectDataMigrator(constructDataPaths()).migrateIfNeeded();
  observabilityService.configure(await readSettings());
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

app.on("will-quit", () => {
  stopLspServer();
  void litellmService.stop();
  void observabilityService.shutdown();
});
