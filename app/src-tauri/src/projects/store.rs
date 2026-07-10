use std::path::PathBuf;

use diesel::prelude::*;
use serde_json::{json, Value};

use crate::error::{CommandError, CommandResult};
use crate::storage::schema::construct_project_documents;
use crate::storage::schema::construct_projects;

use super::legacy;
use super::models::{NewProjectDocument, ProjectDocumentRow, ProjectRow};
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

    pub fn read(&self, project_id: &str) -> CommandResult<Option<Value>> {
        self.database.with_connection(|connection| {
            if let Some(document) = construct_project_documents::table
                .find(project_id)
                .select(ProjectDocumentRow::as_select())
                .first::<ProjectDocumentRow>(connection)
                .optional()?
            {
                return Ok(Some(parse_document(&document.payload_json)?));
            }
            let row = construct_projects::table
                .find(project_id)
                .select(ProjectRow::as_select())
                .first::<ProjectRow>(connection)
                .optional()?;
            let Some(row) = row else {
                return Ok(None);
            };
            let value = legacy::hydrate(connection, row)
                .map_err(|error| diesel::result::Error::QueryBuilderError(Box::new(error)))?;
            cache_document(connection, project_id, &value)?;
            Ok(Some(value))
        })
    }

    pub fn list(&self) -> CommandResult<Vec<Value>> {
        let ids = self.database.with_connection(|connection| {
            construct_projects::table
                .select(construct_projects::id)
                .order(construct_projects::last_opened_at.desc())
                .load::<String>(connection)
        })?;
        let mut projects = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(project) = self.read(&id)? {
                projects.push(project);
            }
        }
        Ok(projects)
    }

    pub fn write(&self, project: &Value) -> CommandResult<()> {
        let id = required_string(project, "id")?;
        let kind = project
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("tape");
        let title = required_string(project, "title")?;
        let description = project
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let workspace = required_string(project, "workspacePath")?;
        let progress = project.get("progress").and_then(Value::as_i64).unwrap_or(0) as i32;
        let last_opened = project.get("lastOpenedAt").and_then(Value::as_str);
        let active_file = project.get("activeFilePath").and_then(Value::as_str);
        self.database.with_connection(|connection| {
            let row = NewProject {
                id,
                kind,
                title,
                description,
                workspace_path: workspace,
            };
            diesel::insert_into(construct_projects::table)
                .values(&row)
                .on_conflict(construct_projects::id)
                .do_update()
                .set((
                    construct_projects::kind.eq(kind),
                    construct_projects::title.eq(title),
                    construct_projects::description.eq(description),
                    construct_projects::workspace_path.eq(workspace),
                    construct_projects::progress.eq(progress),
                    construct_projects::last_opened_at.eq(last_opened),
                    construct_projects::active_file_path.eq(active_file),
                ))
                .execute(connection)?;
            cache_document(connection, id, project)
        })
    }

    pub fn remove(&self, project_id: &str) -> CommandResult<()> {
        self.database.with_connection(|connection| {
            diesel::delete(construct_projects::table.find(project_id)).execute(connection)?;
            Ok(())
        })
    }

    pub fn summaries(&self) -> CommandResult<Vec<Value>> {
        Ok(self.list()?.into_iter().map(summary).collect())
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

fn cache_document(
    connection: &mut diesel::SqliteConnection,
    project_id: &str,
    project: &Value,
) -> diesel::QueryResult<()> {
    let payload = serde_json::to_string(project)
        .map_err(|error| diesel::result::Error::SerializationError(Box::new(error)))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    diesel::insert_into(construct_project_documents::table)
        .values(NewProjectDocument {
            project_id,
            payload_json: &payload,
            updated_at: &now,
        })
        .on_conflict(construct_project_documents::project_id)
        .do_update()
        .set((
            construct_project_documents::payload_json.eq(&payload),
            construct_project_documents::updated_at.eq(&now),
        ))
        .execute(connection)?;
    Ok(())
}

fn parse_document(payload: &str) -> diesel::QueryResult<Value> {
    serde_json::from_str(payload)
        .map_err(|error| diesel::result::Error::DeserializationError(Box::new(error)))
}

fn required_string<'a>(value: &'a Value, key: &str) -> CommandResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("project.invalid", format!("{key} is required")))
}

fn summary(project: Value) -> Value {
    let flow = project.get("flow");
    let sessions = flow
        .and_then(|flow| flow.get("sessions"))
        .and_then(Value::as_array);
    let program = project.get("program");
    let steps = program
        .and_then(|program| program.get("steps"))
        .and_then(Value::as_array);
    let files = program
        .and_then(|program| program.get("files"))
        .and_then(Value::as_array);
    json!({
        "kind":project.get("kind").cloned().unwrap_or(json!("tape")), "id":project["id"],
        "title":project["title"], "description":project["description"], "progress":project["progress"],
        "lastOpenedAt":project.get("lastOpenedAt"), "workspacePath":project["workspacePath"],
        "sourcePath":project.get("sourcePath"), "activeFilePath":project.get("activeFilePath"),
        "completedAt":project.get("completedAt"), "stepCount":steps.map(Vec::len), "fileCount":files.map(Vec::len),
        "flowGoal":flow.and_then(|flow|flow.get("goal")), "flowMemoryFileCount":if flow.is_some(){Some(4)}else{None},
        "flowSessionCount":sessions.map(Vec::len), "flowLastActivityAt":flow.and_then(|flow|flow.get("updatedAt")),
        "learnedConcepts":[]
    })
}
