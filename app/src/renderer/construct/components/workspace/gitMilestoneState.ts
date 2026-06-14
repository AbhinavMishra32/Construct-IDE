import type {
  GitActionResult,
  GitMilestone,
  GitMilestoneStatus,
  ProjectRecord
} from "../../types";

export type StoredGitMilestoneState = {
  status?: GitMilestoneStatus;
  message?: string;
  output?: string;
  commitHash?: string;
  updatedAt?: string;
};

export function readGitMilestoneStates(projectId: string): Record<string, StoredGitMilestoneState> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(gitMilestoneStorageKey(projectId)) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, StoredGitMilestoneState>
      : {};
  } catch {
    return {};
  }
}

export function writeGitMilestoneStates(projectId: string, states: Record<string, StoredGitMilestoneState>): void {
  window.localStorage.setItem(gitMilestoneStorageKey(projectId), JSON.stringify(states));
}

export function gitResultToMilestoneState(
  result: GitActionResult,
  successStatus: GitMilestoneStatus,
  message: string,
  fallbackCommitHash?: string
): StoredGitMilestoneState {
  return {
    status: result.success ? successStatus : "failed",
    message,
    output: result.output || (result.success ? "Done." : "Git command failed."),
    commitHash: result.commitHash ?? fallbackCommitHash
  };
}

export function resolveMilestoneStatus(
  milestone: GitMilestone,
  stored: StoredGitMilestoneState | undefined,
  project: ProjectRecord
): GitMilestoneStatus {
  if (stored?.status === "committed" || stored?.status === "pushed" || stored?.status === "failed") {
    return stored.status;
  }

  const linkedVerificationPassed = project.verificationResults?.[milestone.after]?.passed === true;
  const linkedBlockCompleted = project.completedBlocks?.[milestone.after] === true;
  if (linkedVerificationPassed || linkedBlockCompleted) {
    return "suggested";
  }

  return "pending";
}

export function milestoneStatusLabel(status: GitMilestoneStatus): string {
  switch (status) {
    case "suggested":
      return "Suggested";
    case "committed":
      return "Committed";
    case "pushed":
      return "Pushed";
    case "failed":
      return "Failed";
    case "pending":
    default:
      return "Waiting";
  }
}

function gitMilestoneStorageKey(projectId: string): string {
  return `construct.git.milestones.${projectId}`;
}
