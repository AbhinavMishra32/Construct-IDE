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
      actions: [],
      practiceTasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

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
      confidence: "emerging",
      reason: "The learner asked about TypeScript interface shape.",
      evidence: ["The learner connected interface syntax to object shape in chat."],
      confidenceReason: "They correctly described the interface as a shape contract."
    });

    assert.ok(addResult.created);
    assert.equal(addResult.concept.id, "typescript.syntax.interface");
    assert.equal(addResult.concept.language, "typescript");
    assert.equal(addResult.concept.technology, "TypeScript");
    assert.equal(addResult.concept.parentId, "typescript.syntax");
    assert.equal(addResult.concept.confidenceReason, "They correctly described the interface as a shape contract.");

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
      confidence: "strong",
      reason: "The learner used the interface in a task without hints.",
      evidence: ["Submitted diff added an interface with the correct required property."],
      confidenceReason: "The learner independently applied the concept in code."
    });

    assert.ok(modifyResult.modified);
    assert.equal(modifyResult.concept.content, "TypeScript interface updated.");
    assert.equal(modifyResult.concept.confidence, "strong");
    assert.equal(modifyResult.reason, "The learner used the interface in a task without hints.");

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
      actions: [],
      practiceTasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    project.flow.sessions.push(session);

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
      preparations: [
        {
          path: "src/greet.ts",
          content: "export function greet() {}",
          mode: "create"
        }
      ],
      conceptIds: ["typescript.functions"]
    });

    assert.ok(taskResult.created);
    assert.ok(existsSync(path.join(project.workspacePath, "src/greet.ts")));

    const task = session.practiceTasks[0];
    assert.ok(task);
    assert.equal(task.pathNodeId, "typescript-foundation");
    assert.deepEqual(project.flow.pathNodes?.[0]?.taskIds, [task.id]);
    assert.deepEqual(task.taskFiles, ["src/greet.ts"]);
    assert.equal(task.baseline.files["src/greet.ts"], "export function greet() {}");
    assert.equal(task.baseline.files["ignored.ts"], undefined);
    assert.equal(task.authoredBy?.actor, "agent");
    assert.equal(task.preparedFiles?.[0]?.authoredBy.actor, "agent");
    assert.equal(task.subtasks?.[0]?.status, "active");

    // Modify file and submit task
    await writeFile(path.join(project.workspacePath, "src/greet.ts"), "export function greet() { return 'hello'; }", "utf8");
    const submission = await service.submitPracticeTask(project, task.id, "Done!");

    assert.equal(submission.touchedFiles.length, 1);
    assert.equal(submission.touchedFiles[0], "src/greet.ts");
    assert.ok(submission.compactDiff.includes("return 'hello';"));
    assert.equal(submission.authoredBy?.actor, "learner");
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
    assert.deepEqual(questionSession.messages, []);
    assert.equal(questionSession.questionResponse.answer, "npm");

    const starterSession = (service as any).createSession(project, {
      projectId: project.id,
      message: "Start this new Flow project.",
      startReason: "new-project"
    });
    assert.equal(starterSession.origin, "system");
    assert.deepEqual(starterSession.messages, []);
  });

  it("records estimated context window metadata before Flow model runs", () => {
    const source = readFileSync(new URL("./ConstructFlowService.ts", import.meta.url), "utf8");
    assert.match(source, /session\.contextWindow = estimateContextWindow/);
    assert.match(source, /modelForAiFeature\(settings, "construct-flow"\)/);
    assert.match(source, /source: "estimated"/);
    assert.match(source, /estimateModelContextTokens/);
  });
});
