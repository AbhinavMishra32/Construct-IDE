import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectStore } from "./projectStore.js";

/**
 * The evidence log, through the real database.
 *
 * What is worth testing here is not that rows go in, but the three claims the
 * rest of the system makes about them: a verdict that arrives late settles the
 * rows that were waiting for it, understanding follows the learner across
 * projects rather than belonging to one, and a standing is computed from the
 * log rather than stored beside it.
 */
describe("evidence", () => {
  let directory: string;
  let store: ProjectStore;
  let projectId: string;
  let other: string;

  const concept = (id: string, masteryLevel = 3, project = projectId) =>
    store.recordConcept({
      projectId: project,
      conceptId: id,
      title: id,
      masteryLevel,
      confidence: "solid",
      note: "",
      reason: "",
      summary: "",
      content: "",
      docs: [],
      tags: [],
    });

  const file = (conceptId: string, extra: Partial<Parameters<ProjectStore["recordEvidence"]>[0]> = {}) =>
    store.recordEvidence({
      projectId,
      conceptId,
      kind: "answered",
      demand: "recall",
      outcome: "held",
      source: "message:1",
      excerpt: "",
      ...extra,
    });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "construct-evidence-"));
    store = new ProjectStore(join(directory, "state.sqlite3"));
    projectId = store.createProject({ name: "One", goal: "g", directory: join(directory, "one"), language: "typescript" }).id;
    other = store.createProject({ name: "Two", goal: "g", directory: join(directory, "two"), language: "typescript" }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps what the learner did, newest first", () => {
    file("closures", { excerpt: "first" });
    file("closures", { excerpt: "second" });
    expect(store.listEvidence("closures").map((row) => row.excerpt)).toEqual(["second", "first"]);
  });

  /* Understanding is the learner's, not the project's. Somebody who wrote a
     closure in one project has written a closure. */
  it("reads one concept across every project by default", () => {
    file("closures");
    store.recordEvidence({ projectId: other, conceptId: "closures", kind: "wrote-code", demand: "produce", outcome: "held", source: "task:x", excerpt: "" });

    expect(store.listEvidence("closures")).toHaveLength(2);
    expect(store.listEvidence("closures", { projectId })).toHaveLength(1);
  });

  it("settles the rows a submission left waiting", () => {
    file("closures", { outcome: "unjudged", source: "task:saxpy" });
    file("scope", { outcome: "unjudged", source: "task:saxpy" });
    file("closures", { outcome: "held", source: "message:9" });

    expect(store.judgeEvidence(projectId, "task:saxpy", "missed")).toBe(2);
    expect(store.listEvidence("closures").map((row) => row.outcome)).toEqual(["held", "missed"]);
    /* And only once: a second verdict on the same submission has nothing left
       to settle, so re-judging cannot rewrite a row that already has an answer. */
    expect(store.judgeEvidence(projectId, "task:saxpy", "held")).toBe(0);
  });

  it("computes a standing rather than storing one", () => {
    concept("closures", 4);
    file("closures", { demand: "recall", outcome: "held" });
    file("closures", { demand: "produce", outcome: "held" });
    /* A miss is evidence they were asked, not evidence they can. */
    file("closures", { demand: "transfer", outcome: "missed" });

    const [standing] = store.conceptStandings(projectId);
    expect(standing?.masteryLevel).toBe(4);
    expect(standing?.evidenceCount).toBe(3);
    expect(standing?.demands.sort()).toEqual(["produce", "recall"]);
    expect(standing?.freshness).toBe("fresh");
  });

  it("calls a level with nothing behind it untested", () => {
    concept("monads", 3);
    const [standing] = store.conceptStandings(projectId);
    expect(standing?.freshness).toBe("untested");
    expect(standing?.lastEvidenceAt).toBeNull();
  });

  /* The reading decays even though the row never moves. Asked from a year on
     rather than by backdating the row, because that is exactly what happens in
     use: the log stands still and the clock does not. */
  it("lets an old reading go cold", () => {
    concept("closures", 1);
    file("closures");

    const later = new Date(Date.now() + 365 * 86_400_000);
    const [standing] = store.conceptStandings(projectId, later);
    expect(standing?.freshness).toBe("stale");
    expect(standing?.retention).toBeLessThan(0.01);
  });

  it("gives a task the node it belongs to", () => {
    store.saveTask(projectId, {
      taskId: "saxpy",
      title: "SAXPY",
      brief: "",
      criteria: ["it runs"],
      concepts: [],
      files: [],
      nodeId: "first-kernel",
      status: "open",
      outcome: "",
    });
    expect(store.listTasks(projectId)[0]?.nodeId).toBe("first-kernel");
  });
});
