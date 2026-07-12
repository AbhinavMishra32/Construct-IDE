use crate::core_state::CoreState;
use crate::error::CommandResult;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn rust_learning_get(state: State<'_, CoreState>) -> CommandResult<Value> {
    state.learning.read()
}
#[tauri::command]
pub fn rust_learning_project(
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<Value> {
    state.learning.project(&project_id)
}
#[tauri::command]
pub fn rust_learning_patch(state: State<'_, CoreState>, patch: Value) -> CommandResult<Value> {
    state.learning.apply_patch(&patch)
}
#[tauri::command]
pub fn rust_learning_weak(
    state: State<'_, CoreState>,
    input: Option<Value>,
) -> CommandResult<Vec<Value>> {
    state.learning.weak(
        input
            .as_ref()
            .and_then(|value| value.get("projectId"))
            .and_then(Value::as_str),
    )
}
#[tauri::command]
pub fn rust_learning_save(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    state
        .learning
        .apply_patch(&json!({"knowledgeConcept":input}))
}
#[tauri::command]
pub fn rust_learning_open(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let project = input
        .get("sourceProjectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let concept = input.get("id").and_then(Value::as_str).unwrap_or_default();
    let at = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    state.learning.apply_patch(&json!({"knowledgeConcept":input,"conceptOpen":{"projectId":project,"conceptId":concept,"openedAt":at}}))
}
#[tauri::command]
pub fn rust_learning_concept_open(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    let at = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    state.learning.apply_patch(&json!({"conceptOpen":{"projectId":input.get("projectId"),"conceptId":input.get("conceptId"),"openedAt":at},"knowledgeConcept":input.get("savedRecord")}))
}
#[tauri::command]
pub fn rust_learning_remove(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    state
        .learning
        .apply_patch(&json!({"removeKnowledgeConcept":input}))
}
