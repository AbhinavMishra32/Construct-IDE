use std::path::PathBuf;

use crate::error::{CommandError, CommandResult};

#[derive(Clone, Debug)]
pub struct DataPaths {
    pub user_data_root: PathBuf,
    pub database: PathBuf,
    pub workspaces: PathBuf,
}

impl DataPaths {
    pub fn resolve() -> CommandResult<Self> {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .ok_or_else(|| CommandError::new("paths.home", "home directory is unavailable"))?;

        #[cfg(target_os = "windows")]
        let user_data_root = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("Construct");
        #[cfg(target_os = "macos")]
        let user_data_root = home
            .join("Library")
            .join("Application Support")
            .join("Construct");
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let user_data_root = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("Construct");

        Ok(Self {
            database: user_data_root.join("construct-state.vscdb"),
            workspaces: user_data_root.join("workspaces"),
            user_data_root,
        })
    }
}
