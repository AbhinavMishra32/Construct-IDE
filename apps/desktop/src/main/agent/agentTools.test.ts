import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "../projects/workspaceService.js";
import { executeAgentTool, type AgentToolContext } from "./agentTools.js";

let root: string;
let outside: string;
let context: AgentToolContext;
let asked: Array<{ question: string }>;
let recorded: Array<{ conceptId: string; masteryLevel: number }>;

beforeEach(() => {
  const base = mkdtempSync(path.join(tmpdir(), "construct-agent-"));
  root = path.join(base, "project");
  outside = path.join(base, "secrets");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keys.txt"), "do not read me");
  asked = [];
  recorded = [];
  context = {
    projectDirectory: root,
    workspace: new WorkspaceService(),
    recordConcept: (record) => void recorded.push(record),
    askLearner: vi.fn(async (request) => {
      asked.push({ question: request.question });
      return "the learner's answer";
    }),
  };
});

afterEach(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("filesystem tools", () => {
  it("reads and writes inside the project", async () => {
    await executeAgentTool("write-file", { path: "notes.md", content: "hello" }, context);
    expect(await executeAgentTool("read-file", { path: "notes.md" }, context)).toBe("hello");
  });

  it("lists the project root when no directory is given", async () => {
    await executeAgentTool("write-file", { path: "a.py", content: "" }, context);
    const entries = (await executeAgentTool("list-files", {}, context)) as Array<{ name: string }>;
    expect(entries.map((entry) => entry.name)).toContain("a.py");
  });

  /* The agent is bound by the same containment as the renderer. This is the
     assertion that matters most in this file: a model that can be talked into
     asking for ../../ must not get it. */
  it.each(["../secrets/keys.txt", "/etc/passwd", "nested/../../secrets/keys.txt"])("refuses to read %s", async (candidate) => {
    await expect(executeAgentTool("read-file", { path: candidate }, context)).rejects.toThrow();
  });

  it("refuses to write outside the project", async () => {
    await expect(executeAgentTool("write-file", { path: "../secrets/planted.txt", content: "x" }, context)).rejects.toThrow();
  });
});

describe("running commands", () => {
  it("returns output from a command that succeeds", async () => {
    const result = (await executeAgentTool("run-terminal-command", { command: "echo construct" }, context)) as { exitCode: number; output: string };
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("construct");
  });

  it("runs inside the project directory", async () => {
    const result = (await executeAgentTool("run-terminal-command", { command: "pwd" }, context)) as { output: string };
    /* realpath, because macOS reaches temporary directories through /tmp, which
       is a symlink to /private/tmp. */
    expect(result.output).toContain(path.basename(root));
  });

  /* A failed command is a result, not an exception. The agent asked what
     happens when this runs, and the output explaining the failure is precisely
     what it needs to teach from. */
  it("reports a non-zero exit as a result rather than throwing", async () => {
    const result = (await executeAgentTool("run-terminal-command", { command: "exit 3" }, context)) as { exitCode: number };
    expect(result.exitCode).toBe(3);
  });

  it("keeps stderr, which is where a failing command explains itself", async () => {
    const result = (await executeAgentTool("run-terminal-command", { command: "echo boom >&2; exit 1" }, context)) as { output: string };
    expect(result.output).toContain("boom");
  });

  it("truncates output rather than spending the whole context on one result", async () => {
    const result = (await executeAgentTool("run-terminal-command", { command: "printf 'x%.0s' $(seq 1 50000)" }, context)) as { output: string };
    expect(result.output.length).toBeLessThan(21_000);
    expect(result.output).toContain("truncated");
  });

  it("refuses an empty command instead of running a shell that does nothing", async () => {
    await expect(executeAgentTool("run-terminal-command", { command: "   " }, context)).rejects.toThrow(/No command given/);
  });
});

describe("recording a concept", () => {
  it("passes the reading through", async () => {
    await executeAgentTool(
      "record-concept",
      { conceptId: "rasterisation", title: "Rasterisation", masteryLevel: 3, confidence: "practicing" },
      context,
    );

    expect(recorded).toEqual([expect.objectContaining({ conceptId: "rasterisation", masteryLevel: 3 })]);
  });

  /* A model that answers 7 has still told us the learner is fluent. Refusing
     the call would throw that reading away, so it is clamped. */
  it.each([
    [7, 5],
    [-2, 0],
    [3.6, 4],
  ])("clamps a level of %s to %s rather than refusing it", async (given, expected) => {
    await executeAgentTool("record-concept", { conceptId: "c", title: "C", masteryLevel: given, confidence: "x" }, context);
    expect(recorded.at(-1)?.masteryLevel).toBe(expected);
  });

  it("treats a non-numeric level as knowing nothing, never as knowing everything", async () => {
    await executeAgentTool("record-concept", { conceptId: "c", title: "C", masteryLevel: "lots", confidence: "x" }, context);
    expect(recorded.at(-1)?.masteryLevel).toBe(0);
  });
});

describe("asking the learner", () => {
  it("puts the question through and returns the answer", async () => {
    const answer = await executeAgentTool("ask_user_question", { question: "What does this loop do?" }, context);

    expect(asked).toEqual([{ question: "What does this loop do?" }]);
    expect(answer).toBe("the learner's answer");
  });
});

describe("unknown tools", () => {
  it("names the tool it does not have rather than failing vaguely", async () => {
    await expect(executeAgentTool("delete-everything", {}, context)).rejects.toThrow(/Unknown tool: delete-everything/);
  });
});
