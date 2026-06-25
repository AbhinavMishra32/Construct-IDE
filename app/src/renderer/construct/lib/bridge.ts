import type {
  ConstructProgram,
  ConstructProjectsApi,
  AnyProjectRecord,
  FlowProjectRecord,
  ProjectRecord,
  ProjectSummary,
  TerminalEvent,
  TerminalExitEvent,
  RecallBlock,
  ConceptCard,
  ReferenceCard,
  VerificationResult,
  ConstructInteractClientResult,
  WorkspaceFile,
  WorkspaceTreeNode,
  ConstructUiStateScope,
  ConstructStorageMetrics
} from "../types";
import type { ConstructSelectionContext } from "./selectionContext";
import { apiTracker } from "./apiTracker";
import { performanceProfiler } from "./performanceProfiler";

declare global {
  interface Window {
    constructProjects: ConstructProjectsApi;
  }
}

const activeGhostCalls = new Map<string, string>();

async function trackPromise<T>(key: string, label: string, promise: Promise<T>): Promise<T> {
  const id = apiTracker.start(key, label);
  try {
    return await promise;
  } finally {
    apiTracker.end(id);
  }
}

function api(): ConstructProjectsApi {
  if (!window.constructProjects) {
    throw new Error("Construct project bridge is unavailable.");
  }

  return window.constructProjects;
}

export function setThemeSource(theme: "light" | "dark" | "system"): Promise<void> {
  return api().setThemeSource(theme);
}

export function getUiState<T = unknown>(input: {
  key: string;
  scope?: ConstructUiStateScope;
  projectId?: string;
  fallback?: T;
}): Promise<T> {
  return performanceProfiler.measureAsync(
    "storage.getUiState",
    { key: input.key, scope: input.scope ?? "application", projectId: input.projectId },
    () => api().getUiState<T>(input)
  );
}

export function setUiState(input: Parameters<ConstructProjectsApi["setUiState"]>[0]): ReturnType<ConstructProjectsApi["setUiState"]> {
  const bytes = estimateJsonBytes(input.value);
  performanceProfiler.recordStorageWrite({
    label: "ui-state queued",
    key: input.key,
    scope: input.scope,
    projectId: input.projectId,
    bytes
  });
  return performanceProfiler.measureAsync(
    "storage.setUiState",
    { key: input.key, scope: input.scope ?? "application", projectId: input.projectId, bytes },
    () => api().setUiState(input)
  );
}

export function flushStorage(): ReturnType<ConstructProjectsApi["flushStorage"]> {
  return performanceProfiler.measureAsync("storage.flush", {}, () => api().flushStorage());
}

export function storageMetrics(): Promise<ConstructStorageMetrics> {
  return performanceProfiler.measureAsync("storage.metrics", {}, () => api().storageMetrics());
}

export function ensureProject(input: {
  source: string;
  sourcePath?: string | null;
  program: ConstructProgram;
}): Promise<ProjectRecord> {
  return api().ensureProject(input);
}

export function importProject(input: Parameters<ConstructProjectsApi["importProject"]>[0]): Promise<ProjectRecord> {
  return api().importProject(input);
}

export function createFlowProject(input: Parameters<ConstructProjectsApi["createFlowProject"]>[0]): Promise<FlowProjectRecord> {
  return api().createFlowProject(input);
}

export function openConstructFile(): Promise<{ path: string; source: string } | null> {
  return api().openConstructFile();
}

export function selectWorkspaceDirectory(input?: {
  defaultPath?: string;
}): Promise<string | null> {
  return api().selectWorkspaceDirectory(input);
}

export function getSettings(): ReturnType<ConstructProjectsApi["getSettings"]> {
  return api().getSettings();
}

export function setWorkspaceRoot(input: Parameters<ConstructProjectsApi["setWorkspaceRoot"]>[0]) {
  return api().setWorkspaceRoot(input);
}

export function updateAiSettings(input: Parameters<ConstructProjectsApi["updateAiSettings"]>[0]) {
  return api().updateAiSettings(input).then((settings) => {
    void apiTracker.refreshSettings();
    return settings;
  });
}

export function updateAppSettings(input: Parameters<ConstructProjectsApi["updateAppSettings"]>[0]) {
  return api().updateAppSettings(input).then((settings) => {
    void apiTracker.refreshSettings();
    return settings;
  });
}

export function listAiFeatures() {
  return api().listAiFeatures();
}

export function listModels(input: Parameters<ConstructProjectsApi["listModels"]>[0]) {
  return trackPromise("server.updateProvider", "Updating providers", api().listModels(input));
}

export function getLearningState() {
  return api().getLearningState();
}

export function getProjectLearningState(projectId: string) {
  return api().getProjectLearningState(projectId);
}

export function applyLearningPatch(input: Parameters<ConstructProjectsApi["applyLearningPatch"]>[0]) {
  return api().applyLearningPatch(input);
}

export function getWeakConcepts(input?: Parameters<ConstructProjectsApi["getWeakConcepts"]>[0]) {
  return api().getWeakConcepts(input);
}

export function saveKnowledgeConcept(input: Parameters<ConstructProjectsApi["saveKnowledgeConcept"]>[0]) {
  return api().saveKnowledgeConcept(input);
}

export function openKnowledgeConcept(input: Parameters<ConstructProjectsApi["openKnowledgeConcept"]>[0]) {
  return api().openKnowledgeConcept(input);
}

export function recordConceptOpen(input: Parameters<ConstructProjectsApi["recordConceptOpen"]>[0]) {
  return api().recordConceptOpen(input);
}

export function removeKnowledgeConceptFromStore(input: Parameters<ConstructProjectsApi["removeKnowledgeConcept"]>[0]) {
  return api().removeKnowledgeConcept(input);
}

export function listProjects(): Promise<ProjectSummary[]> {
  return api().listProjects();
}

export function openProject(id: string): Promise<AnyProjectRecord> {
  return api().openProject(id);
}

export function updateProject(input: Parameters<ConstructProjectsApi["updateProject"]>[0]) {
  return api().updateProject(input);
}

export function readProjectTape(projectId: string): ReturnType<ConstructProjectsApi["readProjectTape"]> {
  return api().readProjectTape(projectId);
}

export function updateProjectTape(input: Parameters<ConstructProjectsApi["updateProjectTape"]>[0]): ReturnType<ConstructProjectsApi["updateProjectTape"]> {
  return api().updateProjectTape(input);
}

export function listFiles(projectId: string): Promise<WorkspaceTreeNode[]> {
  return api().listFiles(projectId);
}

export function readFile(input: {
  projectId: string;
  path: string;
}): Promise<WorkspaceFile> {
  return api().readFile(input);
}

export function writeFile(input: {
  projectId: string;
  path: string;
  content: string;
}): Promise<WorkspaceFile> {
  return api().writeFile(input);
}

export function deleteFile(input: {
  projectId: string;
  path: string;
}): Promise<void> {
  return api().deleteFile(input);
}

export function renameFile(input: {
  projectId: string;
  oldPath: string;
  newPath: string;
}): Promise<void> {
  return api().renameFile(input);
}

export function createFolder(input: {
  projectId: string;
  path: string;
}): Promise<void> {
  return api().createFolder(input);
}

export function duplicateFile(input: {
  projectId: string;
  path: string;
  destPath: string;
}): Promise<void> {
  return api().duplicateFile(input);
}

export function verifyRecall(input: {
  projectId: string;
  recall: RecallBlock;
  references: ReferenceCard[];
  concepts?: ConceptCard[];
  savedKnowledge?: ConceptCard[];
  answer?: string;
}): Promise<VerificationResult> {
  return trackPromise("verify-recall", "Verifying block", api().verifyRecall(input));
}

export function runConstructInteract(input: Parameters<ConstructProjectsApi["runConstructInteract"]>[0]): Promise<ConstructInteractClientResult> {
  return trackPromise("interact", "Running Q&A", api().runConstructInteract(input));
}

export function runConstructFlowAgent(input: Parameters<ConstructProjectsApi["runConstructFlowAgent"]>[0]) {
  return trackPromise("flow-agent", "Running Flow agent", api().runConstructFlowAgent(input));
}

export function runConstructFlowResearch(input: Parameters<ConstructProjectsApi["runConstructFlowResearch"]>[0]) {
  return trackPromise("flow-research", "Running Flow research", api().runConstructFlowResearch(input));
}

export function readFlowMemory(input: Parameters<ConstructProjectsApi["readFlowMemory"]>[0]) {
  return api().readFlowMemory(input);
}

export function updateFlowMemory(input: Parameters<ConstructProjectsApi["updateFlowMemory"]>[0]) {
  return api().updateFlowMemory(input);
}

export function submitFlowTask(input: Parameters<ConstructProjectsApi["submitFlowTask"]>[0]) {
  return api().submitFlowTask(input);
}

export function rewindFlowSession(input: Parameters<ConstructProjectsApi["rewindFlowSession"]>[0]) {
  return api().rewindFlowSession(input);
}

export function onConstructFlowSessionEvent(callback: Parameters<ConstructProjectsApi["onConstructFlowSessionEvent"]>[0]): () => void {
  return api().onConstructFlowSessionEvent(callback);
}

export function onConstructInteractSessionEvent(callback: Parameters<ConstructProjectsApi["onConstructInteractSessionEvent"]>[0]): () => void {
  return api().onConstructInteractSessionEvent(callback);
}

export function reviewConstructAuthoring(input: Parameters<ConstructProjectsApi["reviewConstructAuthoring"]>[0]): ReturnType<ConstructProjectsApi["reviewConstructAuthoring"]> {
  return trackPromise("authoring-review", "Reviewing authoring", api().reviewConstructAuthoring(input));
}

export function explainSelection(input: {
  requestId: string;
  projectId: string;
  selection: ConstructSelectionContext;
  learningContext?: unknown;
}) {
  return trackPromise("explain-selection", "Explaining selection", api().explainSelection(input));
}

export function onSelectionExplanationLog(callback: Parameters<ConstructProjectsApi["onSelectionExplanationLog"]>[0]): () => void {
  return api().onSelectionExplanationLog(callback);
}

export function onAgentLog(callback: Parameters<ConstructProjectsApi["onAgentLog"]>[0]): () => void {
  return api().onAgentLog(callback);
}

export function startCodeGhostStream(input: {
  requestId: string;
  lineNumber: number;
  lineContent: string;
  language: string;
  linesBefore: string[];
  linesAfter: string[];
}): void {
  const callId = apiTracker.start("code-ghost", "Code Ghost stream");
  activeGhostCalls.set(input.requestId, callId);
  return api().startCodeGhostStream(input);
}

export function onCodeGhostToken(
  callback: (payload: { requestId: string; lineNumber: number; token: string; done: boolean; error?: string }) => void
): () => void {
  return api().onCodeGhostToken((payload) => {
    if (payload.done || payload.error) {
      const callId = activeGhostCalls.get(payload.requestId);
      if (callId) {
        apiTracker.end(callId);
        activeGhostCalls.delete(payload.requestId);
      }
    }
    callback(payload);
  });
}

export function deleteProject(input: { projectId: string; force?: boolean }): Promise<import("../types").DeleteProjectCheck | { deleted: true }> {
  return api().deleteProject(input);
}

export function gitStatus(projectId: string): ReturnType<ConstructProjectsApi["gitStatus"]> {
  return trackPromise("git-status", "Checking git status", api().gitStatus(projectId));
}

export function gitCommit(input: Parameters<ConstructProjectsApi["gitCommit"]>[0]): ReturnType<ConstructProjectsApi["gitCommit"]> {
  return trackPromise("git-commit", "Git commit", api().gitCommit(input));
}

export function gitPush(projectId: string): ReturnType<ConstructProjectsApi["gitPush"]> {
  return trackPromise("git-push", "Git push", api().gitPush(projectId));
}

export function terminalCreate(projectId: string, size?: { cols: number; rows: number }): Promise<{ sessionId: string }> {
  return api().terminalCreate({ projectId, ...size });
}

export function terminalInput(sessionId: string, data: string): Promise<void> {
  return api().terminalInput({ sessionId, data });
}

export function terminalResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return api().terminalResize({ sessionId, cols, rows });
}

export function terminalKill(sessionId: string): Promise<void> {
  return api().terminalKill({ sessionId });
}

export function onTerminalData(callback: (event: TerminalEvent) => void): () => void {
  return api().onTerminalData(callback);
}

export function onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void {
  return api().onTerminalExit(callback);
}

export function debugProcesses(): ReturnType<ConstructProjectsApi["debugProcesses"]> {
  return api().debugProcesses();
}

export function onVerifyLog(callback: (event: any) => void): () => void {
  return api().onVerifyLog(callback);
}

export function litellmStart(input: { port: number; openAiApiKey?: string; openRouterApiKey?: string }): Promise<import("../types").LitellmState> {
  return api().litellmStart(input);
}

export function litellmStop(): Promise<import("../types").LitellmState> {
  return api().litellmStop();
}

export function litellmStatus(): Promise<import("../types").LitellmState> {
  return api().litellmStatus();
}

export function litellmCheckInstall(): Promise<boolean> {
  return api().litellmCheckInstall();
}

export function litellmInstall(): Promise<boolean> {
  return api().litellmInstall();
}

export function onLitellmLog(callback: (payload: { level: string; message: string }) => void): () => void {
  return api().onLitellmLog(callback);
}

export function onLitellmStatusChange(callback: (payload: import("../types").LitellmState) => void): () => void {
  return api().onLitellmStatusChange(callback);
}

export function importOpencodeAuth(): Promise<string | null> {
  return api().importOpencodeAuth();
}

export function onProviderLog(callback: (payload: { provider: string; message: string; level: string }) => void): () => void {
  return api().onProviderLog(callback);
}

export function closeProject(): Promise<void> {
  return api().closeProject();
}

export function onFileChanged(callback: (payload: import("../types").ProjectFileChangePayload) => void): () => void {
  return api().onFileChanged(callback);
}

function estimateJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}
