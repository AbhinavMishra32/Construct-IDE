import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectStore } from "./projectStore.js";

/**
 * The parent edge, through the real database.
 *
 * Written against a store rather than mocked, because the behaviour worth
 * testing is the SQL: a level update must not orphan a concept, and the three
 * states of `parentId` — absent, null, a slug — have to survive the upsert.
 */
describe("concept parents", () => {
  let directory: string;
  let store: ProjectStore;
  let projectId: string;

  const record = (conceptId: string, extra: Record<string, unknown> = {}) =>
    store.recordConcept({
      projectId,
      conceptId,
      title: conceptId,
      masteryLevel: 2,
      confidence: "introduced",
      note: "",
      reason: "",
      summary: "",
      content: "",
      docs: [],
      tags: [],
      ...extra,
    });

  const parentOf = (conceptId: string) =>
    store.listConcepts(projectId).find((concept) => concept.conceptId === conceptId)?.parentId;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "construct-concepts-"));
    store = new ProjectStore(join(directory, "state.sqlite3"));
    projectId = store.createProject({
      name: "Test",
      goal: "Test",
      directory: join(directory, "project"),
      language: "typescript",
    }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("records a concept under a parent", () => {
    record("oop");
    record("polymorphism", { parentId: "oop" });
    expect(parentOf("polymorphism")).toBe("oop");
  });

  it("defaults to no parent", () => {
    record("oop");
    expect(parentOf("oop")).toBeNull();
  });

  it("keeps the parent when a later call does not mention one", () => {
    /* The bug this guards: most calls are level updates carrying no parent, and
       folding the parent into the upsert would orphan a concept the agent
       placed three turns earlier. */
    record("oop");
    record("polymorphism", { parentId: "oop" });
    record("polymorphism", { masteryLevel: 4 });
    expect(parentOf("polymorphism")).toBe("oop");
  });

  it("detaches to the top when the parent is explicitly null", () => {
    record("oop");
    record("polymorphism", { parentId: "oop" });
    record("polymorphism", { parentId: null });
    expect(parentOf("polymorphism")).toBeNull();
  });

  it("moves a concept to a different parent", () => {
    record("oop");
    record("types");
    record("polymorphism", { parentId: "oop" });
    record("polymorphism", { parentId: "types" });
    expect(parentOf("polymorphism")).toBe("types");
  });

  it("refuses to make a concept its own parent", () => {
    record("oop", { parentId: "oop" });
    expect(parentOf("oop")).toBeNull();
  });

  it("accepts a parent that has not been recorded yet", () => {
    /* Not a foreign key on purpose: the agent may record a child before the
       parent it names, and the tree completes itself on a later turn. */
    record("polymorphism", { parentId: "oop" });
    expect(parentOf("polymorphism")).toBe("oop");
    record("oop");
    expect(parentOf("polymorphism")).toBe("oop");
  });
});

/**
 * Practice tasks, through the real database.
 *
 * The behaviour worth testing is the state machine: the agent writes what the
 * task asks for, the learner and the agent move it between states, and
 * re-setting a task must not quietly undo a verdict.
 */
describe("practice tasks", () => {
  let directory: string;
  let store: ProjectStore;
  let projectId: string;

  const save = (taskId: string, extra: Record<string, unknown> = {}) =>
    store.saveTask(projectId, {
      taskId,
      title: taskId,
      brief: "",
      criteria: ["It runs"],
      concepts: [],
      files: [],
      status: "open",
      outcome: "",
      ...extra,
    });

  const read = (taskId: string) => store.listTasks(projectId).find((task) => task.taskId === taskId);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "construct-tasks-"));
    store = new ProjectStore(join(directory, "state.sqlite3"));
    projectId = store.createProject({
      name: "Test",
      goal: "Test",
      directory: join(directory, "project"),
      language: "typescript",
    }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("stores what the task asks for", () => {
    save("saxpy", { criteria: ["Compiles", "Prints 120"], files: ["main.cpp"], concepts: ["kernels"] });
    expect(read("saxpy")).toMatchObject({
      title: "saxpy",
      criteria: ["Compiles", "Prints 120"],
      files: ["main.cpp"],
      concepts: ["kernels"],
      status: "open",
    });
  });

  it("keeps them in the order they were set", () => {
    save("first");
    save("second");
    expect(store.listTasks(projectId).map((task) => task.taskId)).toEqual(["first", "second"]);
  });

  it("moves through submitted to passed, carrying the verdict", () => {
    save("saxpy");
    store.setTaskStatus(projectId, "saxpy", "submitted");
    expect(read("saxpy")?.status).toBe("submitted");

    store.setTaskStatus(projectId, "saxpy", "passed", "Every criterion met.");
    expect(read("saxpy")).toMatchObject({ status: "passed", outcome: "Every criterion met." });
  });

  it("sends a task back to open with a note saying why", () => {
    save("saxpy");
    store.setTaskStatus(projectId, "saxpy", "submitted");
    store.setTaskStatus(projectId, "saxpy", "open", "The second criterion is not met yet.");
    expect(read("saxpy")).toMatchObject({ status: "open", outcome: "The second criterion is not met yet." });
  });

  it("leaves the verdict alone when only the status moves", () => {
    /* The learner resubmitting must not blank what the agent last said about
       the task — the card is still showing it until a new verdict arrives. */
    save("saxpy");
    store.setTaskStatus(projectId, "saxpy", "open", "Not yet: no bounds check.");
    store.setTaskStatus(projectId, "saxpy", "submitted");
    expect(read("saxpy")).toMatchObject({ status: "submitted", outcome: "Not yet: no bounds check." });
  });

  it("updates a task in place when it is set again", () => {
    save("saxpy", { title: "Write saxpy" });
    save("saxpy", { title: "Write saxpy, with bounds", criteria: ["Compiles", "Guards the index"] });
    expect(store.listTasks(projectId)).toHaveLength(1);
    expect(read("saxpy")).toMatchObject({ title: "Write saxpy, with bounds", criteria: ["Compiles", "Guards the index"] });
  });

  it("keeps tasks separate per project", () => {
    const other = store.createProject({
      name: "Other",
      goal: "Other",
      directory: join(directory, "other"),
      language: "typescript",
    }).id;
    save("saxpy");
    expect(store.listTasks(other)).toEqual([]);
  });
});

/**
 * Rewinding, through the real database.
 *
 * Editing an earlier message means the turns after it never happened. The files
 * are the snapshot service's job; everything here is what the database owns,
 * and it has to move as one — a conversation rewound without its concepts is a
 * project that disagrees with itself.
 */
describe("rewinding to a snapshot", () => {
  let directory: string;
  let store: ProjectStore;
  let projectId: string;

  const message = (id: string, role: "learner" | "agent", at: string) => {
    store.appendMessage(projectId, { id, role, body: id, createdAt: at, activity: [] });
  };

  const snap = (messageId: string) =>
    store.saveSnapshot({
      projectId,
      messageId,
      files: [],
      blobs: new Map(),
      concepts: store.listConcepts(projectId),
      tasks: store.listTasks(projectId),
      pathNodes: store.listPathNodes(projectId),
      currentPathNode: store.currentPathNode(projectId),
    });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "construct-rewind-"));
    store = new ProjectStore(join(directory, "state.sqlite3"));
    projectId = store.createProject({
      name: "Test",
      goal: "Test",
      directory: join(directory, "project"),
      language: "typescript",
    }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("drops the edited message and everything after it", () => {
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    message("m2", "agent", "2026-01-01T00:01:00.000Z");
    snap("m3");
    message("m3", "learner", "2026-01-01T00:02:00.000Z");
    message("m4", "agent", "2026-01-01T00:03:00.000Z");

    store.rewindTo(projectId, store.snapshot(projectId, "m3")!);
    expect(store.listMessages(projectId).map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("undoes concepts the later turns recorded", () => {
    store.recordConcept({ projectId, conceptId: "kept", title: "Kept", masteryLevel: 2, confidence: "x", note: "", reason: "", summary: "", content: "", docs: [], tags: [] });
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    snap("m1");

    store.recordConcept({ projectId, conceptId: "later", title: "Later", masteryLevel: 3, confidence: "x", note: "", reason: "", summary: "", content: "", docs: [], tags: [] });
    expect(store.listConcepts(projectId)).toHaveLength(2);

    store.rewindTo(projectId, store.snapshot(projectId, "m1")!);
    expect(store.listConcepts(projectId).map((concept) => concept.conceptId)).toEqual(["kept"]);
  });

  it("puts a concept's level back rather than only removing new ones", () => {
    store.recordConcept({ projectId, conceptId: "tensors", title: "Tensors", masteryLevel: 1, confidence: "x", note: "", reason: "", summary: "", content: "", docs: [], tags: [] });
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    snap("m1");

    store.recordConcept({ projectId, conceptId: "tensors", title: "Tensors", masteryLevel: 4, confidence: "x", note: "", reason: "", summary: "", content: "", docs: [], tags: [] });
    store.rewindTo(projectId, store.snapshot(projectId, "m1")!);
    expect(store.listConcepts(projectId)[0]?.masteryLevel).toBe(1);
  });

  it("undoes tasks the later turns set", () => {
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    snap("m1");
    store.saveTask(projectId, { taskId: "t1", title: "T", brief: "", criteria: ["x"], concepts: [], files: [], status: "open", outcome: "" });

    store.rewindTo(projectId, store.snapshot(projectId, "m1")!);
    expect(store.listTasks(projectId)).toEqual([]);
  });

  it("keeps a task that already existed, with the status it had", () => {
    store.saveTask(projectId, { taskId: "t1", title: "T", brief: "", criteria: ["x"], concepts: [], files: [], status: "open", outcome: "" });
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    snap("m1");
    store.setTaskStatus(projectId, "t1", "passed", "Well done");

    store.rewindTo(projectId, store.snapshot(projectId, "m1")!);
    expect(store.listTasks(projectId)[0]).toMatchObject({ taskId: "t1", status: "open", outcome: "" });
  });

  it("drops the undo points after the one it rewound to", () => {
    /* Otherwise a second edit could rewind to a snapshot of a turn that no
       longer exists. */
    message("m1", "learner", "2026-01-01T00:00:00.000Z");
    snap("m1");
    message("m2", "learner", "2026-01-01T00:01:00.000Z");
    snap("m2");

    store.rewindTo(projectId, store.snapshot(projectId, "m1")!);
    expect(store.snapshotMessageIds(projectId)).toEqual([]);
  });

  it("stores one copy of a blob however many snapshots hold it", () => {
    const blobs = new Map([["hash-a", Buffer.from("body")]]);
    const files = [{ path: "a.py", hash: "hash-a", bytes: 4 }];
    store.saveSnapshot({ projectId, messageId: "m1", files, blobs, concepts: [], tasks: [], pathNodes: [], currentPathNode: null });
    store.saveSnapshot({ projectId, messageId: "m2", files, blobs, concepts: [], tasks: [], pathNodes: [], currentPathNode: null });

    expect(store.readBlob("hash-a")?.toString()).toBe("body");
    expect(store.snapshotMessageIds(projectId).sort()).toEqual(["m1", "m2"]);
  });
});

/**
 * What sync reads and writes, through the real database.
 *
 * Two halves and one rule: `changedSince` is what this machine has to say,
 * `applyRemote` is what it has been told, and the rule is last-write-wins on
 * `updated_at`. The rule is the part worth testing — it is the only thing
 * standing between two laptops and one of them silently losing a day's work.
 */
describe("sync", () => {
  let directory: string;
  let store: ProjectStore;
  let projectId: string;

  const remote = (over: Record<string, unknown> = {}) => ({
    projects: [],
    messages: [],
    concepts: [],
    tasks: [],
    pathNodes: [],
    ...over,
  });
  const here = () => join(directory, "landed");

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "construct-sync-"));
    store = new ProjectStore(join(directory, "state.sqlite3"));
    projectId = store.createProject({
      name: "Local",
      goal: "Learn",
      directory: join(directory, "project"),
      language: "typescript",
    }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("reports a new project as a change", () => {
    const push = store.changedSince(null);
    expect(push.projects.map((row) => row.name)).toEqual(["Local"]);
  });

  it("never sends the directory, which means nothing on another machine", () => {
    expect(Object.keys(store.changedSince(null).projects[0]!)).not.toContain("directory");
  });

  it("reports nothing after the cursor moves past it", () => {
    expect(store.changedSince(new Date(Date.now() + 60_000).toISOString()).projects).toEqual([]);
  });

  it("notices a rename, which had nothing recording it before", () => {
    /* `projects` carried no `updated_at` until sync needed one: the row was
       written once and then poked, with nothing saying it had moved. */
    const before = new Date(Date.now() - 1_000).toISOString();
    store.renameProject(projectId, "Renamed");
    expect(store.changedSince(before).projects.map((row) => row.name)).toEqual(["Renamed"]);
  });

  it("does not treat merely opening a project as news", () => {
    /* Which machine looked at it last is not something the others need. */
    const after = new Date(Date.now() + 60_000).toISOString();
    store.markOpened(projectId);
    expect(store.changedSince(after).projects).toEqual([]);
  });

  it("takes a project it has never seen, and gives it somewhere to live", () => {
    store.applyRemote(
      remote({
        projects: [
          {
            id: "from-away",
            name: "Elsewhere",
            goal: "g",
            language: "python",
            pinnedAt: null,
            archivedAt: null,
            currentPathNode: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      here,
    );
    const landed = store.listProjects().find((project) => project.id === "from-away");
    expect(landed).toMatchObject({ name: "Elsewhere", directory: here() });
  });

  it("lets a newer remote edit win", () => {
    store.applyRemote(
      remote({
        projects: [
          { id: projectId, name: "Newer", goal: "g", language: "typescript", pinnedAt: null, archivedAt: null, currentPathNode: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z" },
        ],
      }),
      here,
    );
    expect(store.readProject(projectId)?.name).toBe("Newer");
  });

  it("refuses a staler remote edit", () => {
    /* The case that matters: a laptop that has been shut for a week must not
       overwrite this morning's work simply by reconnecting. */
    store.applyRemote(
      remote({
        projects: [
          { id: projectId, name: "Stale", goal: "g", language: "typescript", pinnedAt: null, archivedAt: null, currentPathNode: null, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" },
        ],
      }),
      here,
    );
    expect(store.readProject(projectId)?.name).toBe("Local");
  });

  it("applies the same pull twice without changing anything", () => {
    /* A sync that pulls and then fails before storing its cursor asks again,
       so every write has to be safe to repeat. */
    const pull = remote({
      messages: [
        { id: "m1", projectId, role: "learner", body: "hello", activity: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      concepts: [
        { projectId, conceptId: "c1", parentId: null, title: "C", masteryLevel: 3, confidence: "", note: "", summary: "", content: "", docs: [], tags: [], firstSeenAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    store.applyRemote(pull, here);
    store.applyRemote(pull, here);
    expect(store.listMessages(projectId)).toHaveLength(1);
    expect(store.listConcepts(projectId)).toHaveLength(1);
  });

  it("keeps a deleted project as a tombstone rather than forgetting it", () => {
    /* A row that is simply gone cannot say it was deleted rather than never
       seen, so the next pull would hand it straight back. */
    store.deleteProject(projectId);
    expect(store.listProjects().map((project) => project.id)).not.toContain(projectId);
    expect(store.readProject(projectId)).toBeNull();

    const tombstone = store.changedSince(null).projects.find((row) => row.id === projectId);
    expect(tombstone?.deletedAt).toBeTruthy();
  });
});
