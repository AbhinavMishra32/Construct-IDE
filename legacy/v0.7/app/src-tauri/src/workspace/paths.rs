use std::path::{Component, Path, PathBuf};

use crate::error::{CommandError, CommandResult};

const IGNORED_SEGMENTS: &[&str] = &[
    ".git",
    ".construct",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "dist",
    "env",
    "node_modules",
    "target",
    "venv",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
];

pub fn is_ignored_name(name: &str) -> bool {
    IGNORED_SEGMENTS.contains(&name)
}

pub fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(segment) => is_ignored_name(&segment.to_string_lossy()),
        _ => false,
    })
}

pub fn safe_join(root: &Path, relative: &str) -> CommandResult<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CommandError::new(
            "workspace.invalid-path",
            format!("project path escapes workspace: {relative}"),
        ));
    }

    let root = root.canonicalize().map_err(|error| {
        CommandError::new(
            "workspace.missing-root",
            format!("{}: {error}", root.display()),
        )
    })?;
    let target = root.join(relative_path);
    let existing_ancestor = target
        .ancestors()
        .find(|candidate| candidate.exists())
        .unwrap_or(&root)
        .canonicalize()
        .map_err(|error| CommandError::new("workspace.canonicalize", error.to_string()))?;
    if !existing_ancestor.starts_with(&root) {
        return Err(CommandError::new(
            "workspace.symlink-escape",
            format!("project path escapes workspace through a symlink: {relative}"),
        ));
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        let directory = tempfile::tempdir().unwrap();
        assert!(safe_join(directory.path(), "../secret").is_err());
    }
}
