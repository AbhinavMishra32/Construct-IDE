import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ConstructFlowService } from "./ConstructFlowService";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import { ConstructFlowMemoryService } from "./ConstructFlowMemoryService";
import { AgentLogService } from "../ai/AgentLogService";
import { ConstructLearningStore } from "../constructLearningStore";
import { createConstructProtocolTools } from "../agent-tools/constructProtocolTools";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import type { ConstructFlowSession } from "../../shared/constructFlow";

describe("ConstructFlowService Concept and Task Tools", () => {
  it("executes add-concept, modify-concept, and remove-concept tools and verifies hierarchical behavior", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-"));
    const learningStorePath = path.join(dir, "learning-state.json");
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });

    const learningStore = new ConstructLearningStore(learningStorePath);
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});

    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore
    });

    const project: StoredFlowProject = {
      kind: "flow",
      id: "test-project",
      title: "Notes App Test Project",
      description: "A SwiftUI NotesApp test project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "test-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Build a SwiftUI notes app",
        memoryDirectory: ".construct/flow-memory",
        threadId: "test-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    await mkdir(project.workspacePath, { recursive: true });

    const protocol = createConstructProtocolTools({
      project,
      workspace,
      flowMemory,
      allowWorkspaceMutation: true,
      allowTerminalCommands: true
    });
    assert.ok(protocol.tools["ask-question"]);
    assert.ok(protocol.tools.askQuestion);
    assert.ok(protocol.tools.internetSearch);
    assert.ok(protocol.tools["internet-fetch"]);
    assert.ok(protocol.tools.internetFetch);

    const session: ConstructFlowSession = {
      id: "session-1",
      projectId: project.id,
      threadId: "thread-1",
      messages: [],
      status: "running",
      toolCalls: [],
      agentEvents: [],
      timeline: [],
      actions: [],
      practiceTasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    project.flow.pathNodes = [{
      id: "typescript-foundation",
      title: "TypeScript foundation",
      summary: "Learn interfaces before the first typed task.",
      status: "active",
      order: 0,
      concepts: ["typescript.syntax.interface"],
      taskIds: ["task-1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
    project.flow.currentPathNodeId = "typescript-foundation";
    session.practiceTasks.push({
      id: "task-1",
      projectId: project.id,
      sessionId: session.id,
      pathNodeId: "typescript-foundation",
      title: "Interface task",
      prompt: "Write a small interface.",
      status: "waiting",
      baseline: { capturedAt: new Date().toISOString(), files: {} },
      createdAt: new Date().toISOString(),
      taskFiles: ["src/user.ts"],
      conceptIds: ["typescript.syntax.interface"],
      introducedConceptIds: ["typescript.syntax.interface"]
    });
    project.flow.sessions.push(session);

    // 1. Test add-concept tool
    // We get the tools from createAddConceptTool
    const addTool = (service as any).createAddConceptTool(project, () => {});
    const addResult = await addTool.execute({
      id: "typescript.syntax.interface",
      title: "Interface",
      language: "typescript",
      technology: "TypeScript",
      content: "TypeScript interface defines shape.",
      examples: ["interface User { name: string; }"],
      confidence: "introduced",
      reason: "The learner asked about TypeScript interface shape.",
      evidence: ["The learner connected interface syntax to object shape in chat."],
      confidenceReason: "They correctly described the interface as a shape contract.",
      pathNodeId: "typescript-foundation",
      taskId: "task-1"
    });

    assert.ok(addResult.created);
    assert.equal(addResult.concept.id, "typescript.syntax.interface");
    assert.equal(addResult.concept.language, "typescript");
    assert.equal(addResult.concept.technology, "TypeScript");
    assert.equal(addResult.concept.parentId, "typescript.syntax");
    assert.equal(addResult.concept.confidenceReason, "They correctly described the interface as a shape contract.");
    const introducedHistory = addResult.concept.history?.at(-1);
    assert.equal(introducedHistory?.kind, "introduced");
    assert.ok(introducedHistory?.changedFields?.includes("content"));
    assert.equal(introducedHistory?.provenance?.projectId, project.id);
    assert.equal(introducedHistory?.provenance?.pathNodeTitle, "TypeScript foundation");
    assert.equal(introducedHistory?.provenance?.taskTitle, "Interface task");
    assert.deepEqual(introducedHistory?.provenance?.taskFiles, ["src/user.ts"]);

    const swiftResult = await addTool.execute({
      id: "swiftui.notesapp.core-structure",
      title: "SwiftUI core structure",
      language: "swift",
      technology: "SwiftUI",
      content: "SwiftUI core structure covers App, state, and the first view tree.",
      confidence: "unknown",
      reason: "The agent scaffolded the app and needs a reusable global concept.",
      evidence: ["The scaffold introduced the SwiftUI App entry point and first view tree."]
    });

    assert.ok(swiftResult.created);
    assert.equal(swiftResult.canonicalId, "swiftui.core-structure");
    assert.equal(swiftResult.normalizedFrom, "swiftui.notesapp.core-structure");
    assert.equal(swiftResult.concept.id, "swiftui.core-structure");
    assert.equal(swiftResult.concept.language, "swift");
    assert.equal(swiftResult.concept.technology, "SwiftUI");

    const fetchTool = (service as any).createFetchConceptsTool(project);
    const fetchResult = await fetchTool.execute({
      query: "SwiftUI core",
      includeContent: true
    });
    const fetchedSwiftConcept = fetchResult.concepts.find((concept: any) => concept.id === "swiftui.core-structure");
    assert.ok(fetchResult.count >= 1);
    assert.equal(fetchedSwiftConcept?.content, "SwiftUI core structure covers App, state, and the first view tree.");

    // Verify parent stubs auto-created
    const state = await learningStore.getState();
    assert.ok(state.knowledgeBase.concepts["test-project:typescript.syntax"]);
    assert.ok(state.knowledgeBase.concepts["test-project:typescript"]);
    assert.equal(state.knowledgeBase.concepts["test-project:typescript.syntax"]?.parentId, "typescript");
    assert.equal(state.knowledgeBase.concepts["test-project:typescript"]?.parentId, null);

    // 2. Test modify-concept tool
    const modifyTool = (service as any).createModifyConceptTool(project, () => {});
    const modifyResult = await modifyTool.execute({
      id: "typescript.syntax.interface",
      content: "TypeScript interface updated.",
      confidence: "solid",
      reason: "The learner used the interface in a task without hints.",
      evidence: ["Submitted diff added an interface with the correct required property."],
      confidenceReason: "The learner independently applied the concept in code.",
      taskId: "task-1"
    });

    assert.ok(modifyResult.modified);
    assert.equal(modifyResult.concept.content, "TypeScript interface updated.");
    assert.equal(modifyResult.concept.confidence, "solid");
    assert.equal(modifyResult.reason, "The learner used the interface in a task without hints.");
    assert.deepEqual(modifyResult.concept.history?.map((event: any) => event.kind), ["introduced", "modified"]);
    const modifiedHistory = modifyResult.concept.history?.at(-1);
    assert.equal(modifiedHistory?.kind, "modified");
    assert.ok(modifiedHistory?.changedFields?.includes("content"));
    assert.ok(modifiedHistory?.changedFields?.includes("confidence"));
    assert.equal(modifiedHistory?.provenance?.pathNodeTitle, "TypeScript foundation");
    assert.equal(modifiedHistory?.provenance?.taskTitle, "Interface task");
    const contentChange = modifiedHistory?.fieldChanges?.find((change: any) => change.field === "content");
    assert.equal(contentChange?.before, "TypeScript interface defines shape.");
    assert.equal(contentChange?.after, "TypeScript interface updated.");
    assert.ok(modifyResult.fieldChanges?.some((change: any) => change.field === "confidence"));

    // 3. Test remove-concept tool
    const removeTool = (service as any).createRemoveConceptTool(project, () => {});
    const removeResult = await removeTool.execute({
      id: "typescript.syntax.interface",
      reason: "The concept was merged into a parent concept.",
      evidence: ["The parent concept now contains the same explanation."]
    });

    assert.ok(removeResult.removed);
    const stateAfterRemove = await learningStore.getState();
    assert.equal(stateAfterRemove.knowledgeBase.concepts["test-project:typescript.syntax.interface"], undefined);
  });

  it("prepares files and captures scoped baseline in practice-task", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-task-"));
    const learningStorePath = path.join(dir, "learning-state.json");
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });

    const learningStore = new ConstructLearningStore(learningStorePath);
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});

    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore
    });

    const project: StoredFlowProject = {
      kind: "flow",
      id: "task-project",
      title: "Task Project",
      description: "A task project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "task-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Test goals",
        memoryDirectory: ".construct/flow-memory",
        threadId: "test-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    await mkdir(project.workspacePath, { recursive: true });

    const session: ConstructFlowSession = {
      id: "session-2",
      projectId: project.id,
      threadId: "thread-2",
      messages: [],
      status: "running",
      toolCalls: [],
      agentEvents: [],
      timeline: [],
      actions: [],
      practiceTasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    project.flow.sessions.push(session);

    const addTool = (service as any).createAddConceptTool(project, () => {});
    await addTool.execute({
      id: "typescript.functions",
      title: "TypeScript functions",
      language: "typescript",
      technology: "TypeScript",
      content: "A TypeScript function names a reusable behavior, accepts typed inputs, and returns a typed result.",
      examples: ["function greet(): string { return 'hello'; }"],
      confidence: "unknown",
      reason: "Introduce the function concept before assigning a function-writing task.",
      evidence: ["The task test seeds this as introduced learner knowledge before practice."]
    });

    // Pre-create another file that should not be in the baseline
    const ignoredFile = path.join(project.workspacePath, "ignored.ts");
    await writeFile(ignoredFile, "console.log('ignored');", "utf8");

    const pathTool = (service as any).createPlanLearningPathTool(project, () => {});
    const pathResult = await pathTool.execute({
      reason: "Create a first learner-aware path before assigning tasks.",
      currentNodeId: "typescript-foundation",
      nodes: [{
        id: "typescript-foundation",
        title: "TypeScript foundation",
        summary: "Practice small functions before wiring the project together.",
        kind: "foundation",
        learnerLevel: "beginner",
        concepts: ["typescript.functions"],
        status: "active",
        entryCriteria: ["Learner has selected TypeScript."],
        exitCriteria: ["Learner can write and submit a small function."]
      }]
    });

    assert.equal(pathResult.currentNodeId, "typescript-foundation");
    assert.equal(project.flow.currentPathNodeId, "typescript-foundation");
    assert.equal(project.flow.pathNodes?.[0]?.concepts?.[0], "typescript.functions");

    const taskTool = (service as any).createPracticeTaskTool(project, session, () => {});
    const taskResult = await taskTool.execute({
      title: "Task 1",
      prompt: "Implement greet function",
      taskFiles: ["src/greet.ts"],
      successCriteria: ["greet returns a string"],
      subtasks: [
        {
          title: "Return hello",
          prompt: "Make greet return hello.",
          successCriteria: ["The function returns 'hello'."]
        }
      ],
      guidance: [
        {
          title: "Write the return value",
          instruction: "Replace the empty greet body with a typed return value.",
          path: "src/greet.ts",
          line: 1,
          placeholder: "return 'hello';",
          subtaskTitle: "Return hello"
        }
      ],
      preparations: [
        {
          path: "src/greet.ts",
          content: "export function greet() {}",
          mode: "create"
        }
      ],
      introducedConceptIds: ["typescript.functions"],
      conceptIds: ["typescript.functions"]
    });

    assert.ok(taskResult.created);
    assert.deepEqual(taskResult.introducedConceptIds, ["typescript.functions"]);
    assert.ok(existsSync(path.join(project.workspacePath, "src/greet.ts")));

    const task = session.practiceTasks[0];
    assert.ok(task);
    assert.equal(task.pathNodeId, "typescript-foundation");
    assert.deepEqual(project.flow.pathNodes?.[0]?.taskIds, [task.id]);
    assert.deepEqual(task.taskFiles, ["src/greet.ts"]);
    assert.deepEqual(task.introducedConceptIds, ["typescript.functions"]);
    assert.equal(task.baseline.files["src/greet.ts"], "export function greet() {}");
    assert.equal(task.baseline.files["ignored.ts"], undefined);
    assert.equal(task.authoredBy?.actor, "agent");
    assert.equal(task.preparedFiles?.[0]?.authoredBy.actor, "agent");
    assert.equal(task.subtasks?.[0]?.status, "active");
    assert.equal(task.guidance?.[0]?.path, "src/greet.ts");
    assert.equal(task.guidance?.[0]?.line, 1);
    assert.equal(task.guidance?.[0]?.subtaskId, task.subtasks?.[0]?.id);

    const reviewTool = (service as any).createReviewSubtaskTool(project, () => {});
    await assert.rejects(
      () => reviewTool.execute({
        taskId: task.id,
        subtaskId: task.subtasks?.[0]?.id,
        outcome: "done",
        evidence: "Agent-created task setup is not learner evidence."
      }),
      /learner-authored task submission/
    );

    // Modify file and submit task
    await writeFile(path.join(project.workspacePath, "src/greet.ts"), "export function greet() { return 'hello'; }", "utf8");
    const submission = await service.submitPracticeTask(project, task.id, "Done!");

    assert.equal(submission.touchedFiles.length, 1);
    assert.equal(submission.touchedFiles[0], "src/greet.ts");
    assert.ok(submission.compactDiff.includes("return 'hello';"));
    assert.equal(submission.authoredBy?.actor, "learner");

    const afterSubmission = new Date(Date.parse(submission.submittedAt) + 1000).toISOString();
    session.toolCalls.push({
      id: "agent-write-after-submission",
      name: "write",
      title: "Wrote src/greet.ts",
      reason: "Synthetic agent edit after learner submission.",
      input: { path: "src/greet.ts" },
      outputPreview: JSON.stringify({ authoredBy: "agent" }),
      status: "completed",
      createdAt: afterSubmission,
      completedAt: afterSubmission
    });
    await assert.rejects(
      () => reviewTool.execute({
        taskId: task.id,
        subtaskId: task.subtasks?.[0]?.id,
        outcome: "done",
        evidence: "The current file passes after an agent write."
      }),
      /Flow edited task files after the learner submission/
    );
    session.toolCalls = session.toolCalls.filter((toolCall) => toolCall.id !== "agent-write-after-submission");

    await reviewTool.execute({
      taskId: task.id,
      subtaskId: task.subtasks?.[0]?.id,
      outcome: "needs-work",
      evidence: "The body returns hello, but the review asks for an explicit typed signature.",
      nextInstructions: "Add the return type annotation before resubmitting."
    });
    assert.equal(task.subtasks?.[0]?.status, "needs-work");
    assert.equal(task.subtasks?.[0]?.nextInstructions, "Add the return type annotation before resubmitting.");

    await writeFile(path.join(project.workspacePath, "src/greet.ts"), "export function greet(): string { return 'hello'; }", "utf8");
    await service.submitPracticeTask(project, task.id, "Added the return type.", task.subtasks?.[0]?.id);

    await reviewTool.execute({
      taskId: task.id,
      subtaskId: task.subtasks?.[0]?.id,
      outcome: "done",
      evidence: "The learner provided the expected function body."
    });
    assert.equal(task.subtasks?.[0]?.status, "completed");
  });

  it("patches Flow Memory with scoped diffs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-memory-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const project: StoredFlowProject = {
      kind: "flow",
      id: "memory-project",
      title: "Memory Project",
      description: "A memory project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "memory-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Test memory patching",
        memoryDirectory: ".construct/flow-memory",
        threadId: "test-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    await mkdir(project.workspacePath, { recursive: true });
    await flowMemory.ensure(project);

    const result = await flowMemory.patch(project, [{
      file: "learner.md",
      mode: "append",
      content: "Recent learning evidence: explained why exact memory patches are safer than rewrites.",
      reason: "Record demonstrated understanding of memory patching."
    }]);

    assert.equal(result[0]?.file, "learner.md");
    assert.match(result[0]?.diff ?? "", /\+Recent learning evidence/);
    const learnerMemory = await readFile(path.join(project.workspacePath, ".construct/flow-memory/learner.md"), "utf8");
    assert.match(learnerMemory, /exact memory patches/);
  });

  it("returns diffs for full Flow Memory saves", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-memory-update-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const project: StoredFlowProject = {
      kind: "flow",
      id: "memory-update-project",
      title: "Memory Update Project",
      description: "A memory update project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "memory-update-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Test memory full-save diffs",
        memoryDirectory: ".construct/flow-memory",
        threadId: "test-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    await mkdir(project.workspacePath, { recursive: true });
    await flowMemory.ensure(project);

    const result = await flowMemory.updateWithDiff(project, [{
      file: "project.md",
      content: "# Project\n\nGoal: Show full-save diffs.",
      reason: "Replace project memory."
    }]);

    assert.equal(result[0]?.file, "project.md");
    assert.equal(result[0]?.mode, "replace");
    assert.match(result[0]?.diff ?? "", /--- project\.md/);
    assert.match(result[0]?.diff ?? "", /\+Goal: Show full-save diffs\./);
    assert.doesNotMatch(result[0]?.diff ?? "", /\(memory changed\)/);
  });

  it("creates hidden continuation sessions for question responses and system starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-session-origin-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore
    });
    const project: StoredFlowProject = {
      kind: "flow",
      id: "session-origin-project",
      title: "Session Origin Project",
      description: "A session origin project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "session-origin-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Test hidden continuation sessions",
        memoryDirectory: ".construct/flow-memory",
        threadId: "test-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };

    const questionSession = (service as any).createSession(project, {
      projectId: project.id,
      message: "Continue from the tracked question answer.",
      questionResponse: {
        sessionId: "previous-session",
        toolCallId: "ask-question-1",
        question: "Which package manager should Flow use?",
        answer: "npm",
        answeredAt: new Date().toISOString()
      }
    });
    assert.equal(questionSession.origin, "question-response");
    assert.equal(questionSession.messages.length, 1);
    assert.equal(questionSession.messages[0].role, "user");
    assert.match(questionSession.messages[0].content, /Which package manager should Flow use\?/);
    assert.match(questionSession.messages[0].content, /npm/);
    assert.equal(questionSession.questionResponse.answer, "npm");

    const starterSession = (service as any).createSession(project, {
      projectId: project.id,
      message: "Start this new Flow project.",
      startReason: "new-project"
    });
    assert.equal(starterSession.origin, "system");
    assert.deepEqual(starterSession.messages, []);
  });

  it("saves researched context to research.md instead of preserving a clarification pivot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-research-handoff-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore,
      agentRuntime: () => ({
        runAgentic: async (input: any) => {
          input.onTrace({
            title: "Fetched web page",
            event: {
              id: "research-source-1",
              type: "tool",
              status: "completed",
              title: "Fetched web page",
              detail: "DLSS technical overview",
              toolName: "research-source",
              outputPreview: "DLSS combines neural super-resolution, temporal accumulation, motion vectors, and anti-aliasing for real-time upscaling.",
              createdAt: new Date().toISOString()
            }
          });
          return {
            text: "What does \"DLSS From Scratch\" mean to you? Are you looking to implement NVIDIA's AI upscaling algorithm on an NVIDIA GPU, or explore upscaling techniques on Apple Silicon/M2?"
          };
        }
      }) as any
    });
    const project: StoredFlowProject = {
      kind: "flow",
      id: "research-project",
      title: "DLSS From Scratch",
      description: "A research handoff project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "research-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "DLSS From scratch",
        memoryDirectory: ".construct/flow-memory",
        threadId: "research-thread",
        researchEnabled: false,
        researchCompletedAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    await mkdir(project.workspacePath, { recursive: true });

    const result = await service.runResearchAgent(project);
    const researchMemory = await readFile(path.join(project.workspacePath, ".construct/flow-memory/research.md"), "utf8");

    assert.match(result.reply, /Research saved to research\.md/);
    assert.doesNotMatch(result.reply, /Are you looking to/);
    assert.match(researchMemory, /Mentor Handoff/);
    assert.match(researchMemory, /motion vectors/);
    assert.doesNotMatch(researchMemory, /Are you looking to/);
    assert.ok(project.flow.researchCompletedAt);
    assert.ok(result.session.toolCalls.some((toolCall) => (
      toolCall.name === "flow-memory-update" &&
      toolCall.reason === "Saved research.md for mentor handoff" &&
      toolCall.outputPreview?.includes("research.md")
    )));
  });

  it("records estimated context window metadata before Flow model runs", () => {
    const source = readFileSync(new URL("./ConstructFlowService.ts", import.meta.url), "utf8");
    assert.match(source, /session\.contextWindow = estimateContextWindow/);
    assert.match(source, /modelForAiFeature\(settings, "construct-flow"\)/);
    assert.match(source, /source: "estimated"/);
    assert.match(source, /estimateModelContextTokens/);
  });

  it("keeps Flow agent timeline and concept tools production-shaped", () => {
    const source = readFileSync(new URL("./ConstructFlowService.ts", import.meta.url), "utf8");
    assert.match(source, /const fetchConcepts = this\.createFetchConceptsTool\(project\);/);
    assert.match(source, /"fetch-concepts": fetchConcepts/);
    assert.match(source, /id: "fetch-concepts"/);
    assert.match(source, /"review-subtask": reviewSubtask/);
    assert.match(source, /guidance.*UI-only task work highlights/s);
    assert.match(source, /cleanReplyForPendingQuestion/);
    assert.match(source, /scoreConceptMatch/);
    assert.match(source, /if \(event\.type === "tool" && isProtocolRecordedTool\(event\.toolName \?\? event\.title\)\) return null;/);
    assert.match(source, /protocolRecordedToolNames/);
    assert.match(source, /findPendingLearnerQuestion/);
    assert.match(source, /Do not duplicate the context in both prose and the tool question/);
    assert.match(source, /Treat research\.md as the new-project research handoff/);
    assert.match(source, /Do not ask the learner clarifying questions/);
    assert.match(source, /flow-memory-fetch, and flow-memory-patch/);
  });
});
