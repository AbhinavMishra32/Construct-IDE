use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};
use crate::process::ProcessRunner;
use crate::projects::ProjectStore;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub has_remote: bool,
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInput {
    pub project_id: String,
    pub message: String,
    #[serde(default)]
    pub paths: Vec<String>,
}

pub struct GitService {
    projects: ProjectStore,
    runner: ProcessRunner,
}

impl GitService {
    pub fn new(projects: ProjectStore) -> Self {
        Self {
            projects,
            runner: ProcessRunner,
        }
    }

    pub fn status(&self, project_id: &str) -> CommandResult<GitStatus> {
        let cwd = self.projects.workspace_path(project_id)?;
        let probe = self
            .runner
            .run("git", &["rev-parse", "--is-inside-work-tree"], &cwd)?;
        if !probe.success {
            return Ok(GitStatus {
                is_repo: false,
                branch: None,
                has_remote: false,
                dirty_files: vec![],
            });
        }
        let branch = self
            .runner
            .run("git", &["rev-parse", "--abbrev-ref", "HEAD"], &cwd)?;
        let remote = self
            .runner
            .run("git", &["remote", "get-url", "origin"], &cwd)?;
        let status = self
            .runner
            .run("git", &["status", "--porcelain=v1", "-z", "-uall"], &cwd)?;
        Ok(GitStatus {
            is_repo: true,
            branch: branch
                .success
                .then(|| branch.stdout.trim().to_string())
                .filter(|branch| !branch.is_empty()),
            has_remote: remote.success,
            dirty_files: parse_porcelain(&status.stdout),
        })
    }

    pub fn commit(&self, input: &GitCommitInput) -> CommandResult<GitActionResult> {
        let cwd = self.projects.workspace_path(&input.project_id)?;
        if !self.status(&input.project_id)?.is_repo {
            return Ok(failure("This project workspace is not a git repository."));
        }
        let message = input.message.trim();
        if message.is_empty() {
            return Ok(failure("Commit message is required."));
        }
        let paths = input
            .paths
            .iter()
            .map(|path| path.trim())
            .filter(|path| !path.is_empty())
            .collect::<Vec<_>>();
        for path in &paths {
            validate_git_path(path)?;
        }
        let mut add_args = vec!["add"];
        if paths.is_empty() {
            add_args.push("-A");
        } else {
            add_args.push("--");
            add_args.extend(paths.iter().copied());
        }
        let add = self.runner.run("git", &add_args, &cwd)?;
        if !add.success {
            return Ok(failure(output_text(&add)));
        }
        let staged = self
            .runner
            .run("git", &["diff", "--cached", "--name-only"], &cwd)?;
        if staged.stdout.trim().is_empty() {
            return Ok(failure(
                "No staged changes are available for this milestone.",
            ));
        }
        let committed = self.runner.run("git", &["commit", "-m", message], &cwd)?;
        if !committed.success {
            return Ok(failure(output_text(&committed)));
        }
        let hash = self
            .runner
            .run("git", &["rev-parse", "--short", "HEAD"], &cwd)?;
        Ok(GitActionResult {
            success: true,
            output: output_text(&committed),
            commit_hash: hash
                .success
                .then(|| hash.stdout.trim().to_string())
                .filter(|hash| !hash.is_empty()),
        })
    }

    pub fn push(&self, project_id: &str) -> CommandResult<GitActionResult> {
        let status = self.status(project_id)?;
        if !status.is_repo {
            return Ok(failure("This project workspace is not a git repository."));
        }
        if !status.has_remote {
            return Ok(failure(
                "No git remote named origin is configured for this workspace.",
            ));
        }
        let cwd = self.projects.workspace_path(project_id)?;
        let pushed = self.runner.run("git", &["push"], &cwd)?;
        Ok(GitActionResult {
            success: pushed.success,
            output: output_text(&pushed),
            commit_hash: None,
        })
    }
}

fn validate_git_path(path: &str) -> CommandResult<()> {
    let path = std::path::Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(CommandError::new(
            "git.invalid-path",
            "git path escapes the workspace",
        ));
    }
    Ok(())
}

fn parse_porcelain(output: &str) -> Vec<String> {
    output
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.get(3..).unwrap_or(entry))
        .map(|path| {
            path.rsplit_once(" -> ")
                .map(|(_, target)| target)
                .unwrap_or(path)
        })
        .map(str::to_string)
        .collect()
}

fn output_text(output: &crate::process::ProcessOutput) -> String {
    format!("{}{}", output.stdout, output.stderr)
        .trim()
        .to_string()
}

fn failure(output: impl Into<String>) -> GitActionResult {
    GitActionResult {
        success: false,
        output: output.into(),
        commit_hash: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_renamed_porcelain_paths() {
        assert_eq!(
            parse_porcelain("R  old.rs -> new.rs\0?? fresh.rs\0"),
            vec!["new.rs", "fresh.rs"]
        );
    }
}
