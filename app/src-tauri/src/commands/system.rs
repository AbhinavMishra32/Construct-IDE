use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::profile::ConstructProfile;
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

#[tauri::command]
pub fn rust_profile_get(state: State<'_, CoreState>) -> CommandResult<Value> {
    let projects = state.projects.list()?;
    let learning = state.learning.read()?;
    state.profile.snapshot(&projects, &learning)
}

#[tauri::command]
pub fn rust_profile_update(
    state: State<'_, CoreState>,
    input: ConstructProfile,
) -> CommandResult<ConstructProfile> {
    state.profile.update(input)
}

#[tauri::command]
pub fn rust_runtime_info() -> Value {
    serde_json::json!({"name":"Construct","electron":"","chrome":"","node":"","platform":std::env::consts::OS,"constructCloudEndpoint":"https://api.tryconstruct.cc"})
}

#[tauri::command]
pub fn rust_theme_set(_app: AppHandle, _theme: String) -> OkResponse {
    OkResponse::ok()
}

#[tauri::command]
pub fn rust_debug_processes() -> Vec<Value> {
    vec![]
}

#[tauri::command]
pub fn rust_litellm_state() -> Value {
    serde_json::json!({"status":"stopped","port":4000,"pid":null,"error":"Managed LiteLLM was removed; providers are routed directly by the Rust core."})
}

#[tauri::command]
pub fn rust_litellm_check() -> bool {
    false
}

#[tauri::command]
pub fn rust_read_lsp_source(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let project_id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let raw = input
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let target = std::path::PathBuf::from(raw)
        .canonicalize()
        .map_err(|error| crate::error::CommandError::new("lsp.source", error.to_string()))?;
    let workspace = state
        .projects
        .workspace_path(project_id)?
        .canonicalize()
        .map_err(|error| crate::error::CommandError::new("lsp.source", error.to_string()))?;
    let text = target.to_string_lossy();
    let allowed = target.starts_with(workspace)
        || (target.extension().and_then(|value| value.to_str()) == Some("rs")
            && (text.contains("/.cargo/registry/src/")
                || text.contains("/.cargo/git/checkouts/")
                || text.contains("/.rustup/toolchains/")));
    if !allowed {
        return Err(crate::error::CommandError::new(
            "lsp.source-denied",
            "LSP source path is outside allowed roots",
        ));
    }
    let metadata = std::fs::metadata(&target)
        .map_err(|error| crate::error::CommandError::new("lsp.source", error.to_string()))?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(crate::error::CommandError::new(
            "lsp.source-large",
            "LSP source file is too large",
        ));
    }
    let content = std::fs::read_to_string(&target)
        .map_err(|error| crate::error::CommandError::new("lsp.source", error.to_string()))?;
    Ok(serde_json::json!({"path":target,"content":content}))
}
