use crate::error::CommandResult;
use crate::git::GitService;
use crate::paths::DataPaths;
use crate::projects::ProjectStore;
use crate::storage::{Database, UiStateStore};
use crate::terminal::TerminalService;
use crate::workspace::{WorkspaceService, WorkspaceWatcher};

pub struct CoreState {
    pub paths: DataPaths,
    pub ui_state: UiStateStore,
    pub workspace: WorkspaceService,
    pub watcher: WorkspaceWatcher,
    pub git: GitService,
    pub terminal: TerminalService,
}

impl CoreState {
    pub fn initialize() -> CommandResult<Self> {
        let paths = DataPaths::resolve()?;
        let database = Database::open(&paths.database)?;
        let projects = ProjectStore::new(Database::open(&paths.database)?);
        let git = GitService::new(ProjectStore::new(Database::open(&paths.database)?));
        let terminal = TerminalService::new(ProjectStore::new(Database::open(&paths.database)?));
        Ok(Self {
            paths,
            ui_state: UiStateStore::new(database),
            workspace: WorkspaceService::new(projects),
            watcher: WorkspaceWatcher::default(),
            git,
            terminal,
        })
    }
}
