use serde_json::Value;
use tauri::{AppHandle, State};

use crate::commands::system::OkResponse;
use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::lsp::LspInstallInput;

#[tauri::command]
pub fn rust_lsp_status(state: State<'_, CoreState>, project_id: String) -> CommandResult<Value> {
    state.lsp.status(&project_id)
}

#[tauri::command]
pub fn rust_lsp_start(
    app: AppHandle,
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<Value> {
    state.lsp.start(app, &project_id)
}

#[tauri::command]
pub fn rust_lsp_stop(state: State<'_, CoreState>) -> OkResponse {
    state.lsp.stop_all();
    OkResponse::ok()
}

#[tauri::command]
pub fn rust_lsp_request(
    app: AppHandle,
    state: State<'_, CoreState>,
    payload: Value,
) -> CommandResult<Value> {
    state.lsp.request(app, payload)
}

#[tauri::command]
pub fn rust_lsp_install(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: LspInstallInput,
) -> CommandResult<bool> {
    state.lsp.install(app, input)
}
