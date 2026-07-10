use std::path::PathBuf;

use diesel::prelude::*;

use crate::error::{CommandError, CommandResult};
use crate::storage::schema::construct_projects;
use crate::storage::Database;

#[derive(Insertable)]
#[diesel(table_name = construct_projects)]
pub struct NewProject<'a> {
    pub id: &'a str,
    pub kind: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub workspace_path: &'a str,
}

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
                construct_projects::table
                    .filter(construct_projects::id.eq(project_id))
                    .select(construct_projects::workspace_path)
                    .first::<String>(connection)
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

    #[cfg(test)]
    pub fn insert(&self, project: NewProject<'_>) -> CommandResult<()> {
        self.database.with_connection(|connection| {
            diesel::insert_into(construct_projects::table)
                .values(project)
                .execute(connection)?;
            Ok(())
        })
    }
}
