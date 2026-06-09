import path from "node:path";
import { exec, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage, nativeTheme } from "electron";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";

import {
  runConstructVerifierAgent,
  type VerificationLogEntry,
  type VerificationResult
} from "./constructVerifierAgent";

if (typeof process.loadEnvFile === "function") {
  const envPath = path.resolve(__dirname, "../../.env");
  try { process.loadEnvFile(envPath); } catch { /* .env doesn't exist */ }
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const shouldOpenDevTools = process.env.CONSTRUCT_OPEN_DEVTOOLS === "1";
const ignoredWorkspaceEntries = new Set([
  ".git",
  ".next",
  "dist",
  "node_modules"
]);
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

type StoredProject = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  source: string;
  sourcePath: string | null;
  program: {
    id: string;
    title: string;
    description: string;
    files: Array<{ path: string; content: string }>;
    references?: Array<{
      id: string;
      title: string;
      body: string;
    }>;
    targets?: unknown[];
    steps: Array<{ blocks: Array<{ id: string }> }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  assistance: Record<string, StoredBlockAssistance>;
  verificationResults: Record<string, VerificationResult>;
  completedBlocks: Record<string, boolean>;
  completedAt: string | null;
};

type StoredBlockAssistance = {
  revealLineCount: number;
  revealBlockCount: number;
  referenceCardsOpened: string[];
  referenceCardsPinned: string[];
  extraExplanationCount: number;
  recallAttemptCount: number;
  verificationFailureCount: number;
};

type StoredSettings = {
  workspaceRoot: string;
};

const terminalSessions = new Map<string, pty.IPty>();
const latestTerminalOutputByProject = new Map<string, string>();

function sendToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function constructProjectsRoot(): string {
  return path.join(app.getPath("userData"), "construct-projects");
}

function projectsManifestPath(): string {
  return path.join(constructProjectsRoot(), "projects.json");
}

function settingsPath(): string {
  return path.join(constructProjectsRoot(), "settings.json");
}

function workspacePathForProject(projectId: string): string {
  return path.join(constructProjectsRoot(), "workspaces", projectId);
}

function defaultWorkspaceParent(): string {
  return path.join(constructProjectsRoot(), "workspaces");
}

async function readProjects(): Promise<StoredProject[]> {
  await mkdir(constructProjectsRoot(), { recursive: true });

  if (!existsSync(projectsManifestPath())) {
    return [];
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (JSON.parse(await readFile(projectsManifestPath(), "utf8")) as StoredProject[])
        .map(normalizeStoredProject);
    } catch (error) {
      if (attempt === 2) {
        console.error("[construct-projects] Failed to read project manifest.", error);
        return [];
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return [];
}

function normalizeStoredProject(project: StoredProject): StoredProject {
  return {
    ...project,
    program: {
      ...project.program,
      references: project.program.references ?? [],
      targets: project.program.targets ?? []
    },
    assistance: project.assistance ?? {},
    verificationResults: project.verificationResults ?? {},
    fileTreeExpanded: project.fileTreeExpanded ?? [],
    typingProgress: project.typingProgress ?? {},
    editAnchors: project.editAnchors ?? {},
    completedBlocks: project.completedBlocks ?? {},
    completedAt: project.completedAt ?? null
  };
}

async function writeProjects(projects: StoredProject[]): Promise<void> {
  await mkdir(constructProjectsRoot(), { recursive: true });
  const target = projectsManifestPath();
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function readSettings(): Promise<StoredSettings> {
  await mkdir(constructProjectsRoot(), { recursive: true });

  if (!existsSync(settingsPath())) {
    return { workspaceRoot: defaultWorkspaceParent() };
  }

  try {
    const parsed = JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<StoredSettings>;
    return {
      workspaceRoot: parsed.workspaceRoot || defaultWorkspaceParent()
    };
  } catch {
    return { workspaceRoot: defaultWorkspaceParent() };
  }
}

async function writeSettings(settings: StoredSettings): Promise<void> {
  await mkdir(constructProjectsRoot(), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function calculateProgress(project: StoredProject): number {
  const blockCount = project.program.steps.reduce(
    (total, step) => total + step.blocks.length,
    0
  );

  if (blockCount === 0) {
    return 0;
  }

  const completed = Object.values(project.completedBlocks).filter(Boolean).length;
  return Math.min(100, Math.round((completed / blockCount) * 100));
}

function safeProjectPath(project: Pick<StoredProject, "workspacePath">, relativePath: string): string {
  const workspace = path.resolve(project.workspacePath);
  const normalized = path.normalize(relativePath);

  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid project file path: ${relativePath}`);
  }

  const resolved = path.resolve(workspace, normalized);
  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Project file escaped workspace: ${relativePath}`);
  }

  return resolved;
}

async function materializeInitialFiles(project: StoredProject): Promise<void> {
  await mkdir(project.workspacePath, { recursive: true });

  for (const file of project.program.files) {
    const target = safeProjectPath(project, file.path);
    await mkdir(path.dirname(target), { recursive: true });

    if (!existsSync(target)) {
      await writeFile(target, file.content, "utf8");
    }
  }
}

async function listWorkspaceTree(project: StoredProject, root = ""): Promise<unknown[]> {
  const absoluteRoot = safeProjectPath(project, root || ".");
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !ignoredWorkspaceEntries.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map(async (entry) => {
        const relativePath = path.posix.join(root.split(path.sep).join("/"), entry.name);
        const node = {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? "directory" : "file",
          children: entry.isDirectory()
            ? await listWorkspaceTree(project, path.join(root, entry.name))
            : undefined
        };

        return node;
      })
  );

  return nodes;
}

function findProject(projects: StoredProject[], id: string): StoredProject {
  const project = projects.find((candidate) => candidate.id === id);

  if (!project) {
    throw new Error(`Unknown Construct project: ${id}`);
  }

  return project;
}

async function initializeGitRepository(workspacePath: string): Promise<void> {
  if (existsSync(path.join(workspacePath, ".git"))) {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: workspacePath });
}

function summarizeProject(project: StoredProject) {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    progress: project.progress,
    lastOpenedAt: project.lastOpenedAt,
    workspacePath: project.workspacePath,
    sourcePath: project.sourcePath ?? null
  };
}

function appendTerminalOutput(projectId: string, data: string): void {
  const previous = latestTerminalOutputByProject.get(projectId) ?? "";
  const next = `${previous}${data}`;
  latestTerminalOutputByProject.set(projectId, next.slice(-30_000));
}

function addVerificationLog(
  logs: VerificationLogEntry[],
  status: VerificationLogEntry["status"],
  message: string,
  detail?: string
): void {
  const entry = {
    at: new Date().toISOString(),
    status,
    message,
    detail
  };
  logs.push(entry);
  console.log("[construct verifier]", status, message, detail ? { detail } : "");
  sendToRenderers("construct:project:verify-log", { entry });
}

function withVerificationLogs(
  result: VerificationResult,
  logs: VerificationLogEntry[]
): VerificationResult {
  return {
    ...result,
    logs
  };
}

function summarizeTerminalForLog(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const summary = lines.slice(-8).join("\n");
  return summary.length > 1200 ? `${summary.slice(0, 1200)}…` : summary || "(no output)";
}

async function runVerificationCommand(
  project: StoredProject,
  command: string
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: project.workspacePath,
      maxBuffer: 2 * 1024 * 1024,
      shell: process.env.SHELL || "/bin/zsh"
    });

    return [
      `$ ${command}`,
      stdout,
      stderr
    ].filter(Boolean).join("\n");
  } catch (error) {
    const failed = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };

    return [
      `$ ${command}`,
      `[exit ${failed.code ?? "unknown"}]`,
      failed.stdout ?? "",
      failed.stderr ?? "",
      failed.message
    ].filter(Boolean).join("\n");
  }
}

function installConstructProjectIpcHandlers(): void {
  ipcMain.handle("construct:theme:set", async (_event, theme: "light" | "dark" | "system") => {
    nativeTheme.themeSource = theme;
  });

  ipcMain.handle("construct:dialog:open-construct-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open .construct project",
      properties: ["openFile"],
      filters: [
        { name: "Construct Projects", extensions: ["construct"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths[0] == null) {
      return null;
    }

    const sourcePath = result.filePaths[0];
    return {
      path: sourcePath,
      source: await readFile(sourcePath, "utf8")
    };
  });

  ipcMain.handle("construct:dialog:select-workspace-directory", async (_event, input) => {
    const result = await dialog.showOpenDialog({
      title: "Choose project workspace",
      defaultPath: typeof input?.defaultPath === "string" ? input.defaultPath : defaultWorkspaceParent(),
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths[0] == null) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("construct:settings:get", async () => {
    return readSettings();
  });

  ipcMain.handle("construct:settings:set-workspace-root", async (_event, input) => {
    const workspaceRoot = path.resolve(String(input.workspaceRoot || defaultWorkspaceParent()));
    await mkdir(workspaceRoot, { recursive: true });
    const projects = await readProjects();

    for (const project of projects) {
      const currentWorkspace = path.resolve(project.workspacePath);
      if (currentWorkspace === workspaceRoot || currentWorkspace.startsWith(`${workspaceRoot}${path.sep}`)) {
        continue;
      }

      const nextWorkspace = path.join(workspaceRoot, project.id);
      if (existsSync(currentWorkspace) && !existsSync(nextWorkspace)) {
        await cp(currentWorkspace, nextWorkspace, { recursive: true });
      }
      await mkdir(nextWorkspace, { recursive: true });
      project.workspacePath = nextWorkspace;
    }

    const settings = { workspaceRoot };
    await writeSettings(settings);
    await writeProjects(projects);

    return {
      settings,
      projects: projects.map(summarizeProject)
    };
  });

  ipcMain.handle("construct:project:import", async (_event, input) => {
    const projects = await readProjects();
    const settings = await readSettings();
    const existingIndex = projects.findIndex((project) => project.id === input.program.id);
    const now = new Date().toISOString();
    const workspacePath =
      typeof input.workspacePath === "string" && input.workspacePath.trim()
        ? path.resolve(input.workspacePath)
        : path.join(settings.workspaceRoot, input.program.id);

    if (existingIndex >= 0) {
      const existing = projects[existingIndex];
      projects[existingIndex] = {
        ...existing,
        source: input.source,
        sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : existing.sourcePath ?? null,
        program: input.program,
        title: input.program.title,
        description: input.program.description,
        workspacePath,
        lastOpenedAt: now
      };
      projects[existingIndex].progress = calculateProgress(projects[existingIndex]);
      await materializeInitialFiles(projects[existingIndex]);
      if (input.initializeGit === true) {
        await initializeGitRepository(projects[existingIndex].workspacePath);
      }
      await writeProjects(projects);
      return projects[existingIndex];
    }

    const project: StoredProject = {
      id: input.program.id,
      title: input.program.title,
      description: input.program.description,
      progress: 0,
      lastOpenedAt: now,
      workspacePath,
      source: input.source,
      sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : null,
      program: input.program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: input.program.files[0]?.path ?? null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      assistance: {},
      verificationResults: {},
      completedBlocks: {},
      completedAt: null
    };

    await materializeInitialFiles(project);
    if (input.initializeGit === true) {
      await initializeGitRepository(project.workspacePath);
    }
    projects.push(project);
    await writeProjects(projects);
    return project;
  });

  ipcMain.handle("construct:project:ensure", async (_event, input) => {
    const projects = await readProjects();
    const existing = projects.find((project) => project.id === input.program.id);
    const now = new Date().toISOString();

    if (existing) {
      existing.source = input.source;
      existing.program = input.program;
      existing.title = input.program.title;
      existing.description = input.program.description;
      existing.sourcePath = typeof input.sourcePath === "string" ? input.sourcePath : existing.sourcePath ?? null;
      existing.progress = calculateProgress(existing);
      await materializeInitialFiles(existing);
      await writeProjects(projects);
      return existing;
    }

    const project: StoredProject = {
      id: input.program.id,
      title: input.program.title,
      description: input.program.description,
      progress: 0,
      lastOpenedAt: null,
      workspacePath: workspacePathForProject(input.program.id),
      source: input.source,
      sourcePath: typeof input.sourcePath === "string" ? input.sourcePath : null,
      program: input.program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: input.program.files[0]?.path ?? null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      assistance: {},
      verificationResults: {},
      completedBlocks: {},
      completedAt: null
    };

    await materializeInitialFiles(project);
    project.lastOpenedAt = now;
    projects.push(project);
    await writeProjects(projects);
    return project;
  });

  ipcMain.handle("construct:project:list", async () => {
    return (await readProjects()).map(summarizeProject);
  });

  ipcMain.handle("construct:project:open", async (_event, id: string) => {
    console.log("[construct] open project requested", { id });
    const projects = await readProjects();
    const project = findProject(projects, id);

    project.lastOpenedAt = new Date().toISOString();
    await materializeInitialFiles(project);
    await writeProjects(projects);
    console.log("[construct] open project resolved", {
      id: project.id,
      title: project.title,
      stepCount: project.program.steps.length,
      fileCount: project.program.files.length,
      activeFilePath: project.activeFilePath,
      currentStepIndex: project.currentStepIndex,
      currentBlockIndex: project.currentBlockIndex
    });
    return project;
  });

  ipcMain.handle("construct:project:update", async (_event, input) => {
    const projects = await readProjects();
    const index = projects.findIndex((project) => project.id === input.id);

    if (index < 0) {
      throw new Error(`Unknown Construct project: ${input.id}`);
    }

    projects[index] = {
      ...projects[index],
      ...input.patch
    };
    projects[index].progress = calculateProgress(projects[index]);
    await writeProjects(projects);
    return projects[index];
  });

  ipcMain.handle("construct:project:list-files", async (_event, projectId: string) => {
    const project = findProject(await readProjects(), projectId);
    await mkdir(project.workspacePath, { recursive: true });
    return listWorkspaceTree(project);
  });

  ipcMain.handle("construct:project:read-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    const fileStat = await stat(target);

    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    return {
      path: input.path,
      content: await readFile(target, "utf8")
    };
  });

  ipcMain.handle("construct:project:write-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content, "utf8");
    return {
      path: input.path,
      content: input.content
    };
  });

  ipcMain.handle("construct:project:delete-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    const fileStat = await stat(target);
    if (fileStat.isDirectory()) {
      await rm(target, { recursive: true, force: true });
    } else {
      await rm(target, { force: true });
    }
  });

  ipcMain.handle("construct:project:rename-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const oldTarget = safeProjectPath(project, input.oldPath);
    const newTarget = safeProjectPath(project, input.newPath);
    await mkdir(path.dirname(newTarget), { recursive: true });
    await rename(oldTarget, newTarget);
  });

  ipcMain.handle("construct:project:create-folder", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const target = safeProjectPath(project, input.path);
    await mkdir(target, { recursive: true });
  });

  ipcMain.handle("construct:project:duplicate-file", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const srcTarget = safeProjectPath(project, input.path);
    const destTarget = safeProjectPath(project, input.destPath);
    await mkdir(path.dirname(destTarget), { recursive: true });
    await cp(srcTarget, destTarget, { recursive: true });
  });

  ipcMain.handle("construct:project:verify-recall", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const recall = input.recall;
    const verify = recall?.verify;
    const logs: VerificationLogEntry[] = [];

    if (!verify || verify.kind !== "agent") {
      addVerificationLog(logs, "failed", "Verification contract is not supported", "Expected ::verify kind=\"agent\".");
      return withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: "This Construct build only supports agent verification for recall blocks.",
        evidence: [],
        suggestion: "Use a ::verify block with kind=\"agent\"."
      }, logs);
    }

    addVerificationLog(logs, "running", "Loaded verification contract", String(verify.id ?? "agent verifier"));

    const declaredFiles = Array.isArray(verify.evidence?.files) ? verify.evidence.files : [];
    addVerificationLog(
      logs,
      "running",
      "Collecting declared evidence files",
      declaredFiles.length > 0 ? declaredFiles.join(", ") : "No files declared in ::evidence."
    );
    const files = await Promise.all(
      declaredFiles.map(async (relativePath: string) => {
        try {
          const target = safeProjectPath(project, relativePath);
          const content = await readFile(target, "utf8");
          addVerificationLog(logs, "done", `Read ${relativePath}`, `${content.length} characters`);
          return {
            path: relativePath,
            content
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addVerificationLog(logs, "warning", `Could not read ${relativePath}`, message);
          return {
            path: relativePath,
            content: `[missing or unreadable file: ${message}]`
          };
        }
      })
    );
    addVerificationLog(logs, "done", "Evidence collection finished", `${files.length} file${files.length === 1 ? "" : "s"} supplied to the verifier.`);

    const terminalCommand =
      typeof verify.evidence?.terminalCommand === "string"
        ? verify.evidence.terminalCommand
        : undefined;
    let terminalOutput = latestTerminalOutputByProject.get(project.id) ?? "";

    if (terminalCommand) {
      addVerificationLog(logs, "running", "Running verification command", terminalCommand);
      terminalOutput = await runVerificationCommand(project, terminalCommand);
      appendTerminalOutput(project.id, terminalOutput);
      addVerificationLog(
        logs,
        terminalOutput.includes("[exit ") ? "failed" : "done",
        terminalOutput.includes("[exit ") ? "Command exited with a failure" : "Command completed",
        summarizeTerminalForLog(terminalOutput)
      );
    } else if (verify.evidence?.terminalOutput === "latest") {
      addVerificationLog(
        logs,
        "done",
        "Using latest terminal output",
        terminalOutput ? summarizeTerminalForLog(terminalOutput) : "No terminal output has been captured for this project yet."
      );
    } else {
      addVerificationLog(logs, "done", "No terminal command declared", "The agent will judge from files and rubric only.");
    }

    try {
      addVerificationLog(logs, "running", "Asking Construct Verifier Agent", "Comparing goal, rubric, files, terminal output, task, support, and reference cards.");
      const result = await runConstructVerifierAgent({
        goal: String(verify.goal ?? ""),
        rubric: String(verify.rubric ?? ""),
        task: String(recall.task ?? ""),
        support: String(recall.support ?? ""),
        references: Array.isArray(input.references)
          ? input.references.map((reference: { id?: unknown; title?: unknown; body?: unknown }) => ({
              id: String(reference.id ?? ""),
              title: String(reference.title ?? ""),
              body: String(reference.body ?? "")
            }))
          : [],
        files,
        terminalCommand,
        terminalOutput,
        messages: {
          success: String(verify.messages?.success ?? ""),
          failure: String(verify.messages?.failure ?? "")
        }
      });
      addVerificationLog(
        logs,
        result.passed ? "done" : "failed",
        result.passed ? "Verifier passed the recall task" : "Verifier did not pass the recall task",
        result.reason
      );
      return withVerificationLogs(result, logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addVerificationLog(logs, "failed", "Verifier agent failed to return a result", message);
      return withVerificationLogs({
        passed: false,
        confidence: "low",
        reason: `Construct verifier could not complete: ${message}`,
        evidence: [
          terminalCommand ? `terminal command: ${terminalCommand}` : "terminal command: none",
          `files supplied: ${files.map((file) => file.path).join(", ") || "none"}`
        ],
        suggestion: "Check verifier credentials and rerun verification when the project evidence is ready."
      }, logs);
    }
  });

  ipcMain.handle("construct:project:terminal-create", async (_event, input) => {
    const project = findProject(await readProjects(), input.projectId);
    const sessionId = randomUUID();
    const shellPath = process.env.SHELL || "/bin/zsh";
    const child = pty.spawn(shellPath, ["-i"], {
      name: "xterm-256color",
      cols: typeof input.cols === "number" ? input.cols : 80,
      rows: typeof input.rows === "number" ? input.rows : 24,
      cwd: project.workspacePath,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8"
      }
    });

    terminalSessions.set(sessionId, child);
    child.onData((data) => {
      appendTerminalOutput(project.id, data);
      sendToRenderers("construct:project:terminal-data", {
        sessionId,
        data
      });
    });
    child.onExit(({ exitCode }) => {
      terminalSessions.delete(sessionId);
      sendToRenderers("construct:project:terminal-exit", {
        sessionId,
        exitCode
      });
    });

    return { sessionId };
  });

  ipcMain.handle("construct:project:terminal-input", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.write(input.data);
  });

  ipcMain.handle("construct:project:terminal-resize", async (_event, input) => {
    const session = terminalSessions.get(input.sessionId);
    if (session && input.cols > 0 && input.rows > 0) {
      try {
        session.resize(input.cols, input.rows);
      } catch {
        // Ignore resize races when the pty is tearing down.
      }
    }
  });

  ipcMain.handle("construct:project:terminal-kill", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.kill();
    terminalSessions.delete(input.sessionId);
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: process.platform === "darwin" ? "menu" : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    titleBarStyle: "hiddenInset",
    title: "Construct",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  if (process.platform === "darwin" && app.dock && existsSync(iconPath)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch (err) {
      console.error("Failed to set dock icon:", err);
    }
  }

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (shouldOpenDevTools) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  void window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  installConstructProjectIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
