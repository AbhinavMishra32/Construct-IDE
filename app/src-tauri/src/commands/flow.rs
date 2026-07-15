use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::core_state::CoreState;
use crate::error::{CommandError, CommandResult};

use super::flow_trace;

const MEMORY_FILES: [&str; 4] = ["research.md", "project.md", "path.md", "learner.md"];

#[tauri::command]
pub async fn rust_flow_run(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    run(app, state, input, false).await
}
#[tauri::command]
pub async fn rust_flow_research(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    run(app, state, input, true).await
}

async fn run(
    app: AppHandle,
    state: State<'_, CoreState>,
    input: Value,
    research: bool,
) -> CommandResult<Value> {
    let project_id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut project = state
        .projects
        .read(&project_id)?
        .ok_or_else(|| CommandError::new("flow.not-found", "Flow project was not found"))?;
    if project.get("kind").and_then(Value::as_str) != Some("flow") {
        return Err(CommandError::new(
            "flow.invalid-project",
            "project is not a Flow project",
        ));
    }
    let question_response = input
        .get("questionResponse")
        .filter(|value| value.is_object())
        .cloned();
    let answered_session = question_response
        .as_ref()
        .map(|response| apply_question_response(&mut project, response))
        .transpose()?;
    let message = input
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or(if research {
            "Research this project."
        } else {
            "Continue."
        })
        .to_string();
    let created = timestamp();
    let session_id = Uuid::new_v4().to_string();
    let origin = if question_response.is_some() {
        "question-response"
    } else {
        "user"
    };
    let mut session = json!({"id":session_id,"projectId":project_id,"threadId":project.pointer("/flow/threadId").cloned().unwrap_or(json!(project_id)),"origin":origin,"questionResponse":question_response,"messages":[{"id":Uuid::new_v4().to_string(),"role":"user","content":message,"createdAt":created}],"status":"running","toolCalls":[],"agentEvents":[],"timeline":[],"actions":[],"practiceTasks":[],"conceptExercises":[],"createdAt":created,"updatedAt":created});
    push_session(&mut project, session.clone());
    state.projects.write(&project)?;
    if let Some(answered_session) = answered_session {
        let _ = app.emit(
            "construct:flow:session-event",
            json!({"type":"completed","projectId":project_id,"session":answered_session}),
        );
    }
    let _ = app.emit(
        "construct:flow:session-event",
        json!({"type":"started","projectId":project_id,"session":session}),
    );
    let memory = read_memory(&project, None)?;
    let worker = Arc::clone(&state.mastra);
    let worker_app = app.clone();
    let worker_project = project.clone();
    let worker_message = message.clone();
    let worker_settings = state.settings.read()?["ai"].clone();
    let live_session = Arc::new(Mutex::new(session.clone()));
    let event_session = Arc::clone(&live_session);
    let event_app = app.clone();
    let event_project_id = project_id.clone();
    let method = if research {
        "flow.research"
    } else {
        "flow.run"
    };
    let response = tauri::async_runtime::spawn_blocking(move || {
        worker.request_with_events(
            worker_app,
            method,
            json!({"project":worker_project,"memory":memory,"message":worker_message,"settings":worker_settings}),
            move |trace| {
                let Ok(mut session) = event_session.lock() else {
                    return;
                };
                if flow_trace::apply(&mut session, &trace) {
                    let _ = event_app.emit(
                        "construct:flow:session-event",
                        json!({"type":"updated","projectId":event_project_id,"session":session.clone()}),
                    );
                }
            },
        )
    })
    .await
    .map_err(|error| CommandError::new("flow.worker", error.to_string()))?;
    session = live_session
        .lock()
        .map_err(|_| CommandError::new("flow.stream", "live Flow session lock was poisoned"))?
        .clone();
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let updated = timestamp();
            session["status"] = json!("error");
            session["updatedAt"] = json!(updated);
            flow_trace::finalize_reply(&mut session, "", "error");
            replace_session(&mut project, &session_id, session.clone());
            project["flow"]["updatedAt"] = json!(updated);
            state.projects.write(&project)?;
            let _ = app.emit(
                "construct:flow:session-event",
                json!({"type":"error","projectId":project_id,"session":session}),
            );
            return Err(error);
        }
    };
    let reply = response
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated = timestamp();
    let waiting_for_question = has_pending_question(&session);
    let terminal_status = if waiting_for_question {
        "waiting"
    } else {
        "completed"
    };
    session["status"] = json!(terminal_status);
    session["updatedAt"] = json!(updated);
    session["durationMs"] = response.get("durationMs").cloned().unwrap_or(json!(0));
    session["stepCount"] = response.get("stepCount").cloned().unwrap_or(json!(0));
    session["finishReason"] = response
        .get("finishReason")
        .cloned()
        .unwrap_or(json!("stop"));
    if !reply.trim().is_empty() {
        session["messages"].as_array_mut().unwrap().push(json!({"id":Uuid::new_v4().to_string(),"role":"assistant","content":reply,"createdAt":updated}));
    }
    flow_trace::finalize_reply(&mut session, &reply, terminal_status);
    replace_session(&mut project, &session_id, session.clone());
    project["flow"]["updatedAt"] = json!(updated);
    if research {
        project["flow"]["researchCompletedAt"] = json!(updated);
    }
    state.projects.write(&project)?;
    let result = json!({"session":session,"reply":reply,"actions":[]});
    let _ = app.emit(
        "construct:flow:session-event",
        json!({"type":terminal_status,"projectId":project_id,"session":session,"result":result}),
    );
    if research {
        Ok(json!({"session":session,"reply":reply,"actions":[],"project":project}))
    } else {
        Ok(result)
    }
}

fn apply_question_response(project: &mut Value, response: &Value) -> CommandResult<Value> {
    let session_id = response
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("flow.question-response", "sessionId is required"))?;
    let tool_call_id = response
        .get("toolCallId")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("flow.question-response", "toolCallId is required"))?;
    let session = project
        .pointer_mut("/flow/sessions")
        .and_then(Value::as_array_mut)
        .and_then(|sessions| {
            sessions
                .iter_mut()
                .find(|session| session.get("id").and_then(Value::as_str) == Some(session_id))
        })
        .ok_or_else(|| {
            CommandError::new("flow.question-response", "question session was not found")
        })?;
    let tool_call = session
        .get_mut("toolCalls")
        .and_then(Value::as_array_mut)
        .and_then(|tool_calls| {
            tool_calls
                .iter_mut()
                .find(|tool_call| tool_call.get("id").and_then(Value::as_str) == Some(tool_call_id))
        })
        .ok_or_else(|| {
            CommandError::new("flow.question-response", "question tool call was not found")
        })?;
    tool_call["response"] = response.clone();
    session["status"] = json!("completed");
    session["updatedAt"] = response
        .get("answeredAt")
        .cloned()
        .unwrap_or_else(|| json!(timestamp()));
    Ok(session.clone())
}

fn has_pending_question(session: &Value) -> bool {
    session
        .get("toolCalls")
        .and_then(Value::as_array)
        .is_some_and(|tool_calls| {
            tool_calls.iter().any(|tool_call| {
                let normalized = tool_call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .collect::<String>()
                    .to_lowercase();
                normalized == "askuserquestion"
                    && tool_call.get("status").and_then(Value::as_str) != Some("error")
                    && tool_call.get("response").is_none()
            })
        })
}

#[tauri::command]
pub fn rust_flow_memory_read(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Vec<Value>> {
    let id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let project = state
        .projects
        .read(id)?
        .ok_or_else(|| CommandError::new("flow.not-found", "project not found"))?;
    let files = input
        .get("files")
        .and_then(Value::as_array)
        .map(|files| files.iter().filter_map(Value::as_str).collect());
    read_memory(&project, files)
}
#[tauri::command]
pub fn rust_flow_memory_update(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Vec<Value>> {
    let id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut project = state
        .projects
        .read(id)?
        .ok_or_else(|| CommandError::new("flow.not-found", "project not found"))?;
    let root = project
        .get("workspacePath")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("flow.workspace", "workspace path missing"))?;
    for update in input
        .get("updates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let (Some(file), Some(content)) = (
            update.get("file").and_then(Value::as_str),
            update.get("content").and_then(Value::as_str),
        ) {
            if MEMORY_FILES.contains(&file) {
                std::fs::create_dir_all(std::path::Path::new(root).join(".construct"))
                    .map_err(io_error)?;
                std::fs::write(
                    std::path::Path::new(root).join(".construct").join(file),
                    content,
                )
                .map_err(io_error)?;
            }
        }
    }
    project["flow"]["updatedAt"] = json!(timestamp());
    state.projects.write(&project)?;
    read_memory(&project, None)
}
#[tauri::command]
pub fn rust_flow_rewind(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let session_id = input
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut project = state
        .projects
        .read(id)?
        .ok_or_else(|| CommandError::new("flow.not-found", "project not found"))?;
    if let Some(sessions) = project
        .pointer_mut("/flow/sessions")
        .and_then(Value::as_array_mut)
    {
        if let Some(index) = sessions
            .iter()
            .position(|session| session.get("id").and_then(Value::as_str) == Some(session_id))
        {
            sessions.truncate(index);
        }
    }
    state.projects.write(&project)?;
    Ok(project)
}
#[tauri::command]
pub fn rust_flow_submit_task(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut project = state
        .projects
        .read(id)?
        .ok_or_else(|| CommandError::new("flow.not-found", "project not found"))?;
    let submission = json!({"taskId":input.get("taskId"),"subtaskId":input.get("subtaskId"),"note":input.get("note"),"submittedAt":timestamp()});
    project["flow"]["updatedAt"] = json!(timestamp());
    state.projects.write(&project)?;
    Ok(submission)
}

fn read_memory(project: &Value, files: Option<Vec<&str>>) -> CommandResult<Vec<Value>> {
    let root = project
        .get("workspacePath")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("flow.workspace", "workspace path missing"))?;
    let selected = files.unwrap_or_else(|| MEMORY_FILES.to_vec());
    selected
        .into_iter()
        .filter(|file| MEMORY_FILES.contains(file))
        .map(|file| {
            let path = std::path::Path::new(root).join(".construct").join(file);
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            Ok(json!({"file":file,"path":path,"content":content}))
        })
        .collect()
}
fn push_session(project: &mut Value, session: Value) {
    project["flow"]["sessions"]
        .as_array_mut()
        .unwrap()
        .push(session)
}
fn replace_session(project: &mut Value, id: &str, session: Value) {
    if let Some(sessions) = project["flow"]["sessions"].as_array_mut() {
        if let Some(index) = sessions
            .iter()
            .position(|value| value.get("id").and_then(Value::as_str) == Some(id))
        {
            sessions[index] = session;
        }
    }
}
fn timestamp() -> String {
    Utc::now().to_rfc3339()
}
fn io_error(error: std::io::Error) -> CommandError {
    CommandError::new("flow.io", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_response_completes_the_source_session_and_clears_waiting() {
        let mut project = json!({
            "flow": {
                "sessions": [{
                    "id": "question-session",
                    "status": "waiting",
                    "updatedAt": "2026-07-15T00:00:00Z",
                    "toolCalls": [{
                        "id": "question-call",
                        "name": "ask_user_question",
                        "status": "completed",
                        "input": {"question": "What is your Python experience?"}
                    }]
                }]
            }
        });
        assert!(has_pending_question(&project["flow"]["sessions"][0]));

        let response = json!({
            "sessionId": "question-session",
            "toolCallId": "question-call",
            "question": "What is your Python experience?",
            "answer": "Know the basics",
            "answeredAt": "2026-07-15T00:01:00Z"
        });
        let answered = apply_question_response(&mut project, &response).unwrap();

        assert_eq!(answered["status"], "completed");
        assert_eq!(answered["updatedAt"], "2026-07-15T00:01:00Z");
        assert_eq!(
            answered["toolCalls"][0]["response"]["answer"],
            "Know the basics"
        );
        assert!(!has_pending_question(&answered));
    }
}
