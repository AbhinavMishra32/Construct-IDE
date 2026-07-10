use crate::error::CommandResult;
use crate::git::GitService;
use crate::learning::LearningService;
use crate::lsp::LspService;
use crate::paths::DataPaths;
use crate::projects::ProjectStore;
use crate::settings::SettingsService;
use crate::storage::{Database, JsonStore, UiStateStore};
use crate::terminal::TerminalService;
use crate::workspace::{WorkspaceService, WorkspaceWatcher};

pub struct CoreState {
    pub paths: DataPaths,
    pub ui_state: UiStateStore,
    pub workspace: WorkspaceService,
    pub watcher: WorkspaceWatcher,
    pub git: GitService,
    pub terminal: TerminalService,
    pub lsp: LspService,
    pub projects: ProjectStore,
    pub settings: SettingsService,
    pub learning: LearningService,
}

impl CoreState {
    pub fn initialize() -> CommandResult<Self> {
        let paths = DataPaths::resolve()?;
        let database = Database::open(&paths.database)?;
        let projects = ProjectStore::new(Database::open(&paths.database)?);
        let git = GitService::new(ProjectStore::new(Database::open(&paths.database)?));
        let terminal = TerminalService::new(ProjectStore::new(Database::open(&paths.database)?));
        let lsp = LspService::new(ProjectStore::new(Database::open(&paths.database)?));
        let project_repository = ProjectStore::new(Database::open(&paths.database)?);
        let settings = SettingsService::new(
            JsonStore::new(Database::open(&paths.database)?),
            paths.clone(),
        );
        let learning = LearningService::new(Database::open(&paths.database)?);
        Ok(Self {
            paths,
            ui_state: UiStateStore::new(database),
            workspace: WorkspaceService::new(projects),
            watcher: WorkspaceWatcher::default(),
            git,
            terminal,
            lsp,
            projects: project_repository,
            settings,
            learning,
        })
    }
}
