import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import { createConstructAgentRuntime, type ConstructAgentTraceEntry } from "../constructAgentRuntime";
import { AgentLogService } from "../ai/AgentLogService";
import {
  createConstructProtocolTools,
  readWorkspaceFileForProtocol,
  type ConstructProtocolToolRecord
} from "../agent-tools/constructProtocolTools";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import type { StoredFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructFlowMemoryService } from "./ConstructFlowMemoryService";
import type {
  ConstructFlowAction,
  ConstructFlowAgentInput,
  ConstructFlowAgentResult,
  ConstructFlowPracticeTask,
  ConstructFlowSession,
  ConstructFlowSessionEvent,
  ConstructFlowTaskBaseline,
  ConstructFlowTaskSubmission,
  ConstructFlowToolCallRecord
} from "../../shared/constructFlow";
import type { ConstructAgentRunEvent, KnowledgeBaseRecord } from "../../shared/constructLearning";
import { ConstructLearningStore } from "../constructLearningStore";

const ignoredNames = new Set([".git", ".construct", "node_modules", "dist", "build", ".next", "coverage"]);
const maxBaselineFileBytes = 120_000;
const maxDiffChars = 18_000;

function buildFlowRuntimeErrorReply(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error || "Unknown runtime error");
  return [
    "Construct Flow could not finish because the model runtime failed.",
    "",
    message,
    "",
    "The activity above shows the last model/tool event that completed."
  ].join("\n");
}

export type ConstructFlowSessionEventSink = (event: ConstructFlowSessionEvent) => void;

export class ConstructFlowService {
  constructor(private readonly options: {
    workspace: ConstructProjectWorkspaceService;
    flowMemory: ConstructFlowMemoryService;
    latestTerminalOutput: (projectId: string) => string;
    logs: AgentLogService;
    learningStore: () => ConstructLearningStore;
  }) {}

  async runMainAgent(
    project: StoredFlowProject,
    input: ConstructFlowAgentInput,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const memory = await this.options.flowMemory.read(project);
    const session = this.createSession(project, input);
    const startedAt = Date.now();
    const publish = (type: ConstructFlowSessionEvent["type"], result?: ConstructFlowAgentResult) => {
      session.updatedAt = new Date().toISOString();
      session.durationMs = Date.now() - startedAt;
      onSessionEvent?.({ type, projectId: project.id, session: cloneSession(session), result });
    };

    if (input.taskSubmission) {
      const task = project.flow.sessions
        .flatMap((s) => s.practiceTasks)
        .find((t) => t.id === input.taskSubmission?.taskId);
      if (task) {
        task.submissionSessionId = session.id;
      }
    }

    project.flow.sessions.push(session);
    trimSessions(project);
    publish("started");

    const actionsFromTools: ConstructFlowAction[] = [];
    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      allowWorkspaceMutation: true,
      allowTerminalCommands: true,
      onToolCallStart: (record) => {
        session.toolCalls.push(toFlowToolRecord(record, "running"));
        publish("updated");
      },
      onToolCall: (record) => {
        replaceToolRecord(session, toFlowToolRecord(record, record.status ?? "completed"));
        extractAction(record).forEach((action) => actionsFromTools.push(action));
        publish("updated");
      }
    });

    const store = this.options.learningStore();
    const learningState = await store.getState();
    const concepts = Object.values(learningState.knowledgeBase.concepts).filter((c) => c.sourceProjectId === project.id);

    const practiceTask = this.createPracticeTaskTool(project, session, publish);
    const addConcept = this.createAddConceptTool(project, publish);
    const modifyConcept = this.createModifyConceptTool(project, publish);
    const removeConcept = this.createRemoveConceptTool(project, publish);
    const tools: ToolsInput = {
      ...protocol.tools,
      "practice-task": practiceTask,
      "add-concept": addConcept,
      "modify-concept": modifyConcept,
      "remove-concept": removeConcept
    };

    let reply: string;
    let runError: unknown;
    try {
      const generated = await createConstructAgentRuntime().runAgentic({
        id: "construct-flow-agent",
        featureId: "construct-flow",
        name: "Construct Flow",
        purpose: "Construct Flow mentor agent",
        instructions: FLOW_MAIN_AGENT_PROMPT,
        prompt: buildMainPrompt(project, input, memory, concepts),
        tools,
        maxSteps: 16,
        maxRetries: 2,
        onTrace: (entry) => {
          applyTrace(session, entry);
          if (entry.payload !== undefined) {
            this.options.logs.structured("flow", entry.title, entry.payload, entry.level ?? "debug");
          } else {
            this.options.logs.text("flow", `${entry.title}\n${entry.detail}`, entry.level ?? "debug");
          }
          publish("updated");
        }
      });
      reply = generated.text.trim() || "I could not produce a response from the model, but the activity above shows the work completed.";
    } catch (error) {
      runError = error;
      reply = buildFlowRuntimeErrorReply(error);
    }

    const waiting = session.practiceTasks.some((task) => task.status === "waiting") || hasBlockingLearnerQuestion(session.toolCalls);
    const actions = mergeActions([], actionsFromTools);
    session.actions = actions;
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });
    session.status = runError ? "error" : waiting ? "waiting" : "completed";
    session.errorMessage = runError instanceof Error ? runError.message : undefined;
    project.flow.updatedAt = new Date().toISOString();

    const result: ConstructFlowAgentResult = {
      session: cloneSession(session),
      reply,
      actions
    };
    publish(runError ? "error" : waiting ? "waiting" : "completed", result);
    return result;
  }

  async runResearchAgent(
    project: StoredFlowProject,
    onSessionEvent?: ConstructFlowSessionEventSink
  ): Promise<ConstructFlowAgentResult> {
    await this.options.flowMemory.ensure(project);
    const input: ConstructFlowAgentInput = {
      projectId: project.id,
      message: `Research this Flow project and update research.md. Project goal: ${project.flow.goal}${project.flow.stackPreference ? ` Stack preference: ${project.flow.stackPreference}` : ""}`,
      quickAction: "continue",
      threadId: `${project.flow.threadId}:research`
    };
    const session = this.createSession(project, input);
    const startedAt = Date.now();
    const publish = (type: ConstructFlowSessionEvent["type"], result?: ConstructFlowAgentResult) => {
      session.updatedAt = new Date().toISOString();
      session.durationMs = Date.now() - startedAt;
      onSessionEvent?.({ type, projectId: project.id, session: cloneSession(session), result });
    };
    project.flow.sessions.push(session);
    trimSessions(project);
    publish("started");

    const protocol = createConstructProtocolTools({
      project,
      workspace: this.options.workspace,
      flowMemory: this.options.flowMemory,
      latestTerminalOutput: this.options.latestTerminalOutput(project.id),
      allowWorkspaceMutation: false,
      allowTerminalCommands: false,
      onToolCallStart: (record) => {
        session.toolCalls.push(toFlowToolRecord(record, "running"));
        publish("updated");
      },
      onToolCall: (record) => {
        replaceToolRecord(session, toFlowToolRecord(record, record.status ?? "completed"));
        publish("updated");
      }
    });

    let reply: string;
    try {
      const generated = await createConstructAgentRuntime().runAgentic({
        id: "construct-flow-research-agent",
        featureId: "construct-flow",
        name: "Construct Flow Research",
        purpose: "Construct Flow research agent",
        instructions: FLOW_RESEARCH_AGENT_PROMPT,
        prompt: buildResearchPrompt(project),
        tools: protocol.tools,
        maxSteps: 10,
        maxRetries: 2,
        onTrace: (entry) => {
          applyTrace(session, entry);
          publish("updated");
        }
      });
      reply = generated.text.trim() || "Research completed.";
    } catch (error) {
      reply = "Research failed before completion.";
      await this.options.flowMemory.update(project, [{
        file: "research.md",
        content: `# Research\n\nResearch failed before completion.\n\nError: ${error instanceof Error ? error.message : String(error)}\n`
      }]);
      session.status = "error";
      session.errorMessage = error instanceof Error ? error.message : String(error);
    }

    project.flow.researchCompletedAt = new Date().toISOString();
    project.flow.updatedAt = new Date().toISOString();
    session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });
    session.status = session.status === "error" ? "error" : "completed";
    const result: ConstructFlowAgentResult = {
      session: cloneSession(session),
      reply,
      actions: []
    };
    publish(session.status === "error" ? "error" : "completed", result);
    return result;
  }

  async submitPracticeTask(
    project: StoredFlowProject,
    taskId: string,
    note?: string
  ): Promise<ConstructFlowTaskSubmission> {
    const task = project.flow.sessions
      .flatMap((session) => session.practiceTasks)
      .find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`Unknown Flow practice task: ${taskId}`);
    }
    const baseline = task.baseline;
    const current = await captureBaseline(project, this.options.workspace, task.taskFiles);
    const submission = diffBaseline(baseline, current, taskId, note);
    task.status = "submitted";
    task.submittedAt = submission.submittedAt;
    task.learnerNote = note;
    task.submission = submission;
    project.flow.updatedAt = submission.submittedAt;
    return submission;
  }

  private createSession(project: StoredFlowProject, input: ConstructFlowAgentInput): ConstructFlowSession {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      projectId: project.id,
      threadId: input.threadId ?? project.flow.threadId,
      messages: [{
        id: randomUUID(),
        role: "user",
        content: input.taskSubmission
          ? `${input.message}\n\nTask submission:\n${input.taskSubmission.compactDiff}${input.taskSubmission.note ? `\n\nLearner note: ${input.taskSubmission.note}` : ""}`
          : input.message,
        createdAt: now
      }],
      status: "running",
      toolCalls: [],
      agentEvents: [],
      actions: [],
      practiceTasks: [],
      createdAt: now,
      updatedAt: now
    };
  }

  private createPracticeTaskTool(
    project: StoredFlowProject,
    session: ConstructFlowSession,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "practice-task",
      description: "Create a real learner coding task in the workspace. Prepare files, capture a baseline of relevant task files, focus code, and wait for the learner to submit.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(2_000),
        focus: z.object({
          path: z.string().min(1),
          line: z.number().int().positive().optional(),
          endLine: z.number().int().positive().optional()
        }).optional(),
        taskFiles: z.array(z.string().min(1)).min(1).describe("List of files relevant to this task for scoped diffing"),
        preparations: z.array(z.object({
          path: z.string().min(1),
          content: z.string(),
          mode: z.enum(["create", "overwrite", "replace"]),
          find: z.string().optional()
        })).optional().describe("Files to prepare/scaffold for the learner"),
        conceptIds: z.array(z.string().min(1)).optional().describe("Concept IDs related to this task")
      }).strict(),
      execute: async (toolInput) => {
        if (toolInput.preparations && toolInput.preparations.length > 0) {
          await applyTaskPreparations(project, this.options.workspace, toolInput.preparations);
        }
        const baseline = await captureBaseline(project, this.options.workspace, toolInput.taskFiles);
        const task: ConstructFlowPracticeTask = {
          id: randomUUID(),
          projectId: project.id,
          sessionId: session.id,
          title: toolInput.title,
          prompt: toolInput.prompt,
          focus: toolInput.focus,
          status: "waiting",
          baseline,
          createdAt: new Date().toISOString(),
          taskFiles: toolInput.taskFiles,
          conceptIds: toolInput.conceptIds
        };
        session.practiceTasks.push(task);
        publish("updated");
        return {
          created: true,
          taskId: task.id,
          title: task.title,
          prompt: task.prompt,
          focus: task.focus,
          taskFiles: task.taskFiles,
          conceptIds: task.conceptIds
        };
      }
    });
  }

  private createAddConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "add-concept",
      description: "Create a new concept with a dot-notated hierarchical ID, title, and content. Parent concepts will be auto-created if they do not exist.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The dot-notated hierarchical ID, e.g., 'typescript.syntax.interface'"),
        title: z.string().min(1).describe("Short user-friendly title of the concept"),
        content: z.string().min(1).describe("Rich, detailed free-form markdown explanation of the concept"),
        examples: z.array(z.string()).optional().describe("Code examples illustrating the concept"),
        relatedConcepts: z.array(z.string()).optional().describe("IDs of related concepts"),
        confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional().default("unknown").describe("Learner's current confidence level with this concept")
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const store = this.options.learningStore();
        const state = await store.getState();
        const existingConcepts = Object.values(state.knowledgeBase.concepts).filter(
          (c) => c.sourceProjectId === project.id
        );

        const parts = toolInput.id.split(".");
        for (let i = 1; i < parts.length; i++) {
          const parentId = parts.slice(0, i).join(".");
          const parentExists = existingConcepts.some((c) => c.id === parentId);
          if (!parentExists) {
            const parentParts = parentId.split(".");
            const parentTitle = parentParts[parentParts.length - 1];
            const friendlyParentTitle = parentTitle.charAt(0).toUpperCase() + parentTitle.slice(1);
            const parentStub: KnowledgeBaseRecord = {
              id: parentId,
              sourceProjectId: project.id,
              sourceProjectTitle: project.title,
              title: friendlyParentTitle,
              kind: "concept",
              tags: [],
              summary: `Parent concept stub for ${parentId}`,
              why: "",
              examples: [],
              docs: [],
              content: "",
              confidence: "unknown",
              parentId: parentParts.length > 1 ? parentParts.slice(0, -1).join(".") : null,
              savedAt: now,
              openCount: 0,
              usedInRecall: false,
              lastModifiedAt: now
            };
            await store.saveKnowledgeConcept(parentStub);
          }
        }

        const parentId = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
        const newRecord: KnowledgeBaseRecord = {
          id: toolInput.id,
          sourceProjectId: project.id,
          sourceProjectTitle: project.title,
          title: toolInput.title,
          kind: "concept",
          tags: parts.slice(0, -1),
          summary: toolInput.content.split("\n")[0] || toolInput.title,
          why: "",
          example: toolInput.examples?.[0] || "",
          examples: toolInput.examples ?? [],
          docs: [],
          content: toolInput.content,
          confidence: toolInput.confidence,
          relatedConcepts: toolInput.relatedConcepts ?? [],
          parentId,
          savedAt: now,
          openCount: 0,
          usedInRecall: false,
          lastModifiedAt: now
        };

        await store.saveKnowledgeConcept(newRecord);
        publish("updated");

        return {
          created: true,
          concept: newRecord
        };
      }
    });
  }

  private createModifyConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "modify-concept",
      description: "Modify an existing concept. Only the fields provided in the patch will be updated.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The ID of the concept to modify"),
        title: z.string().optional().describe("New title"),
        content: z.string().optional().describe("New markdown explanation"),
        examples: z.array(z.string()).optional().describe("New code examples"),
        relatedConcepts: z.array(z.string()).optional().describe("New related concepts"),
        confidence: z.enum(["unknown", "weak", "emerging", "strong"]).optional().describe("Updated learner confidence level")
      }).strict(),
      execute: async (toolInput) => {
        const now = new Date().toISOString();
        const store = this.options.learningStore();
        const state = await store.getState();
        const recordKey = `${project.id}:${toolInput.id}`;
        const existing = state.knowledgeBase.concepts[recordKey];
        if (!existing) {
          throw new Error(`Concept with ID ${toolInput.id} not found in project ${project.title}`);
        }

        const updatedRecord: KnowledgeBaseRecord = {
          ...existing,
          title: toolInput.title ?? existing.title,
          content: toolInput.content ?? existing.content,
          example: toolInput.examples ? (toolInput.examples[0] || "") : existing.example,
          examples: toolInput.examples ?? existing.examples,
          relatedConcepts: toolInput.relatedConcepts ?? existing.relatedConcepts,
          confidence: toolInput.confidence ?? existing.confidence,
          lastModifiedAt: now
        };

        if (toolInput.content) {
          updatedRecord.summary = toolInput.content.split("\n")[0] || updatedRecord.title;
        }

        await store.saveKnowledgeConcept(updatedRecord);
        publish("updated");

        return {
          modified: true,
          concept: updatedRecord
        };
      }
    });
  }

  private createRemoveConceptTool(
    project: StoredFlowProject,
    publish: (type: ConstructFlowSessionEvent["type"]) => void
  ): ToolsInput[string] {
    return createTool({
      id: "remove-concept",
      description: "Remove a concept by ID.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The ID of the concept to remove")
      }).strict(),
      execute: async (toolInput) => {
        const store = this.options.learningStore();
        await store.removeKnowledgeConcept(project.id, toolInput.id);
        publish("updated");

        return {
          removed: true,
          id: toolInput.id
        };
      }
    });
  }
}

async function applyTaskPreparations(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  preparations: Array<{ path: string; content: string; mode: "create" | "overwrite" | "replace"; find?: string }>
) {
  for (const prep of preparations) {
    const target = workspace.safeProjectPath(project, prep.path);
    await mkdir(path.dirname(target), { recursive: true });

    if (prep.mode === "create" || prep.mode === "overwrite") {
      await writeFile(target, prep.content, "utf8");
    } else if (prep.mode === "replace") {
      let currentContent = existsSync(target) ? await readFile(target, "utf8") : "";
      if (prep.find !== undefined) {
        const index = currentContent.indexOf(prep.find);
        if (index < 0) {
          throw new Error(`Could not find target string "${prep.find}" in file ${prep.path}`);
        }
        currentContent = `${currentContent.slice(0, index)}${prep.content}${currentContent.slice(index + prep.find.length)}`;
      } else {
        currentContent = prep.content;
      }
      await writeFile(target, currentContent, "utf8");
    }
  }
}

async function captureBaseline(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  taskFiles?: string[]
): Promise<ConstructFlowTaskBaseline> {
  const files = taskFiles && taskFiles.length > 0
    ? taskFiles
    : await listTextFiles(project, workspace);
  const entries = await Promise.all(
    files.map(async (file) => {
      const filePath = workspace.safeProjectPath(project, file);
      const content = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
      return [file, content] as const;
    })
  );
  return {
    capturedAt: new Date().toISOString(),
    files: Object.fromEntries(entries)
  };
}

function diffBaseline(
  baseline: ConstructFlowTaskBaseline,
  current: ConstructFlowTaskBaseline,
  taskId: string,
  note?: string
): ConstructFlowTaskSubmission {
  const paths = [...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])].sort();
  const chunks: string[] = [];
  const touchedFiles: string[] = [];
  for (const file of paths) {
    const before = baseline.files[file] ?? "";
    const after = current.files[file] ?? "";
    if (before === after) continue;
    touchedFiles.push(file);
    chunks.push(simpleUnifiedDiff(file, before, after));
  }
  const compactDiff = chunks.join("\n").slice(0, maxDiffChars);
  return {
    taskId,
    note,
    touchedFiles,
    compactDiff: compactDiff || "(no file changes)",
    nothingChanged: touchedFiles.length === 0,
    submittedAt: new Date().toISOString()
  };
}

function simpleUnifiedDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const beforeContextEnd = Math.min(beforeLines.length - 1, beforeEnd + 3);
  const afterContextEnd = Math.min(afterLines.length - 1, afterEnd + 3);
  const removed = beforeLines.slice(contextStart, beforeContextEnd + 1);
  const added = afterLines.slice(contextStart, afterContextEnd + 1);
  return [
    `--- ${file}`,
    `+++ ${file}`,
    `@@ ${contextStart + 1} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`)
  ].join("\n");
}

async function listTextFiles(
  project: StoredFlowProject,
  workspace: ConstructProjectWorkspaceService,
  root = ""
): Promise<string[]> {
  const absoluteRoot = workspace.safeProjectPath(project, root || ".");
  const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(project, workspace, path.join(root, entry.name)));
      continue;
    }
    const fileStat = await stat(workspace.safeProjectPath(project, relativePath)).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > maxBaselineFileBytes) continue;
    files.push(relativePath);
  }
  return files;
}

function buildMainPrompt(
  project: StoredFlowProject,
  input: ConstructFlowAgentInput,
  memory: Array<{ file: string; content: string; updatedAt: string | null }>,
  concepts: KnowledgeBaseRecord[]
): string {
  const recent = project.flow.sessions.slice(-6).map((session) => ({
    id: session.id,
    status: session.status,
    messages: session.messages.slice(-2),
    toolCalls: session.toolCalls.map((tool) => ({ name: tool.name, title: tool.title, status: tool.status })).slice(-8)
  }));
  return [
    `Project: ${project.title}`,
    `Goal: ${project.flow.goal}`,
    project.flow.stackPreference ? `Stack preference: ${project.flow.stackPreference}` : null,
    "",
    "Flow Memory:",
    JSON.stringify(memory.map((item) => ({
      file: item.file,
      updatedAt: item.updatedAt,
      content: item.content.slice(0, 5_000)
    })), null, 2),
    "",
    "Concepts / Knowledge Base:",
    JSON.stringify(concepts.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      title: c.title,
      content: c.content,
      examples: c.examples,
      confidence: c.confidence,
      relatedConcepts: c.relatedConcepts
    })), null, 2),
    "",
    "Recent Flow context:",
    JSON.stringify(recent, null, 2),
    "",
    input.taskSubmission ? "Latest task submission:" : "Latest learner message:",
    input.taskSubmission ? JSON.stringify(input.taskSubmission, null, 2) : input.message,
    "",
    "Use tools when workspace reality matters. For UI actions, call the relevant action tool instead of returning JSON. Reply naturally after tool work."
  ].filter(Boolean).join("\n");
}

function buildResearchPrompt(project: StoredFlowProject): string {
  return [
    `Project title: ${project.title}`,
    `Goal/description: ${project.flow.goal}`,
    project.flow.stackPreference ? `Stack preference: ${project.flow.stackPreference}` : null,
    "",
    "Research the domain/technology only as much as useful, then return concise researchMarkdown for research.md."
  ].filter(Boolean).join("\n");
}

function applyTrace(session: ConstructFlowSession, entry: ConstructAgentTraceEntry): void {
  if (entry.event) {
    upsertEvent(session.agentEvents, entry.event);
  }
}

function upsertEvent(events: ConstructAgentRunEvent[], event: ConstructAgentRunEvent): void {
  const index = events.findIndex((candidate) => candidate.id === event.id);
  if (index >= 0) {
    events[index] = event;
  } else {
    events.push(event);
  }
}

function toFlowToolRecord(
  record: ConstructProtocolToolRecord,
  status: ConstructFlowToolCallRecord["status"]
): ConstructFlowToolCallRecord {
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    reason: record.reason,
    input: record.input,
    outputPreview: record.outputPreview,
    status,
    createdAt: record.createdAt,
    completedAt: record.completedAt
  };
}

function replaceToolRecord(session: ConstructFlowSession, record: ConstructFlowToolCallRecord): void {
  const index = session.toolCalls.findIndex((candidate) => candidate.id === record.id);
  if (index >= 0) {
    session.toolCalls[index] = record;
  } else {
    session.toolCalls.push(record);
  }
}

function extractAction(record: ConstructProtocolToolRecord): ConstructFlowAction[] {
  if (!record.outputPreview) return [];
  try {
    const parsed = JSON.parse(record.outputPreview) as { action?: ConstructFlowAction };
    return parsed.action ? [parsed.action] : [];
  } catch {
    return [];
  }
}

function hasBlockingLearnerQuestion(toolCalls: ConstructFlowToolCallRecord[]): boolean {
  return toolCalls.some((toolCall) => {
    if (toolCall.name !== "ask-user") return false;
    const input = toolCall.input;
    return typeof input === "object" && input !== null && (input as { blocksProgress?: unknown }).blocksProgress === true;
  });
}

function mergeActions(primary: ConstructFlowAction[], secondary: ConstructFlowAction[]): ConstructFlowAction[] {
  const seen = new Set<string>();
  return [...secondary, ...primary].filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function trimSessions(project: StoredFlowProject): void {
  if (project.flow.sessions.length > 50) {
    project.flow.sessions = project.flow.sessions.slice(-50);
  }
}

function cloneSession(session: ConstructFlowSession): ConstructFlowSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
    toolCalls: session.toolCalls.map((toolCall) => ({ ...toolCall })),
    agentEvents: session.agentEvents.map((event) => ({ ...event })),
    actions: session.actions.map((action) => ({ ...action })),
    practiceTasks: session.practiceTasks.map((task) => ({
      ...task,
      baseline: { ...task.baseline, files: { ...task.baseline.files } },
      submission: task.submission ? { ...task.submission, touchedFiles: [...task.submission.touchedFiles] } : undefined
    }))
  };
}

export const FLOW_MAIN_AGENT_PROMPT = `You are Construct Flow, an understanding-based coding mentor working inside a real project workspace.

You are not a code vending machine. Your job is to help the learner become capable of writing and understanding the project themselves.

You can inspect files, search code, use LSP/static analysis when tools expose it, focus code ranges in the editor, prepare real coding tasks, receive learner diffs, propose patches, run terminal commands, ask questions, update Flow Memory, and create/update concepts.

When you teach or the learner demonstrates understanding, ALWAYS update the concepts database:
- After explaining something new, use add-concept or modify-concept to record it.
- After a practice task is submitted and reviewed, modify-concept to update the learner's confidence level for the related concepts.
- Use dot-notated hierarchical IDs for concepts (e.g. 'typescript.syntax.interface', 'reactjs.hooks.useState'). Max 3 levels deep (domain.area.topic).
- Do not create smaller and smaller concepts. Group related sub-concepts inside parent concepts logically.
- Keep concept content detailed, natural, and free-form markdown so it can be easily read and modified. Write detailed text explanations.
- When a learner struggles, modify the concept to note the specific confusion point.
- Concepts are your persistent memory of what the learner knows. Always consult them.

Stay natural. Do not reveal internal modes. Do not force responses into rigid templates. Respond like a strong human mentor reviewing and building with the learner.

Use Flow Memory as durable context. Read it when it helps. Update it after meaningful progress. Keep it concise.

Prefer learner attempts. When the next step is a learner coding attempt, use the practice-task tool to prepare a real place in the workspace, capture a baseline, and wait for submission.

If you need learner input, call ask-user with the exact question. Do not say "let me ask" or put required learner questions only in prose. If the answer blocks progress, set blocksProgress true and stop after a short acknowledgement.

Do not end with a prose choice question such as "want to build X next?" or "your call". If the learner must choose, use ask-user. If the next step is obvious, create a practice-task instead of asking permission.

For TypeScript, emphasize types before implementation. Help the learner understand data models, parameters, return types, unions, optional values, React props/state types, and API response types when relevant. Explain why each type exists.

Use tools as reality. Do not claim a file exists unless you listed/read it. Do not claim code changed unless a write/patch/task tool confirms it. Do not claim tests pass unless a terminal command confirms it.

Leave the project easy to resume by updating Flow Memory after meaningful work.`;

export const FLOW_RESEARCH_AGENT_PROMPT = `You are the Construct Flow Research Agent.

Your job is to prepare concise project/domain/technology background for a new Construct Flow project.

You may use internet search and source reading.
You do not teach the learner directly.
You do not create a learner profile.
You do not create a deterministic project plan.
You do not modify project code.

Create useful markdown for research.md. Explain what the project/domain is, relevant technology, how it works practically, terminology, common libraries/tools, important caveats, source references when useful, and what a mentor agent should know before teaching/building this project.

Keep it concise and source-grounded. Avoid dumping raw web content.

Use flow-memory-update to save the final research.md content. Then reply with a short summary of what you saved.`;
