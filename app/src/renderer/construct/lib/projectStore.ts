import { ensureProject, listProjects, openProject } from "./bridge";
import { parseConstructSource } from "./parser";
import { traceFailureProjectSource } from "../samples/traceFailureProject";
import type { ProjectRecord, ProjectSummary } from "../types";

export async function bootstrapProjects(): Promise<ProjectSummary[]> {
  const program = parseConstructSource(traceFailureProjectSource);
  await ensureProject({
    source: traceFailureProjectSource,
    program
  });

  return listProjects();
}

export async function openSavedProject(id: string): Promise<ProjectRecord> {
  return openProject(id);
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

