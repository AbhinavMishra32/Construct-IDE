import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";

import { app, BrowserWindow, ipcMain, shell } from "electron";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const shouldOpenDevTools = process.env.CONSTRUCT_OPEN_DEVTOOLS === "1";
const ignoredWorkspaceEntries = new Set([
  ".git",
  ".next",
  "dist",
  "node_modules"
]);

type StoredProject = {
  id: string;
  title: string;
  description: string;
  progress: number;
  lastOpenedAt: string | null;
  workspacePath: string;
  source: string;
  program: {
    id: string;
    title: string;
    description: string;
    files: Array<{ path: string; content: string }>;
    steps: Array<{ blocks: Array<{ id: string }> }>;
  };
  currentStepIndex: number;
  currentBlockIndex: number;
  activeFilePath: string | null;
  fileTreeExpanded: string[];
  typingProgress: Record<string, number>;
  editAnchors: Record<string, string>;
  completedBlocks: Record<string, boolean>;
  completedAt: string | null;
};

const terminalSessions = new Map<string, ChildProcessWithoutNullStreams>();

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

function workspacePathForProject(projectId: string): string {
  return path.join(constructProjectsRoot(), "workspaces", projectId);
}

async function readProjects(): Promise<StoredProject[]> {
  await mkdir(constructProjectsRoot(), { recursive: true });

  if (!existsSync(projectsManifestPath())) {
    return [];
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return JSON.parse(await readFile(projectsManifestPath(), "utf8")) as StoredProject[];
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

async function writeProjects(projects: StoredProject[]): Promise<void> {
  await mkdir(constructProjectsRoot(), { recursive: true });
  const target = projectsManifestPath();
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await rename(temporary, target);
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

function safeProjectPath(projectId: string, relativePath: string): string {
  const workspace = workspacePathForProject(projectId);
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
    const target = safeProjectPath(project.id, file.path);
    await mkdir(path.dirname(target), { recursive: true });

    if (!existsSync(target)) {
      await writeFile(target, file.content, "utf8");
    }
  }
}

async function listWorkspaceTree(projectId: string, root = ""): Promise<unknown[]> {
  const absoluteRoot = safeProjectPath(projectId, root || ".");
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
            ? await listWorkspaceTree(projectId, path.join(root, entry.name))
            : undefined
        };

        return node;
      })
  );

  return nodes;
}

function installConstructProjectIpcHandlers(): void {
  ipcMain.handle("construct:project:ensure", async (_event, input) => {
    const projects = await readProjects();
    const existing = projects.find((project) => project.id === input.program.id);
    const now = new Date().toISOString();

    if (existing) {
      existing.source = input.source;
      existing.program = input.program;
      existing.title = input.program.title;
      existing.description = input.program.description;
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
      program: input.program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: input.program.files[0]?.path ?? null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
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
    return (await readProjects()).map((project) => ({
      id: project.id,
      title: project.title,
      description: project.description,
      progress: project.progress,
      lastOpenedAt: project.lastOpenedAt,
      workspacePath: project.workspacePath
    }));
  });

  ipcMain.handle("construct:project:open", async (_event, id: string) => {
    const projects = await readProjects();
    const project = projects.find((candidate) => candidate.id === id);

    if (!project) {
      throw new Error(`Unknown Construct project: ${id}`);
    }

    project.lastOpenedAt = new Date().toISOString();
    await materializeInitialFiles(project);
    await writeProjects(projects);
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
    await mkdir(workspacePathForProject(projectId), { recursive: true });
    return listWorkspaceTree(projectId);
  });

  ipcMain.handle("construct:project:read-file", async (_event, input) => {
    const target = safeProjectPath(input.projectId, input.path);
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
    const target = safeProjectPath(input.projectId, input.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.content, "utf8");
    return {
      path: input.path,
      content: input.content
    };
  });

  ipcMain.handle("construct:project:terminal-create", async (_event, input) => {
    const sessionId = randomUUID();
    const shell = process.env.SHELL || "/bin/zsh";
    const child = spawn(shell, ["-l"], {
      cwd: workspacePathForProject(input.projectId),
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });

    terminalSessions.set(sessionId, child);
    child.stdout.on("data", (chunk) => {
      sendToRenderers("construct:project:terminal-data", {
        sessionId,
        data: chunk.toString()
      });
    });
    child.stderr.on("data", (chunk) => {
      sendToRenderers("construct:project:terminal-data", {
        sessionId,
        data: chunk.toString()
      });
    });
    child.on("exit", (exitCode) => {
      terminalSessions.delete(sessionId);
      sendToRenderers("construct:project:terminal-exit", {
        sessionId,
        exitCode
      });
    });

    return { sessionId };
  });

  ipcMain.handle("construct:project:terminal-input", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.stdin.write(input.data);
  });

  ipcMain.handle("construct:project:terminal-kill", async (_event, input) => {
    terminalSessions.get(input.sessionId)?.kill();
    terminalSessions.delete(input.sessionId);
  });
}

function createWindow(): void {
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

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
