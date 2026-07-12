use diesel::prelude::*;
use serde_json::Value;

use crate::error::{CommandError, CommandResult};

use super::models::{NewStorageItem, StorageItem};
use super::schema::storage_items;
use super::Database;

pub struct JsonStore {
    database: Database,
}

impl JsonStore {
    pub fn new(database: Database) -> Self {
        Self { database }
    }
    pub fn get(&self, key: &str) -> CommandResult<Option<Value>> {
        let item = self.database.with_connection(|connection| {
            storage_items::table
                .filter(storage_items::scope.eq("application"))
                .filter(storage_items::key.eq(key))
                .select(StorageItem::as_select())
                .first::<StorageItem>(connection)
                .optional()
        })?;
        item.map(|item| {
            serde_json::from_str(&item.value)
                .map_err(|error| CommandError::new("storage.decode", error.to_string()))
        })
        .transpose()
    }
    pub fn set(&self, key: &str, value: &Value) -> CommandResult<()> {
        let payload = serde_json::to_string(value)
            .map_err(|error| CommandError::new("storage.encode", error.to_string()))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string();
        self.database.with_connection(|connection| {
            diesel::insert_into(storage_items::table)
                .values(NewStorageItem {
                    scope: "application",
                    key,
                    value: &payload,
                    target: 1,
                    updated_at: &now,
                })
                .on_conflict((storage_items::scope, storage_items::key))
                .do_update()
                .set((
                    storage_items::value.eq(&payload),
                    storage_items::updated_at.eq(&now),
                ))
                .execute(connection)?;
            Ok(())
        })
    }
}
