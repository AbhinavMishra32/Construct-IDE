import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../store/projectStore.js";
import { availableDirectory, directorySlug, ProjectService } from "./projectService.js";

let root: string;
let store: ProjectStore;
let projects: ProjectService;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "construct-projects-"));
  store = new ProjectStore(path.join(root, "state.sqlite3"));
  projects = new ProjectService(store);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("directorySlug", () => {
  it("turns a typed name into something a filesystem accepts", () => {
    expect(directorySlug("Software Renderer")).toBe("software-renderer");
    expect(directorySlug("  Ray/Tracer!  ")).toBe("ray-tracer");
  });

  it("falls back rather than producing an empty directory name", () => {
    expect(directorySlug("!!!")).toBe("project");
  });
});

describe("availableDirectory", () => {
  it("suffixes rather than colliding, because a second attempt reuses the name", () => {
    mkdirSync(path.join(root, "renderer"));
    expect(availableDirectory(root, "renderer")).toBe(path.join(root, "renderer-2"));

    mkdirSync(path.join(root, "renderer-2"));
    expect(availableDirectory(root, "renderer")).toBe(path.join(root, "renderer-3"));
  });
});

describe("creating a project", () => {
  const input = { name: "Software Renderer", goal: "Understand the graphics pipeline", language: "python" as const };

  it("makes a real directory with an entry point for the language", async () => {
    const created = await projects.create({ ...input, parentDirectory: root });

    expect(created.directory).toBe(path.join(root, "software-renderer"));
    expect(readFileSync(path.join(created.directory, "main.py"), "utf8")).toContain("def main()");
  });

  it("writes the goal into the project, not only into Construct's database", async () => {
    const created = await projects.create({ ...input, parentDirectory: root });

    expect(readFileSync(path.join(created.directory, "GOAL.md"), "utf8")).toContain("Understand the graphics pipeline");
  });

  it("does not seed an entry point for a language Construct has no template for", async () => {
    const created = await projects.create({ ...input, language: "rust", parentDirectory: root });

    expect(readFileSync(path.join(created.directory, "GOAL.md"), "utf8")).toContain("Software Renderer");
    expect(() => readFileSync(path.join(created.directory, "main.rs"), "utf8")).toThrow();
  });

  it("refuses a parent folder that has gone, rather than creating one", async () => {
    await expect(projects.create({ ...input, parentDirectory: path.join(root, "missing") })).rejects.toThrow(/no longer exists/);
  });
});

describe("importing a project", () => {
  it("adopts a directory and infers what it is written in", async () => {
    const directory = path.join(root, "existing");
    mkdirSync(directory);
    writeFileSync(path.join(directory, "app.py"), "print('hi')");
    writeFileSync(path.join(directory, "util.py"), "");
    writeFileSync(path.join(directory, "notes.md"), "");

    const imported = await projects.import({ directory, goal: "Learn what this codebase does" });

    expect(imported.language).toBe("python");
    expect(imported.name).toBe("existing");
  });

  it("reopens rather than duplicating when the same directory is imported twice", async () => {
    const directory = path.join(root, "existing");
    mkdirSync(directory);

    const first = await projects.import({ directory, goal: "Learn this" });
    const second = await projects.import({ directory, goal: "Learn this again" });

    expect(second.id).toBe(first.id);
    expect(projects.list()).toHaveLength(1);
  });

  it("looks one level down when the top level is only configuration", async () => {
    const directory = path.join(root, "monorepo");
    mkdirSync(path.join(directory, "src"), { recursive: true });
    writeFileSync(path.join(directory, "README.md"), "");
    writeFileSync(path.join(directory, "src", "index.ts"), "");

    const imported = await projects.import({ directory, goal: "Learn this" });
    expect(imported.language).toBe("typescript");
  });
});

describe("opening a project", () => {
  it("refuses a project whose directory has gone, naming the path", async () => {
    const created = await projects.create({ name: "Gone", goal: "Vanish", parentDirectory: root, language: "typescript" });
    rmSync(created.directory, { recursive: true, force: true });

    expect(() => projects.open(created.id)).toThrow(new RegExp(created.directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("stamps the project so the list orders by what was opened last", async () => {
    const older = await projects.create({ name: "Older", goal: "First idea", parentDirectory: root, language: "typescript" });
    await projects.create({ name: "Newer", goal: "Second idea", parentDirectory: root, language: "typescript" });

    projects.open(older.id);
    expect(projects.list()[0]?.id).toBe(older.id);
  });
});

describe("deleting a project", () => {
  it("forgets the row and leaves every file where it is", async () => {
    const created = await projects.create({ name: "Keep files", goal: "Stay on disk", parentDirectory: root, language: "typescript" });

    projects.delete(created.id);

    expect(projects.list()).toHaveLength(0);
    expect(readFileSync(path.join(created.directory, "GOAL.md"), "utf8")).toContain("Stay on disk");
  });
});
