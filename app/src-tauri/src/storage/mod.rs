mod migrations;
mod ui_state;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::{CommandError, CommandResult};

pub use ui_state::{StorageMetrics, UiStateInput, UiStateStore};

pub struct Database {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> CommandResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                CommandError::new("storage.create-directory", error.to_string())
            })?;
        }
        let connection = Connection::open(&path)
            .map_err(|error| CommandError::new("storage.open", error.to_string()))?;
        migrations::migrate(&connection)?;
        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> CommandResult<T> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CommandError::new("storage.lock", "database lock was poisoned"))?;
        operation(&connection)
            .map_err(|error| CommandError::new("storage.query", error.to_string()))
    }

    pub fn checkpoint(&self) -> CommandResult<()> {
        self.with_connection(|connection| {
            connection.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_legacy_compatible_storage_tables() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(directory.path().join("construct.sqlite3")).unwrap();
        let tables: Vec<String> = database
            .with_connection(|connection| {
                let mut statement = connection
                    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")?;
                let rows = statement
                    .query_map([], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .unwrap();
        assert!(tables.contains(&"storage_items".to_string()));
        assert!(tables.contains(&"storage_sync_queue".to_string()));
    }
}
