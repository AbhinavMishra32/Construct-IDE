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
const nodeValidationFixtureRoot = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "test-fixtures",
  "node-validation"
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

test("resolveBlueprintStepRequest selects node-test for TypeScript projects that use the built-in Node test runner", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-blueprint-node-test-"));

  try {
    await mkdir(path.join(temporaryDirectory, "src"), { recursive: true });
    await mkdir(path.join(temporaryDirectory, "test"), { recursive: true });

    const blueprint = await loadBlueprint(blueprintPath);
    const temporaryBlueprintPath = path.join(temporaryDirectory, "project-blueprint.json");

    await writeFile(
      path.join(temporaryDirectory, "package.json"),
      JSON.stringify(
        {
          name: "node-test-ts-project",
          type: "module",
          scripts: {
            test: "node --test test/**/*.ts"
          }
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(temporaryDirectory, "src", "vdom.ts"),
      [
        "/* anchor: step-1-vdom-core */",
        "export function h(): string {",
        "  throw new Error('TODO: implement h() for step-1-vdom-core');",
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(temporaryDirectory, "test", "step1_vdom.test.ts"),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { h } from '../src/vdom';",
        "",
        "test('h throws until implemented', () => {",
        "  assert.throws(() => h(), /TODO/);",
        "});"
      ].join("\n")
    );

    await writeFile(
      temporaryBlueprintPath,
      JSON.stringify(
        {
          ...blueprint,
          id: "node.test.project",
          name: "Node test project",
          projectRoot: temporaryDirectory,
          sourceProjectRoot: temporaryDirectory,
          language: "TypeScript",
          entrypoints: ["src/vdom.ts"],
          files: {
            "src/vdom.ts": [
              "/* anchor: step-1-vdom-core */",
              "export function h(): string {",
              "  throw new Error('TODO: implement h() for step-1-vdom-core');",
              "}"
            ].join("\n")
          },
          steps: blueprint.steps.slice(0, 1).map((step) => ({
            ...step,
            id: "step-1-vdom-core",
            title: "Step 1",
            summary: "Implement h.",
            doc: "Edit src/vdom.ts.",
            anchor: {
              file: "src/vdom.ts",
              marker: "step-1-vdom-core"
            },
            tests: ["test/step1_vdom.test.ts"],
            lessonSlides: [
              {
                blocks: [{ type: "markdown", markdown: "Implement h." }]
              }
            ],
            checks: [],
            constraints: [],
            visibleFiles: []
          })),
          frontier: blueprint.frontier
            ? {
                ...blueprint.frontier,
                activeStepId: "step-1-vdom-core",
                stepIds: ["step-1-vdom-core"],
                hiddenTestPaths: ["test/step1_vdom.test.ts"]
              }
            : null
        },
        null,
        2
      )
    );

    const request = await resolveBlueprintStepRequest({
      blueprintPath: temporaryBlueprintPath,
      stepId: "step-1-vdom-core",
      timeoutMs: 4_000
    });

    assert.equal(request.adapter, "node-test");
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

test("TestRunnerManager can run TypeScript Jest suites in generated projects without a local Jest config", async () => {
  const temporaryFixturesRoot = path.join(rootDir, ".construct", "tmp");
  await mkdir(temporaryFixturesRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    path.join(temporaryFixturesRoot, "construct-generated-jest-ts-")
  );

  try {
    await mkdir(path.join(temporaryDirectory, "src", "app"), { recursive: true });
    await mkdir(path.join(temporaryDirectory, "src", "__tests__"), { recursive: true });

    await writeFile(
      path.join(temporaryDirectory, "package.json"),
      JSON.stringify(
        {
          name: "generated-vite-ts-project",
          private: true,
          type: "module",
          devDependencies: {
            typescript: "^5.5.4",
            vite: "^5.2.11"
          }
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(temporaryDirectory, "src", "app", "App.ts"),
      [
        "export function createApp(root: HTMLElement) {",
        "  root.innerHTML = '<h1>Vite Vanilla TypeScript</h1><p>explicit render</p><small>Next step</small>';",
        "  return {",
        "    destroy() {",
        "      root.innerHTML = '';",
        "    }",
        "  };",
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(temporaryDirectory, "src", "__tests__", "step1.main-and-app.test.ts"),
      [
        "import { createApp } from '../app/App';",
        "",
        "function getText(el: Element | null): string {",
        "  return (el?.textContent ?? '').trim();",
        "}",
        "",
        "describe('step 1: explicit entry + initial render', () => {",
        "  test('createApp renders the required DOM', () => {",
        "    document.body.innerHTML = '<div id=\"root\"></div>';",
        "    const root = document.querySelector('#root') as HTMLElement;",
        "",
        "    const { destroy } = createApp(root);",
        "",
        "    expect(getText(root.querySelector('h1'))).toBe('Vite Vanilla TypeScript');",
        "    expect(getText(root.querySelector('p'))).toMatch(/explicit/i);",
        "    expect(getText(root.querySelector('small'))).toMatch(/Next/i);",
        "",
        "    destroy();",
        "    expect(root.innerHTML).toBe('');",
        "  });",
        "});"
      ].join("\n")
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "step-1-create-first-screen-explicit-mount",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: [path.join(temporaryDirectory, "src", "__tests__", "step1.main-and-app.test.ts")],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "passed");
    assert.equal(result.failures.length, 0);
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
  assert.equal(result.failures[0].expectedOutput, "3");
  assert.equal(result.failures[0].actualOutput, "2");
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

test("TestRunnerManager runs hidden validation scripts and derives expected vs current output", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runTask({
    stepId: "fixture.node-validation",
    adapter: "jest",
    projectRoot: nodeValidationFixtureRoot,
    tests: ["hidden_tests/step1_validation.js"],
    timeoutMs: 10_000
  });

  assert.equal(result.status, "failed");
  assert.equal(result.adapter, "jest");
  assert.equal(result.failures.length > 0, true);

  const workspaceFailure = result.failures.find(
    (failure) => failure.message === "workspaces missing in root package.json"
  );
  assert.ok(workspaceFailure);
  assert.equal(workspaceFailure.expectedOutput, "root package.json defines workspaces");
  assert.equal(workspaceFailure.actualOutput, "workspaces missing in root package.json");

  const turboFailure = result.failures.find(
    (failure) => failure.message === "turbo.json missing"
  );
  assert.ok(turboFailure);
  assert.equal(turboFailure.expectedOutput, "turbo.json exists");
  assert.equal(turboFailure.actualOutput, "turbo.json missing");
});

test("TestRunnerManager provides a DOM-backed TypeScript-aware runtime for hidden validations", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-node-validation-dom-"));

  try {
    await mkdir(path.join(temporaryDirectory, "src"), { recursive: true });
    await mkdir(path.join(temporaryDirectory, "hidden_tests"), { recursive: true });

    await writeFile(
      path.join(temporaryDirectory, "src", "vdom.ts"),
      [
        "export function createElement(type: string, props: any, ...children: any[]) {",
        "  return { type, props, children };",
        "}",
        "",
        "export function render(container: HTMLElement, vnode: any): void {",
        "  const element = document.createElement(vnode.type);",
        "  element.textContent = String(vnode.children[0] ?? '');",
        "  container.appendChild(element);",
        "}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(temporaryDirectory, "hidden_tests", "dom_validation.js"),
      [
        "(async function () {",
        "  const { createElement, render } = await import('./src/vdom.js');",
        "  const container = document.createElement('div');",
        "  document.body.appendChild(container);",
        "  render(container, createElement('div', null, 'Hello'));",
        "  if (container.querySelector('div')?.textContent !== 'Hello') {",
        "    throw new Error('DOM render failed');",
        "  }",
        "})();"
      ].join("\n"),
      "utf8"
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-validation-dom",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: ["hidden_tests/dom_validation.js"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "passed");
    assert.equal(result.failures.length, 0);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager runs node:test TypeScript suites via tsx", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-node-test-suite-"));

  try {
    await mkdir(path.join(temporaryDirectory, "src"), { recursive: true });
    await mkdir(path.join(temporaryDirectory, "test"), { recursive: true });

    await writeFile(
      path.join(temporaryDirectory, "src", "vdom.ts"),
      [
        "export function h(): string {",
        "  throw new Error('TODO: implement h() for step-1-vdom-core');",
        "}"
      ].join("\n")
    );
    await writeFile(
      path.join(temporaryDirectory, "test", "step1_vdom.test.ts"),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { h } from '../src/vdom';",
        "",
        "test('h throws until implemented', () => {",
        "  assert.throws(() => h(), /TODO: implement h\\(\\)/);",
        "});"
      ].join("\n")
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-test",
      adapter: "node-test",
      projectRoot: temporaryDirectory,
      tests: ["test/step1_vdom.test.ts"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "passed");
    assert.equal(result.adapter, "node-test");
    assert.equal(result.failures.length, 0);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager derives invalid JSON comparisons from hidden validation output", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-node-validation-json-"));

  try {
    await mkdir(path.join(temporaryDirectory, "hidden_tests"), { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, "hidden_tests", "invalid_json_validation.js"),
      [
        "const path = require('node:path');",
        "console.error(",
        "  `[STEP1] Cannot parse ${path.join(process.cwd(), 'package.json')} as JSON: Unexpected non-whitespace character after JSON at position 282`",
        ");",
        "process.exit(1);"
      ].join("\n"),
      "utf8"
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-validation-invalid-json",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: ["hidden_tests/invalid_json_validation.js"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].expectedOutput, "package.json contains valid JSON");
    assert.equal(result.failures[0].actualOutput, "package.json contains invalid JSON");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager hides internal validation wrapper paths when a hidden validation crashes", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-node-validation-crash-"));

  try {
    await mkdir(path.join(temporaryDirectory, "hidden_tests"), { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, "hidden_tests", "crash_validation.js"),
      "throw new Error('Hidden validation crashed');\n",
      "utf8"
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-validation-crash",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: ["hidden_tests/crash_validation.js"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].message, "Error: Hidden validation crashed");
    assert.doesNotMatch(result.failures[0].message, /__construct_hidden_validation__/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager reports placeholder hidden validations cleanly", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "construct-node-validation-placeholder-")
  );

  try {
    await mkdir(path.join(temporaryDirectory, "hidden_tests"), { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, "hidden_tests", "placeholder_validation.js"),
      ".placeholder\n",
      "utf8"
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-validation-placeholder",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: ["hidden_tests/placeholder_validation.js"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failures.length, 1);
    assert.equal(
      result.failures[0].message,
      "Hidden validation script hidden_tests/placeholder_validation.js contains placeholder content."
    );
    assert.equal(
      result.failures[0].expectedOutput,
      "placeholder_validation.js contains a real runnable validation"
    );
    assert.equal(
      result.failures[0].actualOutput,
      "placeholder_validation.js contains placeholder content"
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("TestRunnerManager reports invalid hidden validation JavaScript cleanly", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-node-validation-invalid-"));

  try {
    await mkdir(path.join(temporaryDirectory, "hidden_tests"), { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, "hidden_tests", "invalid_validation.js"),
      "const broken = ;\n",
      "utf8"
    );

    const manager = new TestRunnerManager();
    const result = await manager.runTask({
      stepId: "fixture.node-validation-invalid-js",
      adapter: "jest",
      projectRoot: temporaryDirectory,
      tests: ["hidden_tests/invalid_validation.js"],
      timeoutMs: 10_000
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failures.length, 1);
    assert.match(
      result.failures[0].message,
      /Hidden validation script hidden_tests\/invalid_validation\.js contains invalid JavaScript:/
    );
    assert.equal(
      result.failures[0].expectedOutput,
      "invalid_validation.js contains valid runnable JavaScript"
    );
    assert.equal(
      result.failures[0].actualOutput,
      "invalid_validation.js contains invalid JavaScript"
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
