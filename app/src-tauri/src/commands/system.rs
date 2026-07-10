use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::storage::{StorageMetrics, UiStateInput};

#[derive(Serialize)]
pub struct OkResponse {
    ok: bool,
}

impl OkResponse {
    pub fn ok() -> Self {
        Self { ok: true }
    }
}

#[tauri::command]
pub fn rust_ui_state_get(state: State<'_, CoreState>, input: UiStateInput) -> CommandResult<Value> {
    state.ui_state.get(&input)
}

#[tauri::command]
pub fn rust_ui_state_set(
    state: State<'_, CoreState>,
    input: UiStateInput,
) -> CommandResult<OkResponse> {
    state.ui_state.set(&input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_storage_flush(state: State<'_, CoreState>) -> CommandResult<OkResponse> {
    state.ui_state.flush()?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_storage_metrics(state: State<'_, CoreState>) -> StorageMetrics {
    state.ui_state.metrics()
}
