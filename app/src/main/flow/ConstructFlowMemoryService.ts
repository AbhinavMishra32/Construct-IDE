import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import type {
  ConstructFlowMemoryPatchResult,
  FlowMemoryFileName
} from "../../shared/constructFlow";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";

export const FLOW_MEMORY_DIRECTORY = ".construct" as const;
export const LEGACY_FLOW_MEMORY_DIRECTORY = ".construct/flow-memory" as const;

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

export type FlowMemoryPatchInput = {
  file: FlowMemoryFileName;
  mode: "append" | "prepend" | "replace";
  content: string;
  reason: string;
  find?: string;
};

export class ConstructFlowMemoryService {
  constructor(private readonly workspace: ConstructProjectWorkspaceService) {}

  async ensure(project: StoredFlowProject): Promise<FlowMemoryReadResult[]> {
    const directory = this.workspace.safeProjectPath(project, FLOW_MEMORY_DIRECTORY);
    await mkdir(directory, { recursive: true });

    for (const file of FLOW_MEMORY_FILES) {
      const target = this.memoryFilePath(project, file);
      if (!existsSync(target)) {
        const legacyTarget = this.legacyMemoryFilePath(project, file);
        const content = existsSync(legacyTarget)
          ? await readFile(legacyTarget, "utf8")
          : starterContent(project, file);
        await writeFile(target, content, "utf8");
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
      const source = existsSync(target)
        ? target
        : existsSync(this.legacyMemoryFilePath(project, file))
          ? this.legacyMemoryFilePath(project, file)
          : null;
      if (!source) {
        return {
          file,
          path: path.posix.join(FLOW_MEMORY_DIRECTORY, file),
          content: "",
          exists: false,
          updatedAt: null
        };
      }

      const fileStat = await stat(source);
      return {
        file,
        path: path.posix.join(FLOW_MEMORY_DIRECTORY, file),
        content: await readFile(source, "utf8"),
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

  async updateWithDiff(
    project: StoredFlowProject,
    updates: Array<{ file: FlowMemoryFileName; content: string; reason?: string }>
  ): Promise<ConstructFlowMemoryPatchResult[]> {
    await mkdir(this.workspace.safeProjectPath(project, FLOW_MEMORY_DIRECTORY), { recursive: true });

    const results: ConstructFlowMemoryPatchResult[] = [];
    for (const update of updates) {
      const target = this.memoryFilePath(project, update.file);
      const before = await this.readExistingMemoryFile(project, update.file);
      const after = normalizeMarkdown(update.content);
      await writeFile(target, after, "utf8");
      results.push({
        file: update.file,
        path: path.posix.join(FLOW_MEMORY_DIRECTORY, update.file),
        reason: update.reason ?? "Saved the full Flow Memory file.",
        mode: "replace",
        diff: simpleUnifiedDiff(update.file, before, after),
        updatedAt: new Date().toISOString(),
        addedText: after
      });
    }

    return results;
  }

  async patch(
    project: StoredFlowProject,
    patches: FlowMemoryPatchInput[]
  ): Promise<ConstructFlowMemoryPatchResult[]> {
    await mkdir(this.workspace.safeProjectPath(project, FLOW_MEMORY_DIRECTORY), { recursive: true });

    const results: ConstructFlowMemoryPatchResult[] = [];
    for (const patch of patches) {
      const target = this.memoryFilePath(project, patch.file);
      const before = await this.readExistingMemoryFile(project, patch.file);
      const after = applyMemoryPatch(before, patch);
      await writeFile(target, normalizeMarkdown(after), "utf8");
      const updatedAt = new Date().toISOString();
      results.push({
        file: patch.file,
        path: path.posix.join(FLOW_MEMORY_DIRECTORY, patch.file),
        reason: patch.reason,
        mode: patch.mode,
        diff: simpleUnifiedDiff(patch.file, before, normalizeMarkdown(after)),
        updatedAt,
        addedText: patch.content,
        removedText: patch.mode === "replace" ? patch.find : undefined
      });
    }

    return results;
  }

  memoryFilePath(project: StoredFlowProject, file: FlowMemoryFileName): string {
    if (!(FLOW_MEMORY_FILES as readonly string[]).includes(file)) {
      throw new Error(`Unsupported Flow Memory file: ${file}`);
    }
    return this.workspace.safeProjectPath(project, path.join(FLOW_MEMORY_DIRECTORY, file));
  }

  private legacyMemoryFilePath(project: StoredFlowProject, file: FlowMemoryFileName): string {
    return this.workspace.safeProjectPath(project, path.join(LEGACY_FLOW_MEMORY_DIRECTORY, file));
  }

  private async readExistingMemoryFile(project: StoredFlowProject, file: FlowMemoryFileName): Promise<string> {
    const target = this.memoryFilePath(project, file);
    if (existsSync(target)) {
      return readFile(target, "utf8");
    }
    const legacyTarget = this.legacyMemoryFilePath(project, file);
    if (existsSync(legacyTarget)) {
      return readFile(legacyTarget, "utf8");
    }
    return "";
  }
}

function normalizeMarkdown(value: string): string {
  const trimmedRight = String(value ?? "").replace(/[ \t]+\n/g, "\n").trimEnd();
  return `${trimmedRight}\n`;
}

function applyMemoryPatch(before: string, patch: FlowMemoryPatchInput): string {
  const content = normalizeMarkdown(patch.content).trimEnd();
  if (!content.trim()) {
    throw new Error("Flow Memory patch content cannot be empty.");
  }

  if (patch.mode === "append") {
    return before.trimEnd() ? `${before.trimEnd()}\n\n${content}\n` : `${content}\n`;
  }

  if (patch.mode === "prepend") {
    return before.trim() ? `${content}\n\n${before.trimStart()}` : `${content}\n`;
  }

  const find = patch.find ?? "";
  if (!find) {
    throw new Error("Flow Memory replace patches require exact find text.");
  }
  const first = before.indexOf(find);
  if (first < 0) {
    throw new Error(`Could not find exact memory text in ${patch.file}.`);
  }
  if (before.indexOf(find, first + find.length) >= 0) {
    throw new Error(`Exact memory text appears more than once in ${patch.file}; use a narrower find string.`);
  }
  return `${before.slice(0, first)}${content}${before.slice(first + find.length)}`;
}

function simpleUnifiedDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const beforeContextEnd = Math.min(beforeLines.length - 1, beforeEnd + 3);
  const afterContextEnd = Math.min(afterLines.length - 1, afterEnd + 3);
  const removed = beforeLines.slice(contextStart, Math.max(contextStart, beforeContextEnd + 1));
  const added = afterLines.slice(contextStart, Math.max(contextStart, afterContextEnd + 1));
  return [
    `--- ${file}`,
    `+++ ${file}`,
    `@@ ${contextStart + 1} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`)
  ].join("\n");
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
        project.flow.stackPreference ? `Project context: ${project.flow.stackPreference}` : "Project context: not specified yet.",
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
        "Preferences and constraints: none recorded yet.",
        "",
        "Autonomy and tooling preferences: balanced; no concrete evidence yet.",
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
