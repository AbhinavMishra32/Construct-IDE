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

function createFlowTestProject(workspaceRoot: string, id: string, goal = "Test Flow context"): StoredFlowProject {
  return {
    kind: "flow",
    id,
    title: id,
    description: "A Flow test project",
    progress: 0,
    lastOpenedAt: new Date().toISOString(),
    workspacePath: path.join(workspaceRoot, id),
    sourcePath: null,
    activeFilePath: null,
    fileTreeExpanded: [],
    completedAt: null,
    flow: {
      goal,
      memoryDirectory: ".construct/flow-memory",
      threadId: `${id}-thread`,
      researchEnabled: false,
      researchCompletedAt: null,
      sessions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

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
      confidence: "introduced",
      reason: "Introduce the function concept before assigning a function-writing task.",
      evidence: ["The task test seeds this as introduced learner knowledge before practice."],
      confidenceReason: "The learner has seen the function concept and answered what a return value means."
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
      learnerReadiness: [{
        conceptId: "typescript.functions",
        evidence: "The learner explained that greet should return a string instead of printing.",
        source: "learner-chat"
      }],
      safety: {
        level: "beginner-safe",
        rationale: "The task edits a tiny TypeScript file and requires no host privileges."
      },
      introducedConceptIds: ["typescript.functions"],
      conceptIds: ["typescript.functions"]
    });

    assert.ok(taskResult.created);
    assert.deepEqual(taskResult.introducedConceptIds, ["typescript.functions"]);
    assert.ok(existsSync(path.join(project.workspacePath, "src/greet.ts")));

    const task = session.practiceTasks[0];
    assert.ok(task);
    assert.equal(task.pathNodeId, "typescript-foundation");
    assert.equal(task.language, "typescript");
    assert.deepEqual(project.flow.pathNodes?.[0]?.taskIds, [task.id]);
    assert.deepEqual(task.taskFiles, ["src/greet.ts"]);
    assert.deepEqual(task.introducedConceptIds, ["typescript.functions"]);
    assert.deepEqual(task.learnerReadiness?.map((item) => item.conceptId), ["typescript.functions"]);
    assert.equal(task.safety?.level, "beginner-safe");
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

  it("blocks unsafe hardware tasks and complete read-and-run C++ demos", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-safe-task-"));
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
      id: "safe-task-project",
      title: "Safe Task Project",
      description: "A safe task project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "safe-task-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Learn low-level C++ safely",
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
      id: "safe-session",
      projectId: project.id,
      threadId: "thread-safe",
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
      id: "cpp.pointers",
      title: "C++ pointers",
      language: "cpp",
      technology: "C++",
      content: "A pointer stores an address and dereferencing follows that address to a value.",
      confidence: "introduced",
      reason: "Introduce pointers before any low-level C++ task.",
      evidence: ["The learner said pointers are addresses that can be dereferenced."],
      confidenceReason: "The learner gave a correct address/dereference explanation."
    });
    await addTool.execute({
      id: "cpp.memory-mapping",
      title: "Memory mapping",
      language: "cpp",
      technology: "C++",
      content: "Memory mapping connects a file or safe buffer to an address range; real device memory needs extra care.",
      confidence: "introduced",
      reason: "Introduce memory mapping before simulated mmap practice.",
      evidence: ["The learner distinguished safe simulated buffers from real device memory."],
      confidenceReason: "The learner recognized that real hardware access is not beginner-safe."
    });

    const pathTool = (service as any).createPlanLearningPathTool(project, () => {});
    await pathTool.execute({
      reason: "Create a safe C++ foundation path.",
      currentNodeId: "cpp-foundation",
      nodes: [{
        id: "cpp-foundation",
        title: "C++ foundation",
        summary: "Practice safe pointer and memory ideas before device access.",
        kind: "foundation",
        learnerLevel: "beginner",
        concepts: ["cpp.pointers", "cpp.memory-mapping"],
        status: "active"
      }]
    });

    const taskTool = (service as any).createPracticeTaskTool(project, session, () => {});
    const readiness = [
      {
        conceptId: "cpp.pointers",
        evidence: "The learner explained that a pointer stores an address and * reads through it.",
        source: "learner-chat"
      },
      {
        conceptId: "cpp.memory-mapping",
        evidence: "The learner explained that safe practice should use a toy buffer instead of real device memory.",
        source: "learner-chat"
      }
    ];

    await assert.rejects(
      () => taskTool.execute({
        title: "C++ Memory Mapping and Pointer Access",
        prompt: "Open /dev/mem with sudo, mmap() a hardware register region, and inspect M2 GPU registers.",
        language: "cpp",
        taskFiles: ["src/memory_mapper.cpp"],
        introducedConceptIds: ["cpp.pointers", "cpp.memory-mapping"],
        learnerReadiness: readiness,
        successCriteria: ["Program opens /dev/mem and prints register values."]
      }),
      /privileged host access/
    );

    await assert.rejects(
      () => taskTool.execute({
        title: "Pointer demo",
        prompt: "Compile and run the prepared pointer demo.",
        language: "cpp",
        taskFiles: ["src/pointer_demo.cpp"],
        introducedConceptIds: ["cpp.pointers"],
        learnerReadiness: [readiness[0]],
        successCriteria: ["Program prints pointer values."],
        preparations: [{
          path: "src/pointer_demo.cpp",
          mode: "create",
          content: "#include <iostream>\n\nint main() {\n  int x = 42;\n  int* ptr = &x;\n  std::cout << x << std::endl;\n  std::cout << ptr << std::endl;\n  std::cout << *ptr << std::endl;\n  return 0;\n}\n"
        }]
      }),
      /complete read-and-run demo/
    );
  });

  it("requires language-switch path revision and cancels stale waiting tasks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-language-switch-"));
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
      id: "language-switch-project",
      title: "Language Switch Project",
      description: "A language switch project",
      progress: 0,
      lastOpenedAt: new Date().toISOString(),
      workspacePath: path.join(workspaceRoot, "language-switch-project"),
      sourcePath: null,
      activeFilePath: null,
      fileTreeExpanded: [],
      completedAt: null,
      flow: {
        goal: "Move from Swift to C++",
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
      id: "language-session",
      projectId: project.id,
      threadId: "thread-language",
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
      id: "swift.basics.functions",
      title: "Swift functions",
      language: "swift",
      technology: "Swift",
      content: "Swift functions name a reusable behavior.",
      confidence: "introduced",
      reason: "Introduce Swift functions before a Swift task.",
      evidence: ["The learner explained that a Swift function returns a value."],
      confidenceReason: "The learner gave a simple function mental model."
    });
    await addTool.execute({
      id: "cpp.basics.functions",
      title: "C++ functions",
      language: "cpp",
      technology: "C++",
      content: "C++ functions declare a return type, name, parameters, and body.",
      confidence: "introduced",
      reason: "Introduce C++ functions after the learner switched from Swift to C++.",
      evidence: ["The learner said a C++ function needs a return type before its name."],
      confidenceReason: "The learner identified the return type position in C++."
    });

    const pathTool = (service as any).createPlanLearningPathTool(project, () => {});
    await pathTool.execute({
      reason: "Start with Swift before the learner switches languages.",
      currentNodeId: "swift-foundation",
      nodes: [{
        id: "swift-foundation",
        title: "Swift foundation",
        summary: "Swift basics before app work.",
        kind: "foundation",
        learnerLevel: "beginner",
        concepts: ["swift.basics.functions"],
        status: "active"
      }]
    });

    const taskTool = (service as any).createPracticeTaskTool(project, session, () => {});
    const swiftTask = await taskTool.execute({
      title: "Swift return value",
      prompt: "Write a Swift function that returns a title string.",
      language: "swift",
      taskFiles: ["Sources/App.swift"],
      introducedConceptIds: ["swift.basics.functions"],
      learnerReadiness: [{
        conceptId: "swift.basics.functions",
        evidence: "The learner explained that a function can return a value.",
        source: "learner-chat"
      }],
      successCriteria: ["The learner-authored function returns a string."]
    });

    await assert.rejects(
      () => taskTool.execute({
        title: "C++ return value",
        prompt: "Write a C++ function that returns a title string.",
        language: "cpp",
        taskFiles: ["src/main.cpp"],
        introducedConceptIds: ["cpp.basics.functions"],
        learnerReadiness: [{
          conceptId: "cpp.basics.functions",
          evidence: "The learner explained that C++ puts the return type before the function name.",
          source: "learner-chat"
        }],
        successCriteria: ["The learner-authored function returns a std::string."]
      }),
      /Revise the learning path/
    );

    await pathTool.execute({
      reason: "Learner switched from Swift to C++, so the active path must change before new tasks.",
      currentNodeId: "cpp-foundation",
      nodes: [{
        id: "cpp-foundation",
        title: "C++ foundation",
        summary: "C++ basics before low-level exploration.",
        kind: "foundation",
        learnerLevel: "beginner",
        concepts: ["cpp.basics.functions"],
        status: "active"
      }]
    });

    const cppTask = await taskTool.execute({
      title: "C++ return value",
      prompt: "Write a C++ function that returns a title string.",
      language: "cpp",
      taskFiles: ["src/main.cpp"],
      introducedConceptIds: ["cpp.basics.functions"],
      learnerReadiness: [{
        conceptId: "cpp.basics.functions",
        evidence: "The learner explained that C++ puts the return type before the function name.",
        source: "learner-chat"
      }],
      successCriteria: ["The learner-authored function returns a std::string."]
    });

    assert.ok(cppTask.created);
    assert.deepEqual(cppTask.cancelledStaleTaskIds, [swiftTask.taskId]);
    assert.equal(session.practiceTasks.find((task) => task.id === swiftTask.taskId)?.status, "cancelled");
    assert.equal(session.practiceTasks.find((task) => task.id === cppTask.taskId)?.status, "waiting");
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

  it("sends the persisted Flow transcript as the model message array", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-message-array-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const calls: any[] = [];
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore,
      agentRuntime: () => ({
        runAgentic: async (input: any) => {
          calls.push(input);
          return { text: "We will keep teaching from the actual transcript.", stepCount: 1, finishReason: "stop", durationMs: 1 };
        }
      }) as any
    });
    const project = createFlowTestProject(workspaceRoot, "message-array-project");
    await mkdir(project.workspacePath, { recursive: true });
    project.flow.sessions.push({
      id: "prior-session",
      projectId: project.id,
      threadId: "thread",
      origin: "user",
      messages: [
        { id: "m1", role: "user", content: "I do not know Swift. I want C++ instead.", createdAt: new Date().toISOString() },
        { id: "m2", role: "assistant", content: "Cool, we should slow down and teach C++ basics first.", createdAt: new Date().toISOString() }
      ],
      status: "completed",
      toolCalls: [],
      agentEvents: [],
      timeline: [],
      actions: [],
      practiceTasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const result = await service.runMainAgent(project, {
      projectId: project.id,
      message: "What is a pointer actually?",
      quickAction: "continue"
    });

    assert.equal(calls.length, 1);
    assert.ok(Array.isArray(calls[0].messages));
    assert.deepEqual(calls[0].messages.map((message: any) => message.role), ["user", "assistant", "user"]);
    assert.match(calls[0].messages[0].content, /I do not know Swift/);
    assert.match(calls[0].messages[1].content, /teach C\+\+ basics/);
    assert.match(calls[0].messages[2].content, /What is a pointer actually\?/);
    assert.match(calls[0].instructions, /Structured Flow Path/);
    assert.equal(calls[0].prompt, "What is a pointer actually?");
    assert.ok((result.session.contextWindow?.systemPromptTokens ?? 0) > 0);
    assert.ok((result.session.contextWindow?.chatTokens ?? 0) > 0);
    assert.equal(result.session.contextWindow?.messageCount, 3);
  });

  it("replays visible setup tools and tracked question answers into the next model call", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-visible-transcript-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const calls: any[] = [];
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore,
      agentRuntime: () => ({
        runAgentic: async (input: any) => {
          calls.push(input);
          return { text: "Continuing with the approved install.", stepCount: 1, finishReason: "stop", durationMs: 1 };
        }
      }) as any
    });
    const project = createFlowTestProject(workspaceRoot, "visible-transcript-project", "Learn Mastra and React Ink");
    await mkdir(project.workspacePath, { recursive: true });
    const createdAt = new Date().toISOString();
    project.flow.sessions.push({
      id: "setup-session",
      projectId: project.id,
      threadId: "thread",
      origin: "user",
      messages: [
        { id: "u1", role: "user", content: "hi! lets start", createdAt },
        { id: "a1", role: "assistant", content: "I need approval before running npm install.", createdAt }
      ],
      status: "waiting",
      toolCalls: [
        {
          id: "write-package",
          name: "write",
          title: "Wrote package.json",
          reason: "Scaffold Mastra dependencies",
          input: { path: "package.json", reason: "Create package manifest", content: "{\"dependencies\":{\"@mastra/core\":\"latest\",\"zod\":\"latest\"}}" },
          outputPreview: "{\"path\":\"package.json\",\"bytes\":123,\"authoredBy\":\"agent\"}",
          status: "completed",
          createdAt,
          completedAt: createdAt
        },
        {
          id: "write-tsconfig",
          name: "write",
          title: "Wrote tsconfig.json",
          reason: "Scaffold TypeScript config",
          input: { path: "tsconfig.json", reason: "Create TypeScript config", content: "{\"compilerOptions\":{\"strict\":true}}" },
          outputPreview: "{\"path\":\"tsconfig.json\",\"bytes\":88,\"authoredBy\":\"agent\"}",
          status: "completed",
          createdAt,
          completedAt: createdAt
        },
        {
          id: "install-command",
          name: "run-terminal-command",
          title: "Ran npm install",
          reason: "Install Mastra and Zod dependencies",
          input: { command: "npm install", label: "npm install", reason: "Install dependencies" },
          outputPreview: "Package manager mutation requires explicit user approval.",
          status: "error",
          createdAt,
          completedAt: createdAt
        },
        {
          id: "ask-install",
          name: "ask-question",
          title: "Asked learner",
          reason: "Package manager approval required",
          input: {
            question: "Should I run npm install to install Mastra and Zod dependencies?",
            choices: ["yes", "no"],
            blocksProgress: true
          },
          outputPreview: "{\"question\":\"Should I run npm install to install Mastra and Zod dependencies?\",\"choices\":[\"yes\",\"no\"]}",
          status: "completed",
          createdAt,
          completedAt: createdAt
        }
      ],
      agentEvents: [],
      timeline: [
        { id: "write-package", kind: "tool", toolCallId: "write-package", name: "write", title: "Wrote package.json", reason: "Scaffold Mastra dependencies", status: "completed", input: { path: "package.json", reason: "Create package manifest", content: "{\"dependencies\":{\"@mastra/core\":\"latest\",\"zod\":\"latest\"}}" }, outputPreview: "{\"path\":\"package.json\",\"bytes\":123,\"authoredBy\":\"agent\"}", createdAt, completedAt: createdAt },
        { id: "write-tsconfig", kind: "tool", toolCallId: "write-tsconfig", name: "write", title: "Wrote tsconfig.json", reason: "Scaffold TypeScript config", status: "completed", input: { path: "tsconfig.json", reason: "Create TypeScript config", content: "{\"compilerOptions\":{\"strict\":true}}" }, outputPreview: "{\"path\":\"tsconfig.json\",\"bytes\":88,\"authoredBy\":\"agent\"}", createdAt, completedAt: createdAt },
        { id: "install-command", kind: "tool", toolCallId: "install-command", name: "run-terminal-command", title: "Ran npm install", reason: "Install Mastra and Zod dependencies", status: "error", input: { command: "npm install", label: "npm install", reason: "Install dependencies" }, outputPreview: "Package manager mutation requires explicit user approval.", createdAt, completedAt: createdAt },
        { id: "ask-install", kind: "tool", toolCallId: "ask-install", name: "ask-question", title: "Asked learner", reason: "Package manager approval required", status: "completed", input: { question: "Should I run npm install to install Mastra and Zod dependencies?", choices: ["yes", "no"], blocksProgress: true }, outputPreview: "{\"question\":\"Should I run npm install to install Mastra and Zod dependencies?\",\"choices\":[\"yes\",\"no\"]}", createdAt, completedAt: createdAt }
      ],
      actions: [],
      practiceTasks: [],
      createdAt,
      updatedAt: createdAt
    });

    const result = await service.runMainAgent(project, {
      projectId: project.id,
      message: "Continue from the tracked question answer.",
      questionResponse: {
        sessionId: "setup-session",
        toolCallId: "ask-install",
        question: "Should I run npm install to install Mastra and Zod dependencies?",
        answer: "yes",
        answeredAt: new Date().toISOString()
      },
      quickAction: "continue"
    });

    assert.equal(calls.length, 1);
    const renderedMessages = calls[0].messages.map((message: any) => `${message.role}:\n${message.content}`).join("\n\n");
    assert.match(renderedMessages, /Visible Flow turn transcript/);
    assert.match(renderedMessages, /Wrote package\.json/);
    assert.match(renderedMessages, /Wrote tsconfig\.json/);
    assert.match(renderedMessages, /npm install/);
    assert.match(renderedMessages, /Package manager mutation requires explicit user approval/);
    assert.match(renderedMessages, /Should I run npm install to install Mastra and Zod dependencies/);
    assert.match(renderedMessages, /answer=yes/);
    assert.match(renderedMessages, /Tracked Flow question answered/);
    assert.match(renderedMessages, /Answer: yes/);
    assert.doesNotMatch(calls[0].messages.at(-1).content, /^Continue from the tracked question answer\.$/);
    assert.ok((result.session.contextWindow?.visibleTranscriptEventCount ?? 0) >= 4);
    assert.ok((result.session.contextWindow?.visibleTranscriptTokens ?? 0) > 0);
  });

  it("auto-compacts older Flow transcript messages and preserves the recent tail", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-auto-compact-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const calls: any[] = [];
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore,
      agentRuntime: () => ({
        runAgentic: async (input: any) => {
          calls.push(input);
          if (input.id === "construct-flow-context-compactor") {
            return {
              text: "The learner switched from Swift to C++, has not proven pointer understanding, and must be taught safely before any task.",
              stepCount: 1,
              finishReason: "stop",
              durationMs: 1
            };
          }
          return { text: "Continuing after compaction.", stepCount: 1, finishReason: "stop", durationMs: 1 };
        }
      }) as any
    });
    const project = createFlowTestProject(workspaceRoot, "auto-compact-project");
    await mkdir(project.workspacePath, { recursive: true });
    const largeText = "learner still needs concept-first teaching ".repeat(350);
    for (let index = 0; index < 18; index += 1) {
      project.flow.sessions.push({
        id: `prior-${index}`,
        projectId: project.id,
        threadId: "thread",
        origin: "user",
        messages: [
          { id: `u-${index}`, role: "user", content: `turn ${index}: ${largeText}`, createdAt: new Date().toISOString() },
          { id: `a-${index}`, role: "assistant", content: `turn ${index}: teach first, no task yet. ${largeText}`, createdAt: new Date().toISOString() }
        ],
        status: "completed",
        toolCalls: [],
        agentEvents: [],
        timeline: [],
        actions: [],
        practiceTasks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    const result = await service.runMainAgent(project, {
      projectId: project.id,
      message: "continue but do not forget I have not learned pointers",
      quickAction: "continue"
    });

    assert.equal(calls[0].id, "construct-flow-context-compactor");
    assert.equal(calls[1].id, "construct-flow-agent");
    assert.match(calls[1].messages[0].content, /Compacted Flow context summary/);
    assert.match(calls[1].messages[0].content, /has not proven pointer understanding/);
    assert.match(calls[1].messages.at(-1).content, /do not forget I have not learned pointers/);
    assert.ok(calls[1].messages.length < 18 * 2);
    assert.equal(result.session.contextCompaction?.status, "completed");
    assert.ok((result.session.contextCompaction?.summarizedMessageCount ?? 0) > 0);
    assert.equal(result.session.contextWindow?.compaction?.status, "completed");
    assert.ok(result.session.timeline.some((part) => part.kind === "compaction" && part.status === "completed"));
  });

  it("carries raw summarized ids forward across repeated Flow compactions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "construct-flow-test-repeat-compact-"));
    const workspaceRoot = path.join(dir, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const workspace = new ConstructProjectWorkspaceService(
      () => workspaceRoot,
      () => dir
    );
    const flowMemory = new ConstructFlowMemoryService(workspace);
    const logs = new AgentLogService(() => {});
    const learningStore = new ConstructLearningStore(path.join(dir, "learning-state.json"));
    const calls: any[] = [];
    const service = new ConstructFlowService({
      workspace,
      flowMemory,
      latestTerminalOutput: () => "",
      logs,
      learningStore: () => learningStore,
      agentRuntime: () => ({
        runAgentic: async (input: any) => {
          calls.push(input);
          if (input.id === "construct-flow-context-compactor") {
            return {
              text: "Compacted summary preserves learner state without raw ancient transcript.",
              stepCount: 1,
              finishReason: "stop",
              durationMs: 1
            };
          }
          return { text: "Continuing after repeated compaction.", stepCount: 1, finishReason: "stop", durationMs: 1 };
        }
      }) as any
    });
    const project = createFlowTestProject(workspaceRoot, "repeat-compact-project");
    await mkdir(project.workspacePath, { recursive: true });
    const hugeText = "context needs compacting ".repeat(2500);
    for (let index = 0; index < 18; index += 1) {
      project.flow.sessions.push({
        id: `ancient-${index}`,
        projectId: project.id,
        threadId: "thread",
        origin: "user",
        messages: [
          { id: `u-${index}`, role: "user", content: `ancient raw turn ${index}: ${hugeText}`, createdAt: new Date().toISOString() },
          { id: `a-${index}`, role: "assistant", content: `ancient raw answer ${index}: ${hugeText}`, createdAt: new Date().toISOString() }
        ],
        status: "completed",
        toolCalls: [],
        agentEvents: [],
        timeline: [],
        actions: [],
        practiceTasks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await service.runMainAgent(project, {
      projectId: project.id,
      message: "first compaction",
      quickAction: "continue"
    });

    for (let index = 0; index < 3; index += 1) {
      project.flow.sessions.push({
        id: `fresh-${index}`,
        projectId: project.id,
        threadId: "thread",
        origin: "user",
        messages: [
          { id: `fu-${index}`, role: "user", content: `fresh raw turn ${index}: ${hugeText}`, createdAt: new Date().toISOString() },
          { id: `fa-${index}`, role: "assistant", content: `fresh raw answer ${index}: ${hugeText}`, createdAt: new Date().toISOString() }
        ],
        status: "completed",
        toolCalls: [],
        agentEvents: [],
        timeline: [],
        actions: [],
        practiceTasks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await service.runMainAgent(project, {
      projectId: project.id,
      message: "second compaction",
      quickAction: "continue"
    });
    await service.runMainAgent(project, {
      projectId: project.id,
      message: "third call after repeated compaction",
      quickAction: "continue"
    });

    assert.ok(calls.filter((call) => call.id === "construct-flow-context-compactor").length >= 2);
    const lastMainCall = [...calls].reverse().find((call) => call.id === "construct-flow-agent");
    const renderedMessages = lastMainCall.messages.map((message: any) => message.content).join("\n");
    assert.doesNotMatch(renderedMessages, /ancient raw turn 0/);
    assert.doesNotMatch(renderedMessages, /ancient raw answer 0/);
    assert.match(renderedMessages, /Compacted Flow context summary/);
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
    assert.match(source, /removeDuplicatedQuestionText/);
    assert.match(source, /Question-response guard/);
    assert.match(source, /learnerReadiness/);
  });
});
