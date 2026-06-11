import type {
  ConstructProgram,
  ConstructProjectsApi,
  ProjectRecord,
  ProjectSummary,
  TerminalEvent,
  TerminalExitEvent,
  RecallBlock,
  ConceptCard,
  ReferenceCard,
  VerificationResult,
  WorkspaceFile,
  WorkspaceTreeNode
} from "../types";
import type { ConstructSelectionContext } from "./selectionContext";

declare global {
  interface Window {
    constructProjects: ConstructProjectsApi;
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

export function listProjects(): Promise<ProjectSummary[]> {
  return api().listProjects();
}

export function openProject(id: string): Promise<ProjectRecord> {
  return api().openProject(id);
}

export function updateProject(input: Parameters<ConstructProjectsApi["updateProject"]>[0]) {
  return api().updateProject(input);
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
}): Promise<VerificationResult> {
  return api().verifyRecall(input);
}

export function reviewConstructAuthoring(input: Parameters<ConstructProjectsApi["reviewConstructAuthoring"]>[0]): ReturnType<ConstructProjectsApi["reviewConstructAuthoring"]> {
  return api().reviewConstructAuthoring(input);
}

export function explainSelection(input: {
  requestId: string;
  projectId: string;
  selection: ConstructSelectionContext;
  learningContext?: unknown;
}) {
  return api().explainSelection(input);
}

export function onSelectionExplanationLog(callback: Parameters<ConstructProjectsApi["onSelectionExplanationLog"]>[0]): () => void {
  return api().onSelectionExplanationLog(callback);
}

export function startCodeGhostStream(input: {
  requestId: string;
  lineNumber: number;
  lineContent: string;
  language: string;
  linesBefore: string[];
  linesAfter: string[];
}): void {
  return api().startCodeGhostStream(input);
}

export function onCodeGhostToken(
  callback: (payload: { requestId: string; lineNumber: number; token: string; done: boolean; error?: string }) => void
): () => void {
  return api().onCodeGhostToken(callback);
}

export function deleteProject(input: { projectId: string; force?: boolean }): Promise<import("../types").DeleteProjectCheck | { deleted: true }> {
  return api().deleteProject(input);
}

export function gitStatus(projectId: string): ReturnType<ConstructProjectsApi["gitStatus"]> {
  return api().gitStatus(projectId);
}

export function gitCommit(input: Parameters<ConstructProjectsApi["gitCommit"]>[0]): ReturnType<ConstructProjectsApi["gitCommit"]> {
  return api().gitCommit(input);
}

export function gitPush(projectId: string): ReturnType<ConstructProjectsApi["gitPush"]> {
  return api().gitPush(projectId);
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
