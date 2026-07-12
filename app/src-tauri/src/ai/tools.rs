use serde_json::{json, Value};

use crate::error::{CommandError, CommandResult};
use crate::process::ProcessRunner;
use crate::projects::ProjectStore;
use crate::workspace::{FileInput, WorkspaceService, WriteFileInput};

pub struct ToolHost {
    projects: ProjectStore,
    workspace: WorkspaceService,
    runner: ProcessRunner,
}

impl ToolHost {
    pub fn new(projects: ProjectStore, workspace: WorkspaceService) -> Self {
        Self {
            projects,
            workspace,
            runner: ProcessRunner,
        }
    }

    pub fn execute(&self, name: &str, input: &Value) -> CommandResult<Value> {
        let project_id = required(input, "projectId")?;
        match name {
            "read-file" => Ok(serde_json::to_value(self.workspace.read(&FileInput {
                project_id: project_id.into(),
                path: required(input, "path")?.into(),
            })?)
            .unwrap()),
            "write-file" => Ok(serde_json::to_value(self.workspace.write(&WriteFileInput {
                project_id: project_id.into(),
                path: required(input, "path")?.into(),
                content: required(input, "content")?.into(),
            })?)
            .unwrap()),
            "list-files" => Ok(serde_json::to_value(self.workspace.list(project_id)?).unwrap()),
            "run-terminal-command" => self.run_command(project_id, required(input, "command")?),
            _ => Err(CommandError::new(
                "mastra.unknown-tool",
                format!("Unknown host tool: {name}"),
            )),
        }
    }

    fn run_command(&self, project_id: &str, command: &str) -> CommandResult<Value> {
        if !command_is_allowed(command) {
            return Err(CommandError::new(
                "mastra.command-denied",
                "Command requires explicit learner approval",
            ));
        }
        let cwd = self.projects.workspace_path(project_id)?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let output = self.runner.run(&shell, &["-lc", command], &cwd)?;
        Ok(json!({"success":output.success,"stdout":output.stdout,"stderr":output.stderr}))
    }
}

fn required<'a>(value: &'a Value, key: &str) -> CommandResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CommandError::new("mastra.invalid-tool-input", format!("{key} is required")))
}

fn command_is_allowed(command: &str) -> bool {
    let normalized = command.to_lowercase();
    ![
        "sudo ",
        "rm -rf",
        "curl ",
        "wget ",
        "npm install",
        "pnpm add",
        "yarn add",
        "cargo install",
        "git push",
        "git reset --hard",
    ]
    .iter()
    .any(|blocked| normalized.contains(blocked))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_destructive_and_dependency_mutations() {
        assert!(!command_is_allowed("rm -rf ."));
        assert!(!command_is_allowed("npm install"));
        assert!(command_is_allowed("cargo test"));
    }
}
