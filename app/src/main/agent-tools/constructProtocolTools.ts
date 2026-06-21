import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";

import type { ConstructFlowToolCallRecord } from "../../shared/constructFlow";
import type { StoredFlowProject, StoredProject } from "../projects/ConstructProjectTypes";
import { isFlowProject } from "../projects/ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "../projects/ConstructProjectWorkspaceService";
import { ConstructFlowMemoryService, FLOW_MEMORY_FILES } from "../flow/ConstructFlowMemoryService";

const execFileAsync = promisify(execFile);

const MAX_TEXT_FILE_BYTES = 160_000;
const MAX_RESULT_CHARS = 12_000;
const MAX_MEMORY_RESULT_CHARS = 80_000;

const ignoredNames = new Set([
  ".git",
  ".construct",
  ".next",
  "dist",
  "node_modules",
  "build",
  "coverage"
]);

export type ConstructProtocolToolRecord = Omit<ConstructFlowToolCallRecord, "status"> & {
  status?: ConstructFlowToolCallRecord["status"];
};

export type ConstructProtocolToolCallSink = (record: ConstructProtocolToolRecord) => void;

export type ConstructProtocolToolsOptions = {
  project: StoredProject;
  workspace: ConstructProjectWorkspaceService;
  flowMemory?: ConstructFlowMemoryService;
  latestTerminalOutput?: string;
  tavilyApiKey?: string;
  allowWorkspaceMutation?: boolean;
  allowTerminalCommands?: boolean;
  terminalCommandMode?: "workspace" | "validation-only";
  onToolCallStart?: ConstructProtocolToolCallSink;
  onToolCall?: ConstructProtocolToolCallSink;
};

export function createConstructProtocolTools(options: ConstructProtocolToolsOptions): {
  tools: ToolsInput;
  toolCalls: ConstructProtocolToolRecord[];
} {
  const toolCalls: ConstructProtocolToolRecord[] = [];
  let toolCallSequence = 0;

  const recordToolCall = async <T>(
    name: string,
    title: string,
    reason: string,
    output: T | Promise<T>,
    input?: unknown,
    statusForOutput?: (resolved: T) => ConstructProtocolToolRecord["status"] | undefined
  ): Promise<T> => {
    toolCallSequence += 1;
    const baseRecord: ConstructProtocolToolRecord = {
      id: `${name}-${toolCallSequence}`,
      name,
      title,
      reason,
      input,
      createdAt: new Date().toISOString(),
      status: "running"
    };
    options.onToolCallStart?.(baseRecord);
    try {
      const resolved = await output;
      const status = statusForOutput?.(resolved) ?? "completed";
      const record: ConstructProtocolToolRecord = {
        ...baseRecord,
        status,
        completedAt: new Date().toISOString(),
        outputPreview: previewToolOutput(name, resolved)
      };
      toolCalls.push(record);
      options.onToolCall?.(record);
      return resolved;
    } catch (error) {
      const record: ConstructProtocolToolRecord = {
        ...baseRecord,
        status: "error",
        completedAt: new Date().toISOString(),
        outputPreview: error instanceof Error ? error.message : String(error)
      };
      toolCalls.push(record);
      options.onToolCall?.(record);
      throw error;
    }
  };

  const flowMemoryRead = createTool({
    id: "flow-memory-read",
    description: "Read selected Flow Memory markdown files. Use when durable project, path, research, or learner context would help. Does not mutate state.",
    inputSchema: z.object({
      files: z.array(z.enum(FLOW_MEMORY_FILES)).optional()
    }).strict(),
    execute: async (toolInput) => {
      const project = requireFlowProject(options.project);
      const memory = requireFlowMemory(options.flowMemory);
      return recordToolCall(
        "flow-memory-read",
        "Read Flow Memory",
        "Durable Flow project context",
        memory.read(project, toolInput.files),
        toolInput
      );
    }
  });

  const flowMemoryFetch = createTool({
    id: "flow-memory-fetch",
    description: "Fetch targeted Flow Memory by purpose. Specify why you need memory and which files are relevant; avoid fetching all files by habit.",
    inputSchema: z.object({
      purpose: z.string().min(1).max(500),
      files: z.array(z.enum(FLOW_MEMORY_FILES)).min(1).max(4),
      currentStep: z.string().max(300).optional(),
      projectPath: z.string().max(500).optional(),
      taskId: z.string().max(120).optional()
    }).strict(),
    execute: async (toolInput) => {
      const project = requireFlowProject(options.project);
      const memory = requireFlowMemory(options.flowMemory);
      return recordToolCall(
        "flow-memory-fetch",
        "Fetched Flow Memory",
        toolInput.purpose,
        memory.read(project, toolInput.files),
        toolInput
      );
    }
  });

  const flowMemoryEnsure = createTool({
    id: "flow-memory-ensure",
    description: "Create any missing Flow Memory markdown files. Use during Flow setup or recovery. Mutates only .construct/flow-memory.",
    inputSchema: z.object({}).strict(),
    execute: async () => {
      const project = requireFlowProject(options.project);
      const memory = requireFlowMemory(options.flowMemory);
      return recordToolCall(
        "flow-memory-ensure",
        "Ensured Flow Memory",
        "Created missing memory files",
        memory.ensure(project)
      );
    }
  });

  const flowMemoryUpdate = createTool({
    id: "flow-memory-update",
    description: "Manual full-save fallback for Flow Memory markdown files. Agent runs should prefer flow-memory-patch so changes are scoped and diffable.",
    inputSchema: z.object({
      updates: z.array(z.object({
        file: z.enum(FLOW_MEMORY_FILES),
        content: z.string()
      })).min(1).max(4)
    }).strict(),
    execute: async (toolInput) => {
      const project = requireFlowProject(options.project);
      const memory = requireFlowMemory(options.flowMemory);
      return recordToolCall(
        "flow-memory-update",
        "Updated Flow Memory",
        toolInput.updates.map((update) => update.file).join(", "),
        memory.updateWithDiff(project, toolInput.updates.map((update) => ({
          file: update.file,
          content: update.content
        }))),
        toolInput
      );
    }
  });

  const flowMemoryPatch = createTool({
    id: "flow-memory-patch",
    description: "Patch selected Flow Memory files with append, prepend, or exact replacement. Use this instead of rewriting full memory files. Returns a diff for the UI.",
    inputSchema: z.object({
      patches: z.array(z.object({
        file: z.enum(FLOW_MEMORY_FILES),
        mode: z.enum(["append", "prepend", "replace"]),
        content: z.string().min(1).max(4_000),
        find: z.string().optional().describe("Required for replace mode; exact text to replace."),
        reason: z.string().min(1).max(500)
      }).superRefine((patch, ctx) => {
        if (patch.mode === "replace" && !patch.find?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["find"],
            message: "Replace patches require exact find text."
          });
        }
      })).min(1).max(6)
    }).strict(),
    execute: async (toolInput) => {
      const project = requireFlowProject(options.project);
      const memory = requireFlowMemory(options.flowMemory);
      return recordToolCall(
        "flow-memory-patch",
        "Updated Flow Memory",
        toolInput.patches.map((patch) => `${patch.file}: ${patch.reason}`).join("; "),
        memory.patch(project, toolInput.patches),
        toolInput
      );
    }
  });

  const findFiles = createTool({
    id: "find-files",
    description: "Find project files by name, path fragment, extension, or intent. Safe read-only workspace search.",
    inputSchema: z.object({
      query: z.string().min(1).max(120),
      limit: z.number().int().min(1).max(50).default(20)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "find-files",
      "Found files",
      toolInput.query,
      findWorkspaceFiles(options.project, options.workspace, toolInput.query, toolInput.limit ?? 20),
      toolInput
    )
  });

  const searchContent = createTool({
    id: "search-content",
    description: "Search project content for symbols, strings, errors, TODOs, or concepts. Safe read-only workspace search.",
    inputSchema: z.object({
      query: z.string().min(1).max(160),
      limit: z.number().int().min(1).max(50).default(20)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "search-content",
      "Searched content",
      toolInput.query,
      searchWorkspaceContent(options.project, options.workspace, toolInput.query, toolInput.limit ?? 20),
      toolInput
    )
  });

  const view = createTool({
    id: "view",
    description: "Read a project file or line range. Use ranges instead of huge full files when possible. Safe read-only workspace access.",
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional()
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "view",
      `Viewed ${toolInput.path}`,
      "Read project context",
      viewWorkspaceFile(options.project, options.workspace, toolInput.path, toolInput.startLine, toolInput.endLine),
      toolInput
    )
  });

  const read = createTool({
    id: "read",
    description: "Claude-Code-style bounded file read. Read a project file or line range; prefer ranges over full files.",
    inputSchema: z.object({
      path: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional()
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "read",
      `Read ${toolInput.path}`,
      "Read bounded project context",
      viewWorkspaceFile(options.project, options.workspace, toolInput.path, toolInput.startLine, toolInput.endLine),
      toolInput
    )
  });

  const glob = createTool({
    id: "glob",
    description: "Claude-Code-style file glob. Find files by glob pattern without reading their contents.",
    inputSchema: z.object({
      pattern: z.string().min(1).max(160),
      limit: z.number().int().min(1).max(100).default(40)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "glob",
      "Matched files",
      toolInput.pattern,
      globWorkspaceFiles(options.project, options.workspace, toolInput.pattern, toolInput.limit ?? 40),
      toolInput
    )
  });

  const grep = createTool({
    id: "grep",
    description: "Claude-Code-style ripgrep-like content search. Search text with optional path glob and compact snippets.",
    inputSchema: z.object({
      query: z.string().min(1).max(160),
      pathGlob: z.string().max(160).optional(),
      caseSensitive: z.boolean().default(false),
      limit: z.number().int().min(1).max(80).default(30)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "grep",
      "Searched content",
      toolInput.pathGlob ? `${toolInput.query} in ${toolInput.pathGlob}` : toolInput.query,
      grepWorkspaceContent(options.project, options.workspace, toolInput.query, {
        limit: toolInput.limit ?? 30,
        caseSensitive: toolInput.caseSensitive === true,
        pathGlob: toolInput.pathGlob
      }),
      toolInput
    )
  });

  const focusCode = createTool({
    id: "focus-code",
    description: "Request that the UI focus a project file/range. Does not edit code.",
    inputSchema: z.object({
      path: z.string().min(1),
      line: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
      label: z.string().min(1).default("Focus code"),
      reason: z.string().min(1).default("Relevant code")
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "focus-code",
      `Focused ${toolInput.path}`,
      toolInput.reason ?? "Relevant code",
      {
        action: {
          type: "focus-code",
          path: toolInput.path,
          line: toolInput.line,
          endLine: toolInput.endLine,
          label: toolInput.label ?? "Focus code",
          reason: toolInput.reason ?? "Relevant code"
        }
      },
      toolInput
    )
  });

  const openFile = createTool({
    id: "open-file",
    description: "Request that the UI open a project file. Does not edit code.",
    inputSchema: z.object({
      path: z.string().min(1),
      label: z.string().min(1).default("Open file"),
      reason: z.string().min(1).default("Relevant file")
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "open-file",
      `Opened ${toolInput.path}`,
      toolInput.reason ?? "Relevant file",
      {
        action: {
          type: "open-file",
          path: toolInput.path,
          label: toolInput.label ?? "Open file",
          reason: toolInput.reason ?? "Relevant file"
        }
      },
      toolInput
    )
  });

  const focusTerminal = createTool({
    id: "focus-terminal",
    description: "Request that the UI focus the terminal. Does not run a command.",
    inputSchema: z.object({
      label: z.string().min(1).default("Focus terminal"),
      reason: z.string().min(1).default("Terminal output is relevant")
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "focus-terminal",
      "Focused terminal",
      toolInput.reason ?? "Terminal output is relevant",
      {
        action: {
          type: "focus-terminal",
          label: toolInput.label ?? "Focus terminal",
          reason: toolInput.reason ?? "Terminal output is relevant"
        }
      },
      toolInput
    )
  });

  const terminalLatest = createTool({
    id: "terminal-latest",
    description: "Read the latest terminal output summary for this project. Safe read-only terminal context.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "terminal-latest",
      "Checked terminal output",
      "Latest terminal output",
      {
        output: (options.latestTerminalOutput ?? "").slice(-4_000),
        truncated: (options.latestTerminalOutput ?? "").length > 4_000
      }
    )
  });

  const workspaceDiff = createTool({
    id: "workspace-diff",
    description: "Return a compact git/workspace diff summary. Safe read-only; useful before review or checkpoint.",
    inputSchema: z.object({}).strict(),
    execute: async () => recordToolCall(
      "workspace-diff",
      "Checked workspace diff",
      "Current workspace changes",
      currentWorkspaceDiff(options.project)
    )
  });

  const editWriteFile = createTool({
    id: "edit-write-file",
    description: "Create or rewrite a project file when explicitly appropriate. Mutates workspace; existing files should usually use edit-replace or edit-propose-patch first.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      reason: z.string().min(1)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "edit-write-file",
      `Wrote ${toolInput.path}`,
      toolInput.reason,
      writeWorkspaceFile(options, toolInput.path, toolInput.content),
      toolInput
    )
  });

  const write = createTool({
    id: "write",
    description: "Claude-Code-style file write. Create or rewrite a project file only when explicitly appropriate; prefer edit for existing files.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      reason: z.string().min(1)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "write",
      `Wrote ${toolInput.path}`,
      `${toolInput.reason} Authorship: agent-created content.`,
      writeWorkspaceFile(options, toolInput.path, toolInput.content).then((result) => ({
        ...result,
        authoredBy: "agent"
      })),
      toolInput
    )
  });

  const editReplace = createTool({
    id: "edit-replace",
    description: "Replace one exact string in a project file. Mutates workspace only when one exact match is found.",
    inputSchema: z.object({
      path: z.string().min(1),
      find: z.string().min(1),
      replace: z.string(),
      reason: z.string().min(1)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "edit-replace",
      `Edited ${toolInput.path}`,
      toolInput.reason,
      replaceInWorkspaceFile(options, toolInput.path, toolInput.find, toolInput.replace),
      toolInput
    )
  });

  const edit = createTool({
    id: "edit",
    description: "Claude-Code-style exact string edit. Replace one exact string in a project file; refuses ambiguous matches.",
    inputSchema: z.object({
      path: z.string().min(1),
      find: z.string().min(1),
      replace: z.string(),
      reason: z.string().min(1)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "edit",
      `Edited ${toolInput.path}`,
      `${toolInput.reason} Authorship: agent edit.`,
      replaceInWorkspaceFile(options, toolInput.path, toolInput.find, toolInput.replace).then((result) => ({
        ...result,
        authoredBy: "agent"
      })),
      toolInput
    )
  });

  const runTerminalCommand = createTool({
    id: "run-terminal-command",
    description: "Run a safe terminal command in the project workspace with timeout and concise output. Risky/destructive/package-install commands are refused unless policy allows them.",
    inputSchema: z.object({
      command: z.string().min(1).max(500),
      cwd: z.string().optional(),
      label: z.string().min(1).default("Run command"),
      reason: z.string().min(1).default("Validate project state"),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "run-terminal-command",
      `Ran ${toolInput.label ?? "Run command"}`,
      toolInput.reason ?? "Validate project state",
      runCommand(options, toolInput.command, toolInput.cwd, toolInput.timeoutMs ?? 30_000).then((result) => ({
        ...result,
        action: {
          type: "focus-terminal",
          label: toolInput.label ?? "Run command",
          reason: toolInput.reason ?? "Validate project state"
        }
      })),
      toolInput,
      terminalToolStatus
    )
  });

  const createQuestionTool = (id: "ask-question" | "askQuestion" | "ask-user" | "askUser") => createTool({
    id,
    description: "Ask the learner a direct tracked question when their answer is useful for learner modeling or required to choose the next step. The question field should be the short direct question only; put any brief setup in normal chat before the tool call. Reason is internal and should stay concise. Use for learner background, preferences, constraints, goals, confidence, clarification, design choices, blockers, or approvals. Do not use this for quizzes, recap prompts, or questions whose answer can be taught in chat or encoded in task guidance. Questions pause the Flow session until answered unless the caller explicitly resumes later.",
    inputSchema: z.object({
      question: z.string().min(1),
      reason: z.string().optional(),
      choices: z.array(z.string()).max(6).optional(),
      allowOther: z.boolean().default(true),
      allowSkip: z.boolean().default(true),
      blocksProgress: z.boolean().default(true)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      id,
      "Asked learner",
      toolInput.reason ?? "Learner input needed",
      toolInput,
      toolInput
    )
  });
  const askQuestion = createQuestionTool("ask-question");
  const askQuestionAlias = createQuestionTool("askQuestion");
  const askUser = createQuestionTool("ask-user");
  const askUserAlias = createQuestionTool("askUser");

  const internetSearch = createTool({
    id: "internet-search",
    description: "Search the web for current project/domain/technology research. Use mainly from the Flow Research Agent; returns concise source-grounded results.",
    inputSchema: z.object({
      query: z.string().min(2).max(180),
      limit: z.number().int().min(1).max(6).default(4)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "internet-search",
      "Searched web",
      toolInput.query,
      searchInternet(toolInput.query, toolInput.limit ?? 4, options.tavilyApiKey),
      toolInput
    )
  });
  const createInternetFetchTool = (id: "internet-fetch" | "internetFetch") => createTool({
    id,
    description: "Fetch readable content from exact public web URLs. Uses Tavily Extract when configured, with a bounded public HTTP fallback. Use after internet-search when you need the source page contents.",
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1).max(5),
      query: z.string().min(2).max(180).optional(),
      maxChars: z.number().int().min(1_000).max(20_000).default(6_000),
      extractDepth: z.enum(["basic", "advanced"]).default("basic"),
      chunksPerSource: z.number().int().min(1).max(5).optional(),
      format: z.enum(["markdown", "text"]).default("markdown"),
      timeoutSeconds: z.number().min(1).max(30).default(10)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      id,
      "Fetched web page",
      toolInput.query ?? toolInput.urls.join(", "),
      fetchInternetPages({
        urls: toolInput.urls,
        query: toolInput.query,
        maxChars: toolInput.maxChars ?? 6_000,
        extractDepth: toolInput.extractDepth ?? "basic",
        chunksPerSource: toolInput.chunksPerSource,
        format: toolInput.format ?? "markdown",
        timeoutSeconds: toolInput.timeoutSeconds ?? 10,
        tavilyApiKey: options.tavilyApiKey
      }),
      toolInput
    )
  });
  const internetFetch = createInternetFetchTool("internet-fetch");
  const internetFetchAlias = createInternetFetchTool("internetFetch");

  const tools: ToolsInput = {
    findFiles,
    searchContent,
    view,
    read,
    glob,
    grep,
    focusCode,
    openFile,
    focusTerminal,
    terminalLatest,
    workspaceDiff,
    "ask-question": askQuestion,
    askQuestion: askQuestionAlias,
    "ask-user": askUser,
    askUser: askUserAlias,
    internetSearch,
    "internet-fetch": internetFetch,
    internetFetch: internetFetchAlias
  };

  if (isFlowProject(options.project)) {
    tools.flowMemoryRead = flowMemoryRead;
    tools.flowMemoryFetch = flowMemoryFetch;
    tools.flowMemoryEnsure = flowMemoryEnsure;
    tools.flowMemoryPatch = flowMemoryPatch;
    tools.flowMemoryUpdate = flowMemoryUpdate;
  }

  if (options.allowWorkspaceMutation) {
    tools.editWriteFile = editWriteFile;
    tools.editReplace = editReplace;
    tools.edit = edit;
    tools.write = write;
  }

  if (options.allowTerminalCommands) {
    tools.runTerminalCommand = runTerminalCommand;
  }

  return { tools, toolCalls };
}

export async function readWorkspaceFileForProtocol(
  project: Pick<StoredProject, "workspacePath">,
  workspace: ConstructProjectWorkspaceService,
  relativePath: string
): Promise<string> {
  const target = workspace.safeProjectPath(project, relativePath);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File is too large to read through the agent tool: ${relativePath}`);
  }
  return readFile(target, "utf8");
}

async function findWorkspaceFiles(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  query: string,
  limit: number
) {
  const needle = query.toLowerCase();
  const files = await listProjectFiles(project, workspace);
  return files
    .filter((file) => file.path.toLowerCase().includes(needle) || file.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((file) => ({
      path: file.path,
      name: file.name,
      hint: file.directory || "."
    }));
}

async function searchWorkspaceContent(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  query: string,
  limit: number
) {
  const needle = query.toLowerCase();
  const files = await listProjectFiles(project, workspace);
  const results: Array<{ path: string; line: number; snippet: string }> = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const target = workspace.safeProjectPath(project, file.path);
    const fileStat = await stat(target).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > MAX_TEXT_FILE_BYTES) continue;
    const content = await readFile(target, "utf8").catch(() => "");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(needle)) continue;
      results.push({
        path: file.path,
        line: index + 1,
        snippet: lines[index].trim().slice(0, 240)
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}

async function globWorkspaceFiles(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  pattern: string,
  limit: number
) {
  const files = await listProjectFiles(project, workspace);
  const matcher = globToRegExp(pattern);
  return files
    .filter((file) => matcher.test(file.path))
    .slice(0, limit)
    .map((file) => ({
      path: file.path,
      name: file.name,
      hint: file.directory || "."
    }));
}

async function grepWorkspaceContent(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  query: string,
  options: {
    limit: number;
    caseSensitive: boolean;
    pathGlob?: string;
  }
) {
  const files = await listProjectFiles(project, workspace);
  const pathMatcher = options.pathGlob ? globToRegExp(options.pathGlob) : null;
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const results: Array<{ path: string; line: number; snippet: string }> = [];

  for (const file of files) {
    if (results.length >= options.limit) break;
    if (pathMatcher && !pathMatcher.test(file.path)) continue;
    const target = workspace.safeProjectPath(project, file.path);
    const fileStat = await stat(target).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > MAX_TEXT_FILE_BYTES) continue;
    const content = await readFile(target, "utf8").catch(() => "");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const haystack = options.caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (!haystack.includes(needle)) continue;
      results.push({
        path: file.path,
        line: index + 1,
        snippet: lines[index].trim().slice(0, 240)
      });
      if (results.length >= options.limit) break;
    }
  }

  return results;
}

async function viewWorkspaceFile(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  relativePath: string,
  startLine?: number,
  endLine?: number
) {
  const content = await readWorkspaceFileForProtocol(project, workspace, relativePath);
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? (startLine ? start + 80 : Math.min(lines.length, 160)));
  const excerpt = lines.slice(start - 1, end).map((line, offset) => `${start + offset}: ${line}`).join("\n");
  return {
    path: relativePath,
    lineStart: start,
    lineEnd: end,
    totalLines: lines.length,
    excerpt,
    truncated: start > 1 || end < lines.length
  };
}

async function writeWorkspaceFile(
  options: ConstructProtocolToolsOptions,
  relativePath: string,
  content: string
) {
  if (!options.allowWorkspaceMutation) {
    throw new Error("Workspace mutation is not allowed for this agent run.");
  }
  const target = options.workspace.safeProjectPath(options.project, relativePath);
  const existed = existsSync(target);
  const before = existed ? await readFile(target, "utf8").catch(() => "") : "";
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return {
    path: relativePath,
    bytes: Buffer.byteLength(content, "utf8"),
    existed,
    lineStats: lineChangeStats(before, content, existed ? "overwrite" : "create")
  };
}

async function replaceInWorkspaceFile(
  options: ConstructProtocolToolsOptions,
  relativePath: string,
  find: string,
  replace: string
) {
  if (!options.allowWorkspaceMutation) {
    throw new Error("Workspace mutation is not allowed for this agent run.");
  }
  const content = await readWorkspaceFileForProtocol(options.project, options.workspace, relativePath);
  const first = content.indexOf(find);
  if (first < 0) {
    throw new Error(`Could not find exact text in ${relativePath}.`);
  }
  if (content.indexOf(find, first + find.length) >= 0) {
    throw new Error(`Exact text appears more than once in ${relativePath}; use a narrower replacement.`);
  }
  const next = `${content.slice(0, first)}${replace}${content.slice(first + find.length)}`;
  const target = options.workspace.safeProjectPath(options.project, relativePath);
  await writeFile(target, next, "utf8");
  return {
    path: relativePath,
    replacedCharacters: find.length,
    insertedCharacters: replace.length,
    lineStats: {
      additions: countTextLines(replace),
      deletions: countTextLines(find),
      beforeLines: countTextLines(content),
      afterLines: countTextLines(next),
      netLines: countTextLines(next) - countTextLines(content),
      mode: "replace"
    }
  };
}

function lineChangeStats(before: string, after: string, mode: "create" | "overwrite") {
  const beforeLines = countTextLines(before);
  const afterLines = countTextLines(after);
  if (mode === "create") {
    return {
      additions: afterLines,
      deletions: 0,
      beforeLines: 0,
      afterLines,
      netLines: afterLines,
      mode
    };
  }
  if (before === after) {
    return {
      additions: 0,
      deletions: 0,
      beforeLines,
      afterLines,
      netLines: 0,
      mode
    };
  }
  return {
    additions: afterLines,
    deletions: beforeLines,
    beforeLines,
    afterLines,
    netLines: afterLines - beforeLines,
    mode
  };
}

function countTextLines(value: string): number {
  if (!value) return 0;
  const normalized = value.endsWith("\n") ? value.slice(0, -1) : value;
  return normalized ? normalized.split(/\r?\n/).length : 0;
}

async function currentWorkspaceDiff(project: StoredProject) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", project.workspacePath, "diff", "--", "."], {
      timeout: 20_000,
      maxBuffer: 512_000
    });
    return {
      isGit: true,
      diff: stdout.slice(0, MAX_RESULT_CHARS),
      truncated: stdout.length > MAX_RESULT_CHARS
    };
  } catch (error) {
    return {
      isGit: false,
      diff: "",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runCommand(
  options: ConstructProtocolToolsOptions,
  command: string,
  cwd: string | undefined,
  timeoutMs: number
) {
  if (!options.allowTerminalCommands) {
    throw new Error("Terminal commands are not allowed for this agent run.");
  }
  const safety = commandSafety(command, options.terminalCommandMode ?? "workspace");
  if (!safety.allowed) {
    return {
      status: "blocked",
      reason: safety.reason,
      command
    };
  }

  const resolvedCwd = cwd
    ? options.workspace.safeProjectPath(options.project, cwd)
    : options.project.workspacePath;
  try {
    const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-lc", command], {
      cwd: resolvedCwd,
      timeout: timeoutMs,
      maxBuffer: 512_000
    });
    return {
      status: "completed",
      command,
      cwd: resolvedCwd,
      stdout: stdout.slice(-8_000),
      stderr: stderr.slice(-8_000),
      truncated: stdout.length + stderr.length > 16_000
    };
  } catch (error) {
    const record = error as {
      code?: number | string;
      signal?: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = bufferToString(record.stdout).slice(-8_000);
    const stderr = (bufferToString(record.stderr) || record.message || "Command failed.").slice(-8_000);
    return {
      status: "failed",
      command,
      cwd: resolvedCwd,
      exitCode: record.code ?? null,
      signal: record.signal ?? null,
      stdout,
      stderr,
      truncated: stdout.length + stderr.length > 16_000
    };
  }
}

function bufferToString(value: string | Buffer | undefined): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

async function searchInternet(query: string, limit: number, tavilyApiKey?: string) {
  const boundedLimit = Math.min(Math.max(limit, 1), 6);
  const boundedQuery = query.trim().slice(0, 380);
  if (tavilyApiKey?.trim()) {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${tavilyApiKey.trim()}`
      },
      body: JSON.stringify({
        query: boundedQuery,
        max_results: boundedLimit,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        include_images: false
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Tavily search failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    const json = await response.json() as {
      results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
    };
    return (json.results ?? []).slice(0, boundedLimit).map((result) => ({
      title: result.title ?? result.url ?? "Untitled result",
      url: result.url ?? "",
      snippet: result.content ?? "",
      score: result.score ?? null,
      provider: "tavily"
    }));
  }

  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(boundedQuery)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Construct Flow Research/1.0"
    }
  });
  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  return matches.slice(0, boundedLimit).map((match) => ({
    title: stripHtml(match[2]),
    url: decodeDuckDuckGoUrl(match[1]),
    snippet: stripHtml(match[3]),
    provider: "duckduckgo"
  }));
}

async function fetchInternetPages(input: {
  urls: string[];
  query?: string;
  maxChars: number;
  extractDepth: "basic" | "advanced";
  chunksPerSource?: number;
  format: "markdown" | "text";
  timeoutSeconds: number;
  tavilyApiKey?: string;
}) {
  const urls = input.urls.map(normalizePublicWebUrl);
  const maxChars = Math.min(Math.max(input.maxChars, 1_000), 20_000);
  if (input.tavilyApiKey?.trim()) {
    const body: Record<string, unknown> = {
      urls: urls.length === 1 ? urls[0] : urls,
      extract_depth: input.extractDepth,
      include_images: false,
      include_favicon: true,
      format: input.format,
      timeout: Math.min(Math.max(input.timeoutSeconds, 1), 30),
      include_usage: true
    };
    if (input.query?.trim()) {
      body.query = input.query.trim().slice(0, 180);
      body.chunks_per_source = input.chunksPerSource ?? 3;
    }
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.tavilyApiKey.trim()}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Tavily extract failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    const json = await response.json() as {
      results?: Array<{ url?: string; raw_content?: string; favicon?: string }>;
      failed_results?: Array<{ url?: string; error?: string }>;
      response_time?: number;
      usage?: { credits?: number };
      request_id?: string;
    };
    return {
      provider: "tavily",
      results: (json.results ?? []).map((result) => {
        const content = result.raw_content ?? "";
        return {
          url: result.url ?? "",
          title: titleFromMarkdown(content) ?? result.url ?? "Fetched page",
          content: content.slice(0, maxChars),
          truncated: content.length > maxChars,
          favicon: result.favicon
        };
      }),
      failedResults: json.failed_results ?? [],
      responseTime: json.response_time,
      usage: json.usage,
      requestId: json.request_id
    };
  }

  return {
    provider: "http",
    results: await Promise.all(urls.map((url) => fetchPublicPage(url, maxChars))),
    failedResults: []
  };
}

async function fetchPublicPage(url: string, maxChars: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Construct Flow Research/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const content = contentType.includes("html") ? htmlToReadableText(text) : text.replace(/\s+/g, " ").trim();
    return {
      url,
      title: readHtmlTitle(text) ?? url,
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
      provider: "http"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePublicWebUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be fetched: ${value}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost"
    || hostname.endsWith(".local")
    || /^127\./.test(hostname)
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw new Error(`Refusing to fetch non-public URL: ${value}`);
  }
  return url.toString();
}

async function listProjectFiles(
  project: StoredProject,
  workspace: ConstructProjectWorkspaceService,
  root = ""
): Promise<Array<{ path: string; name: string; directory: string }>> {
  const absoluteRoot = workspace.safeProjectPath(project, root || ".");
  const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
  const files: Array<{ path: string; name: string; directory: string }> = [];

  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listProjectFiles(project, workspace, path.join(root, entry.name)));
      continue;
    }
    files.push({
      path: relativePath,
      name: entry.name,
      directory: path.posix.dirname(relativePath)
    });
  }

  return files;
}

function commandSafety(
  command: string,
  mode: NonNullable<ConstructProtocolToolsOptions["terminalCommandMode"]>
): { allowed: true } | { allowed: false; reason: string } {
  const normalized = command.trim().toLowerCase();
  if (mode === "validation-only" && /(?:^|[;&|]\s*)(?:rm|unlink|mv|truncate|touch|mkdir|rmdir)\b/.test(normalized)) {
    return { allowed: false, reason: "Validation terminal mode blocks commands that modify or delete workspace files." };
  }
  const risky = [
    /\brm\b/,
    /\bunlink\b/,
    /\bmv\b/,
    /\btruncate\b/,
    /\bgit\s+(?:reset|clean)\b/,
    /\bgit\s+(?:checkout|restore)\s+--\b/,
    /\brm\s+-[^&|;]*r/,
    /\bsudo\b/,
    /\bchmod\s+-r\b/,
    /\bchown\s+-r\b/,
    /\bdd\s+/,
    /\bmkfs\b/,
    /\bshutdown\b/,
    /\breboot\b/
  ];
  if (risky.some((pattern) => pattern.test(normalized))) {
    return { allowed: false, reason: "Command looks destructive or privileged." };
  }
  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:add|install|remove|update|upgrade)\b/.test(normalized)) {
    return { allowed: false, reason: "Package manager mutation requires explicit user approval." };
  }
  return { allowed: true };
}

function terminalToolStatus(result: unknown): ConstructProtocolToolRecord["status"] | undefined {
  if (!result || typeof result !== "object") return undefined;
  const status = (result as { status?: unknown }).status;
  return status === "failed" || status === "blocked" ? "error" : undefined;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replaceAll("\\", "/") || "**/*";
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExp(char);
    }
  }
  return new RegExp(`^${expression}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireFlowProject(project: StoredProject): StoredFlowProject {
  if (!isFlowProject(project)) {
    throw new Error("This tool is available only for Flow projects.");
  }
  return project;
}

function requireFlowMemory(memory: ConstructFlowMemoryService | undefined): ConstructFlowMemoryService {
  if (!memory) {
    throw new Error("Flow Memory service is not configured.");
  }
  return memory;
}

function decodeDuckDuckGoUrl(value: string): string {
  const decoded = value.replace(/&amp;/g, "&");
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    return url.searchParams.get("uddg") ?? decoded;
  } catch {
    return decoded;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToReadableText(value: string): string {
  return stripHtml(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr)>/gi, "\n"));
}

function readHtmlTitle(value: string): string | undefined {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? stripHtml(match[1]) : "";
  return title || undefined;
}

function titleFromMarkdown(value: string): string | undefined {
  const heading = value.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  return heading?.replace(/^#{1,3}\s+/, "").trim() || undefined;
}

function previewToolOutput(name: string, value: unknown): string {
  if (name === "flow-memory-patch" || name === "flow-memory-update") {
    return previewJson(value, MAX_MEMORY_RESULT_CHARS);
  }
  return preview(value);
}

function previewJson(value: unknown, maxChars: number): string {
  try {
    const rendered = JSON.stringify(value, null, 2);
    if (rendered.length <= maxChars) {
      return rendered;
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value.map((item) => truncateMemoryResult(item, Math.floor(maxChars / Math.max(value.length, 1)))), null, 2);
    }
    return JSON.stringify({ truncated: true, preview: rendered.slice(0, maxChars) }, null, 2);
  } catch {
    return String(value).slice(0, maxChars);
  }
}

function truncateMemoryResult(value: unknown, maxChars: number): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const result: Record<string, unknown> = { ...(value as Record<string, unknown>), truncated: true };
  for (const key of ["diff", "addedText", "removedText", "content"]) {
    const field = result[key];
    if (typeof field === "string" && field.length > maxChars) {
      result[key] = `${field.slice(0, maxChars)}\n... [truncated]`;
    }
  }
  return result;
}

function preview(value: unknown): string {
  try {
    const rendered = JSON.stringify(value, null, 2);
    return rendered.length > MAX_RESULT_CHARS ? `${rendered.slice(0, MAX_RESULT_CHARS)}\n... [truncated]` : rendered;
  } catch {
    return String(value).slice(0, MAX_RESULT_CHARS);
  }
}
