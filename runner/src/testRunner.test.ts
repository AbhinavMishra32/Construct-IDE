import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TestRunnerManager,
  findUpwardJestBinaryPath,
  inferAdapterFromBlueprint,
  loadBlueprint,
  resolveBlueprintStepRequest
} from "./testRunner";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const blueprintPath = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "project-blueprint.json"
);
const failureFixtureRoot = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "test-fixtures",
  "jest-failure"
);
const timeoutFixtureRoot = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "test-fixtures",
  "jest-timeout"
);

test("resolveBlueprintStepRequest maps a blueprint step to a targeted Jest run", async () => {
  const request = await resolveBlueprintStepRequest({
    blueprintPath,
    stepId: "step.state-merge",
    timeoutMs: 4_000
  });

  assert.equal(request.adapter, "jest");
  assert.equal(path.basename(request.projectRoot), "workflow-runtime");
  assert.deepEqual(request.tests, ["tests/state.test.ts"]);
  assert.equal(request.timeoutMs, 4_000);
});

test("resolveBlueprintStepRequest accepts generated blueprints that use TypeScript casing", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-blueprint-"));

  try {
    const blueprint = await loadBlueprint(blueprintPath);
    const temporaryBlueprintPath = path.join(temporaryDirectory, "project-blueprint.json");

    await writeFile(
      temporaryBlueprintPath,
      JSON.stringify({ ...blueprint, language: "TypeScript" }, null, 2)
    );

    const request = await resolveBlueprintStepRequest({
      blueprintPath: temporaryBlueprintPath,
      stepId: "step.state-merge",
      timeoutMs: 4_000
    });

    assert.equal(request.adapter, "jest");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("inferAdapterFromBlueprint supports TypeScript, Python, and Rust labels", async () => {
  const blueprint = await loadBlueprint(blueprintPath);

  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "TypeScript" }), "jest");
  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "typescript" }), "jest");
  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "Python" }), "pytest");
  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "python" }), "pytest");
  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "Rust" }), "cargo");
  assert.equal(inferAdapterFromBlueprint({ ...blueprint, language: "rust" }), "cargo");
});

test("findUpwardJestBinaryPath resolves pnpm-installed jest from a nested generated workspace", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-jest-binary-"));

  try {
    const workspaceRoot = path.join(
      temporaryDirectory,
      ".construct",
      "workspaces",
      "project"
    );
    const pnpmJestBinaryPath = path.join(
      temporaryDirectory,
      "node_modules",
      ".pnpm",
      "jest@29.7.0",
      "node_modules",
      "jest",
      "bin",
      "jest.js"
    );

    await mkdir(path.dirname(pnpmJestBinaryPath), { recursive: true });
    await writeFile(pnpmJestBinaryPath, "console.log('jest');", { encoding: "utf8" });

    const resolvedBinaryPath = findUpwardJestBinaryPath(workspaceRoot);

    assert.equal(resolvedBinaryPath, pnpmJestBinaryPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager returns a passing structured result for a blueprint step", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runBlueprintStep({
    blueprintPath,
    stepId: "step.state-merge",
    timeoutMs: 10_000
  });

  assert.equal(result.status, "passed");
  assert.equal(result.adapter, "jest");
  assert.equal(result.timedOut, false);
  assert.equal(result.testsRun.includes("tests/state.test.ts"), true);
  assert.equal(result.failures.length, 0);
});

test("TestRunnerManager captures failing assertions as structured task failures", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runTask({
    stepId: "fixture.failure",
    adapter: "jest",
    projectRoot: failureFixtureRoot,
    tests: ["tests/math.test.js"],
    timeoutMs: 10_000
  });

  assert.equal(result.status, "failed");
  assert.equal(result.adapter, "jest");
  assert.equal(result.failures.length > 0, true);
  assert.match(result.failures[0].testName, /reports a structured failure/i);
  assert.equal(result.failures[0].message.length > 0, true);
  assert.equal(result.timedOut, false);
});

test("TestRunnerManager marks timed-out task runs explicitly", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runTask({
    stepId: "fixture.timeout",
    adapter: "jest",
    projectRoot: timeoutFixtureRoot,
    tests: ["tests/slow.test.js"],
    timeoutMs: 50
  });

  assert.equal(result.status, "failed");
  assert.equal(result.timedOut, true);
  assert.match(result.failures[0].message, /timed out/i);
});
