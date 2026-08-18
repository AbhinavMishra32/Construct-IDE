import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "./projectStore.js";

let directory: string;
let store: ProjectStore;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "construct-store-"));
  store = new ProjectStore(path.join(directory, "state.sqlite3"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const project = (overrides: Partial<Parameters<ProjectStore["createProject"]>[0]> = {}) => ({
  name: "Renderer",
  goal: "Build a software renderer to understand the graphics pipeline",
  directory: path.join(directory, "renderer"),
  language: "typescript" as const,
  ...overrides,
});

describe("settings", () => {
  it("survives a reopen, which is the whole point of storing them", () => {
    store.setTheme("dark");
    store.close();

    store = new ProjectStore(path.join(directory, "state.sqlite3"));
    expect(store.theme()).toBe("dark");
  });

  it("answers with the fallback rather than throwing for a setting never written", () => {
    expect(store.theme()).toBe("system");
  });
});

describe("projects", () => {
  it("adopts a directory once, so importing twice reopens rather than duplicates", () => {
    const first = store.createProject(project());
    const second = store.createProject(project({ name: "Renderer again" }));

    expect(second.id).toBe(first.id);
    expect(store.listProjects()).toHaveLength(1);
  });

  it("orders by most recently opened, falling back to creation", () => {
    const older = store.createProject(project({ name: "Older", directory: path.join(directory, "a") }));
    const newer = store.createProject(project({ name: "Newer", directory: path.join(directory, "b") }));

    expect(store.listProjects().map((row) => row.id)).toEqual([newer.id, older.id]);

    store.markOpened(older.id);
    expect(store.listProjects().map((row) => row.id)).toEqual([older.id, newer.id]);
  });

  it("reports a project whose directory has gone as absent rather than hiding it", () => {
    const created = store.createProject(project({ directory: path.join(directory, "gone") }));
    expect(store.readProject(created.id)?.present).toBe(false);
  });

  it("reports a project whose directory exists as present", () => {
    mkdtempSync(path.join(directory, "live-"));
    const created = store.createProject(project({ directory }));
    expect(store.readProject(created.id)?.present).toBe(true);
  });

  it("forgets a project without touching its files", () => {
    const created = store.createProject(project({ directory }));
    store.deleteProject(created.id);

    expect(store.readProject(created.id)).toBeNull();
    expect(mkdtempSync(path.join(directory, "still-here-"))).toContain(directory);
  });

  it("renames in place, keeping identity and directory", () => {
    const created = store.createProject(project());
    store.renameProject(created.id, "Software renderer");

    const renamed = store.readProject(created.id);
    expect(renamed?.name).toBe("Software renderer");
    expect(renamed?.directory).toBe(created.directory);
  });
});
