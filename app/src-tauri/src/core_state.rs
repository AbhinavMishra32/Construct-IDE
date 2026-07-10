use crate::error::CommandResult;
use crate::paths::DataPaths;
use crate::projects::ProjectStore;
use crate::storage::{Database, UiStateStore};
use crate::workspace::WorkspaceService;

pub struct CoreState {
    pub paths: DataPaths,
    pub ui_state: UiStateStore,
    pub workspace: WorkspaceService,
}

impl CoreState {
    pub fn initialize() -> CommandResult<Self> {
        let paths = DataPaths::resolve()?;
        let database = Database::open(&paths.database)?;
        let projects = ProjectStore::new(Database::open(&paths.database)?);
        Ok(Self {
            paths,
            ui_state: UiStateStore::new(database),
            workspace: WorkspaceService::new(projects),
        })
    }
}
