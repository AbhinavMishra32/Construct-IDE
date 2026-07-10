use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::core_state::CoreState;
use crate::error::{CommandError, CommandResult};

async fn call(
    app: AppHandle,
    worker: Arc<crate::ai::MastraWorker>,
    method: &'static str,
    mut payload: Value,
    settings: Value,
) -> CommandResult<Value> {
    payload["settings"] = settings;
    tauri::async_runtime::spawn_blocking(move || worker.request(app, method, payload))
        .await
        .map_err(|error| CommandError::new("agent.worker", error.to_string()))?
}

#[tauri::command]
pub async fn rust_verify_recall(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    let recall = input.get("recall").cloned().unwrap_or(json!({}));
    let verify = recall.get("verify").cloned().unwrap_or(json!({}));
    let payload = json!({"goal":verify.get("goal"),"rubric":verify.get("rubric"),"task":recall.get("task"),"support":recall.get("support"),"references":input.get("references").cloned().unwrap_or(json!([])),"concepts":input.get("concepts").cloned().unwrap_or(json!([])),"savedKnowledge":input.get("savedKnowledge").cloned().unwrap_or(json!([])),"files":[],"terminalCommand":verify.pointer("/evidence/terminalCommand"),"terminalOutput":"","answer":input.get("answer"),"messages":verify.get("messages").cloned().unwrap_or(json!({"success":"Passed","failure":"Try again"}))});
    let result = call(
        app.clone(),
        Arc::clone(&state.mastra),
        "verification.run",
        payload,
        state.settings.read()?["ai"].clone(),
    )
    .await?;
    let _ = app.emit(
        "construct:project:verify-log",
        json!({"status":"done","message":"Verification completed"}),
    );
    Ok(result)
}

#[tauri::command]
pub async fn rust_interact(
    app: AppHandle,
    state: State<'_, CoreState>,
    mut input: Value,
) -> CommandResult<Value> {
    input["learningState"] = state.learning.read()?;
    if let Some(id) = input.get("projectId").and_then(Value::as_str) {
        input["project"] = state.projects.read(id)?.unwrap_or(Value::Null);
    }
    let result = call(
        app.clone(),
        Arc::clone(&state.mastra),
        "interact.run",
        input,
        state.settings.read()?["ai"].clone(),
    )
    .await?;
    let _ = app.emit(
        "construct:project:interact-session-event",
        json!({"type":"completed","result":result}),
    );
    Ok(result)
}

#[tauri::command]
pub async fn rust_authoring_review(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    call(
        app,
        Arc::clone(&state.mastra),
        "authoring.review",
        input,
        state.settings.read()?["ai"].clone(),
    )
    .await
}

#[tauri::command]
pub async fn rust_selection_explain(
    app: AppHandle,
    state: State<'_, CoreState>,
    mut input: Value,
) -> CommandResult<Value> {
    if let Some(id) = input.get("projectId").and_then(Value::as_str) {
        if let Some(project) = state.projects.read(id)? {
            input["workspacePath"] = project.get("workspacePath").cloned().unwrap_or(Value::Null);
        }
    }
    let result = call(
        app.clone(),
        Arc::clone(&state.mastra),
        "selection.explain",
        input.clone(),
        state.settings.read()?["ai"].clone(),
    )
    .await?;
    let _=app.emit("construct:project:explain-selection-log",json!({"requestId":input.get("requestId"),"entry":{"status":"done","message":"Explanation completed"}}));
    Ok(result)
}

#[tauri::command]
pub async fn rust_code_ghost(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<()> {
    let request_id = input.get("requestId").cloned().unwrap_or(Value::Null);
    let line = input.get("lineNumber").cloned().unwrap_or(json!(0));
    match call(
        app.clone(),
        Arc::clone(&state.mastra),
        "code-ghost.run",
        input,
        state.settings.read()?["ai"].clone(),
    )
    .await
    {
        Ok(value) => {
            let _=app.emit("construct:project:code-ghost:token",json!({"requestId":request_id,"lineNumber":line,"token":value.as_str().unwrap_or_default(),"done":true}));
            Ok(())
        }
        Err(error) => {
            let _=app.emit("construct:project:code-ghost:token",json!({"requestId":request_id,"lineNumber":line,"token":"","done":true,"error":error.to_string()}));
            Err(error)
        }
    }
}
