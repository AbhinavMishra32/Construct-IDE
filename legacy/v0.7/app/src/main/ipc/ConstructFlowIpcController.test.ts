import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConstructFlowIpcController, applyFlowSessionSnapshot } from "./ConstructFlowIpcController";
import type { ConstructFlowAgentResult, ConstructFlowSession, ConstructFlowSessionEvent } from "../../shared/constructFlow";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import {
  applyLiveFlowProjectSnapshot,
  forgetFlowProjectSnapshot,
  mergeFlowProjectSnapshot,
  rememberFlowProjectSnapshot
} from "../flow/ConstructFlowProjectSnapshotStore";

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

  it("returns Flow run results before slow post-run project persistence finishes", async () => {
    const project = flowProject("fast-unlock");
    const completedSession = flowSession(project, "session-1", "completed", "Done.");
    const result: ConstructFlowAgentResult = {
      session: completedSession,
      reply: "Done.",
      actions: []
    };
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const writeStarted = createDeferred<void>();
    const slowWrite = createDeferred<void>();
    const controller = new ConstructFlowIpcController({
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }
      } as any,
      readSettings: async () => ({}) as any,
      readProject: async () => project,
      readProjectSummaries: async () => [],
      writeProject: async () => {
        writeStarted.resolve();
        await slowWrite.promise;
      },
      workspace: {} as any,
      flowMemory: {} as any,
      flow: {
        runMainAgent: async (_project: StoredFlowProject, _input: unknown, onSessionEvent?: (event: ConstructFlowSessionEvent) => void) => {
          onSessionEvent?.(event(project, "completed", completedSession));
          return result;
        }
      } as any,
      workspacePathForProject: (projectId: string) => `/tmp/${projectId}`,
      setActiveWebContents: () => {},
      getAppSourceRoot: () => "/tmp"
    });
    controller.register();

    const runAgent = handlers.get("construct:flow:run-agent");
    assert.ok(runAgent);
    let settled = false;
    let settledValue: unknown;
    const invocation = runAgent({
      sender: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => sentEvents.push({ channel, payload })
      }
    }, { projectId: project.id, message: "continue" }).then((value) => {
      settled = true;
      settledValue = value;
      return value;
    });

    try {
      await writeStarted.promise;
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(settled, true);
      assert.deepEqual(settledValue, result);
      assert.equal(sentEvents.some((entry) => entry.channel === "construct:flow:session-event"), true);
    } finally {
      slowWrite.resolve();
    }

    await invocation;
  });

  it("starts the main mentor after research-first project creation completes", async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const mainStarted = createDeferred<unknown>();
    const controller = new ConstructFlowIpcController({
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }
      } as any,
      readSettings: async () => ({ workspaceRoot: "/tmp/construct-workspace" }) as any,
      readProject: async () => null,
      readProjectSummaries: async () => [],
      writeProject: async () => {},
      workspace: {
        isInsidePath: () => false
      } as any,
      flowMemory: {
        ensure: async () => {}
      } as any,
      flow: {
        runResearchAgent: async (project: StoredFlowProject, onSessionEvent?: (event: ConstructFlowSessionEvent) => void) => {
          const session = {
            ...flowSession(project, "research-session", "completed", "Research saved."),
            threadId: `${project.flow.threadId}:research`
          };
          onSessionEvent?.(event(project, "completed", session));
          return {
            session,
            reply: "Research saved.",
            actions: []
          } satisfies ConstructFlowAgentResult;
        },
        runMainAgent: async (project: StoredFlowProject, input: unknown, onSessionEvent?: (event: ConstructFlowSessionEvent) => void) => {
          const session = {
            ...flowSession(project, "mentor-session", "completed", "Hello, let's begin."),
            origin: "system" as const
          };
          onSessionEvent?.(event(project, "completed", session));
          mainStarted.resolve(input);
          return {
            session,
            reply: "Hello, let's begin.",
            actions: []
          } satisfies ConstructFlowAgentResult;
        }
      } as any,
      workspacePathForProject: (projectId: string) => `/tmp/${projectId}`,
      setActiveWebContents: () => {},
      getAppSourceRoot: () => "/tmp/source"
    });
    controller.register();

    const createFlow = handlers.get("construct:flow:create");
    assert.ok(createFlow);
    const project = await createFlow({
      sender: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => sentEvents.push({ channel, payload })
      }
    }, {
      title: "Research Chain",
      goal: "Learn rendering architecture",
      researchFirst: true
    }) as StoredFlowProject;
    const mainInput = await mainStarted.promise as { message?: string; startReason?: string };

    assert.equal(project.flow.researchEnabled, true);
    assert.equal(mainInput.startReason, "new-project");
    assert.match(mainInput.message ?? "", /after research completed/);
    assert.match(mainInput.message ?? "", /Greet the learner briefly/);
    assert.equal(sentEvents.some((entry) => entry.channel === "construct:flow:session-event"), true);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => promiseResolve(value as T | PromiseLike<T>);
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

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
