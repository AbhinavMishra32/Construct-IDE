import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "../memory/memoryService.js";
import { WorkspaceService } from "../projects/workspaceService.js";
import { ProjectStore } from "../store/projectStore.js";
import { PathService } from "./pathService.js";

let root: string;
let store: ProjectStore;
let service: PathService;
let project: { id: string; directory: string };

const node = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, summary: `Do ${title}`, ...extra });
const pathMd = () => readFileSync(path.join(project.directory, ".construct", "path.md"), "utf8");

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "construct-path-"));
  store = new ProjectStore(path.join(root, "state.sqlite3"));
  const memory = new MemoryService(new WorkspaceService());
  service = new PathService(store, memory);
  const created = store.createProject({ name: "Renderer", goal: "Understand rasterisation", directory: root, language: "typescript" });
  project = { id: created.id, directory: created.directory };
  await memory.ensure(created);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("planning", () => {
  it("stores the steps in the order given and starts on the first", async () => {
    const planned = await service.plan(project, { reason: "First plan", nodes: [node("basics", "Basics"), node("build", "Build")] });

    expect(planned.nodes.map((step) => step.id)).toEqual(["basics", "build"]);
    expect(planned.nodes.map((step) => step.order)).toEqual([0, 1]);
    expect(planned.currentNodeId).toBe("basics");
    expect(planned.nodes[0]!.status).toBe("active");
    expect(planned.nodes[1]!.status).toBe("planned");
  });

  it("survives a reopen, because the path is the project's state and not the session's", async () => {
    await service.plan(project, { reason: "x", nodes: [node("basics", "Basics")] });
    expect(service.read(project.id).nodes.map((step) => step.title)).toEqual(["Basics"]);
  });

  it("honours a named current step", async () => {
    const planned = await service.plan(project, {
      reason: "x",
      currentNodeId: "build",
      nodes: [node("basics", "Basics"), node("build", "Build")],
    });
    expect(planned.currentNodeId).toBe("build");
  });

  it("ignores a named step that is not in the path", async () => {
    const planned = await service.plan(project, { reason: "x", currentNodeId: "ghost", nodes: [node("basics", "Basics")] });
    expect(planned.currentNodeId).toBe("basics");
  });

  it("keeps finished work finished across a revision", async () => {
    /* The plan is the agent's opinion; what the learner has actually done is a
       fact. A replan that quietly un-finishes their work would make the path
       untrustworthy exactly when it matters. */
    await service.plan(project, { reason: "x", nodes: [node("basics", "Basics"), node("build", "Build")] });
    await service.complete(project, "basics", "learner explained it back");

    const replanned = await service.plan(project, {
      reason: "revised",
      nodes: [node("basics", "Basics"), node("shapes", "Shapes"), node("build", "Build")],
    });

    expect(replanned.nodes.find((step) => step.id === "basics")?.status).toBe("completed");
    expect(replanned.currentNodeId).toBe("shapes");
  });

  it("drops steps a revision no longer lists", async () => {
    await service.plan(project, { reason: "x", nodes: [node("basics", "Basics"), node("detour", "Detour")] });
    const replanned = await service.plan(project, { reason: "tighter", nodes: [node("basics", "Basics")] });
    expect(replanned.nodes.map((step) => step.id)).toEqual(["basics"]);
    expect(service.read(project.id).nodes).toHaveLength(1);
  });

  it("keeps the date a step was first planned, so revisions do not reset its history", async () => {
    const first = await service.plan(project, { reason: "x", nodes: [node("basics", "Basics")] });
    const again = await service.plan(project, { reason: "y", nodes: [node("basics", "Basics, revised")] });
    expect(again.nodes[0]!.createdAt).toBe(first.nodes[0]!.createdAt);
  });

  it("ignores a step with no id or title rather than storing a blank one", async () => {
    const planned = await service.plan(project, { reason: "x", nodes: [node("", "Nameless"), node("real", "Real")] });
    expect(planned.nodes.map((step) => step.id)).toEqual(["real"]);
  });

  it("falls back to custom for a kind it does not know", async () => {
    const planned = await service.plan(project, { reason: "x", nodes: [node("basics", "Basics", { kind: "vibes" })] });
    expect(planned.nodes[0]!.kind).toBe("custom");
  });
});

describe("the mirror in path.md", () => {
  it("writes the plan into the learner's own repository", async () => {
    await service.plan(project, {
      reason: "Start from what a triangle is",
      nodes: [node("basics", "Basics", { exitCriteria: ["can explain a barycentric coordinate"] }), node("build", "Build")],
    });

    const written = pathMd();
    expect(written).toContain("Now: Basics");
    expect(written).toContain("Why this path: Start from what a triangle is");
    expect(written).toContain("### 1. Basics ← here");
    expect(written).toContain("Done when: can explain a barycentric coordinate");
  });

  it("is rewritten rather than appended to, so it cannot drift from the rows", async () => {
    await service.plan(project, { reason: "x", nodes: [node("detour", "Detour")] });
    await service.plan(project, { reason: "y", nodes: [node("basics", "Basics")] });
    expect(pathMd()).not.toContain("Detour");
  });

  it("moves the marker when a step is completed", async () => {
    await service.plan(project, { reason: "x", nodes: [node("basics", "Basics"), node("build", "Build")] });
    await service.complete(project, "basics", "done");
    expect(pathMd()).toContain("### 2. Build ← here");
  });
});

describe("completing", () => {
  it("moves to the next unfinished step", async () => {
    await service.plan(project, { reason: "x", nodes: [node("a", "A"), node("b", "B"), node("c", "C")] });
    const after = await service.complete(project, "a", "done");
    expect(after.currentNodeId).toBe("b");
  });

  it("ends with nothing current once every step is done", async () => {
    await service.plan(project, { reason: "x", nodes: [node("a", "A")] });
    const after = await service.complete(project, "a", "done");
    expect(after.currentNodeId).toBeNull();
    expect(after.nodes[0]!.status).toBe("completed");
  });
});
