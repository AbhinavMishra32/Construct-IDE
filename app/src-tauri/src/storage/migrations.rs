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
            "#,
        )
        .map_err(|error| CommandError::new("storage.migrate", error.to_string()))
}
