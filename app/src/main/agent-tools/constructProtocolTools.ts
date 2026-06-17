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
  allowWorkspaceMutation?: boolean;
  allowTerminalCommands?: boolean;
  onToolCallStart?: ConstructProtocolToolCallSink;
  onToolCall?: ConstructProtocolToolCallSink;
};

export function createConstructProtocolTools(options: ConstructProtocolToolsOptions): {
  tools: ToolsInput;
  toolCalls: ConstructProtocolToolRecord[];
} {
  const toolCalls: ConstructProtocolToolRecord[] = [];

  const recordToolCall = async <T>(
    name: string,
    title: string,
    reason: string,
    output: T | Promise<T>,
    input?: unknown
  ): Promise<T> => {
    const baseRecord: ConstructProtocolToolRecord = {
      id: `${name}-${toolCalls.length + 1}`,
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
      const record: ConstructProtocolToolRecord = {
        ...baseRecord,
        status: "completed",
        completedAt: new Date().toISOString(),
        outputPreview: preview(resolved)
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
    description: "Rewrite one or more Flow Memory markdown files with concise human-readable updates. Mutates only .construct/flow-memory.",
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
        memory.update(project, toolInput.updates.map((update) => ({
          file: update.file,
          content: update.content
        }))),
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
      toolInput
    )
  });

  const askUser = createTool({
    id: "ask-user",
    description: "Ask the learner a direct tracked question. This is mandatory whenever the agent needs an answer from the learner; do not ask required questions only in prose. Use for clarification, design choices, understanding checks, blockers, or approval. Does not itself wait in the backend.",
    inputSchema: z.object({
      question: z.string().min(1),
      reason: z.string().optional(),
      choices: z.array(z.string()).max(6).optional(),
      blocksProgress: z.boolean().default(false)
    }).strict(),
    execute: async (toolInput) => recordToolCall(
      "ask-user",
      "Asked learner",
      toolInput.reason ?? "Learner input needed",
      toolInput,
      toolInput
    )
  });

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
      searchInternet(toolInput.query, toolInput.limit ?? 4),
      toolInput
    )
  });

  const tools: ToolsInput = {
    findFiles,
    searchContent,
    view,
    focusCode,
    openFile,
    focusTerminal,
    terminalLatest,
    workspaceDiff,
    askUser,
    internetSearch
  };

  if (isFlowProject(options.project)) {
    tools.flowMemoryRead = flowMemoryRead;
    tools.flowMemoryEnsure = flowMemoryEnsure;
    tools.flowMemoryUpdate = flowMemoryUpdate;
  }

  if (options.allowWorkspaceMutation) {
    tools.editWriteFile = editWriteFile;
    tools.editReplace = editReplace;
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
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: relativePath, bytes: Buffer.byteLength(content, "utf8") };
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
  await writeWorkspaceFile(options, relativePath, next);
  return {
    path: relativePath,
    replacedCharacters: find.length,
    insertedCharacters: replace.length
  };
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
  const safety = commandSafety(command);
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
}

async function searchInternet(query: string, limit: number) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Construct Flow Research/1.0"
    }
  });
  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  return matches.slice(0, limit).map((match) => ({
    title: stripHtml(match[2]),
    url: decodeDuckDuckGoUrl(match[1]),
    snippet: stripHtml(match[3])
  }));
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

function commandSafety(command: string): { allowed: true } | { allowed: false; reason: string } {
  const normalized = command.trim().toLowerCase();
  const risky = [
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

function preview(value: unknown): string {
  try {
    const rendered = JSON.stringify(value, null, 2);
    return rendered.length > MAX_RESULT_CHARS ? `${rendered.slice(0, MAX_RESULT_CHARS)}\n... [truncated]` : rendered;
  } catch {
    return String(value).slice(0, MAX_RESULT_CHARS);
  }
}
