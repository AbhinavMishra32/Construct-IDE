import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import type { GitStatus, StoredProject } from "./ConstructProjectTypes";
import { ConstructProjectWorkspaceService } from "./ConstructProjectWorkspaceService";

const execFileAsync = promisify(execFile);

export class ConstructProjectGitService {
  constructor(private readonly workspace: ConstructProjectWorkspaceService) {}

  async initializeRepository(workspacePath: string): Promise<void> {
    if (existsSync(path.join(workspacePath, ".git"))) {
      return;
    }

    await execFileAsync("git", ["init"], { cwd: workspacePath });
  }

  async getStatus(project: StoredProject): Promise<GitStatus> {
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: project.workspacePath });
    } catch {
      return {
        isRepo: false,
        branch: null,
        hasRemote: false,
        dirtyFiles: []
      };
    }

    const branch = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.workspacePath })
      .then(({ stdout }) => String(stdout).trim() || null)
      .catch(() => null);
    const hasRemote = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: project.workspacePath })
      .then(() => true)
      .catch(() => false);
    const dirtyFiles = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: project.workspacePath })
      .then(({ stdout }) => String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const value = line.slice(3);
          const renameIndex = value.indexOf(" -> ");
          return renameIndex >= 0 ? value.slice(renameIndex + 4) : value;
        }))
      .catch(() => []);

    return {
      isRepo: true,
      branch,
      hasRemote,
      dirtyFiles
    };
  }

  async commitMilestone(
    project: StoredProject,
    message: string,
    paths: string[]
  ): Promise<{ success: boolean; output: string; commitHash?: string }> {
    const gitStatus = await this.getStatus(project);
    if (!gitStatus.isRepo) {
      return {
        success: false,
        output: "This project workspace is not a git repository."
      };
    }

    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      return {
        success: false,
        output: "Commit message is required."
      };
    }

    const includePaths = paths
      .map((includePath) => String(includePath || "").trim())
      .filter(Boolean);
    const existingPaths: string[] = [];

    for (const includePath of includePaths) {
      this.workspace.safeProjectPath(project, includePath);
      if (existsSync(path.resolve(project.workspacePath, includePath))) {
        existingPaths.push(includePath);
      }
    }

    if (includePaths.length > 0 && existingPaths.length === 0) {
      return {
        success: false,
        output: `None of the included paths exist yet: ${includePaths.join(", ")}`
      };
    }

    const addArgs = includePaths.length > 0 ? ["add", "--", ...existingPaths] : ["add", "-A"];
    await execFileAsync("git", addArgs, { cwd: project.workspacePath });

    const staged = await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: project.workspacePath })
      .then(({ stdout }) => String(stdout).trim());
    if (!staged) {
      return {
        success: false,
        output: "No staged changes are available for this milestone."
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync("git", ["commit", "-m", normalizedMessage], {
        cwd: project.workspacePath,
        maxBuffer: 2 * 1024 * 1024
      });
      const commitHash = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: project.workspacePath })
        .then(({ stdout }) => String(stdout).trim())
        .catch(() => undefined);
      return {
        success: true,
        output: [stdout, stderr].map(String).join("").trim(),
        commitHash
      };
    } catch (error: any) {
      return {
        success: false,
        output: String(error?.stderr || error?.stdout || error?.message || error)
      };
    }
  }

  async push(project: StoredProject): Promise<{ success: boolean; output: string }> {
    const gitStatus = await this.getStatus(project);
    if (!gitStatus.isRepo) {
      return {
        success: false,
        output: "This project workspace is not a git repository."
      };
    }

    if (!gitStatus.hasRemote) {
      return {
        success: false,
        output: "No git remote named origin is configured for this workspace."
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync("git", ["push"], {
        cwd: project.workspacePath,
        maxBuffer: 2 * 1024 * 1024
      });
      return {
        success: true,
        output: [stdout, stderr].map(String).join("").trim()
      };
    } catch (error: any) {
      return {
        success: false,
        output: String(error?.stderr || error?.stdout || error?.message || error)
      };
    }
  }

  async inspectDeletionRisk(project: StoredProject): Promise<{
    hasGit: boolean;
    branch: string | null;
    hasRemote: boolean;
    hasUncommittedChanges: boolean;
    unpushedCommits: number;
  }> {
    const gitDir = path.join(project.workspacePath, ".git");
    const hasGit = existsSync(gitDir);
    let branch: string | null = null;
    let hasRemote = false;
    let hasUncommittedChanges = false;
    let unpushedCommits = 0;

    if (hasGit) {
      try {
        const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.workspacePath });
        branch = branchOut.trim() || null;
      } catch { /* not a repo */ }
      try {
        const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd: project.workspacePath });
        hasUncommittedChanges = statusOut.trim().length > 0;
      } catch { /* ignore */ }
      try {
        await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: project.workspacePath });
        hasRemote = true;
        await execFileAsync("git", ["fetch", "origin"], { cwd: project.workspacePath }).catch(() => {});
        const { stdout: ahead } = await execFileAsync("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd: project.workspacePath }).catch(() => ({ stdout: "0" }));
        unpushedCommits = parseInt(ahead.trim(), 10) || 0;
      } catch { /* no remote */ }
    }

    return {
      hasGit,
      branch,
      hasRemote,
      hasUncommittedChanges,
      unpushedCommits
    };
  }
}
