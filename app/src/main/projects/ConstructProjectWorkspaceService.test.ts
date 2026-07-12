import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ConstructProjectWorkspaceService, isIgnoredWorkspacePath } from "./ConstructProjectWorkspaceService";
import type { StoredFlowProject } from "./ConstructProjectTypes";

test("workspace tree excludes generated dependency directories before renderer state", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-workspace-tree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const project = createFlowProject(dir);
  await mkdir(path.join(project.workspacePath, "src"), { recursive: true });
  await mkdir(path.join(project.workspacePath, ".venv/lib/python3.12/site-packages"), { recursive: true });
  await mkdir(path.join(project.workspacePath, "node_modules/pkg"), { recursive: true });
  await mkdir(path.join(project.workspacePath, ".construct"), { recursive: true });
  await mkdir(path.join(project.workspacePath, ".git/objects"), { recursive: true });
  await mkdir(path.join(project.workspacePath, ".pytest_cache"), { recursive: true });
  await mkdir(path.join(project.workspacePath, "target/debug/build/generated"), { recursive: true });

  await writeFile(path.join(project.workspacePath, "src/main.py"), "print('ok')\n", "utf8");
  await writeFile(path.join(project.workspacePath, "README.md"), "# Demo\n", "utf8");
  await writeFile(path.join(project.workspacePath, ".venv/lib/python3.12/site-packages/pkg.py"), "", "utf8");
  await writeFile(path.join(project.workspacePath, "node_modules/pkg/index.js"), "", "utf8");
  await writeFile(path.join(project.workspacePath, ".construct/learner.md"), "", "utf8");
  await writeFile(path.join(project.workspacePath, ".pytest_cache/CACHEDIR.TAG"), "", "utf8");
  await writeFile(path.join(project.workspacePath, "target/debug/build/generated/out.rs"), "", "utf8");

  const workspace = new ConstructProjectWorkspaceService(() => dir, () => dir);
  const tree = await workspace.listWorkspaceTree(project);
  const serialized = JSON.stringify(tree);

  assert.deepEqual(tree.map((node) => node.path), ["src", "README.md"]);
  assert.deepEqual(tree[0]?.children?.map((node) => node.path), ["src/main.py"]);
  assert.equal(serialized.includes(".venv"), false);
  assert.equal(serialized.includes("node_modules"), false);
  assert.equal(serialized.includes(".construct"), false);
  assert.equal(serialized.includes(".pytest_cache"), false);
  assert.equal(serialized.includes("target"), false);
});

test("workspace path ignore policy matches generated path segments", () => {
  assert.equal(isIgnoredWorkspacePath(".venv/lib/python3.12/site-packages/pkg.py"), true);
  assert.equal(isIgnoredWorkspacePath("src/__pycache__/main.cpython-312.pyc"), true);
  assert.equal(isIgnoredWorkspacePath("src/node_modules/pkg/index.js"), true);
  assert.equal(isIgnoredWorkspacePath("target/debug/build/generated/out.rs"), true);
  assert.equal(isIgnoredWorkspacePath("src/not-node_modules/example.ts"), false);
  assert.equal(isIgnoredWorkspacePath("src/.DS_Store"), true);
});

function createFlowProject(root: string): StoredFlowProject {
  const now = "2026-07-05T00:00:00.000Z";
  return {
    kind: "flow",
    id: "flow-project",
    title: "Flow Project",
    description: "Test project",
    progress: 0,
    lastOpenedAt: null,
    workspacePath: path.join(root, "flow-project"),
    activeFilePath: "src/main.py",
    fileTreeExpanded: [],
    completedAt: null,
    sourcePath: null,
    flow: {
      goal: "Learn Python",
      memoryDirectory: ".construct",
      threadId: "thread",
      researchEnabled: false,
      sessions: [],
      createdAt: now,
      updatedAt: now
    }
  };
}
