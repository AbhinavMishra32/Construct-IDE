PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_items (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_storage_items_target
  ON storage_items(scope, target);

CREATE TABLE IF NOT EXISTS storage_sync_queue (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  operation TEXT NOT NULL,
  target INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  flushed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_storage_sync_queue_status
  ON storage_sync_queue(provider_id, status, created_at);

CREATE TABLE IF NOT EXISTS construct_projects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tape', 'flow')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  workspace_path TEXT NOT NULL,
  active_file_path TEXT,
  file_tree_expanded_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  source_path TEXT,
  source TEXT,
  original_source TEXT,
  authoring_fixes_json TEXT,
  program_json TEXT,
  current_step_index INTEGER,
  current_block_index INTEGER,
  typing_progress_json TEXT,
  edit_anchors_json TEXT,
  assistance_json TEXT,
  verification_results_json TEXT,
  completed_blocks_json TEXT,
  flow_goal TEXT,
  flow_stack_preference TEXT,
  flow_autonomy_preference TEXT,
  flow_permissions_preference TEXT,
  flow_project_settings_json TEXT,
  flow_memory_directory TEXT,
  flow_thread_id TEXT,
  flow_research_enabled INTEGER,
  flow_research_completed_at TEXT,
  flow_current_path_node_id TEXT,
  flow_path_created_at TEXT,
  flow_path_updated_at TEXT,
  flow_created_at TEXT,
  flow_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_construct_projects_kind
  ON construct_projects(kind, last_opened_at);

CREATE TABLE IF NOT EXISTS construct_flow_path_nodes (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL REFERENCES construct_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, node_order INTEGER NOT NULL,
  kind TEXT, learner_level TEXT, concepts_json TEXT, task_ids_json TEXT, entry_criteria_json TEXT,
  exit_criteria_json TEXT, research_notes_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_construct_flow_path_nodes_project ON construct_flow_path_nodes(project_id, node_order);

CREATE TABLE IF NOT EXISTS construct_flow_sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES construct_projects(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL, origin TEXT, question_response_json TEXT, status TEXT NOT NULL,
  citations_json TEXT, context_compaction_json TEXT, context_window_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, duration_ms INTEGER, step_count INTEGER,
  finish_reason TEXT, error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_construct_flow_sessions_project_time ON construct_flow_sessions(project_id, created_at, id);

CREATE TABLE IF NOT EXISTS construct_flow_messages (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construct_flow_messages_session ON construct_flow_messages(session_id, position);

CREATE TABLE IF NOT EXISTS construct_flow_tool_calls (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, title TEXT NOT NULL, reason TEXT NOT NULL, input_json TEXT, output_preview TEXT,
  response_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construct_flow_tool_calls_session ON construct_flow_tool_calls(session_id, position);

CREATE TABLE IF NOT EXISTS construct_flow_timeline_parts (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT, detail TEXT, text TEXT, tool_call_id TEXT,
  name TEXT, reason TEXT, input_json TEXT, output_preview TEXT, summary TEXT,
  before_tokens INTEGER, after_tokens INTEGER, summarized_message_count INTEGER, preserved_message_count INTEGER,
  created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT, position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construct_flow_timeline_session ON construct_flow_timeline_parts(session_id, position);

CREATE TABLE IF NOT EXISTS construct_flow_agent_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS construct_flow_actions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS construct_flow_practice_tasks (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  path_node_id TEXT, language TEXT, title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, submitted_at TEXT, payload_json TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS construct_flow_concept_exercises (
  id TEXT PRIMARY KEY, original_id TEXT, project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL, position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS construct_project_documents (
  project_id TEXT PRIMARY KEY REFERENCES construct_projects(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS construct_learning_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_learning_global_concepts (concept_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_learning_assistance_events (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_learning_projects (project_id TEXT PRIMARY KEY, current_step_index INTEGER, current_block_index INTEGER, current_block_id TEXT);
CREATE TABLE IF NOT EXISTS construct_project_concept_understanding (project_id TEXT NOT NULL, concept_id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(project_id, concept_id));
CREATE TABLE IF NOT EXISTS construct_project_concept_relations (project_id TEXT NOT NULL, concept_id TEXT NOT NULL, last_referenced_at TEXT, payload_json TEXT NOT NULL, PRIMARY KEY(project_id, concept_id));
CREATE TABLE IF NOT EXISTS construct_project_concept_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, concept_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_project_artifact_audits (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_knowledge_concepts (project_id TEXT NOT NULL, concept_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, language TEXT, technology TEXT, saved_at TEXT, updated_at TEXT, payload_json TEXT NOT NULL, PRIMARY KEY(project_id, concept_id));
CREATE TABLE IF NOT EXISTS construct_project_concept_engagement (project_id TEXT NOT NULL, concept_id TEXT NOT NULL, first_opened_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, open_count INTEGER NOT NULL, PRIMARY KEY(project_id, concept_id));
CREATE TABLE IF NOT EXISTS construct_project_interact_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_project_recall_attempts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_project_planned_overlays (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_project_generated_live_steps (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_project_generated_live_step_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS construct_learning_documents (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
