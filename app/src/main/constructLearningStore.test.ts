import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

import { createConstructDataPaths } from "./config/constructConfig";
import { ConstructLearningStore } from "./constructLearningStore";
import { createConstructDomainStorage } from "./storage/ConstructDomainStorage";
import { createConstructStorageService } from "./storage/storage";

const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");

describe("ConstructLearningStore", () => {
  it("records knowledge, opens, recall attempts, and weak concepts in one state file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));

    await store.saveKnowledgeConcept({
      id: "sandbox.runtime",
      sourceProjectId: "project-a",
      sourceProjectTitle: "Project A",
      title: "Sandbox runtime",
      kind: "concept",
      tags: ["runtime"],
      summary: "A resumable workspace.",
      why: "It keeps execution state explicit.",
      docs: [],
      savedAt: "2026-06-12T00:00:00.000Z",
      openCount: 0,
      usedInRecall: false
    });

    await store.openKnowledgeConcept({
      id: "sandbox.runtime",
      sourceProjectId: "project-a",
      sourceProjectTitle: "Project A",
      title: "Sandbox runtime",
      kind: "concept",
      tags: ["runtime"],
      summary: "A resumable workspace.",
      why: "It keeps execution state explicit.",
      docs: [],
      savedAt: "2026-06-12T00:00:00.000Z",
      openCount: 0,
      usedInRecall: false
    });

    await store.recordRecallAttempt({
      id: "attempt-1",
      projectId: "project-a",
      recallId: "recall-runtime",
      mode: "reply",
      answer: "The runtime depends on a provider contract.",
      passed: false,
      status: "almost",
      confidence: "medium",
      conceptIds: ["sandbox.runtime"],
      createdAt: "2026-06-12T00:00:01.000Z"
    });

    const state = await store.getState();
    assert.equal(state.knowledgeBase.concepts["project-a:sandbox.runtime"]?.openCount, 1);
    assert.equal(state.projects["project-a"]?.recallAttempts.length, 1);
    assert.equal(state.learner.globalConceptUnderstanding["sandbox.runtime"]?.confidence, "weak");
    assert.equal((await store.getWeakConcepts("project-a"))[0]?.conceptId, "sandbox.runtime");

    await store.removeKnowledgeConcept("project-a", "sandbox.runtime");
    assert.equal((await store.getState()).knowledgeBase.concepts["project-a:sandbox.runtime"], undefined);
  });

  it("persists learning concepts and attempts as domain rows", async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-domain-"));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const paths = createConstructDataPaths(dir);
    const storage = createConstructStorageService(paths.storageDatabasePath, {
      flushDelayMs: 10_000,
      periodicFlushIntervalMs: 60_000
    });
    const domainStorage = createConstructDomainStorage(paths.storageDatabasePath);
    await storage.initialize();
    await domainStorage.initialize();

    const store = new ConstructLearningStore({
      storage,
      domainStorage,
      legacyPath: paths.learningStatePath
    });

    await store.saveKnowledgeConcept({
      id: "sqlite.rows",
      sourceProjectId: "project-db",
      sourceProjectTitle: "Project DB",
      title: "SQLite rows",
      kind: "concept",
      tags: ["storage"],
      summary: "Sessions and concepts are stored as rows.",
      why: "Append/update rows avoid rewriting the whole learning state.",
      docs: [],
      savedAt: "2026-06-12T00:00:00.000Z",
      openCount: 0,
      usedInRecall: false
    });

    await store.recordRecallAttempt({
      id: "attempt-db-1",
      projectId: "project-db",
      recallId: "recall-db",
      mode: "reply",
      answer: "Store the mutable parts as indexed rows.",
      passed: false,
      status: "almost",
      confidence: "medium",
      conceptIds: ["sqlite.rows"],
      createdAt: "2026-06-12T00:00:01.000Z"
    });

    const state = await store.getState();
    assert.equal(state.knowledgeBase.concepts["project-db:sqlite.rows"]?.title, "SQLite rows");
    assert.equal(state.projects["project-db"]?.recallAttempts.length, 1);
    assert.equal(state.learner.globalConceptUnderstanding["sqlite.rows"]?.confidence, "weak");
    await storage.flush();

    assert.equal(readStorageValue(paths.storageDatabasePath, "construct.learningState"), null);
    assert.equal(readTableCount(paths.storageDatabasePath, "construct_knowledge_concepts"), 1);
    assert.equal(readTableCount(paths.storageDatabasePath, "construct_project_recall_attempts"), 1);
    assert.equal(readTableCount(paths.storageDatabasePath, "construct_project_concept_understanding"), 1);

    domainStorage.close();
    await storage.close();
  });

  it("persists the full agent trace with each Construct Interact turn", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-interact-trace-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));

    await store.recordConstructInteractAttempt({
      id: "session-1",
      projectId: "project-a",
      blockId: "interact-1",
      prompt: "Explain the boundary.",
      answer: "I am not sure.",
      status: "almost",
      confidence: "medium",
      reply: "Let's inspect the exact source.",
      coveredConceptIds: [],
      missingConceptIds: ["disk.sector"],
      assistanceLevel: "guided",
      createdAt: "2026-06-15T00:00:00.000Z",
      durationMs: 1_250,
      toolCalls: [{
        id: "getCurrentStep-1",
        name: "getCurrentStep",
        reason: "Read the authored step.",
        input: {},
        outputPreview: "Step text",
        createdAt: "2026-06-15T00:00:00.100Z"
      }],
      agentEvents: [{
        id: "event-1",
        type: "tool",
        status: "completed",
        title: "getCurrentStep",
        detail: "Read the authored step.",
        toolName: "getCurrentStep",
        input: {},
        outputPreview: "Step text",
        createdAt: "2026-06-15T00:00:00.100Z"
      }]
    });

    const session = (await store.getState()).projects["project-a"]?.constructInteractSessions[0];
    assert.equal(session?.durationMs, 1_250);
    assert.equal(session?.agentEvents?.[0]?.toolName, "getCurrentStep");
    assert.equal(session?.agentEvents?.[0]?.outputPreview, "Step text");
  });

  it("upserts live Construct Interact sessions without duplicating a run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-interact-upsert-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));

    await store.upsertConstructInteractSession({
      id: "session-live",
      threadId: "lesson:interact-1",
      mode: "lesson-check",
      projectId: "project-a",
      blockId: "interact-1",
      prompt: "Explain the boundary.",
      answer: "It stores state.",
      status: "continue",
      confidence: "low",
      reply: "",
      coveredConceptIds: [],
      missingConceptIds: [],
      assistanceLevel: "none",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
      runStatus: "running",
      toolCalls: [],
      agentEvents: []
    });

    await store.recordConstructInteractAttempt({
      id: "session-live",
      threadId: "lesson:interact-1",
      mode: "lesson-check",
      projectId: "project-a",
      blockId: "interact-1",
      prompt: "Explain the boundary.",
      answer: "It stores state.",
      status: "pass",
      confidence: "high",
      reply: "Exactly: the session state is the canonical source.",
      coveredConceptIds: ["session.state"],
      missingConceptIds: [],
      assistanceLevel: "none",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:02.000Z",
      runStatus: "completed",
      toolCalls: [],
      agentEvents: []
    });

    const sessions = (await store.getState()).projects["project-a"]?.constructInteractSessions ?? [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.status, "pass");
    assert.equal(sessions[0]?.runStatus, "completed");
    assert.equal(sessions[0]?.reply, "Exactly: the session state is the canonical source.");
  });

  it("persists generated live steps and status changes without mutating authored tape source", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-live-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const authoredSource = `@construct spec="tape-0.4"\n# Static tape stays clean\n`;

    await store.applyPatch({
      generatedLiveSteps: {
        projectId: "project-a",
        steps: [
          {
            id: "live-1",
            projectId: "project-a",
            source: "construct-interact",
            sourceBlockId: "interact-1",
            sourceStepId: "step-2",
            sourceRunId: "run-1",
            insertAfterStepId: "step-2",
            title: "Review runtime validation",
            reason: "The learner missed the prerequisite concept.",
            status: "pending",
            blocks: [
              {
                kind: "explain",
                id: "live-1-explain",
                content: "Runtime validation checks values as they cross trust boundaries.",
                concepts: ["runtime.validation"]
              }
            ],
            conceptIds: ["runtime.validation"],
            createdAt: "2026-06-13T00:00:00.000Z",
            updatedAt: "2026-06-13T00:00:00.000Z"
          }
        ],
        run: {
          id: "run-1",
          source: "construct-interact",
          sourceBlockId: "interact-1",
          sourceStepId: "step-2",
          generatedStepIds: ["live-1"],
          actions: [
            {
              type: "create-live-steps",
              stepIds: ["live-1"],
              label: "Review generated live step",
              reason: "Focused remediation is useful here."
            }
          ],
          toolCalls: [
            {
              id: "getCurrentStep-1",
              name: "getCurrentStep",
              reason: "Anchor to current authored step.",
              createdAt: "2026-06-13T00:00:00.000Z"
            }
          ],
          validation: [
            {
              draftTitle: "Review runtime validation",
              stepId: "live-1",
              status: "accepted",
              reason: "Accepted safe generated live step draft.",
              createdAt: "2026-06-13T00:00:00.000Z"
            }
          ],
          createdAt: "2026-06-13T00:00:00.000Z"
        }
      }
    });

    let state = await store.getState();
    assert.equal(state.projects["project-a"]?.generatedLiveSteps.length, 1);
    assert.equal(state.projects["project-a"]?.generatedLiveStepRuns[0]?.toolCalls[0]?.name, "getCurrentStep");

    state = await store.applyPatch({
      generatedLiveStepStatus: {
        projectId: "project-a",
        stepId: "live-1",
        status: "completed",
        updatedAt: "2026-06-13T00:01:00.000Z"
      }
    });
    assert.equal(state.projects["project-a"]?.generatedLiveSteps[0]?.status, "completed");

    state = await store.applyPatch({
      generatedLiveStepStatus: {
        projectId: "project-a",
        stepId: "live-1",
        status: "dismissed",
        updatedAt: "2026-06-13T00:02:00.000Z"
      }
    });
    assert.equal(state.projects["project-a"]?.generatedLiveSteps[0]?.status, "dismissed");
    assert.equal(authoredSource, `@construct spec="tape-0.4"\n# Static tape stays clean\n`);
  });

  it("tracks opens for unsaved concepts independently from the knowledge base", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-learning-concept-open-"));
    const store = new ConstructLearningStore(path.join(dir, "learning-state.json"));

    await store.recordConceptOpen({
      projectId: "project-a",
      conceptId: "disk.sector",
      title: "Sector 0 is a byte-level contract"
    });
    await store.recordConceptOpen({
      projectId: "project-a",
      conceptId: "disk.sector",
      title: "Sector 0 is a byte-level contract"
    });

    const state = await store.getState();
    const engagement = state.projects["project-a"]?.conceptEngagement["disk.sector"];
    assert.equal(engagement?.openCount, 2);
    assert.ok(engagement?.firstOpenedAt);
    assert.ok(engagement?.lastOpenedAt);
    assert.equal(state.knowledgeBase.concepts["project-a:disk.sector"], undefined);
    assert.equal(state.projects["project-a"]?.assistanceEvents.filter((event) => event.kind === "concept-open").length, 2);
  });
});

function readStorageValue(databasePath: string, key: string): string | null {
  let db: NodeDatabaseSync | null = null;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare("SELECT value FROM storage_items WHERE scope = 'application' AND key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
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
