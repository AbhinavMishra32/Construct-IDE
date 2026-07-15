import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ConstructFlowPracticeTask,
  ConstructFlowSession,
} from "../../../shared/constructFlow";
import {
  AsideRunProjector,
  answerFromAsideSuspensionResponse,
  buildAsideMessages,
  buildAsideSession,
  questionResultTextFromAsideSuspensionResponse,
} from "./asideThreadProtocol";

const createdAt = "2026-07-15T08:00:00.000Z";

describe("Aside thread protocol", () => {
  it("projects Construct tasks and pending questions into the compiled session contract", () => {
    const task = practiceTask();
    const session = flowSession({
      status: "waiting",
      practiceTasks: [task],
      toolCalls: [{
        id: "question-1",
        name: "ask-question",
        title: "Ask learner",
        reason: "Need an architectural choice",
        input: { question: "Which renderer should own the loop?", choices: ["Canvas", "WebGL"] },
        status: "completed",
        createdAt,
        completedAt: createdAt,
      }],
    });

    const projected = buildAsideSession({
      projectId: "project-1",
      projectTitle: "Game engine",
      workspacePath: "/tmp/game-engine",
      sessions: [session],
      provider: "openai",
      model: "gpt-5.5",
      thinkingLevel: "high",
    });
    const toolState = projected.toolState as {
      todo: { todos: Array<Record<string, unknown>> };
      question: Record<string, unknown>;
    };

    assert.equal(projected.title, "Game engine");
    assert.equal(projected.status, "suspended");
    assert.deepEqual(projected.suspension, {
      kind: "ask-user-question",
      toolCallId: "question-1",
      createdAt,
      request: {
        questions: [{
          header: "Your choice",
          question: "Which renderer should own the loop?",
          options: [
            { label: "Canvas", description: "Answer with “Canvas”." },
            { label: "WebGL", description: "Answer with “WebGL”." },
          ],
          multiple: false,
          custom: true,
        }],
      },
    });
    assert.deepEqual(toolState.todo.todos, [{
      id: "subtask-1",
      content: "Implement the accumulator",
      status: "in_progress",
      taskId: "task-1",
    }]);
    assert.deepEqual(toolState.question, {
      questions: [{
        header: "Your choice",
        question: "Which renderer should own the loop?",
        options: [
          { label: "Canvas", description: "Answer with “Canvas”." },
          { label: "WebGL", description: "Answer with “WebGL”." },
        ],
        multiple: false,
        custom: true,
      }],
      toolCallId: "question-1",
    });
  });

  it("uses Aside's native question suspension and answer result contract", () => {
    const pending = flowSession({
      status: "waiting",
      toolCalls: [{
        id: "question-1",
        name: "ask_user_question",
        title: "Ask learner",
        reason: "Need a renderer choice",
        input: { question: "Pick a renderer", choices: ["Canvas", "WebGL"] },
        status: "completed",
        createdAt,
        completedAt: createdAt,
      }],
      timeline: [{
        id: "question-1",
        kind: "tool",
        toolCallId: "question-1",
        name: "ask_user_question",
        title: "Ask learner",
        status: "completed",
        input: { question: "Pick a renderer", choices: ["Canvas", "WebGL"] },
        createdAt,
        completedAt: createdAt,
      }],
    });

    const pendingMessages = buildAsideMessages([pending], undefined, "openai", "gpt-5.5");
    const pendingAssistant = pendingMessages.find((message) => message.role === "assistant");
    assert.ok(pendingAssistant && pendingAssistant.role === "assistant");
    assert.deepEqual(pendingAssistant.content[0], {
      type: "toolCall",
      id: "question-1",
      name: "ask_user_question",
      arguments: {
        question: "Pick a renderer",
        choices: ["Canvas", "WebGL"],
        questions: [{
          header: "Your choice",
          question: "Pick a renderer",
          options: [
            { label: "Canvas", description: "Answer with “Canvas”." },
            { label: "WebGL", description: "Answer with “WebGL”." },
          ],
          multiple: false,
          custom: true,
        }],
      },
    });
    assert.equal(pendingMessages.some((message) => message.role === "toolResult"), false);

    const response = { answers: [{ header: "Your choice", answer: "custom: WebGPU" }] };
    assert.equal(answerFromAsideSuspensionResponse(response), "WebGPU");
    assert.equal(
      questionResultTextFromAsideSuspensionResponse(response),
      "Asked user 1 question(s)\nUser responses to asked questions:\n- Your choice: custom: WebGPU",
    );
  });

  it("projects Construct internet research through Aside's native web search renderer", () => {
    const session = flowSession({
      status: "completed",
      timeline: [{
        id: "search-1",
        kind: "tool",
        toolCallId: "search-1",
        name: "internet-search",
        title: "Searched web",
        status: "completed",
        input: { query: "fixed timestep", limit: 2 },
        outputPreview: JSON.stringify([{
          sourceId: "source-mdn",
          title: "Animation timing",
          url: "https://developer.mozilla.org/example",
          snippet: "A current primary-source result.",
        }]),
        createdAt,
        completedAt: createdAt,
      }],
    });

    const messages = buildAsideMessages([session], undefined, "openai", "gpt-5.5");
    const assistant = messages.find((message) => message.role === "assistant");
    const result = messages.find((message) => message.role === "toolResult");
    assert.ok(assistant && assistant.role === "assistant");
    assert.deepEqual(assistant.content[0], {
      type: "toolCall",
      id: "search-1",
      name: "websearch",
      arguments: { query: "fixed timestep", limit: 2, objective: "fixed timestep" },
    });
    assert.ok(result && result.role === "toolResult");
    assert.equal(result.toolName, "websearch");
    const payload = JSON.parse(result.content[0].text) as { results: Array<{ source_id: string }> };
    assert.equal(payload.results[0]?.source_id, "source-mdn");
    assert.deepEqual(result.details.sources, [{
      id: "source-mdn",
      url: "https://developer.mozilla.org/example",
      title: "Animation timing",
      publishDate: null,
      excerpt: "A current primary-source result.",
    }]);
  });

  it("maps Construct concept tools and their results into native chat messages", () => {
    const session = flowSession({
      status: "completed",
      messages: [{ id: "user-1", role: "user", content: "Teach fixed timesteps", createdAt }],
      timeline: [
        {
          id: "reasoning-1",
          kind: "reasoning",
          status: "completed",
          title: "Thought",
          text: "Start with determinism.",
          createdAt,
        },
        {
          id: "concept-1",
          kind: "tool",
          toolCallId: "concept-call-1",
          name: "add-concept",
          title: "Record concept",
          status: "completed",
          input: { id: "fixed-timestep", title: "Fixed timestep", language: "typescript" },
          outputPreview: JSON.stringify({ id: "fixed-timestep", summary: "A stable simulation interval.", masteryLevel: "L1" }),
          createdAt,
          completedAt: createdAt,
        },
        {
          id: "message-1",
          kind: "message",
          status: "completed",
          text: "The concept is recorded.",
          createdAt,
        },
      ],
    });

    const messages = buildAsideMessages([session], undefined, "openai", "gpt-5.5");
    const assistant = messages.find((message) => message.role === "assistant");
    const toolResult = messages.find((message) => message.role === "toolResult");

    assert.ok(assistant && assistant.role === "assistant");
    assert.deepEqual(assistant.content[1], {
      type: "toolCall",
      id: "concept-call-1",
      name: "construct_concept",
      arguments: {
        id: "fixed-timestep",
        title: "Fixed timestep",
        language: "typescript",
        conceptId: "fixed-timestep",
        summary: "A stable simulation interval.",
        masteryLevel: "L1",
      },
    });
    assert.ok(toolResult && toolResult.role === "toolResult");
    assert.equal(toolResult.toolName, "construct_concept");
    assert.equal(toolResult.details.constructKind, "concept");
  });

  it("streams live Construct snapshots as ordered Pi-compatible envelopes", () => {
    const envelopes: Array<Record<string, unknown>> = [];
    const projector = new AsideRunProjector((value) => envelopes.push(value), "openai", "gpt-5.5");
    projector.start("Explain the loop");
    projector.project(flowSession({
      status: "running",
      timeline: [{
        id: "reply-1",
        kind: "message",
        status: "running",
        text: "A fixed",
        createdAt,
      }],
    }));
    projector.project(flowSession({
      status: "completed",
      timeline: [{
        id: "reply-1",
        kind: "message",
        status: "completed",
        text: "A fixed timestep is deterministic.",
        createdAt,
        updatedAt: createdAt,
      }],
    }));

    const eventTypes = envelopes.map((envelope) => (envelope.event as { type: string }).type);
    const assistantEventTypes = envelopes.flatMap((envelope) => {
      const event = envelope.event as { assistantMessageEvent?: { type?: string } };
      return event.assistantMessageEvent?.type ? [event.assistantMessageEvent.type] : [];
    });
    const sequences = envelopes.map((envelope) => envelope.seq);
    assert.deepEqual(sequences, sequences.map((_, index) => index));
    assert.deepEqual(eventTypes.slice(0, 3), ["agent_start", "message_start", "message_end"]);
    assert.ok(assistantEventTypes.includes("text_start"));
    assert.equal(assistantEventTypes.filter((type) => type === "text_delta").length, 2);
    assert.ok(assistantEventTypes.includes("text_end"));
    assert.deepEqual(eventTypes.slice(-2), ["message_end", "agent_end"]);
  });

  it("resumes a suspended native question with its tool result before continuation output", () => {
    const envelopes: Array<Record<string, unknown>> = [];
    const projector = new AsideRunProjector((value) => envelopes.push(value), "openai", "gpt-5.5");
    projector.resumeQuestion(
      "question-1",
      "Asked user 1 question(s)\nUser responses to asked questions:\n- Your choice: WebGL",
    );

    const events = envelopes.map((envelope) => envelope.event as Record<string, unknown>);
    assert.equal(events[0]?.type, "agent_start");
    assert.deepEqual(events[1], {
      type: "tool_execution_end",
      toolCallId: "question-1",
      toolName: "ask_user_question",
      result: {
        content: [{
          type: "text",
          text: "Asked user 1 question(s)\nUser responses to asked questions:\n- Your choice: WebGL",
        }],
        details: { constructKind: "tool" },
      },
      isError: false,
    });
    const toolResult = (events.find((event) => event.type === "message_start")?.message ?? {}) as { role?: string; toolCallId?: string };
    assert.equal(toolResult.role, "toolResult");
    assert.equal(toolResult.toolCallId, "question-1");
  });
});

function flowSession(overrides: Partial<ConstructFlowSession> = {}): ConstructFlowSession {
  return {
    id: "session-1",
    projectId: "project-1",
    threadId: "thread-1",
    messages: [],
    status: "running",
    toolCalls: [],
    agentEvents: [],
    timeline: [],
    actions: [],
    practiceTasks: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function practiceTask(): ConstructFlowPracticeTask {
  return {
    id: "task-1",
    projectId: "project-1",
    sessionId: "session-1",
    title: "Build the game loop",
    prompt: "Implement a fixed-timestep accumulator.",
    status: "waiting",
    baseline: { capturedAt: createdAt, files: {} },
    subtasks: [{
      id: "subtask-1",
      title: "Implement the accumulator",
      prompt: "Add the accumulator loop.",
      status: "active",
    }],
    createdAt,
  };
}
