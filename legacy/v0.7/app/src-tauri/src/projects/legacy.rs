use diesel::prelude::*;
use diesel::SqliteConnection;
use serde_json::{json, Map, Value};

use crate::error::{CommandError, CommandResult};
use crate::storage::schema::*;

use super::models::*;

pub fn hydrate(connection: &mut SqliteConnection, row: ProjectRow) -> CommandResult<Value> {
    if row.kind == "flow" {
        hydrate_flow(connection, row)
    } else {
        Ok(hydrate_tape(row))
    }
}

fn hydrate_tape(row: ProjectRow) -> Value {
    json!({
        "kind":"tape", "id":row.id, "title":row.title, "description":row.description,
        "progress":row.progress, "lastOpenedAt":row.last_opened_at, "workspacePath":row.workspace_path,
        "sourcePath":row.source_path, "activeFilePath":row.active_file_path,
        "fileTreeExpanded":parse(row.file_tree_expanded_json.as_str(), json!([])), "completedAt":row.completed_at,
        "source":row.source.unwrap_or_default(), "originalSource":row.original_source,
        "authoringFixes":parse_opt(row.authoring_fixes_json, json!([])),
        "program":parse_opt(row.program_json, json!({"id":row.id,"title":row.title,"description":row.description,"files":[],"references":[],"targets":[],"steps":[]})),
        "currentStepIndex":row.current_step_index.unwrap_or(0), "currentBlockIndex":row.current_block_index.unwrap_or(0),
        "typingProgress":parse_opt(row.typing_progress_json,json!({})), "editAnchors":parse_opt(row.edit_anchors_json,json!({})),
        "assistance":parse_opt(row.assistance_json,json!({})), "verificationResults":parse_opt(row.verification_results_json,json!({})),
        "completedBlocks":parse_opt(row.completed_blocks_json,json!({}))
    })
}

fn hydrate_flow(connection: &mut SqliteConnection, row: ProjectRow) -> CommandResult<Value> {
    let nodes = construct_flow_path_nodes::table
        .filter(construct_flow_path_nodes::project_id.eq(&row.id))
        .order((
            construct_flow_path_nodes::node_order.asc(),
            construct_flow_path_nodes::id.asc(),
        ))
        .select(PathNodeRow::as_select())
        .load(connection)
        .map_err(db_error)?
        .into_iter()
        .map(path_node)
        .collect::<Vec<_>>();
    let sessions = construct_flow_sessions::table
        .filter(construct_flow_sessions::project_id.eq(&row.id))
        .order((
            construct_flow_sessions::created_at.asc(),
            construct_flow_sessions::id.asc(),
        ))
        .select(SessionRow::as_select())
        .load(connection)
        .map_err(db_error)?
        .into_iter()
        .map(|session| hydrate_session(connection, session))
        .collect::<CommandResult<Vec<_>>>()?;
    Ok(json!({
        "kind":"flow", "id":row.id, "title":row.title, "description":row.description,
        "progress":row.progress, "lastOpenedAt":row.last_opened_at, "workspacePath":row.workspace_path,
        "sourcePath":row.source_path, "activeFilePath":row.active_file_path,
        "fileTreeExpanded":parse(&row.file_tree_expanded_json,json!([])), "completedAt":row.completed_at,
        "flow": { "goal":row.flow_goal.unwrap_or_else(||row.description.clone()),
          "stackPreference":row.flow_stack_preference, "autonomyPreference":row.flow_autonomy_preference,
          "permissionsPreference":row.flow_permissions_preference, "projectSettings":parse_opt(row.flow_project_settings_json,Value::Null),
          "memoryDirectory":".construct", "threadId":row.flow_thread_id.unwrap_or_else(||row.id.clone()),
          "researchEnabled":row.flow_research_enabled==Some(1), "researchCompletedAt":row.flow_research_completed_at,
          "pathNodes":nodes, "currentPathNodeId":row.flow_current_path_node_id,
          "pathCreatedAt":row.flow_path_created_at, "pathUpdatedAt":row.flow_path_updated_at,
          "sessions":sessions, "createdAt":row.flow_created_at.unwrap_or_else(||"1970-01-01T00:00:00.000Z".into()),
          "updatedAt":row.flow_updated_at.unwrap_or_else(||"1970-01-01T00:00:00.000Z".into()) }
    }))
}

fn hydrate_session(connection: &mut SqliteConnection, row: SessionRow) -> CommandResult<Value> {
    let messages = construct_flow_messages::table.filter(construct_flow_messages::session_id.eq(&row.id))
        .order(construct_flow_messages::position.asc()).select(MessageRow::as_select()).load(connection).map_err(db_error)?
        .into_iter().map(|item| json!({"id":item.original_id.unwrap_or(item.id),"role":item.role,"content":item.content,"createdAt":item.created_at})).collect::<Vec<_>>();
    let tools = construct_flow_tool_calls::table
        .filter(construct_flow_tool_calls::session_id.eq(&row.id))
        .order(construct_flow_tool_calls::position.asc())
        .select(ToolCallRow::as_select())
        .load(connection)
        .map_err(db_error)?
        .into_iter()
        .map(tool_call)
        .collect::<Vec<_>>();
    let timeline = construct_flow_timeline_parts::table
        .filter(construct_flow_timeline_parts::session_id.eq(&row.id))
        .order(construct_flow_timeline_parts::position.asc())
        .select(TimelineRow::as_select())
        .load(connection)
        .map_err(db_error)?
        .into_iter()
        .map(timeline_part)
        .collect::<Vec<_>>();
    Ok(json!({
      "id":row.id,"projectId":row.project_id,"threadId":row.thread_id,"origin":row.origin,
      "questionResponse":parse_opt(row.question_response_json,Value::Null),"messages":messages,"status":row.status,
      "toolCalls":tools,"agentEvents":payloads::<AgentEventRow>(connection,&row.id)?,"timeline":timeline,
      "citations":parse_opt(row.citations_json,Value::Null),"contextCompaction":parse_opt(row.context_compaction_json,Value::Null),
      "contextWindow":parse_opt(row.context_window_json,Value::Null),"actions":payloads::<ActionRow>(connection,&row.id)?,
      "practiceTasks":practice_payloads(connection,&row.id)?,"conceptExercises":exercise_payloads(connection,&row.id)?,
      "createdAt":row.created_at,"updatedAt":row.updated_at,"durationMs":row.duration_ms,"stepCount":row.step_count,
      "finishReason":row.finish_reason,"errorMessage":row.error_message
    }))
}

trait PayloadEntity {
    fn load(connection: &mut SqliteConnection, session: &str) -> diesel::QueryResult<Vec<Self>>
    where
        Self: Sized;
    fn payload(self) -> String;
}
impl PayloadEntity for AgentEventRow {
    fn load(c: &mut SqliteConnection, s: &str) -> diesel::QueryResult<Vec<Self>> {
        construct_flow_agent_events::table
            .filter(construct_flow_agent_events::session_id.eq(s))
            .order(construct_flow_agent_events::position.asc())
            .select(Self::as_select())
            .load(c)
    }
    fn payload(self) -> String {
        self.payload_json
    }
}
impl PayloadEntity for ActionRow {
    fn load(c: &mut SqliteConnection, s: &str) -> diesel::QueryResult<Vec<Self>> {
        construct_flow_actions::table
            .filter(construct_flow_actions::session_id.eq(s))
            .order(construct_flow_actions::position.asc())
            .select(Self::as_select())
            .load(c)
    }
    fn payload(self) -> String {
        self.payload_json
    }
}
fn payloads<T: PayloadEntity>(c: &mut SqliteConnection, s: &str) -> CommandResult<Vec<Value>> {
    Ok(T::load(c, s)
        .map_err(db_error)?
        .into_iter()
        .map(|row| parse(&row.payload(), json!({})))
        .collect())
}
fn practice_payloads(c: &mut SqliteConnection, s: &str) -> CommandResult<Vec<Value>> {
    Ok(construct_flow_practice_tasks::table
        .filter(construct_flow_practice_tasks::session_id.eq(s))
        .order(construct_flow_practice_tasks::position.asc())
        .select(PracticeTaskRow::as_select())
        .load(c)
        .map_err(db_error)?
        .into_iter()
        .map(|row| parse(&row.payload_json, json!({})))
        .collect())
}
fn exercise_payloads(c: &mut SqliteConnection, s: &str) -> CommandResult<Vec<Value>> {
    Ok(construct_flow_concept_exercises::table
        .filter(construct_flow_concept_exercises::session_id.eq(s))
        .order(construct_flow_concept_exercises::position.asc())
        .select(ConceptExerciseRow::as_select())
        .load(c)
        .map_err(db_error)?
        .into_iter()
        .map(|row| parse(&row.payload_json, json!({})))
        .collect())
}

fn path_node(row: PathNodeRow) -> Value {
    json!({"id":row.original_id.unwrap_or(row.id),"title":row.title,"summary":row.summary,"status":row.status,"order":row.node_order,"kind":row.kind,"learnerLevel":row.learner_level,"concepts":parse_opt(row.concepts_json,Value::Null),"taskIds":parse_opt(row.task_ids_json,Value::Null),"entryCriteria":parse_opt(row.entry_criteria_json,Value::Null),"exitCriteria":parse_opt(row.exit_criteria_json,Value::Null),"researchNotes":parse_opt(row.research_notes_json,Value::Null),"createdAt":row.created_at,"updatedAt":row.updated_at,"completedAt":row.completed_at})
}
fn tool_call(row: ToolCallRow) -> Value {
    json!({"id":row.original_id.unwrap_or(row.id),"name":row.name,"title":row.title,"reason":row.reason,"input":parse_opt(row.input_json,Value::Null),"outputPreview":row.output_preview,"response":parse_opt(row.response_json,Value::Null),"status":row.status,"createdAt":row.created_at,"completedAt":row.completed_at})
}
fn timeline_part(row: TimelineRow) -> Value {
    let mut value = Map::new();
    value.insert("id".into(), json!(row.original_id.unwrap_or(row.id)));
    value.insert("kind".into(), json!(row.kind));
    value.insert("status".into(), json!(row.status));
    for (key, item) in [
        ("title", row.title),
        ("detail", row.detail),
        ("text", row.text),
        ("toolCallId", row.tool_call_id),
        ("name", row.name),
        ("reason", row.reason),
        ("outputPreview", row.output_preview),
        ("summary", row.summary),
        ("completedAt", row.completed_at),
        ("updatedAt", row.updated_at),
    ] {
        if let Some(item) = item {
            value.insert(key.into(), json!(item));
        }
    }
    value.insert("input".into(), parse_opt(row.input_json, Value::Null));
    value.insert("createdAt".into(), json!(row.created_at));
    Value::Object(value)
}
fn parse(value: &str, fallback: Value) -> Value {
    serde_json::from_str(value).unwrap_or(fallback)
}
fn parse_opt(value: Option<String>, fallback: Value) -> Value {
    value
        .as_deref()
        .map(|value| parse(value, fallback.clone()))
        .unwrap_or(fallback)
}
fn db_error(error: diesel::result::Error) -> CommandError {
    CommandError::new("project.legacy-read", error.to_string())
}
