import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
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

describe("signing out", () => {
  /* The bug this exists for: a second account opened onto the first one's
     projects and was never asked a single intake question, because nothing in
     this schema records whose work it is. */
  it("leaves nothing of the account behind for whoever signs in next", () => {
    const created = store.createProject(project());
    store.setSetting("learner-profile", { name: "Someone", portrait: "A paragraph about them" });
    store.setSetting("learner-onboarded", true);
    store.setSetting("sync-cursor", "2026-09-02T00:00:00.000Z");
    store.setSetting("sync-cursor-local", "2026-09-02T00:00:00.000Z");

    store.clearAccountData();

    expect(store.listProjects()).toEqual([]);
    expect(store.getSetting("learner-profile", null)).toBeNull();
    expect(store.getSetting("learner-onboarded", null)).toBeNull();
    expect(store.getSetting("sync-cursor", null)).toBeNull();
    expect(store.getSetting("sync-cursor-local", null)).toBeNull();
    expect(store.readProject(created.id)).toBeNull();
  });

  /* Theme and the projects folder are true of the computer, not of the person
     using it, and re-picking them on every sign-in would be the app forgetting
     how it is set up rather than forgetting who was here. */
  it("keeps what is true of the machine rather than of the account", () => {
    store.setTheme("dark");
    store.setSetting("projects-directory", "/somewhere/projects");

    store.clearAccountData();

    expect(store.theme()).toBe("dark");
    expect(store.getSetting("projects-directory", "")).toBe("/somewhere/projects");
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

describe("agent conversation repair", () => {
  it("collapses legacy duplicate tool executions and kickoff notices without collapsing learner messages", () => {
    const created = store.createProject(project());
    const tool = {
      kind: "tool" as const,
      tool: "plan-learning-path",
      label: "Planned what to teach next",
      actionTitle: "",
      detail: "",
      ok: true,
      text: "",
      seconds: 0,
      input: "{\"reason\":\"start\"}",
      output: "{\"ok\":true}",
    };
    store.appendMessage(created.id, { id: "system-1", role: "system", body: "Read up before starting.", createdAt: "2026-01-01T00:00:00.000Z", activity: [] });
    store.appendMessage(created.id, { id: "system-2", role: "system", body: "Read up before starting.", createdAt: "2026-01-01T00:00:01.000Z", activity: [] });
    store.appendMessage(created.id, { id: "learner-1", role: "learner", body: "go", createdAt: "2026-01-01T00:00:02.000Z", activity: [] });
    store.appendMessage(created.id, { id: "learner-2", role: "learner", body: "go", createdAt: "2026-01-01T00:00:03.000Z", activity: [] });
    store.appendMessage(created.id, { id: "agent-1", role: "agent", body: "Starting.", createdAt: "2026-01-01T00:00:04.000Z", activity: [tool, { ...tool }] });

    const messages = store.listMessages(created.id);
    expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "learner")).toHaveLength(1);
    expect(messages.find((message) => message.id === "agent-1")?.activity).toEqual([tool]);
  });

  it("rewrites a turn in place, so a reply saved while it was still being written survives", () => {
    const created = store.createProject(project());

    /* What a turn does as it runs: the same id, written again with more of the
       answer under it. Two rows here would mean quitting mid-turn left the
       learner reading the agent's first sentence twice. */
    store.appendMessage(created.id, { id: "agent-1", role: "agent", body: "A triangle is", createdAt: "2026-01-01T00:00:00.000Z", activity: [] });
    store.appendMessage(created.id, { id: "agent-1", role: "agent", body: "A triangle is three points.", createdAt: "2026-01-01T00:00:00.000Z", activity: [] });

    const messages = store.listMessages(created.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe("A triangle is three points.");
  });
});


describe("ordering ties", () => {
  /* The tie has to be forced. Writing two rows and hoping their millisecond
     timestamps collide is a coin toss — the first version of this test asserted
     a collision that usually did not happen, and failed for the wrong reason.
     Setting the timestamps equal in SQL tests the ORDER BY itself, which is
     what the tiebreak keys exist for. */
  const forceEqualTimestamps = (file: string, stamp: string) => {
    const requireBuiltin = createRequire(import.meta.url);
    const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");
    const database = new DatabaseSync(file);
    try {
      database.exec(`UPDATE projects SET created_at = '${stamp}'`);
      database.exec(`UPDATE projects SET opened_at = '${stamp}' WHERE opened_at IS NOT NULL`);
    } finally {
      database.close();
    }
  };

  it("puts a project that was opened above one merely created at the same instant", () => {
    const file = path.join(directory, "state.sqlite3");
    const older = store.createProject(project({ name: "Older", directory: path.join(directory, "a") }));
    const newer = store.createProject(project({ name: "Newer", directory: path.join(directory, "b") }));
    store.markOpened(older.id);
    store.close();

    forceEqualTimestamps(file, "2026-01-01T00:00:00.000Z");

    store = new ProjectStore(file);
    const ordered = store.listProjects().map((row) => row.id);
    /* Without the (opened_at IS NOT NULL) key, rowid would put the
       later-inserted `newer` first even though the learner deliberately opened
       `older`. */
    expect(ordered.indexOf(older.id)).toBeLessThan(ordered.indexOf(newer.id));
  });

  it("falls back to insertion order when neither project has been opened", () => {
    const file = path.join(directory, "state.sqlite3");
    const first = store.createProject(project({ name: "First", directory: path.join(directory, "a") }));
    const second = store.createProject(project({ name: "Second", directory: path.join(directory, "b") }));
    store.close();

    forceEqualTimestamps(file, "2026-01-01T00:00:00.000Z");

    store = new ProjectStore(file);
    expect(store.listProjects().map((row) => row.id)).toEqual([second.id, first.id]);
  });
});

describe("the atlas read", () => {
  const concept = (projectId: string, conceptId: string, level: number) => ({
    projectId,
    conceptId,
    title: conceptId,
    masteryLevel: level,
    confidence: "medium",
    note: "",
    reason: "taught",
    summary: "",
    content: "",
    docs: [],
    tags: [],
  });

  it("spans every project, and says which one each concept came from", () => {
    /* Understanding is the learner's, not the repository's — so the page that
       shows it whole cannot be scoped to one project, and a node that cannot
       name where it was learned is a node you cannot follow back. */
    const first = store.createProject(project({ name: "First", directory: path.join(directory, "a") }));
    const second = store.createProject(project({ name: "Second", directory: path.join(directory, "b") }));
    store.recordConcept(concept(first.id, "interfaces", 3));
    store.recordConcept(concept(second.id, "assertions", 2));

    const all = store.listAllConcepts();
    expect(all.map((row) => row.conceptId).sort()).toEqual(["assertions", "interfaces"]);
    expect(all.find((row) => row.conceptId === "interfaces")?.projectName).toBe("First");
    expect(all.find((row) => row.conceptId === "assertions")?.projectId).toBe(second.id);
  });

  it("drops a deleted project's concepts rather than orphaning them", () => {
    const created = store.createProject(project());
    store.recordConcept(concept(created.id, "interfaces", 3));
    store.deleteProject(created.id);
    expect(store.listAllConcepts()).toEqual([]);
  });
});

describe("forgetting a concept", () => {
  const concept = (projectId: string, conceptId: string, level: number) => ({
    projectId,
    conceptId,
    title: conceptId,
    masteryLevel: level,
    confidence: "medium",
    note: "",
    reason: "taught",
    summary: "",
    content: "",
    docs: [],
    tags: [],
  });

  it("removes it from the project it was learned in, and nowhere else", () => {
    /* Concept ids are the agent's own slugs, so they are only unique within a
       project — two projects can both be teaching "interfaces", and forgetting
       one must not forget the other. */
    const first = store.createProject(project({ name: "First", directory: path.join(directory, "a") }));
    const second = store.createProject(project({ name: "Second", directory: path.join(directory, "b") }));
    store.recordConcept(concept(first.id, "interfaces", 3));
    store.recordConcept(concept(second.id, "interfaces", 2));

    store.deleteConcept(first.id, "interfaces");

    expect(store.listConcepts(first.id)).toEqual([]);
    expect(store.listConcepts(second.id).map((row) => row.conceptId)).toEqual(["interfaces"]);
  });

  it("takes the level history with it", () => {
    const created = store.createProject(project());
    store.recordConcept(concept(created.id, "interfaces", 2));
    store.recordConcept(concept(created.id, "interfaces", 3));
    store.deleteConcept(created.id, "interfaces");
    /* Recording it again must start clean rather than inheriting the history of
       the concept the learner threw away. */
    store.recordConcept(concept(created.id, "interfaces", 1));
    expect(store.listConcepts(created.id).map((row) => row.masteryLevel)).toEqual([1]);
  });

  it("says nothing and changes nothing for a concept that is not there", () => {
    const created = store.createProject(project());
    expect(() => store.deleteConcept(created.id, "never-taught")).not.toThrow();
  });
});
