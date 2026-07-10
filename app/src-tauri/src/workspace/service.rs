use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};
use crate::projects::ProjectStore;

use super::paths::safe_join;
use super::tree::{self, WorkspaceTreeNode};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInput {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileInput {
    pub project_id: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameInput {
    pub project_id: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

pub struct WorkspaceService {
    projects: ProjectStore,
}

impl WorkspaceService {
    pub fn new(projects: ProjectStore) -> Self {
        Self { projects }
    }

    pub fn list(&self, project_id: &str) -> CommandResult<Vec<WorkspaceTreeNode>> {
        let root = self.projects.workspace_path(project_id)?;
        fs::create_dir_all(&root)
            .map_err(|error| CommandError::new("workspace.create", error.to_string()))?;
        tree::list(&root)
    }

    pub fn read(&self, input: &FileInput) -> CommandResult<FileContent> {
        let target = self.target(&input.project_id, &input.path)?;
        if !target.is_file() {
            return Err(CommandError::new(
                "workspace.not-file",
                format!("Not a file: {}", input.path),
            ));
        }
        let content = fs::read_to_string(&target)
            .map_err(|error| CommandError::new("workspace.read", error.to_string()))?;
        Ok(FileContent {
            path: input.path.clone(),
            content,
        })
    }

    pub fn write(&self, input: &WriteFileInput) -> CommandResult<FileContent> {
        let target = self.target(&input.project_id, &input.path)?;
        create_parent(&target)?;
        fs::write(&target, &input.content)
            .map_err(|error| CommandError::new("workspace.write", error.to_string()))?;
        Ok(FileContent {
            path: input.path.clone(),
            content: input.content.clone(),
        })
    }

    pub fn remove(&self, input: &FileInput) -> CommandResult<()> {
        let target = self.target(&input.project_id, &input.path)?;
        if target.is_dir() {
            fs::remove_dir_all(target)
        } else {
            fs::remove_file(target)
        }
        .map_err(|error| CommandError::new("workspace.remove", error.to_string()))
    }

    pub fn rename(&self, input: &RenameInput) -> CommandResult<()> {
        let source = self.target(&input.project_id, &input.old_path)?;
        let destination = self.target(&input.project_id, &input.new_path)?;
        create_parent(&destination)?;
        fs::rename(source, destination)
            .map_err(|error| CommandError::new("workspace.rename", error.to_string()))
    }

    pub fn create_folder(&self, input: &FileInput) -> CommandResult<()> {
        let target = self.target(&input.project_id, &input.path)?;
        fs::create_dir_all(target)
            .map_err(|error| CommandError::new("workspace.create-folder", error.to_string()))
    }

    pub fn duplicate(&self, source: &FileInput, destination_path: &str) -> CommandResult<()> {
        let source_path = self.target(&source.project_id, &source.path)?;
        let destination = self.target(&source.project_id, destination_path)?;
        create_parent(&destination)?;
        if source_path.is_dir() {
            copy_directory(&source_path, &destination)
        } else {
            fs::copy(source_path, destination)
                .map(|_| ())
                .map_err(|error| CommandError::new("workspace.duplicate", error.to_string()))
        }
    }

    fn target(&self, project_id: &str, relative: &str) -> CommandResult<std::path::PathBuf> {
        safe_join(&self.projects.workspace_path(project_id)?, relative)
    }
}

fn create_parent(path: &Path) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| CommandError::new("workspace.create-parent", error.to_string()))?;
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> CommandResult<()> {
    fs::create_dir_all(destination)
        .map_err(|error| CommandError::new("workspace.duplicate", error.to_string()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| CommandError::new("workspace.duplicate", error.to_string()))?
    {
        let entry =
            entry.map_err(|error| CommandError::new("workspace.duplicate", error.to_string()))?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)
                .map_err(|error| CommandError::new("workspace.duplicate", error.to_string()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;

    #[test]
    fn tree_excludes_generated_directories_and_reads_files() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir_all(workspace.join("src")).unwrap();
        fs::create_dir_all(workspace.join("node_modules/pkg")).unwrap();
        fs::write(workspace.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(workspace.join("node_modules/pkg/index.js"), "ignored").unwrap();

        let database = Database::open(directory.path().join("state.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO construct_projects(id, kind, title, description, workspace_path) VALUES ('project', 'flow', 'Project', '', ?1)",
                    [workspace.to_string_lossy().as_ref()],
                )?;
                Ok(())
            })
            .unwrap();
        let service = WorkspaceService::new(ProjectStore::new(database));
        let tree = service.list("project").unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "src");
        assert_eq!(
            service
                .read(&FileInput {
                    project_id: "project".into(),
                    path: "src/main.rs".into(),
                })
                .unwrap()
                .content,
            "fn main() {}"
        );
    }
}
