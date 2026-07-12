use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CommandError, CommandResult};

use super::models::{NewStorageItem, StorageItem};
use super::schema::storage_items;
use super::Database;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiStateInput {
    pub key: String,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub fallback: Value,
    #[serde(default)]
    pub value: Value,
}

impl UiStateInput {
    fn normalized_key(&self) -> CommandResult<String> {
        let key = self.key.trim();
        if key.is_empty() {
            return Err(CommandError::new(
                "storage.invalid-key",
                "UI state key is required",
            ));
        }
        Ok(if key.starts_with("construct.ui.") {
            key.to_string()
        } else {
            format!("construct.ui.{key}")
        })
    }

    fn scope_key(&self) -> String {
        if matches!(self.scope.as_deref(), Some("workspace") | Some("1")) {
            if let Some(project_id) = self
                .project_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
            {
                return format!("workspace:{project_id}");
            }
        }
        "application".to_string()
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMetrics {
    pub total_reads: u64,
    pub total_queued_writes: u64,
    pub database_path: String,
}

pub struct UiStateStore {
    database: Database,
    reads: AtomicU64,
    writes: AtomicU64,
}

impl UiStateStore {
    pub fn new(database: Database) -> Self {
        Self {
            database,
            reads: AtomicU64::new(0),
            writes: AtomicU64::new(0),
        }
    }

    pub fn get(&self, input: &UiStateInput) -> CommandResult<Value> {
        let key = input.normalized_key()?;
        let scope = input.scope_key();
        let value = self.database.with_connection(|connection| {
            storage_items::table
                .filter(storage_items::scope.eq(&scope))
                .filter(storage_items::key.eq(&key))
                .select(StorageItem::as_select())
                .first::<StorageItem>(connection)
                .optional()
        })?;
        self.reads.fetch_add(1, Ordering::Relaxed);
        match value {
            Some(item) => serde_json::from_str(&item.value)
                .or_else(|_| Ok(Value::String(item.value)))
                .map_err(|error: serde_json::Error| {
                    CommandError::new("storage.decode", error.to_string())
                }),
            None => Ok(input.fallback.clone()),
        }
    }

    pub fn set(&self, input: &UiStateInput) -> CommandResult<()> {
        let key = input.normalized_key()?;
        let scope = input.scope_key();
        let value = serde_json::to_string(&input.value)
            .map_err(|error| CommandError::new("storage.encode", error.to_string()))?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string();
        self.database.with_connection(|connection| {
            let item = NewStorageItem {
                scope: &scope,
                key: &key,
                value: &value,
                target: 1,
                updated_at: &timestamp,
            };
            diesel::insert_into(storage_items::table)
                .values(&item)
                .on_conflict((storage_items::scope, storage_items::key))
                .do_update()
                .set((
                    storage_items::value.eq(&value),
                    storage_items::target.eq(1),
                    storage_items::updated_at.eq(&timestamp),
                ))
                .execute(connection)?;
            Ok(())
        })?;
        self.writes.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    pub fn flush(&self) -> CommandResult<()> {
        self.database.checkpoint()
    }

    pub fn metrics(&self) -> StorageMetrics {
        StorageMetrics {
            total_reads: self.reads.load(Ordering::Relaxed),
            total_queued_writes: self.writes.load(Ordering::Relaxed),
            database_path: self.database.path().to_string_lossy().into_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_json_without_changing_renderer_contract() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            UiStateStore::new(Database::open(directory.path().join("construct.sqlite3")).unwrap());
        let input = UiStateInput {
            key: "shell".into(),
            scope: None,
            project_id: None,
            fallback: Value::Null,
            value: serde_json::json!({"sidebar": 280}),
        };
        store.set(&input).unwrap();
        assert_eq!(store.get(&input).unwrap(), input.value);
    }

    #[test]
    fn isolates_workspace_scopes() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            UiStateStore::new(Database::open(directory.path().join("construct.sqlite3")).unwrap());
        let mut first = UiStateInput {
            key: "flow".into(),
            scope: Some("workspace".into()),
            project_id: Some("one".into()),
            fallback: Value::Null,
            value: serde_json::json!(1),
        };
        store.set(&first).unwrap();
        first.project_id = Some("two".into());
        assert_eq!(store.get(&first).unwrap(), Value::Null);
    }
}
