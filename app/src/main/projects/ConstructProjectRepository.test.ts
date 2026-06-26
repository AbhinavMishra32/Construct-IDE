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
import { createConstructDomainStorage } from "../storage/ConstructDomainStorage";
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

test("project repository stores Flow projects and sessions as domain rows", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await storage.initialize();
  await domainStorage.initialize();

  const repository = new ConstructProjectRepository(paths, storage, domainStorage);
  const project = createFlowProject("domain-flow", [
    createSession("domain-flow", "session-one", "First domain session"),
    createSession("domain-flow", "session-two", "Second domain session")
  ]);

  await repository.writeAll([project]);
  await storage.flush();

  const keys = readStorageKeys(paths.storageDatabasePath);
  assert(!keys.includes("construct.projects.index"));
  assert(!keys.includes("construct.project.domain-flow"));
  assert(!keys.includes("construct.flow.sessions.domain-flow"));
  assert(!keys.some((key) => key.startsWith("construct.flow.session.domain-flow.")));
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_projects"), 1);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_sessions"), 2);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_messages"), 2);

  const summaries = await repository.readSummaries();
  assert.equal(summaries[0]?.id, "domain-flow");
  assert.equal(summaries[0]?.flowSessionCount, 2);

  const reloaded = await repository.readOne("domain-flow");
  assert.equal(reloaded?.kind, "flow");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions.length : 0, 2);
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[1]?.messages[0]?.content : null, "Second domain session");

  domainStorage.close();
  await storage.close();
});

test("project repository migrates legacy project blobs into domain tables", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-migrate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const legacyProject = createFlowProject("legacy-domain-flow", [
    createSession("legacy-domain-flow", "legacy-session", "Legacy domain session")
  ]);
  storage.store("construct.projects", [legacyProject], APPLICATION_SCOPE, StorageTarget.USER);
  await storage.flush();

  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await domainStorage.initialize();
  const repository = new ConstructProjectRepository(paths, storage, domainStorage);

  const projects = await repository.readAll();
  await storage.flush();

  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.id, "legacy-domain-flow");
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_projects"), 1);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_sessions"), 1);
  const keys = readStorageKeys(paths.storageDatabasePath);
  assert(!keys.includes("construct.projects"));
  assert(!keys.some((key) => key.startsWith("construct.flow.session.legacy-domain-flow.")));

  domainStorage.close();
  await storage.close();
});

test("project repository migrates segmented project records into domain tables", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-segmented-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const project = createFlowProject("segmented-domain-flow", [
    createSession("segmented-domain-flow", "segmented-session", "Segmented domain session")
  ]);
  const segmentedRepository = new ConstructProjectRepository(paths, storage);
  await segmentedRepository.writeAll([project]);
  await storage.flush();
  assert(readStorageKeys(paths.storageDatabasePath).includes("construct.project.segmented-domain-flow"));

  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await domainStorage.initialize();
  const domainRepository = new ConstructProjectRepository(paths, storage, domainStorage);

  const projects = await domainRepository.readAll();
  await storage.flush();

  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.id, "segmented-domain-flow");
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_projects"), 1);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_sessions"), 1);
  const keys = readStorageKeys(paths.storageDatabasePath);
  assert(!keys.includes("construct.projects.index"));
  assert(!keys.includes("construct.project.segmented-domain-flow"));
  assert(!keys.includes("construct.flow.session.segmented-domain-flow.segmented-session"));

  domainStorage.close();
  await storage.close();
});

test("project repository normalizes legacy Flow records with missing nullable fields", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-legacy-null-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const legacyProject = createFlowProject("missing-source-path-flow", [
    createSession("missing-source-path-flow", "missing-source-session", "Missing source path")
  ]);
  delete (legacyProject as Partial<StoredFlowProject>).sourcePath;
  storage.store("construct.projects", [legacyProject], APPLICATION_SCOPE, StorageTarget.USER);
  await storage.flush();

  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await domainStorage.initialize();
  const repository = new ConstructProjectRepository(paths, storage, domainStorage);

  const summaries = await repository.readSummaries();
  assert.equal(summaries[0]?.id, "missing-source-path-flow");

  const reloaded = await repository.readOne("missing-source-path-flow");
  assert.equal(reloaded?.sourcePath, null);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_projects"), 1);

  domainStorage.close();
  await storage.close();
});

test("project repository scopes repeated agent event ids while preserving payloads", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-event-ids-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await storage.initialize();
  await domainStorage.initialize();

  const first = createSession("event-id-flow", "session-one", "First repeated event");
  first.messages[0]!.id = "provider-reused-message";
  first.toolCalls.push({
    id: "provider-reused-tool",
    name: "askLearnerQuestion",
    title: "Ask learner",
    reason: "First question.",
    status: "completed",
    createdAt: "2026-06-25T00:00:00.000Z",
    completedAt: "2026-06-25T00:00:00.100Z"
  });
  first.timeline.push({
    id: "provider-reused-timeline",
    kind: "tool",
    toolCallId: "provider-reused-tool",
    name: "askLearnerQuestion",
    title: "Ask learner",
    status: "completed",
    createdAt: "2026-06-25T00:00:00.000Z",
    completedAt: "2026-06-25T00:00:00.100Z"
  });
  first.agentEvents.push({
    id: "provider-reused-id",
    type: "reasoning",
    status: "completed",
    title: "Thinking",
    text: "first",
    createdAt: "2026-06-25T00:00:00.000Z"
  });
  const second = createSession("event-id-flow", "session-two", "Second repeated event");
  second.messages[0]!.id = "provider-reused-message";
  second.toolCalls.push({
    id: "provider-reused-tool",
    name: "askLearnerQuestion",
    title: "Ask learner",
    reason: "Second question.",
    status: "completed",
    createdAt: "2026-06-25T00:00:01.000Z",
    completedAt: "2026-06-25T00:00:01.100Z"
  });
  second.timeline.push({
    id: "provider-reused-timeline",
    kind: "tool",
    toolCallId: "provider-reused-tool",
    name: "askLearnerQuestion",
    title: "Ask learner",
    status: "completed",
    createdAt: "2026-06-25T00:00:01.000Z",
    completedAt: "2026-06-25T00:00:01.100Z"
  });
  second.agentEvents.push({
    id: "provider-reused-id",
    type: "reasoning",
    status: "completed",
    title: "Thinking",
    text: "second",
    createdAt: "2026-06-25T00:00:01.000Z"
  });
  const repository = new ConstructProjectRepository(paths, storage, domainStorage);

  await repository.writeAll([createFlowProject("event-id-flow", [first, second])]);

  const reloaded = await repository.readOne("event-id-flow");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[0]?.messages[0]?.id : null, "provider-reused-message");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[1]?.messages[0]?.id : null, "provider-reused-message");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[0]?.toolCalls[0]?.id : null, "provider-reused-tool");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[1]?.toolCalls[0]?.id : null, "provider-reused-tool");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[0]?.timeline[0]?.id : null, "provider-reused-timeline");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[1]?.timeline[0]?.id : null, "provider-reused-timeline");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[0]?.agentEvents[0]?.id : null, "provider-reused-id");
  assert.equal(reloaded && reloaded.kind === "flow" ? reloaded.flow.sessions[1]?.agentEvents[0]?.id : null, "provider-reused-id");
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_messages"), 2);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_tool_calls"), 2);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_timeline_parts"), 2);
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_agent_events"), 2);

  domainStorage.close();
  await storage.close();
});

test("project repository scopes repeated Flow path node ids across projects", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-project-domain-path-ids-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const paths = createConstructDataPaths(dir);
  const storage = createConstructStorageService(paths.storageDatabasePath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
  await storage.initialize();
  await domainStorage.initialize();

  const first = createFlowProject("path-flow-one", []);
  const second = createFlowProject("path-flow-two", []);
  first.flow.pathNodes = [createPathNode("reused-node", "First path")];
  first.flow.currentPathNodeId = "reused-node";
  second.flow.pathNodes = [createPathNode("reused-node", "Second path")];
  second.flow.currentPathNodeId = "reused-node";
  const repository = new ConstructProjectRepository(paths, storage, domainStorage);

  await repository.writeAll([first, second]);

  const reloadedFirst = await repository.readOne("path-flow-one");
  const reloadedSecond = await repository.readOne("path-flow-two");
  assert.equal(reloadedFirst && reloadedFirst.kind === "flow" ? reloadedFirst.flow.pathNodes?.[0]?.id : null, "reused-node");
  assert.equal(reloadedSecond && reloadedSecond.kind === "flow" ? reloadedSecond.flow.pathNodes?.[0]?.id : null, "reused-node");
  assert.equal(readTableCount(paths.storageDatabasePath, "construct_flow_path_nodes"), 2);

  domainStorage.close();
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

function createPathNode(id: string, title: string) {
  const now = "2026-06-25T00:00:00.000Z";
  return {
    id,
    title,
    summary: title,
    status: "active" as const,
    order: 0,
    createdAt: now,
    updatedAt: now
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

function readTableCount(databasePath: string, table: string): number {
  let db: NodeDatabaseSync | null = null;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
  } finally {
    db?.close();
  }
}
