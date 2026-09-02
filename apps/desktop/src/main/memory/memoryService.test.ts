import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "../projects/workspaceService.js";
import { MEMORY_FILES, MemoryService } from "./memoryService.js";

let root: string;
let memory: MemoryService;

const project = () => ({ directory: root, name: "Renderer", goal: "Understand rasterisation", language: "typescript" });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "construct-memory-"));
  memory = new MemoryService(new WorkspaceService());
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (file: string) => readFileSync(path.join(root, ".construct", file), "utf8");

describe("ensure", () => {
  it("writes all four files into the project's own .construct", async () => {
    const files = await memory.ensure(project());
    expect(files.map((entry) => entry.file)).toEqual([...MEMORY_FILES]);
    expect(files.every((entry) => entry.exists)).toBe(true);
    for (const file of MEMORY_FILES) expect(read(file).trim().length).toBeGreaterThan(0);
  });

  it("puts the project's own goal in the starters, so they read as notes rather than a form", async () => {
    await memory.ensure(project());
    expect(read("project.md")).toContain("Understand rasterisation");
    expect(read("research.md")).toContain("Understand rasterisation");
  });

  it("leaves a file that already exists alone", async () => {
    await memory.ensure(project());
    writeFileSync(path.join(root, ".construct", "learner.md"), "# Learner\n\nPrefers worked examples.\n", "utf8");
    await memory.ensure(project());
    expect(read("learner.md")).toContain("Prefers worked examples.");
  });

  it("opens learner.md with what the intake already established", async () => {
    await memory.ensure(project(), undefined, ["- Goes by: Ada", "- Home language: rust"]);
    const learner = read("learner.md");
    expect(learner).toContain("## From their intake");
    expect(learner).toContain("Goes by: Ada");
    /* Under its own heading, above the placeholders — the agent must be able to
       tell a preference the learner stated from an inference it made itself. */
    expect(learner.indexOf("From their intake")).toBeLessThan(learner.indexOf("Learner style: not enough evidence yet."));
  });

  it("says nothing about an intake nobody went through", async () => {
    await memory.ensure(project());
    expect(read("learner.md")).not.toContain("From their intake");
  });

  it("replaces one the learner deleted rather than failing", async () => {
    await memory.ensure(project());
    rmSync(path.join(root, ".construct", "path.md"));
    const files = await memory.ensure(project());
    expect(files.find((entry) => entry.file === "path.md")?.exists).toBe(true);
  });
});

describe("read", () => {
  it("reports a missing file as missing rather than throwing", async () => {
    const [entry] = await memory.read(root, ["project.md"]);
    expect(entry).toMatchObject({ exists: false, content: "", updatedAt: null });
  });

  it("names files by their project-relative path, which is what the learner sees", async () => {
    await memory.ensure(project());
    const [entry] = await memory.read(root, ["learner.md"]);
    expect(entry!.path).toBe(".construct/learner.md");
  });
});

describe("patch", () => {
  beforeEach(async () => {
    await memory.ensure(project());
  });

  it("appends with a blank line between, so notes stay separate paragraphs", async () => {
    await memory.patch(root, [{ file: "learner.md", mode: "append", content: "Reads code before prose.", reason: "evidence" }]);
    expect(read("learner.md")).toMatch(/\n\nReads code before prose\.\n$/);
  });

  it("prepends, for a note that should lead", async () => {
    await memory.patch(root, [{ file: "path.md", mode: "prepend", content: "# Path\n\nNow: build the rasteriser.", reason: "replan" }]);
    expect(read("path.md").startsWith("# Path\n\nNow: build the rasteriser.")).toBe(true);
  });

  it("replaces exact text", async () => {
    await memory.patch(root, [
      { file: "project.md", mode: "replace", find: "Important files: not mapped yet.", content: "Important files: src/raster.ts", reason: "mapped" },
    ]);
    expect(read("project.md")).toContain("Important files: src/raster.ts");
    /* Only that line: "not mapped yet" is also the placeholder for commands. */
    expect(read("project.md")).not.toContain("Important files: not mapped yet.");
  });

  it("refuses an ambiguous replace instead of guessing which one was meant", async () => {
    writeFileSync(path.join(root, ".construct", "path.md"), "next\n\nnext\n", "utf8");
    await expect(
      memory.patch(root, [{ file: "path.md", mode: "replace", find: "next", content: "done", reason: "x" }]),
    ).rejects.toThrow(/more than once/);
  });

  it("refuses a replace with nothing to find", async () => {
    await expect(
      memory.patch(root, [{ file: "project.md", mode: "replace", content: "anything", reason: "x" }]),
    ).rejects.toThrow(/exact text/);
  });

  it("says so when the text is not there at all", async () => {
    await expect(
      memory.patch(root, [{ file: "project.md", mode: "replace", find: "nowhere in this file", content: "x", reason: "x" }]),
    ).rejects.toThrow(/could not find/);
  });

  it("refuses an empty patch", async () => {
    await expect(memory.patch(root, [{ file: "learner.md", mode: "append", content: "   ", reason: "x" }])).rejects.toThrow(/cannot be empty/);
  });

  it("returns a diff of what changed, because the transcript shows it", async () => {
    const [result] = await memory.patch(root, [{ file: "learner.md", mode: "append", content: "Asks for the why first.", reason: "evidence" }]);
    expect(result!.diff).toContain("+Asks for the why first.");
    expect(result!.diff).toContain("--- learner.md");
    expect(result!.reason).toBe("evidence");
  });

  it("ends every file with exactly one newline however often it is appended to", async () => {
    for (let round = 0; round < 3; round += 1) {
      await memory.patch(root, [{ file: "learner.md", mode: "append", content: `note ${round}`, reason: "x" }]);
    }
    expect(read("learner.md").endsWith("note 2\n")).toBe(true);
    expect(read("learner.md")).not.toMatch(/\n\n\n/);
  });

  it("creates the file when memory was never ensured", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "construct-memory-bare-"));
    try {
      await memory.patch(fresh, [{ file: "research.md", mode: "append", content: "Found the spec.", reason: "x" }]);
      expect(readFileSync(path.join(fresh, ".construct", "research.md"), "utf8")).toContain("Found the spec.");
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("containment", () => {
  it("refuses a memory file name that is not one of the four", async () => {
    /* The name arrives as a tool argument the model chose, so `../../.ssh/id_rsa`
       has to be refused by the service rather than by the caller. */
    await expect(memory.read(root, ["../../secret.md" as never])).rejects.toThrow(/no memory file/);
  });

  it("will not follow a .construct symlink out of the project", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "construct-outside-"));
    try {
      symlinkSync(outside, path.join(root, ".construct"), "dir");
      await expect(memory.ensure(project())).rejects.toThrow(/escaped its folder/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  /**
   * What `find` is allowed to get wrong.
   *
   * The agent does not have the file in front of it when it writes a `find` — it
   * has what a fetch showed it several steps ago, and it retypes that. Each of
   * these is a difference that broke an exact `indexOf` while meaning nothing,
   * and each one cost a failed tool call the model then retried identically.
   */
  it("forgives trailing whitespace the model did not reproduce", async () => {
    await memory.ensure(project());
    writeFileSync(path.join(root, ".construct", "project.md"), "# Project\n\nA line with trailing space.   \n", "utf8");
    await memory.patch(root, [
      { file: "project.md", mode: "replace", find: "A line with trailing space.", content: "Rewritten.", reason: "x" },
    ]);
    expect(read("project.md")).toContain("Rewritten.");
  });

  it("forgives a tab retyped as spaces", async () => {
    await memory.ensure(project());
    writeFileSync(path.join(root, ".construct", "project.md"), "# Project\n\n\tIndented note.\n", "utf8");
    await memory.patch(root, [{ file: "project.md", mode: "replace", find: " Indented note.", content: "Flat note.", reason: "x" }]);
    expect(read("project.md")).toContain("Flat note.");
  });

  it("matches a find that spans several lines", async () => {
    await memory.ensure(project());
    writeFileSync(path.join(root, ".construct", "project.md"), "# Project\n\nFirst line.  \nSecond line.\nThird line.\n", "utf8");
    await memory.patch(root, [{ file: "project.md", mode: "replace", find: "First line.\nSecond line.", content: "Merged.", reason: "x" }]);
    const after = read("project.md");
    expect(after).toContain("Merged.");
    expect(after).toContain("Third line.");
    expect(after).not.toContain("First line.");
  });

  it("says what to do when the text is genuinely not there", async () => {
    /* The tolerance is bounded on purpose: a fuzzy match that rewrote the wrong
       paragraph would be worse than no match. The message has to carry the way
       out, because the agent retries from it. */
    await memory.ensure(project());
    await expect(
      memory.patch(root, [{ file: "project.md", mode: "replace", find: "Nothing like this.", content: "x", reason: "x" }]),
    ).rejects.toThrow(/could not find that text[\s\S]*append/i);
  });

  it("refuses an ambiguous match found only by the forgiving pass", async () => {
    await memory.ensure(project());
    /* Both lines are tab-indented, so the space-indented `find` matches neither
       exactly and only the forgiving pass sees them — as two identical
       candidates, which it must refuse rather than pick between. */
    writeFileSync(path.join(root, ".construct", "project.md"), "# Project\n\n\tRepeated.\n\tRepeated.\n", "utf8");
    await expect(
      memory.patch(root, [{ file: "project.md", mode: "replace", find: " Repeated.", content: "x", reason: "x" }]),
    ).rejects.toThrow(/more than once/i);
  });
});
