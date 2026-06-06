import type {
  ConstructProgram,
  ConstructV2Api,
  ProjectRecord,
  ProjectSummary,
  TerminalEvent,
  TerminalExitEvent,
  WorkspaceFile,
  WorkspaceTreeNode
} from "../types";

declare global {
  interface Window {
    constructV2: ConstructV2Api;
  }
}

function api(): ConstructV2Api {
  if (!window.constructV2) {
    throw new Error("Construct v2 bridge is unavailable.");
  }

  return window.constructV2;
}

export function ensureProject(input: {
  source: string;
  program: ConstructProgram;
}): Promise<ProjectRecord> {
  return api().ensureProject(input);
}

export function listProjects(): Promise<ProjectSummary[]> {
  return api().listProjects();
}

export function openProject(id: string): Promise<ProjectRecord> {
  return api().openProject(id);
}

export function updateProject(input: Parameters<ConstructV2Api["updateProject"]>[0]) {
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

