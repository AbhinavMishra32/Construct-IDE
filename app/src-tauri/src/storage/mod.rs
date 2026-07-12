mod json_store;
mod models;
pub(crate) mod schema;
mod ui_state;

use std::path::{Path, PathBuf};

use diesel::connection::SimpleConnection;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

use crate::error::{CommandError, CommandResult};

pub use json_store::JsonStore;
pub use ui_state::{StorageMetrics, UiStateInput, UiStateStore};

const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");
pub type SqlitePool = Pool<ConnectionManager<SqliteConnection>>;

pub struct Database {
    path: PathBuf,
    pool: SqlitePool,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> CommandResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                CommandError::new("storage.create-directory", error.to_string())
            })?;
        }
        let manager = ConnectionManager::<SqliteConnection>::new(path.to_string_lossy());
        let pool = Pool::builder()
            .max_size(4)
            .build(manager)
            .map_err(|error| CommandError::new("storage.pool", error.to_string()))?;
        let database = Self { path, pool };
        database.with_connection(|connection| {
            connection.batch_execute(
                "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -20000;",
            )?;
            connection
                .run_pending_migrations(MIGRATIONS)
                .map_err(|error| diesel::result::Error::QueryBuilderError(error))?;
            Ok(())
        })?;
        Ok(database)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut SqliteConnection) -> diesel::QueryResult<T>,
    ) -> CommandResult<T> {
        let mut connection = self
            .pool
            .get()
            .map_err(|error| CommandError::new("storage.connection", error.to_string()))?;
        operation(&mut connection)
            .map_err(|error| CommandError::new("storage.query", error.to_string()))
    }

    pub fn checkpoint(&self) -> CommandResult<()> {
        self.with_connection(|connection| {
            connection.batch_execute("PRAGMA wal_checkpoint(PASSIVE)")
        })
    }
}

#[cfg(test)]
mod tests {
    use diesel::prelude::*;

    use super::schema::storage_items::dsl::*;
    use super::*;

    #[test]
    fn runs_embedded_migrations() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(directory.path().join("construct.sqlite3")).unwrap();
        let count = database
            .with_connection(|connection| storage_items.count().get_result::<i64>(connection))
            .unwrap();
        assert_eq!(count, 0);
    }
}
