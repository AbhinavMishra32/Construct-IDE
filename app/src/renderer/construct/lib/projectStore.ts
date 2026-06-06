import { importProject, listProjects, openProject } from "./bridge";
import { parseConstructSource } from "./parser";
import type { ProjectRecord, ProjectSummary } from "../types";

export async function bootstrapProjects(): Promise<ProjectSummary[]> {
  return (await listProjects()).filter((project) => project.sourcePath);
}

export async function openSavedProject(id: string): Promise<ProjectRecord> {
  return openProject(id);
}

export async function createProjectFromConstructFile(input: {
  initializeGit: boolean;
  source: string;
  sourcePath: string;
  workspacePath: string;
}): Promise<ProjectRecord> {
  const program = parseConstructSource(input.source);

  return importProject({
    initializeGit: input.initializeGit,
    source: input.source,
    sourcePath: input.sourcePath,
    program,
    workspacePath: input.workspacePath
  });
}

export function formatLastOpened(value: string | null): string {
  if (!value) {
    return "Not opened yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not opened yet";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
