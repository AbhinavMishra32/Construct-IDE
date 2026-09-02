import { describe, expect, it } from "vitest";

import { activeTask, plainText, taskFromToolInput } from "./taskInput";
import type { TaskSummary } from "../../../shared/api";

const task = (taskId: string, status: TaskSummary["status"]): TaskSummary => ({
  taskId,
  title: taskId,
  brief: "",
  criteria: [],
  concepts: [],
  files: [],
  status,
  outcome: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("taskFromToolInput", () => {
  it("reads the task out of the call that set it", () => {
    /* The card is drawn the instant the tool runs, before the stored task has
       been re-read, so the call's own arguments have to stand in. */
    const written = taskFromToolInput(
      JSON.stringify({ taskId: "saxpy", title: "Write saxpy", brief: "Do it.", criteria: ["Compiles"], files: ["main.cpp"] }),
    );
    expect(written).toMatchObject({
      taskId: "saxpy",
      title: "Write saxpy",
      brief: "Do it.",
      criteria: ["Compiles"],
      files: ["main.cpp"],
      status: "open",
    });
  });

  it("drops blank criteria rather than rendering empty rows", () => {
    const written = taskFromToolInput(JSON.stringify({ taskId: "a", title: "A", criteria: ["Real", "  ", ""] }));
    expect(written?.criteria).toEqual(["Real"]);
  });

  it("returns nothing without an id and a title", () => {
    expect(taskFromToolInput(JSON.stringify({ title: "No id" }))).toBeNull();
    expect(taskFromToolInput(JSON.stringify({ taskId: "no-title" }))).toBeNull();
  });

  it("returns nothing for input that is not JSON", () => {
    /* Tool input is a string the worker formatted; a truncated one must not
       take the transcript down. */
    expect(taskFromToolInput("{ not json")).toBeNull();
  });
});

describe("activeTask", () => {
  it("is the newest task still outstanding", () => {
    expect(activeTask([task("a", "passed"), task("b", "open")])?.taskId).toBe("b");
  });

  it("counts a submitted task as outstanding — it is still owed", () => {
    expect(activeTask([task("a", "submitted")])?.taskId).toBe("a");
  });

  it("prefers the newest when more than one is open", () => {
    /* The agent is told to judge before setting another, but if it sets one
       anyway the newest is the one just asked for. */
    expect(activeTask([task("a", "open"), task("b", "open")])?.taskId).toBe("b");
  });

  it("is nothing when everything is finished", () => {
    expect(activeTask([task("a", "passed")])).toBeNull();
    expect(activeTask([])).toBeNull();
  });
});

describe("plainText", () => {
  /* The agent writes criteria with the same reflexes it writes prose, and a
     checklist row is the one place that markup has nowhere to go — it is a
     single line beside a checkbox, not a paragraph. */
  it("strips inline code, keeping the code", () => {
    expect(plainText("In main.py, `scores` is created with torch.zeros")).toBe(
      "In main.py, scores is created with torch.zeros",
    );
  });

  it("strips bold and italic", () => {
    expect(plainText("**Both** shapes are *printed*")).toBe("Both shapes are printed");
    expect(plainText("_Every_ tensor line has a comment")).toBe("Every tensor line has a comment");
  });

  it("keeps a reference's label, which is the readable half", () => {
    expect(plainText("Edit [[file:src/main.py|main.py]] to add it")).toBe("Edit main.py to add it");
    expect(plainText("Covers [[concept:tensors]]")).toBe("Covers tensors");
  });

  it("leaves ordinary prose alone", () => {
    /* Underscores and asterisks inside identifiers are not emphasis — a
       criterion naming `snake_case_name` must survive intact. */
    expect(plainText("Running python main.py prints both shapes")).toBe("Running python main.py prints both shapes");
    expect(plainText("The variable snake_case_name is set")).toBe("The variable snake_case_name is set");
    expect(plainText("Multiply a * b together")).toBe("Multiply a * b together");
  });

  it("trims what is left", () => {
    expect(plainText("  `done`  ")).toBe("done");
  });
});
