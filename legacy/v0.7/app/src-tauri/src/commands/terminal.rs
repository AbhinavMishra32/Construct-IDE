use tauri::{AppHandle, State};

use crate::commands::system::OkResponse;
use crate::core_state::CoreState;
use crate::error::CommandResult;
use crate::terminal::{TerminalCreateInput, TerminalInput, TerminalResizeInput};

#[tauri::command]
pub fn rust_terminal_create(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: TerminalCreateInput,
) -> CommandResult<impl serde::Serialize> {
    state.terminal.create(app, input)
}

#[tauri::command]
pub fn rust_terminal_input(
    state: State<'_, CoreState>,
    input: TerminalInput,
) -> CommandResult<OkResponse> {
    state.terminal.write(input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_terminal_resize(
    state: State<'_, CoreState>,
    input: TerminalResizeInput,
) -> CommandResult<OkResponse> {
    state.terminal.resize(input)?;
    Ok(OkResponse::ok())
}

#[tauri::command]
pub fn rust_terminal_kill(
    state: State<'_, CoreState>,
    input: serde_json::Value,
) -> CommandResult<OkResponse> {
    let session_id = input
        .get("sessionId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    state.terminal.kill(session_id)?;
    Ok(OkResponse::ok())
}
