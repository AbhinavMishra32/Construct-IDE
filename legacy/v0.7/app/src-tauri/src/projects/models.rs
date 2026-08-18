#![allow(dead_code)]

use diesel::{Insertable, Queryable, Selectable};

use crate::storage::schema::*;

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_projects)]
pub struct ProjectRow {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub progress: i32,
    pub last_opened_at: Option<String>,
    pub workspace_path: String,
    pub active_file_path: Option<String>,
    pub file_tree_expanded_json: String,
    pub completed_at: Option<String>,
    pub source_path: Option<String>,
    pub source: Option<String>,
    pub original_source: Option<String>,
    pub authoring_fixes_json: Option<String>,
    pub program_json: Option<String>,
    pub current_step_index: Option<i32>,
    pub current_block_index: Option<i32>,
    pub typing_progress_json: Option<String>,
    pub edit_anchors_json: Option<String>,
    pub assistance_json: Option<String>,
    pub verification_results_json: Option<String>,
    pub completed_blocks_json: Option<String>,
    pub flow_goal: Option<String>,
    pub flow_stack_preference: Option<String>,
    pub flow_autonomy_preference: Option<String>,
    pub flow_permissions_preference: Option<String>,
    pub flow_project_settings_json: Option<String>,
    pub flow_memory_directory: Option<String>,
    pub flow_thread_id: Option<String>,
    pub flow_research_enabled: Option<i32>,
    pub flow_research_completed_at: Option<String>,
    pub flow_current_path_node_id: Option<String>,
    pub flow_path_created_at: Option<String>,
    pub flow_path_updated_at: Option<String>,
    pub flow_created_at: Option<String>,
    pub flow_updated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_project_documents)]
pub struct ProjectDocumentRow {
    pub project_id: String,
    pub payload_json: String,
    pub updated_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = construct_project_documents)]
pub struct NewProjectDocument<'a> {
    pub project_id: &'a str,
    pub payload_json: &'a str,
    pub updated_at: &'a str,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_path_nodes)]
pub struct PathNodeRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub node_order: i32,
    pub kind: Option<String>,
    pub learner_level: Option<String>,
    pub concepts_json: Option<String>,
    pub task_ids_json: Option<String>,
    pub entry_criteria_json: Option<String>,
    pub exit_criteria_json: Option<String>,
    pub research_notes_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_sessions)]
pub struct SessionRow {
    pub id: String,
    pub project_id: String,
    pub thread_id: String,
    pub origin: Option<String>,
    pub question_response_json: Option<String>,
    pub status: String,
    pub citations_json: Option<String>,
    pub context_compaction_json: Option<String>,
    pub context_window_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub duration_ms: Option<i32>,
    pub step_count: Option<i32>,
    pub finish_reason: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_messages)]
pub struct MessageRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub position: i32,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_tool_calls)]
pub struct ToolCallRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub session_id: String,
    pub name: String,
    pub title: String,
    pub reason: String,
    pub input_json: Option<String>,
    pub output_preview: Option<String>,
    pub response_json: Option<String>,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub position: i32,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_timeline_parts)]
pub struct TimelineRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub session_id: String,
    pub kind: String,
    pub status: String,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub text: Option<String>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
    pub reason: Option<String>,
    pub input_json: Option<String>,
    pub output_preview: Option<String>,
    pub summary: Option<String>,
    pub before_tokens: Option<i32>,
    pub after_tokens: Option<i32>,
    pub summarized_message_count: Option<i32>,
    pub preserved_message_count: Option<i32>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub updated_at: Option<String>,
    pub position: i32,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_agent_events)]
pub struct AgentEventRow {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub payload_json: String,
    pub position: i32,
}
#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_actions)]
pub struct ActionRow {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub payload_json: String,
    pub position: i32,
}
#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_practice_tasks)]
pub struct PracticeTaskRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub session_id: String,
    pub path_node_id: Option<String>,
    pub language: Option<String>,
    pub title: String,
    pub prompt: String,
    pub status: String,
    pub created_at: String,
    pub submitted_at: Option<String>,
    pub payload_json: String,
    pub position: i32,
}
#[derive(Queryable, Selectable)]
#[diesel(table_name = construct_flow_concept_exercises)]
pub struct ConceptExerciseRow {
    pub id: String,
    pub original_id: Option<String>,
    pub project_id: String,
    pub session_id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub payload_json: String,
    pub position: i32,
}
