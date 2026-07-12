use tauri::State;

use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::git::{GitActionResult, GitCommitInput, GitStatus};

#[tauri::command]
pub fn rust_git_status(
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<GitStatus> {
    state.git.status(&project_id)
}

#[tauri::command]
pub fn rust_git_commit(
    state: State<'_, CoreState>,
    input: GitCommitInput,
) -> CommandResult<GitActionResult> {
    state.git.commit(&input)
}

#[tauri::command]
pub fn rust_git_push(
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<GitActionResult> {
    state.git.push(&project_id)
}
