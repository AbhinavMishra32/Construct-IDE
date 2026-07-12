use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::commands::system::OkResponse;
use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::workspace::{FileContent, FileInput, RenameInput, WorkspaceTreeNode, WriteFileInput};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateInput {
    pub project_id: String,
    pub path: String,
    pub dest_path: String,
}

#[tauri::command]
pub fn rust_workspace_list(
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<Vec<WorkspaceTreeNode>> {
    state.workspace.list(&project_id)
}

#[tauri::command]
pub fn rust_workspace_read(
    state: State<'_, CoreState>,
    input: FileInput,
) -> CommandResult<FileContent> {
    state.workspace.read(&input)
}

#[tauri::command]
pub fn rust_workspace_write(
    state: State<'_, CoreState>,
    input: WriteFileInput,
) -> CommandResult<FileContent> {
    state.workspace.write(&input)
}

#[tauri::command]
pub fn rust_workspace_remove(
    state: State<'_, CoreState>,
    input: FileInput,
) -> CommandResult<OkResponse> {
    state.workspace.remove(&input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_workspace_rename(
    state: State<'_, CoreState>,
    input: RenameInput,
) -> CommandResult<OkResponse> {
    state.workspace.rename(&input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_workspace_create_folder(
    state: State<'_, CoreState>,
    input: FileInput,
) -> CommandResult<OkResponse> {
    state.workspace.create_folder(&input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_workspace_duplicate(
    state: State<'_, CoreState>,
    input: DuplicateInput,
) -> CommandResult<OkResponse> {
    state.workspace.duplicate(
        &FileInput {
            project_id: input.project_id,
            path: input.path,
        },
        &input.dest_path,
    )?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_workspace_watch_start(
    app: AppHandle,
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<OkResponse> {
    state
        .watcher
        .start(app, state.workspace.workspace_path(&project_id)?)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_workspace_watch_stop(state: State<'_, CoreState>) -> CommandResult<OkResponse> {
    state.watcher.stop()?;
    Ok(OkResponse::ok())
}
