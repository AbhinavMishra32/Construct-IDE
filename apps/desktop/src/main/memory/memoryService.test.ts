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
});
