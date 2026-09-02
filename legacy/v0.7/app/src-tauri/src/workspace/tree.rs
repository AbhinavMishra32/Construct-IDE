use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::{CommandError, CommandResult};

use super::paths::is_ignored_name;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<WorkspaceTreeNode>>,
}

pub fn list(root: &Path) -> CommandResult<Vec<WorkspaceTreeNode>> {
    list_directory(root, root)
}

fn list_directory(root: &Path, directory: &Path) -> CommandResult<Vec<WorkspaceTreeNode>> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| CommandError::new("workspace.read-directory", error.to_string()))?
        .filter_map(Result::ok)
        .filter(|entry| !is_ignored_name(&entry.file_name().to_string_lossy()))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        let left_dir = left.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let right_dir = right.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });

    entries
        .into_iter()
        .map(|entry| {
            let file_type = entry
                .file_type()
                .map_err(|error| CommandError::new("workspace.file-type", error.to_string()))?;
            let entry_path = entry.path();
            let relative = entry_path
                .strip_prefix(root)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .replace('\\', "/");
            let directory = file_type.is_dir() && !file_type.is_symlink();
            Ok(WorkspaceTreeNode {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: relative,
                kind: if directory { "directory" } else { "file" },
                children: if directory {
                    Some(list_directory(root, &entry_path)?)
                } else {
                    None
                },
            })
        })
        .collect()
}
