use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::core_state::CoreState;
use crate::error::{CommandError, CommandResult};

use super::interact_trace;

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
    let project_id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let block_id = input
        .get("blockId")
        .and_then(Value::as_str)
        .unwrap_or("general")
        .to_string();
    let mode = input
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("lesson-check")
        .to_string();
    let thread_id = input
        .get("threadId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if mode == "general" {
                format!("general:{project_id}")
            } else {
                format!("{block_id}:lesson")
            }
        });
    let learning_state = state.learning.read()?;
    input["learningState"] = learning_state.clone();
    input["project"] = state.projects.read(&project_id)?.unwrap_or(Value::Null);
    input["settings"] = state.settings.read()?["ai"].clone();
    let run_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let session = json!({
        "id":Uuid::new_v4().to_string(),"threadId":thread_id,"mode":mode,
        "projectId":project_id,"blockId":block_id,"prompt":input.get("prompt"),"answer":input.get("answer"),
        "status":"continue","confidence":"low","reply":"","coveredConceptIds":[],"missingConceptIds":[],
        "assistanceLevel":"none","createdAt":now,"updatedAt":now,"runStatus":"running",
        "actions":[],"dynamicSteps":[],"dynamicStepValidation":[],"generatedLiveSteps":[],
        "liveStepValidation":[],"toolCalls":[],"agentEvents":[],"durationMs":0
    });
    let live_session = Arc::new(Mutex::new(session));
    let event_session = Arc::clone(&live_session);
    let event_app = app.clone();
    let event_run_id = run_id.clone();
    let event_project_id = project_id.clone();
    let event_block_id = block_id.clone();
    let event_thread_id = thread_id.clone();
    let _ = app.emit(
        "construct:project:interact-session-event",
        json!({"type":"started","runId":run_id,"projectId":project_id,"blockId":block_id,"threadId":thread_id,"session":live_session.lock().map_err(|_| CommandError::new("interact.stream","live session lock was poisoned"))?.clone()}),
    );
    let worker = Arc::clone(&state.mastra);
    let worker_app = app.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        worker.request_with_events(worker_app, "interact.run", input, move |trace| {
            let Ok(mut session) = event_session.lock() else {
                return;
            };
            if interact_trace::apply(&mut session, &trace) {
                let _ = event_app.emit(
                    "construct:project:interact-session-event",
                    json!({"type":"updated","runId":event_run_id,"projectId":event_project_id,"blockId":event_block_id,"threadId":event_thread_id,"session":session.clone()}),
                );
            }
        })
    })
    .await
    .map_err(|error| CommandError::new("interact.worker", error.to_string()))?;
    let mut session = live_session
        .lock()
        .map_err(|_| CommandError::new("interact.stream", "live session lock was poisoned"))?
        .clone();
    let mut result = match response {
        Ok(result) => result,
        Err(error) => {
            interact_trace::complete(&mut session, &json!({}), "error");
            let _ = app.emit(
                "construct:project:interact-session-event",
                json!({"type":"error","runId":run_id,"projectId":project_id,"blockId":block_id,"threadId":thread_id,"session":session,"learningState":learning_state}),
            );
            return Err(error);
        }
    };
    interact_trace::complete(&mut session, &result, "completed");
    result["session"] = session.clone();
    result["learningState"] = learning_state.clone();
    let _ = app.emit(
        "construct:project:interact-session-event",
        json!({"type":"completed","runId":run_id,"projectId":project_id,"blockId":block_id,"threadId":thread_id,"session":session,"result":result,"learningState":learning_state}),
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
