use diesel::{Identifiable, Insertable, Queryable, Selectable};

use super::schema::storage_items;

#[derive(Debug, Queryable, Selectable, Identifiable)]
#[diesel(table_name = storage_items)]
#[diesel(primary_key(scope, key))]
pub struct StorageItem {
    pub scope: String,
    pub key: String,
    pub value: String,
    pub target: i32,
    pub updated_at: String,
}

#[derive(Insertable)]
#[diesel(table_name = storage_items)]
pub struct NewStorageItem<'a> {
    pub scope: &'a str,
    pub key: &'a str,
    pub value: &'a str,
    pub target: i32,
    pub updated_at: &'a str,
}
