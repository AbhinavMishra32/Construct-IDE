import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

import { createConstructDataPaths } from "../config/constructConfig";
import {
  APPLICATION_SCOPE,
  createConstructStorageService,
  StorageTarget
} from "../storage/storage";
import { ConstructProjectRepository } from "./ConstructProjectRepository";
import type { StoredFlowProject } from "./ConstructProjectTypes";
import type { ConstructFlowSession } from "../../shared/constructFlow";

const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");

test("project repository stores Flow projects as segmented project and session records", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const repository = new ConstructProjectRepository(paths, storage);
  const project = createFlowProject("flow-one", [
    createSession("flow-one", "session-one", "First session"),
    createSession("flow-one", "session-two", "Second session")
  ]);

  await repository.writeAll([project]);
  await storage.flush();

  const keys = readStorageKeys(paths.storageDatabasePath);
  assert(keys.includes("construct.projects.index"));
  assert(keys.includes("construct.project.flow-one"));
  assert(keys.includes("construct.flow.sessions.flow-one"));
  assert(keys.includes("construct.flow.session.flow-one.session-one"));
  assert(keys.includes("construct.flow.session.flow-one.session-two"));
  assert(!keys.includes("construct.projects"));

  const [reloaded] = await repository.readAll();
  assert.equal(reloaded.id, "flow-one");
  assert.equal(reloaded.kind, "flow");
  assert.equal(reloaded.flow.sessions.length, 2);
  assert.equal(reloaded.flow.sessions[1].messages[0]?.content, "Second session");

  await storage.close();
});

test("project repository migrates the legacy aggregate key into segmented storage", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const legacyProject = createFlowProject("legacy-flow", [
    createSession("legacy-flow", "legacy-session", "Legacy session")
  ]);
  storage.store("construct.projects", [legacyProject], APPLICATION_SCOPE, StorageTarget.USER);
  await storage.flush();

  const repository = new ConstructProjectRepository(paths, storage);
  const projects = await repository.readAll();
  await storage.flush();

  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.id, "legacy-flow");

  const keys = readStorageKeys(paths.storageDatabasePath);
  assert(keys.includes("construct.projects.index"));
  assert(keys.includes("construct.project.legacy-flow"));
  assert(keys.includes("construct.flow.session.legacy-flow.legacy-session"));
  assert(!keys.includes("construct.projects"));

  await storage.close();
});

function createFlowProject(id: string, sessions: ConstructFlowSession[]): StoredFlowProject {
  const now = "2026-06-25T00:00:00.000Z";
  return {
    kind: "flow",
    id,
    title: id,
    description: "Learn by building.",
    progress: 0,
    lastOpenedAt: now,
    workspacePath: path.join("/tmp", id),
    sourcePath: null,
    activeFilePath: null,
    fileTreeExpanded: [],
    completedAt: null,
    flow: {
      goal: "Learn by building.",
      autonomyPreference: "balanced",
      permissionsPreference: "ask",
      memoryDirectory: ".construct",
      threadId: `${id}-thread`,
      researchEnabled: false,
      researchCompletedAt: null,
      pathNodes: [],
      currentPathNodeId: null,
      pathCreatedAt: null,
      pathUpdatedAt: null,
      sessions,
      createdAt: now,
      updatedAt: now
    }
  };
}

function createSession(projectId: string, id: string, content: string): ConstructFlowSession {
  const now = "2026-06-25T00:00:00.000Z";
  return {
    id,
    projectId,
    threadId: `${projectId}-thread`,
    origin: "user",
    messages: [{
      id: `${id}-message`,
      role: "assistant",
      content,
      createdAt: now
    }],
    status: "completed",
    toolCalls: [],
    agentEvents: [],
    timeline: [],
    actions: [],
    practiceTasks: [],
    createdAt: now,
    updatedAt: now
  };
}

function readStorageKeys(databasePath: string): string[] {
  let db: NodeDatabaseSync | null = null;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const rows = db.prepare("SELECT key FROM storage_items ORDER BY key").all() as Array<{ key: string }>;
    return rows.map((row) => row.key);
  } finally {
    db?.close();
  }
}
