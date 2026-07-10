use std::path::PathBuf;

use rusqlite::{params, OptionalExtension};

use crate::error::{CommandError, CommandResult};
use crate::storage::Database;

pub struct ProjectStore {
    database: Database,
}

impl ProjectStore {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn workspace_path(&self, project_id: &str) -> CommandResult<PathBuf> {
        let project_id = project_id.trim();
        if project_id.is_empty() {
            return Err(CommandError::new(
                "project.invalid-id",
                "project id is required",
            ));
        }
        self.database
            .with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT workspace_path FROM construct_projects WHERE id = ?1",
                        params![project_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
            })?
            .map(PathBuf::from)
            .ok_or_else(|| {
                CommandError::new(
                    "project.not-found",
                    format!("Unknown Construct project: {project_id}"),
                )
            })
    }
}
