use rusqlite::Connection;

use crate::error::{CommandError, CommandResult};

pub fn migrate(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            PRAGMA cache_size = -20000;

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
            "#,
        )
        .map_err(|error| CommandError::new("storage.migrate", error.to_string()))
}
