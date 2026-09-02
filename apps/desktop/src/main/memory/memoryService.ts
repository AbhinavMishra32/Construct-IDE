import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceService } from "../projects/workspaceService.js";

/**
 * Flow Memory: what Construct remembers about a project between turns.
 *
 * Four Markdown files in the project's own `.construct` directory, and the fact
 * that they are files in the learner's repository rather than rows in Construct's
 * database is the whole design. A learner can read them, edit them, diff them,
 * commit them, and take them to another machine; the agent reads and patches them
 * the same way it would any other file it has been told about. Memory that lives
 * only in an application's private store is memory the learner cannot audit —
 * and this memory is *about them*.
 *
 *   research.md — what this domain is, gathered once before teaching starts
 *   project.md  — what the project is: goal, stack, important files, commands
 *   path.md     — where the teaching has got to and what comes next
 *   learner.md  — how this person learns, and what they already know
 *
 * Ported from v0.7's `ConstructFlowMemoryService`, including the patch modes and
 * the exact-match rule below, because the agent's prompt is v0.7's prompt and it
 * describes these files by name.
 */
export const MEMORY_DIRECTORY = ".construct";

export const MEMORY_FILES = ["research.md", "project.md", "path.md", "learner.md"] as const;
export type MemoryFile = (typeof MEMORY_FILES)[number];

export type MemoryRead = {
  file: MemoryFile;
  /** Project-relative, always posix, because it is shown to the learner. */
  path: string;
  content: string;
  exists: boolean;
  updatedAt: string | null;
};

export type MemoryPatch = {
  file: MemoryFile;
  mode: "append" | "prepend" | "replace";
  content: string;
  reason: string;
  /** Required by `replace`: the exact text to swap out. */
  find?: string | undefined;
};

export type MemoryPatchResult = {
  file: MemoryFile;
  path: string;
  reason: string;
  mode: MemoryPatch["mode"];
  diff: string;
  updatedAt: string;
};

export class MemoryService {
  constructor(private readonly workspace: WorkspaceService) {}

  /** Creates whatever is missing, and answers with all four. Called when a
   *  project is created and again when one is opened, because a learner who
   *  deletes a memory file should get a fresh one rather than an error. */
  async ensure(
    project: { directory: string; name: string; goal: string; language: string },
    foundation?: Foundation,
    /* What the learner said about themselves on the way into Construct, as
       lines. Written into this project's `learner.md` as well as being in the
       agent's prompt, because this file is the one a learner can open, and a
       file that says "no evidence yet" about someone who filled in an intake is
       a file that is simply wrong. */
    intake?: readonly string[],
  ): Promise<MemoryRead[]> {
    await mkdir(await this.folder(project.directory), { recursive: true });

    for (const file of MEMORY_FILES) {
      const target = await this.pathTo(project.directory, file);
      if (!existsSync(target)) await writeFile(target, starter(project, file, foundation, intake), "utf8");
    }

    return this.read(project.directory);
  }

  async read(directory: string, files: readonly MemoryFile[] = MEMORY_FILES): Promise<MemoryRead[]> {
    return Promise.all(
      files.map(async (file) => {
        const target = await this.pathTo(directory, file);
        const relative = path.posix.join(MEMORY_DIRECTORY, file);
        if (!existsSync(target)) return { file, path: relative, content: "", exists: false, updatedAt: null };
        const [content, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
        return { file, path: relative, content, exists: true, updatedAt: info.mtime.toISOString() };
      }),
    );
  }

  /** Full save. The fallback: the agent is told to patch, because a patch says
   *  what changed and a save does not. */
  async update(directory: string, updates: Array<{ file: MemoryFile; content: string }>): Promise<MemoryRead[]> {
    await mkdir(await this.folder(directory), { recursive: true });
    for (const update of updates) {
      await writeFile(await this.pathTo(directory, update.file), normalise(update.content), "utf8");
    }
    return this.read(directory, updates.map((update) => update.file));
  }

  /**
   * Applies patches and reports what each one did.
   *
   * A diff per patch rather than a bare acknowledgement, because the transcript
   * shows these: "Construct updated its memory" is not something a learner can
   * check, and three added lines is.
   */
  async patch(directory: string, patches: MemoryPatch[]): Promise<MemoryPatchResult[]> {
    await mkdir(await this.folder(directory), { recursive: true });

    const results: MemoryPatchResult[] = [];
    for (const patch of patches) {
      const target = await this.pathTo(directory, patch.file);
      const before = existsSync(target) ? await readFile(target, "utf8") : "";
      const after = normalise(apply(before, patch));
      await writeFile(target, after, "utf8");
      results.push({
        file: patch.file,
        path: path.posix.join(MEMORY_DIRECTORY, patch.file),
        reason: patch.reason,
        mode: patch.mode,
        diff: diff(patch.file, before, after),
        updatedAt: new Date().toISOString(),
      });
    }
    return results;
  }

  private async folder(directory: string): Promise<string> {
    return this.workspace.resolveInsideReal(directory, MEMORY_DIRECTORY);
  }

  /** Through the workspace's containment check like every other file operation:
   *  the file name comes from a tool argument the model chose, and `..` in it
   *  would otherwise be a way out of the project. */
  private async pathTo(directory: string, file: MemoryFile): Promise<string> {
    if (!(MEMORY_FILES as readonly string[]).includes(file)) throw new Error(`Construct has no memory file called ${file}.`);
    return this.workspace.resolveInsideReal(directory, path.join(MEMORY_DIRECTORY, file));
  }
}

/** Trailing whitespace gone, exactly one newline at the end. Memory files are
 *  appended to constantly, so without this they accumulate blank lines until the
 *  diffs are mostly whitespace. */
function normalise(value: string): string {
  return `${String(value ?? "").replace(/[ \t]+\n/g, "\n").trimEnd()}\n`;
}

function apply(before: string, patch: MemoryPatch): string {
  const content = normalise(patch.content).trimEnd();
  if (!content.trim()) throw new Error("A memory patch cannot be empty.");

  if (patch.mode === "append") return before.trimEnd() ? `${before.trimEnd()}\n\n${content}\n` : `${content}\n`;
  if (patch.mode === "prepend") return before.trim() ? `${content}\n\n${before.trimStart()}` : `${content}\n`;

  const find = patch.find ?? "";
  if (!find) throw new Error("A replace patch needs the exact text to replace.");

  const span = locate(before, find);
  if (span === "missing") {
    /* Says what to do instead. The agent gets this back as a tool result and
       retries from it, so an error that only reports failure costs a whole
       round trip to learn nothing. */
    throw new Error(
      `Construct could not find that text in ${patch.file}. Fetch the file and copy the lines exactly, or use mode "append" to add to it instead.`,
    );
  }
  /* Ambiguity is refused rather than resolved. The model supplies `find`, and
     silently patching the first of several matches is how memory ends up saying
     something nobody wrote. */
  if (span === "ambiguous") {
    throw new Error(`That text appears more than once in ${patch.file}. Use a longer, unique find string.`);
  }
  return `${before.slice(0, span.start)}${content}${before.slice(span.end)}`;
}

/**
 * Finds `find` in `before`, forgiving the differences that are not differences.
 *
 * An exact match is tried first and is what almost always runs. The fallback
 * exists because the model does not have the file in front of it — it has what a
 * fetch showed it several steps ago, and it retypes that from memory. Trailing
 * spaces, a tab against four spaces, and CRLF against LF all break `indexOf`
 * while meaning nothing, and every one of those failures cost a whole retry
 * that failed the same way.
 *
 * Matching is line-based, so what is forgiven is bounded: whitespace at the ends
 * of lines and the exact characters used to indent. A line whose words differ
 * still does not match, which is the point — a fuzzy match that rewrites the
 * wrong paragraph is worse than no match at all.
 */
type Span = { start: number; end: number };

function locate(before: string, find: string): Span | "missing" | "ambiguous" {
  const exact = before.indexOf(find);
  if (exact >= 0) {
    return before.indexOf(find, exact + find.length) >= 0 ? "ambiguous" : { start: exact, end: exact + find.length };
  }

  const key = (line: string) => line.replace(/\r$/, "").replace(/\s+$/, "").replace(/^\s+/, (run) => " ".repeat(run.length));
  const lines = before.split("\n");
  const wanted = find.split("\n").map(key);
  /* A find string that ends in a newline splits to a trailing empty line, which
     would only ever match an empty line in the file. */
  while (wanted.length > 1 && wanted[wanted.length - 1] === "") wanted.pop();
  if (wanted.length === 0) return "missing";

  /* Offset of the start of each line, so a line range can be turned back into a
     span of the original text — the replacement has to be spliced into the file
     as it really is, not into the normalised copy. */
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }

  let found: Span | null = null;
  for (let index = 0; index + wanted.length <= lines.length; index += 1) {
    let same = true;
    for (let step = 0; step < wanted.length; step += 1) {
      if (key(lines[index + step]!) !== wanted[step]) {
        same = false;
        break;
      }
    }
    if (!same) continue;
    if (found) return "ambiguous";
    const last = index + wanted.length - 1;
    found = { start: offsets[index]!, end: offsets[last]! + lines[last]!.length };
  }

  return found ?? "missing";
}

/**
 * A unified-ish diff of the one region that changed.
 *
 * Not a real diff algorithm: it finds the common prefix and suffix and prints
 * what is between them with three lines of context. That is all a transcript row
 * needs, and a proper LCS diff here would be a dependency and a decision about
 * rename detection in aid of a fifteen-line note.
 */
function diff(file: string, before: string, after: string): string {
  const from = before.split(/\r?\n/);
  const to = after.split(/\r?\n/);

  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start += 1;

  let fromEnd = from.length - 1;
  let toEnd = to.length - 1;
  while (fromEnd >= start && toEnd >= start && from[fromEnd] === to[toEnd]) {
    fromEnd -= 1;
    toEnd -= 1;
  }

  const context = Math.max(0, start - 3);
  const removed = from.slice(context, Math.min(from.length, fromEnd + 4));
  const added = to.slice(context, Math.min(to.length, toEnd + 4));
  return [
    `--- ${file}`,
    `+++ ${file}`,
    `@@ ${context + 1} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}

/**
 * What a memory file says before anything has happened.
 *
 * Written as prose with the project's own details in it rather than as empty
 * headings, and that is deliberate: the agent reads these at the start of every
 * turn, and a file of empty headings reads as a form to fill in — which is how
 * v0.7's early builds got six stub sections instead of notes. A starter that
 * states plainly that nothing is known yet is a starter the agent replaces.
 */
/** Concepts the learner brought with them, as the dialog collected them. */
type Foundation = ReadonlyArray<{ title: string; level: number }>;

function starter(project: { name: string; goal: string; language: string }, file: MemoryFile, foundation?: Foundation, intake?: readonly string[]): string {
  switch (file) {
    case "research.md":
      return normalise(`# Research\n\nNo research captured yet.\n\nProject goal: ${project.goal}`);
    case "project.md":
      return normalise(
        [
          "# Project",
          "",
          `Title: ${project.name}`,
          "",
          `Goal: ${project.goal}`,
          "",
          `Language: ${project.language}`,
          "",
          "Important files: not mapped yet.",
          "",
          "Important commands: not mapped yet.",
          "",
          "Constraints: keep changes minimal and reversible.",
        ].join("\n"),
      );
    case "path.md":
      return normalise(
        [
          "# Path",
          "",
          "Current direction: clarify the project and choose the first useful move.",
          "",
          "Recently done: project created.",
          "",
          "Likely next: look at the workspace, then teach or ask one focused question.",
          "",
          "Blockers/questions: none recorded yet.",
          "",
          "Handoff: start from the learner's latest message.",
        ].join("\n"),
      );
    case "learner.md":
      return normalise(
        [
          "# Learner",
          "",
          /* The global profile first: it is what is known before this project
             starts, and the placeholders below are what this project has yet to
             find out. Kept apart from them under its own heading so the agent
             never mistakes a stated preference for an inference it made. */
          ...(intake?.length ? ["## From their intake", "", ...intake, ""] : []),
          /* Written on the first line because it is the one thing here that is
             evidence rather than a placeholder: the learner chose these from
             their own atlas, so the levels are earned rather than guessed. An
             agent that opens this file and re-teaches them has wasted the
             session. */
          ...(foundation?.length
            ? [
                "Already holds (chosen by the learner, from other projects):",
                ...foundation.map((concept) => `- ${concept.title} — level ${concept.level}`),
                "",
                "Build on these rather than re-teaching them. Check rather than assume:",
                "a level is evidence from another project, not a guarantee it transfers here.",
                "",
              ]
            : []),
          "Learner style: not enough evidence yet.",
          "",
          "Preferences and constraints: none recorded yet.",
          "",
          "Autonomy and tooling preferences: balanced; no evidence yet.",
          "",
          "Known concepts: none recorded yet.",
          "",
          "Weak concepts: none recorded yet.",
          "",
          "Current help level: balanced.",
          "",
          "Recent learning evidence: none recorded yet.",
        ].join("\n"),
      );
  }
}
