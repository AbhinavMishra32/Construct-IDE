import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RUST_ANALYZER_SAFE_CONFIGURATION,
  rustAnalyzerConfigurationForSection,
  rustAnalyzerConfigurationForWorkspace
} from "../../shared/constructLsp";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructLspService } from "./ConstructLspService";

test("rust-analyzer safe configuration keeps dependency navigation while disabling expensive default work", () => {
  const config = rustAnalyzerConfigurationForSection("rust-analyzer") as typeof RUST_ANALYZER_SAFE_CONFIGURATION;

  assert.equal(config.checkOnSave, false);
  assert.equal(config.cachePriming.enable, false);
  assert.equal(config.cargo.buildScripts.enable, false);
  assert.equal(config.cargo.allTargets, false);
  assert.equal(config.check.workspace, false);
  assert.equal(config.procMacro.enable, true);
  assert.equal(config.procMacro.attributes.enable, true);
  assert.equal(config.procMacro.processes, 1);
  assert.equal(config.files.exclude.includes("target"), true);
  assert.equal(rustAnalyzerConfigurationForSection("rust-analyzer.checkOnSave"), false);
  assert.equal(rustAnalyzerConfigurationForSection("rust-analyzer.procMacro.enable"), true);
  assert.equal(rustAnalyzerConfigurationForSection("rust-analyzer.procMacro.attributes.enable"), true);
});

test("rust-analyzer configuration pins nested Cargo projects with linkedProjects", () => {
  const workspacePath = "/tmp/course/my_bevy_game";
  const config = rustAnalyzerConfigurationForWorkspace(workspacePath);

  assert.deepEqual(config.linkedProjects, [`${workspacePath}/Cargo.toml`]);
  assert.deepEqual(
    rustAnalyzerConfigurationForSection("rust-analyzer.linkedProjects", workspacePath),
    [`${workspacePath}/Cargo.toml`]
  );
});

test("rust-analyzer memory guard leaves room for Bevy while staying capped", () => {
  if (process.env.CONSTRUCT_RUST_ANALYZER_MEMORY_MB) {
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "construct-lsp-budget-"));
  const service = new ConstructLspService({
    appPath: dir,
    bundleDir: dir,
    cwd: dir,
    workspacePathForProject: () => dir
  });
  const limit = service.getStatus().rust.memoryLimitMb;

  assert.ok(limit != null);
  assert.ok(limit >= 2048, `expected Rust analyzer budget to be Bevy-capable, got ${limit} MB`);
  assert.ok(limit <= 3072, `expected Rust analyzer budget to remain capped, got ${limit} MB`);
});

test("rust analyzer is not started for Rust files outside a Cargo project", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-lsp-rust-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const project = createFlowProject(dir);
  await mkdir(path.join(project.workspacePath, "src"), { recursive: true });
  await writeFile(path.join(project.workspacePath, "src/main.rs"), "fn main() {}\n", "utf8");

  const service = new ConstructLspService({
    appPath: dir,
    bundleDir: dir,
    cwd: dir,
    workspacePathForProject: () => project.workspacePath
  });

  const result = service.startForProject(project);

  assert.deepEqual(result.languages, []);
  assert.equal(result.skipped?.rust?.reason, "no-cargo-project");
  assert.match(result.skipped?.rust?.message ?? "", /no Cargo\.toml root/);
  assert.equal(service.snapshots().find((snapshot) => snapshot.id === "lsp:rust")?.pid, null);
});

test("generated Rust files under target do not trigger rust analyzer startup", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-lsp-target-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const project = createFlowProject(dir, "target/debug/build/generated/out.rs");
  await mkdir(path.join(project.workspacePath, "target/debug/build/generated"), { recursive: true });
  await writeFile(path.join(project.workspacePath, "target/debug/build/generated/out.rs"), "pub fn generated() {}\n", "utf8");

  const service = new ConstructLspService({
    appPath: dir,
    bundleDir: dir,
    cwd: dir,
    workspacePathForProject: () => project.workspacePath
  });

  const result = service.startForProject(project);

  assert.deepEqual(result.languages, []);
  assert.equal(result.skipped?.rust, undefined);
  assert.equal(service.snapshots().find((snapshot) => snapshot.id === "lsp:rust")?.pid, null);
});

function createFlowProject(root: string, activeFilePath = "src/main.rs"): StoredFlowProject {
  const now = "2026-07-08T00:00:00.000Z";
  return {
    kind: "flow",
    id: "rust-project",
    title: "Rust Project",
    description: "Test project",
    progress: 0,
    lastOpenedAt: null,
    workspacePath: path.join(root, "rust-project"),
    activeFilePath,
    fileTreeExpanded: [],
    completedAt: null,
    sourcePath: null,
    flow: {
      goal: "Inspect Rust",
      memoryDirectory: ".construct",
      threadId: "thread",
      researchEnabled: false,
      sessions: [],
      createdAt: now,
      updatedAt: now
    }
  };
}
