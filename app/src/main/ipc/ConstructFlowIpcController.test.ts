import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConstructFlowSession, ConstructFlowSessionEvent } from "../../shared/constructFlow";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import {
  applyLiveFlowProjectSnapshot,
  forgetFlowProjectSnapshot,
  mergeFlowProjectSnapshot,
  rememberFlowProjectSnapshot
} from "../flow/ConstructFlowProjectSnapshotStore";
import { applyFlowSessionSnapshot } from "./ConstructFlowIpcController";

describe("ConstructFlowIpcController", () => {
  it("upserts live Flow session snapshots into the persisted project", () => {
    const project = flowProject("persisted-chat");
    const first = flowSession(project, "session-1", "running", "Starting");
    const updated = {
      ...flowSession(project, "session-1", "waiting", "I will wait for your answer."),
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I will wait for your answer.",
          createdAt: "2026-06-24T05:00:01.000Z"
        }
      ],
      timeline: [{
        id: "session-1:question",
        kind: "tool",
        toolCallId: "ask-question-1",
        name: "ask-question",
        title: "Asked learner",
        status: "completed",
        createdAt: "2026-06-24T05:00:01.000Z"
      }]
    } satisfies ConstructFlowSession;

    applyFlowSessionSnapshot(project, event(project, "started", first));
    applyFlowSessionSnapshot(project, event(project, "waiting", updated));

    assert.equal(project.flow.sessions.length, 1);
    assert.equal(project.flow.sessions[0]?.status, "waiting");
    assert.equal(project.flow.sessions[0]?.messages[0]?.content, "I will wait for your answer.");
    assert.equal(project.flow.sessions[0]?.timeline[0]?.kind, "tool");
    assert.equal(project.flow.updatedAt, updated.updatedAt);
  });

  it("marks persisted research snapshots as completed", () => {
    const project = flowProject("research-chat");
    const research = {
      ...flowSession(project, "research-session", "completed", "Research saved."),
      threadId: `${project.flow.threadId}:research`
    } satisfies ConstructFlowSession;

    applyFlowSessionSnapshot(project, event(project, "completed", research));

    assert.equal(project.flow.researchEnabled, true);
    assert.equal(project.flow.researchCompletedAt, research.updatedAt);
    assert.equal(project.flow.sessions[0]?.threadId, `${project.flow.threadId}:research`);
  });

  it("merges answered question snapshots without letting stale waiting sessions win", () => {
    const persisted = flowProject("question-race");
    const waiting = {
      ...flowSession(persisted, "question-session", "waiting", "I will wait for your answer."),
      toolCalls: [{
        id: "ask-question-1",
        name: "ask-question",
        title: "Ask learner",
        reason: "Need learner input.",
        input: { question: "Which package manager should Flow use?" },
        status: "completed" as const,
        createdAt: "2026-06-24T05:00:01.000Z",
        completedAt: "2026-06-24T05:00:02.000Z"
      }]
    } satisfies ConstructFlowSession;
    persisted.flow.sessions = [waiting];
    persisted.flow.updatedAt = "2026-06-24T05:00:02.000Z";

    const live = flowProject("question-race");
    live.flow.sessions = [{
      ...waiting,
      status: "completed",
      updatedAt: "2026-06-24T05:00:03.000Z",
      toolCalls: [{
        ...waiting.toolCalls[0],
        response: {
          sessionId: "question-session",
          toolCallId: "ask-question-1",
          question: "Which package manager should Flow use?",
          answer: "pnpm",
          answeredAt: "2026-06-24T05:00:03.000Z"
        }
      }]
    }];
    live.flow.updatedAt = "2026-06-24T05:00:03.000Z";

    const merged = mergeFlowProjectSnapshot(persisted, live);

    assert.equal(merged.flow.sessions.length, 1);
    assert.equal(merged.flow.sessions[0]?.status, "completed");
    assert.equal(merged.flow.sessions[0]?.toolCalls[0]?.response?.answer, "pnpm");
    assert.equal(merged.flow.updatedAt, "2026-06-24T05:00:03.000Z");
  });

  it("hydrates project opens from live Flow snapshots while preserving shell fields", () => {
    const project = flowProject("live-open");
    project.activeFilePath = "src/current.ts";
    project.lastOpenedAt = "2026-06-24T05:00:04.000Z";
    project.flow.updatedAt = "2026-06-24T05:00:02.000Z";

    const live = flowProject("live-open");
    live.activeFilePath = "src/stale.ts";
    live.flow.updatedAt = "2026-06-24T05:00:05.000Z";
    live.flow.sessions = [flowSession(project, "latest-session", "completed", "Latest Flow turn.")];
    rememberFlowProjectSnapshot(live);

    const hydrated = applyLiveFlowProjectSnapshot(project);
    forgetFlowProjectSnapshot(project.id);

    assert.equal(hydrated.activeFilePath, "src/current.ts");
    assert.equal(hydrated.lastOpenedAt, "2026-06-24T05:00:04.000Z");
    assert.equal(hydrated.flow.updatedAt, "2026-06-24T05:00:05.000Z");
    assert.equal(hydrated.flow.sessions[0]?.id, "latest-session");
  });
});

function event(
  project: StoredFlowProject,
  type: ConstructFlowSessionEvent["type"],
  session: ConstructFlowSession
): ConstructFlowSessionEvent {
  return {
    projectId: project.id,
    type,
    session
  };
}

function flowSession(
  project: StoredFlowProject,
  id: string,
  status: ConstructFlowSession["status"],
  text: string
): ConstructFlowSession {
  return {
    id,
    projectId: project.id,
    threadId: project.flow.threadId,
    messages: text
      ? [{
          id: `${id}:message`,
          role: "assistant",
          content: text,
          createdAt: "2026-06-24T05:00:00.000Z"
        }]
      : [],
    status,
    toolCalls: [],
    agentEvents: [],
    timeline: [],
    actions: [],
    practiceTasks: [],
    createdAt: "2026-06-24T05:00:00.000Z",
    updatedAt: "2026-06-24T05:00:02.000Z"
  };
}

function flowProject(id: string): StoredFlowProject {
  return {
    kind: "flow",
    id,
    title: id,
    description: "A Flow project",
    progress: 0,
    lastOpenedAt: "2026-06-24T05:00:00.000Z",
    workspacePath: `/tmp/${id}`,
    sourcePath: null,
    activeFilePath: null,
    fileTreeExpanded: [],
    completedAt: null,
    flow: {
      goal: "Keep chat persisted",
      memoryDirectory: ".construct",
      threadId: `${id}-thread`,
      researchEnabled: false,
      researchCompletedAt: null,
      sessions: [],
      createdAt: "2026-06-24T05:00:00.000Z",
      updatedAt: "2026-06-24T05:00:00.000Z"
    }
  };
}
