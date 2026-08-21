import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceService } from "../projects/workspaceService.js";

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
  recordConcept(input: {
    conceptId: string;
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
      context.recordConcept({
        conceptId: String(args.conceptId ?? "").trim(),
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
