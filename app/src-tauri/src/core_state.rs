use crate::error::CommandResult;
use crate::paths::DataPaths;
use crate::storage::{Database, UiStateStore};

pub struct CoreState {
    pub paths: DataPaths,
    pub ui_state: UiStateStore,
}

impl CoreState {
    pub fn initialize() -> CommandResult<Self> {
        let paths = DataPaths::resolve()?;
        let database = Database::open(&paths.database)?;
        Ok(Self {
            paths,
            ui_state: UiStateStore::new(database),
        })
    }
}
