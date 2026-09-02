import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceService } from "../projects/workspaceService.js";
import type { MemoryFile, MemoryPatch, MemoryRead, MemoryPatchResult } from "../memory/memoryService.js";
import { MEMORY_FILES } from "../memory/memoryService.js";
import type { PathNodeInput, PlannedPath } from "../learning/pathService.js";
import type { WebSearchResult } from "../webSearch.js";

const run = promisify(execFile);

/** A command may run for this long before it is killed. Long enough for a test
 *  suite or an install, short enough that a hung command does not wedge a turn
 *  until the learner gives up and quits. */
const COMMAND_TIMEOUT_MS = 120_000;
/** Output beyond this is truncated. A command that prints a megabyte would
 *  otherwise spend the model's entire context on one tool result. */
const MAX_OUTPUT_CHARS = 20_000;

export type AgentToolContext = {
  projectDirectory: string;
  workspace: WorkspaceService;
  /** Records a mastery reading. The agent is the only thing that can judge
   *  understanding, so this is the one tool whose effect is on the learner's
   *  record rather than on their files. */
  /** Sets or corrects a practice task. Status is not the agent's to set here —
   *  a task it writes is open, and it moves through `judgeTask`. */
  saveTask(input: {
    taskId: string;
    title: string;
    brief: string;
    criteria: string[];
    concepts: string[];
    files: string[];
  }): void;
  /** The agent's verdict on a submitted task. */
  judgeTask(taskId: string, passed: boolean, outcome: string): void;
  recordConcept(input: {
    conceptId: string;
    /** Omitted leaves the concept where it is; null moves it to the top. */
    parentId?: string | null;
    title: string;
    masteryLevel: number;
    confidence: string;
    note: string;
    reason: string;
    summary: string;
    /** The whole note, as Markdown. One field rather than a set of titled
     *  ones: the agent writes prose, and asking it to fill six boxes produced
     *  six stubs instead of one good entry. */
    content: string;
    docs: Array<{ title: string; url: string }>;
    tags: string[];
  }): void;
  /** Flow Memory: the four Markdown files in the project's own `.construct`.
   *  Read by purpose rather than by habit, and patched rather than rewritten —
   *  see `memoryService.ts` for why both of those matter. */
  readMemory(files: MemoryFile[]): Promise<MemoryRead[]>;
  patchMemory(patches: MemoryPatch[]): Promise<MemoryPatchResult[]>;
  /** Records or revises the teaching path: the ordered steps between where the
   *  learner is and the project they set out to build. */
  planPath(input: { reason: string; currentNodeId?: string | undefined; nodes: PathNodeInput[] }): Promise<PlannedPath>;
  /** The web, when a key is configured. Unconfigured is an answer rather than an
   *  error: the agent has other ways to make progress and a thrown error would
   *  end the turn. */
  webSearch(query: string, limit: number): Promise<WebSearchResult>;
  webFetch(urls: string[]): Promise<WebSearchResult>;
  /** Puts a question to the learner and resolves with their answer. The agent
   *  is a teaching system, so asking is a first-class move and the turn genuinely
   *  waits here. */
  askLearner(request: { question: string; header?: string; choices?: string[]; allowOther: boolean }): Promise<string>;
};

/**
 * Executes one tool call from the agent worker.
 *
 * Every filesystem path goes through the same WorkspaceService the editor uses,
 * so the agent is bound by exactly the containment rules the renderer is — it
 * cannot read or write outside the project, symlinks included. The worker has
 * no filesystem access of its own precisely so this stays the only place those
 * rules have to be enforced.
 */
export async function executeAgentTool(name: string, input: unknown, context: AgentToolContext): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case "read-file":
      return context.workspace.read(context.projectDirectory, String(args.path ?? ""));

    case "write-file":
      await context.workspace.write(context.projectDirectory, String(args.path ?? ""), String(args.content ?? ""));
      return { written: true };

    case "list-files":
      return context.workspace.list(context.projectDirectory, args.directory ? String(args.directory) : "");

    case "run-terminal-command":
      return runCommand(String(args.command ?? ""), context.projectDirectory);

    case "record-concept": {
      const level = Number(args.masteryLevel ?? 0);
      const conceptId = String(args.conceptId ?? "").trim();
      /* Three distinct answers, and they have to stay distinct: absent means
         "leave it where it is", null means "move it to the top", and a slug
         means "put it under that". Coercing absent to null would flatten the
         tree on every level update. */
      const parent =
        args.parentId === undefined
          ? undefined
          : args.parentId === null || String(args.parentId).trim() === ""
            ? null
            : String(args.parentId).trim();

      context.recordConcept({
        conceptId,
        ...(parent === undefined ? {} : { parentId: parent }),
        title: String(args.title ?? "").trim(),
        /* Clamped rather than rejected. A model that answers 7 has still told
           us the learner is fluent, and refusing the call would lose that. */
        masteryLevel: Number.isFinite(level) ? Math.min(5, Math.max(0, Math.round(level))) : 0,
        confidence: String(args.confidence ?? "introduced").trim(),
        note: String(args.note ?? ""),
        reason: String(args.reason ?? ""),
        summary: String(args.summary ?? ""),
        content: String(args.content ?? ""),
        /* Only http(s) links are kept. A concept note is rendered with its
           references as real links, and a file: or javascript: URL arriving
           from a model must never become one. */
        docs: Array.isArray(args.docs)
          ? args.docs
              .map((entry) => entry as { title?: unknown; url?: unknown })
              .filter((entry) => /^https?:\/\//i.test(String(entry.url ?? "")))
              .map((entry) => ({ title: String(entry.title ?? entry.url), url: String(entry.url) }))
              .slice(0, 5)
          : [],
        tags: Array.isArray(args.tags) ? args.tags.map(String).slice(0, 8) : [],
      });
      return { recorded: true };
    }

    case "set-practice-task": {
      const criteria = Array.isArray(args.criteria)
        ? args.criteria.map(String).map((line) => line.trim()).filter(Boolean).slice(0, 8)
        : [];
      /* A task with nothing to check is not a task. Refused rather than stored
         empty, because the learner would get a card with no way to finish it. */
      if (criteria.length === 0) throw new Error("A practice task needs at least one success criterion.");

      context.saveTask({
        taskId: String(args.taskId ?? "").trim(),
        title: String(args.title ?? "").trim(),
        brief: String(args.brief ?? ""),
        criteria,
        concepts: Array.isArray(args.concepts) ? args.concepts.map(String).slice(0, 8) : [],
        files: Array.isArray(args.files) ? args.files.map(String).slice(0, 8) : [],
      });
      return { set: true };
    }

    case "judge-practice-task": {
      context.judgeTask(String(args.taskId ?? "").trim(), args.passed === true, String(args.outcome ?? ""));
      return { judged: true };
    }

    case "flow-memory-fetch": {
      /* Named files only, and defaulted to all four when the model asks for
         nothing in particular — the prompt tells it to fetch by purpose, but a
         turn that fetches badly should still get its memory. */
      const asked = Array.isArray(args.files) ? args.files.map(String) : [];
      const files = asked.filter((file): file is MemoryFile => (MEMORY_FILES as readonly string[]).includes(file));
      return context.readMemory(files.length > 0 ? files : [...MEMORY_FILES]);
    }

    case "flow-memory-patch": {
      const patches = Array.isArray(args.patches) ? args.patches : [];
      if (patches.length === 0) throw new Error("No memory patches were given.");
      return context.patchMemory(
        patches.slice(0, 6).map((entry) => {
          const patch = entry as Record<string, unknown>;
          const file = String(patch.file ?? "");
          if (!(MEMORY_FILES as readonly string[]).includes(file)) throw new Error(`Construct has no memory file called ${file}.`);
          const mode = String(patch.mode ?? "append");
          if (mode !== "append" && mode !== "prepend" && mode !== "replace") throw new Error(`Unknown memory patch mode: ${mode}`);
          return {
            file: file as MemoryFile,
            mode,
            content: String(patch.content ?? ""),
            reason: String(patch.reason ?? "Updated memory."),
            ...(patch.find ? { find: String(patch.find) } : {}),
          };
        }),
      );
    }

    case "plan-learning-path": {
      const nodes = Array.isArray(args.nodes) ? args.nodes : [];
      if (nodes.length === 0) throw new Error("A path needs at least one step.");
      return context.planPath({
        reason: String(args.reason ?? "Planned the path."),
        ...(args.currentNodeId ? { currentNodeId: String(args.currentNodeId) } : {}),
        nodes: nodes.slice(0, 14).map((entry) => {
          const node = entry as Record<string, unknown>;
          return {
            id: String(node.id ?? "").trim(),
            title: String(node.title ?? "").trim(),
            summary: String(node.summary ?? "").trim(),
            ...(node.kind ? { kind: String(node.kind) } : {}),
            ...(node.status ? { status: String(node.status) } : {}),
            ...(Array.isArray(node.concepts) ? { concepts: node.concepts.map(String).slice(0, 16) } : {}),
            ...(Array.isArray(node.exitCriteria) ? { exitCriteria: node.exitCriteria.map(String).slice(0, 8) } : {}),
          } as PathNodeInput;
        }),
      });
    }

    case "web-search":
      return context.webSearch(String(args.query ?? ""), Number(args.limit ?? 5));

    case "web-fetch":
      return context.webFetch(Array.isArray(args.urls) ? args.urls.map(String) : []);

    case "ask_user_question":
      return context.askLearner({
        question: String(args.question ?? ""),
        ...(args.header ? { header: String(args.header) } : {}),
        ...(Array.isArray(args.choices) ? { choices: args.choices.map(String) } : {}),
        allowOther: args.allowOther !== false,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runCommand(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  if (!command.trim()) throw new Error("No command given.");

  try {
    /* Through a shell, because the agent writes shell commands — pipes,
       redirection and `&&` are all things it legitimately uses. The command is
       confined by cwd rather than by parsing, since parsing shell safely is not
       something to attempt halfway. */
    const { stdout, stderr } = await run("/bin/sh", ["-c", command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 10_000_000,
      env: { ...process.env, PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
    });
    return { exitCode: 0, output: truncate(`${stdout}${stderr}`) };
  } catch (cause) {
    /* A non-zero exit is a result, not an exception: the agent asked what
       happens when this runs, and "it failed with this output" is the answer it
       needs. Throwing here would hide the output that explains why. */
    const error = cause as { code?: number; killed?: boolean; stdout?: string; stderr?: string };
    if (error.killed) return { exitCode: 124, output: truncate(`${error.stdout ?? ""}${error.stderr ?? ""}\nCommand timed out.`) };
    return { exitCode: typeof error.code === "number" ? error.code : 1, output: truncate(`${error.stdout ?? ""}${error.stderr ?? ""}`) };
  }
}

function truncate(value: string): string {
  return value.length <= MAX_OUTPUT_CHARS ? value : `${value.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated`;
}
