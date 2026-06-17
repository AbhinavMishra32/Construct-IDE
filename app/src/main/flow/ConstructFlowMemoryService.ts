import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import type { FlowMemoryFileName } from "../../shared/constructFlow";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";

export const FLOW_MEMORY_DIRECTORY = ".construct/flow-memory" as const;

export const FLOW_MEMORY_FILES = [
  "research.md",
  "project.md",
  "path.md",
  "learner.md"
] as const satisfies readonly FlowMemoryFileName[];

export type FlowMemoryReadResult = {
  file: FlowMemoryFileName;
  path: string;
  content: string;
  exists: boolean;
  updatedAt: string | null;
};

export class ConstructFlowMemoryService {
  constructor(private readonly workspace: ConstructProjectWorkspaceService) {}

  async ensure(project: StoredFlowProject): Promise<FlowMemoryReadResult[]> {
    const directory = this.workspace.safeProjectPath(project, FLOW_MEMORY_DIRECTORY);
    await mkdir(directory, { recursive: true });

    for (const file of FLOW_MEMORY_FILES) {
      const target = this.memoryFilePath(project, file);
      if (!existsSync(target)) {
        await writeFile(target, starterContent(project, file), "utf8");
      }
    }

    return this.read(project);
  }

  async read(
    project: StoredFlowProject,
    files: readonly FlowMemoryFileName[] = FLOW_MEMORY_FILES
  ): Promise<FlowMemoryReadResult[]> {
    return Promise.all(files.map(async (file) => {
      const target = this.memoryFilePath(project, file);
      if (!existsSync(target)) {
        return {
          file,
          path: path.posix.join(FLOW_MEMORY_DIRECTORY, file),
          content: "",
          exists: false,
          updatedAt: null
        };
      }

      const fileStat = await stat(target);
      return {
        file,
        path: path.posix.join(FLOW_MEMORY_DIRECTORY, file),
        content: await readFile(target, "utf8"),
        exists: true,
        updatedAt: fileStat.mtime.toISOString()
      };
    }));
  }

  async update(
    project: StoredFlowProject,
    updates: Array<{ file: FlowMemoryFileName; content: string }>
  ): Promise<FlowMemoryReadResult[]> {
    await mkdir(this.workspace.safeProjectPath(project, FLOW_MEMORY_DIRECTORY), { recursive: true });

    for (const update of updates) {
      await writeFile(this.memoryFilePath(project, update.file), normalizeMarkdown(update.content), "utf8");
    }

    return this.read(project, updates.map((update) => update.file));
  }

  memoryFilePath(project: StoredFlowProject, file: FlowMemoryFileName): string {
    if (!(FLOW_MEMORY_FILES as readonly string[]).includes(file)) {
      throw new Error(`Unsupported Flow Memory file: ${file}`);
    }
    return this.workspace.safeProjectPath(project, path.join(FLOW_MEMORY_DIRECTORY, file));
  }
}

function normalizeMarkdown(value: string): string {
  const trimmedRight = String(value ?? "").replace(/[ \t]+\n/g, "\n").trimEnd();
  return `${trimmedRight}\n`;
}

function starterContent(project: StoredFlowProject, file: FlowMemoryFileName): string {
  switch (file) {
    case "research.md":
      return normalizeMarkdown(`# Research\n\nNo research has been captured yet.\n\nProject goal: ${project.flow.goal}`);
    case "project.md":
      return normalizeMarkdown([
        "# Project",
        "",
        `Title: ${project.title}`,
        "",
        `Goal: ${project.flow.goal}`,
        "",
        project.flow.stackPreference ? `Stack preference: ${project.flow.stackPreference}` : "Stack preference: not specified yet.",
        "",
        "Important files: not mapped yet.",
        "",
        "Important commands: not mapped yet.",
        "",
        "Constraints: keep changes minimal and reversible."
      ].join("\n"));
    case "path.md":
      return normalizeMarkdown([
        "# Path",
        "",
        "Current direction: clarify the project and choose the first useful coding move.",
        "",
        "Recently done: Flow project created.",
        "",
        "Likely next: inspect the workspace and ask one focused question if the goal is still unclear.",
        "",
        "Blockers/questions: none recorded yet.",
        "",
        "Handoff: start naturally from the learner's latest message."
      ].join("\n"));
    case "learner.md":
      return normalizeMarkdown([
        "# Learner",
        "",
        "Learner style: not enough evidence yet.",
        "",
        "Known concepts: none recorded yet.",
        "",
        "Weak concepts: none recorded yet.",
        "",
        "Current help level: balanced.",
        "",
        "Recent learning evidence: none recorded yet."
      ].join("\n"));
  }

  return normalizeMarkdown(`# ${file}\n`);
}
