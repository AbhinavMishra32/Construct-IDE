import type {
  ConstructProgram,
  ConstructProjectsApi,
  ProjectRecord,
  ProjectSummary,
  TerminalEvent,
  TerminalExitEvent,
  WorkspaceFile,
  WorkspaceTreeNode
} from "../types";

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

export function terminalCreate(projectId: string): Promise<{ sessionId: string }> {
  return api().terminalCreate({ projectId });
}

export function terminalInput(sessionId: string, data: string): Promise<void> {
  return api().terminalInput({ sessionId, data });
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
