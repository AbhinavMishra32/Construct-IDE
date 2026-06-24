import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConstructFlowSession, ConstructFlowSessionEvent } from "../../shared/constructFlow";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
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
