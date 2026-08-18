use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::core_state::CoreState;
use crate::error::{CommandError, CommandResult};
use crate::workspace::WriteFileInput;

#[tauri::command]
pub fn rust_projects_list(state: State<'_, CoreState>) -> CommandResult<Vec<Value>> {
    state.projects.summaries()
}

#[tauri::command]
pub fn rust_project_open(state: State<'_, CoreState>, id: String) -> CommandResult<Value> {
    let mut project = state.projects.read(&id)?.ok_or_else(|| {
        CommandError::new(
            "project.not-found",
            format!("Unknown Construct project: {id}"),
        )
    })?;
    project["lastOpenedAt"] = Value::String(now());
    state.projects.write(&project)?;
    state.profile.record_activity("project-open", Some(&id))?;
    Ok(project)
}

#[tauri::command]
pub fn rust_project_update(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let id = input.get("id").and_then(Value::as_str).unwrap_or_default();
    let mut project = state.projects.read(id)?.ok_or_else(|| {
        CommandError::new(
            "project.not-found",
            format!("Unknown Construct project: {id}"),
        )
    })?;
    if let Some(patch) = input.get("patch").and_then(Value::as_object) {
        let object = project.as_object_mut().ok_or_else(|| {
            CommandError::new("project.invalid", "stored project is not an object")
        })?;
        for (key, value) in patch {
            object.insert(key.clone(), value.clone());
        }
    }
    state.projects.write(&project)?;
    Ok(project)
}

#[tauri::command]
pub fn rust_project_ensure(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    create_or_replace_tape(&state, input, false)
}

#[tauri::command]
pub fn rust_project_import(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    create_or_replace_tape(&state, input, true)
}

#[tauri::command]
pub fn rust_project_read_tape(
    state: State<'_, CoreState>,
    project_id: String,
) -> CommandResult<Value> {
    let project = state
        .projects
        .read(&project_id)?
        .ok_or_else(|| CommandError::new("project.not-found", "project was not found"))?;
    if project.get("kind").and_then(Value::as_str) == Some("flow") {
        return Err(CommandError::new(
            "project.not-tape",
            "Flow projects do not have a project tape",
        ));
    }
    let source = project
        .get("sourcePath")
        .and_then(Value::as_str)
        .filter(|path| std::path::Path::new(path).is_file())
        .map(std::fs::read_to_string)
        .transpose()
        .map_err(|error| CommandError::new("project.read-tape", error.to_string()))?
        .map(Value::String)
        .unwrap_or_else(|| project.get("source").cloned().unwrap_or(json!("")));
    Ok(json!({"projectId":project_id,"sourcePath":project.get("sourcePath"),"source":source}))
}

#[tauri::command]
pub fn rust_project_update_tape(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let project_id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut project = state
        .projects
        .read(project_id)?
        .ok_or_else(|| CommandError::new("project.not-found", "project was not found"))?;
    if project.get("kind").and_then(Value::as_str) == Some("flow") {
        return Err(CommandError::new(
            "project.not-tape",
            "Flow projects do not have a project tape",
        ));
    }
    if input.pointer("/program/id").and_then(Value::as_str) != Some(project_id) {
        return Err(CommandError::new(
            "project.tape-id",
            format!("Tape project id must remain \"{project_id}\"."),
        ));
    }
    for key in ["source", "originalSource", "authoringFixes", "program"] {
        if let Some(value) = input.get(key) {
            project[key] = value.clone();
        }
    }
    let next_title = project.pointer("/program/title").cloned();
    let next_description = project.pointer("/program/description").cloned();
    if let Some(title) = next_title {
        project["title"] = title;
    }
    if let Some(description) = next_description {
        project["description"] = description;
    }
    clamp_tape_progress(&mut project);
    if let Some(source_path) = project.get("sourcePath").and_then(Value::as_str) {
        let source_path = std::path::Path::new(source_path);
        if let Some(parent) = source_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CommandError::new("project.write-tape", error.to_string()))?;
        }
        let source = project
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_default();
        std::fs::write(&source_path, source)
            .map_err(|error| CommandError::new("project.write-tape", error.to_string()))?;
    }
    materialize(&state, &project)?;
    state.projects.write(&project)?;
    Ok(project)
}

#[tauri::command]
pub fn rust_flow_create(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let title = input
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Flow Project");
    let goal = input
        .get("goal")
        .or_else(|| input.get("description"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Build and understand this project.");
    let ids = state
        .projects
        .list()?
        .into_iter()
        .filter_map(|project| {
            project
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let id = unique_id(&slug(title), &ids);
    let workspace = input
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.workspaces.join(&id));
    std::fs::create_dir_all(workspace.join(".construct"))
        .map_err(|error| CommandError::new("flow.create-workspace", error.to_string()))?;
    for file in ["project.md", "path.md", "learner.md", "research.md"] {
        let path = workspace.join(".construct").join(file);
        if !path.exists() {
            std::fs::write(path, format!("# {}\n", file.trim_end_matches(".md")))
                .map_err(|error| CommandError::new("flow.memory", error.to_string()))?;
        }
    }
    let timestamp = now();
    let settings=input.get("projectSettings").cloned().unwrap_or_else(||json!({"projectType":"app","codebaseState":"empty","projectPhase":"build","setupScope":"standard","packageManager":"auto","testStrategy":"unit","docsLevel":"brief","gitStrategy":"skip","agentEdits":"workspace","openWorkspace":true}));
    let project = json!({"kind":"flow","id":id,"title":title,"description":goal,"progress":0,"lastOpenedAt":timestamp,"workspacePath":workspace,"sourcePath":null,"activeFilePath":null,"fileTreeExpanded":[],"completedAt":null,"flow":{"goal":goal,"stackPreference":input.get("stackPreference"),"autonomyPreference":input.get("autonomyPreference").cloned().unwrap_or(json!("balanced")),"permissionsPreference":input.get("permissionsPreference").cloned().unwrap_or(json!("workspace")),"projectSettings":settings,"memoryDirectory":".construct","threadId":Uuid::new_v4().to_string(),"researchEnabled":input.get("researchFirst").and_then(Value::as_bool).unwrap_or(false),"researchCompletedAt":null,"pathNodes":[],"currentPathNodeId":null,"pathCreatedAt":null,"pathUpdatedAt":null,"sessions":[],"createdAt":timestamp,"updatedAt":timestamp}});
    state.projects.write(&project)?;
    Ok(project)
}

#[tauri::command]
pub fn rust_project_delete(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    let id = input
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let project = state
        .projects
        .read(id)?
        .ok_or_else(|| CommandError::new("project.not-found", "project was not found"))?;
    let status = state.git.status(id)?;
    if !input.get("force").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(
            json!({"hasGit":status.is_repo,"branch":status.branch,"hasRemote":status.has_remote,"hasUncommittedChanges":!status.dirty_files.is_empty(),"unpushedCommits":0}),
        );
    }
    if let Some(path) = project.get("workspacePath").and_then(Value::as_str) {
        let _ = std::fs::remove_dir_all(path);
    }
    state.projects.remove(id)?;
    Ok(json!({"deleted":true}))
}

fn create_or_replace_tape(
    state: &CoreState,
    input: Value,
    importing: bool,
) -> CommandResult<Value> {
    let program = input
        .get("program")
        .cloned()
        .ok_or_else(|| CommandError::new("project.invalid", "program is required"))?;
    let id = program
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("project.invalid", "program id is required"))?;
    let existing = state.projects.read(id)?;
    let workspace = input
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|project| project.get("workspacePath"))
                .and_then(Value::as_str)
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| state.paths.workspaces.join(id));
    std::fs::create_dir_all(&workspace)
        .map_err(|error| CommandError::new("project.workspace", error.to_string()))?;
    let timestamp = now();
    let mut project=existing.unwrap_or_else(||json!({"kind":"tape","id":id,"progress":0,"currentStepIndex":0,"currentBlockIndex":0,"fileTreeExpanded":[],"typingProgress":{},"editAnchors":{},"assistance":{},"verificationResults":{},"completedBlocks":{},"completedAt":null}));
    project["title"] = program.get("title").cloned().unwrap_or(json!(id));
    project["description"] = program.get("description").cloned().unwrap_or(json!(""));
    project["workspacePath"] = json!(workspace);
    project["source"] = input.get("source").cloned().unwrap_or(json!(""));
    project["sourcePath"] = input.get("sourcePath").cloned().unwrap_or(Value::Null);
    project["program"] = program;
    project["lastOpenedAt"] = json!(timestamp);
    if importing {
        project["originalSource"] = input
            .get("originalSource")
            .cloned()
            .unwrap_or_else(|| project["source"].clone());
        project["authoringFixes"] = input.get("authoringFixes").cloned().unwrap_or(json!([]));
    }
    state.projects.write(&project)?;
    materialize(state, &project)?;
    Ok(project)
}

fn materialize(state: &CoreState, project: &Value) -> CommandResult<()> {
    let id = project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(files) = project.pointer("/program/files").and_then(Value::as_array) {
        for file in files {
            if let (Some(path), Some(content)) = (
                file.get("path").and_then(Value::as_str),
                file.get("content").and_then(Value::as_str),
            ) {
                state.workspace.write(&WriteFileInput {
                    project_id: id.into(),
                    path: path.into(),
                    content: content.into(),
                })?;
            }
        }
    }
    Ok(())
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn clamp_tape_progress(project: &mut Value) {
    let steps = project
        .pointer("/program/steps")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let step_index = project
        .get("currentStepIndex")
        .and_then(Value::as_u64)
        .unwrap_or_default() as usize;
    let step_index = step_index.min(steps.len().saturating_sub(1));
    let block_count = steps
        .get(step_index)
        .and_then(|step| step.get("blocks"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(1);
    let block_index = project
        .get("currentBlockIndex")
        .and_then(Value::as_u64)
        .unwrap_or_default() as usize;
    let completed = project
        .get("completedBlocks")
        .and_then(Value::as_object)
        .map(|blocks| {
            blocks
                .values()
                .filter(|value| value.as_bool() == Some(true))
                .count()
        })
        .unwrap_or_default();
    let total = steps
        .iter()
        .filter_map(|step| step.get("blocks").and_then(Value::as_array))
        .map(Vec::len)
        .sum::<usize>();
    project["currentStepIndex"] = json!(step_index);
    project["currentBlockIndex"] = json!(block_index.min(block_count.saturating_sub(1)));
    project["progress"] = json!(if total == 0 {
        0
    } else {
        ((completed as f64 / total as f64) * 100.0).round() as u64
    });
}
fn slug(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
fn unique_id(base: &str, ids: &[String]) -> String {
    let base = if base.is_empty() {
        "flow-project"
    } else {
        base
    };
    if !ids.iter().any(|id| id == base) {
        return base.into();
    }
    for index in 2.. {
        let candidate = format!("{base}-{index}");
        if !ids.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}
