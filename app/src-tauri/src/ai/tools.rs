use chrono::Utc;
use serde_json::{json, Value};

use crate::error::{CommandError, CommandResult};
use crate::learning::LearningService;
use crate::process::ProcessRunner;
use crate::projects::ProjectStore;
use crate::workspace::{FileInput, WorkspaceService, WriteFileInput};

pub struct ToolHost {
    projects: ProjectStore,
    workspace: WorkspaceService,
    learning: LearningService,
    runner: ProcessRunner,
}

impl ToolHost {
    pub fn new(
        projects: ProjectStore,
        workspace: WorkspaceService,
        learning: LearningService,
    ) -> Self {
        Self {
            projects,
            workspace,
            learning,
            runner: ProcessRunner,
        }
    }

    pub fn execute(&self, name: &str, input: &Value) -> CommandResult<Value> {
        if name == "ask_user_question" {
            return Ok(input.clone());
        }
        let project_id = required(input, "projectId")?;
        match name {
            "read-file" => Ok(serde_json::to_value(self.workspace.read(&FileInput {
                project_id: project_id.into(),
                path: required(input, "path")?.into(),
            })?)
            .unwrap()),
            "write-file" => Ok(serde_json::to_value(self.workspace.write(&WriteFileInput {
                project_id: project_id.into(),
                path: required(input, "path")?.into(),
                content: required(input, "content")?.into(),
            })?)
            .unwrap()),
            "list-files" => Ok(serde_json::to_value(self.workspace.list(project_id)?).unwrap()),
            "run-terminal-command" => self.run_command(project_id, required(input, "command")?),
            "fetch-concepts" => self.fetch_concepts(project_id, input),
            "add-concept" => self.add_concept(project_id, input),
            "modify-concept" => self.modify_concept(project_id, input),
            "remove-concept" => self.remove_concept(project_id, input),
            _ => Err(CommandError::new(
                "mastra.unknown-tool",
                format!("Unknown host tool: {name}"),
            )),
        }
    }

    fn run_command(&self, project_id: &str, command: &str) -> CommandResult<Value> {
        if !command_is_allowed(command) {
            return Err(CommandError::new(
                "mastra.command-denied",
                "Command requires explicit learner approval",
            ));
        }
        let cwd = self.projects.workspace_path(project_id)?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let output = self.runner.run(&shell, &["-lc", command], &cwd)?;
        Ok(json!({"success":output.success,"stdout":output.stdout,"stderr":output.stderr}))
    }

    fn fetch_concepts(&self, project_id: &str, input: &Value) -> CommandResult<Value> {
        let state = self.learning.read()?;
        let requested = input.get("ids").and_then(Value::as_array).map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .collect::<std::collections::HashSet<_>>()
        });
        let query = input
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let concepts = state
            .pointer("/knowledgeBase/concepts")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|concepts| concepts.values())
            .filter(|concept| {
                concept.get("sourceProjectId").and_then(Value::as_str) == Some(project_id)
            })
            .filter(|concept| {
                requested.as_ref().map_or(true, |ids| {
                    concept
                        .get("id")
                        .and_then(Value::as_str)
                        .map_or(false, |id| ids.contains(id))
                })
            })
            .filter(|concept| query.is_empty() || searchable_concept_text(concept).contains(&query))
            .cloned()
            .collect::<Vec<_>>();
        Ok(
            json!({"concepts":concepts,"tree":input.get("includeTree").and_then(Value::as_bool).unwrap_or(false)}),
        )
    }

    fn add_concept(&self, project_id: &str, input: &Value) -> CommandResult<Value> {
        let id = required(input, "id")?.trim();
        let now = timestamp();
        let mut state = self.learning.read()?;
        let existing = state["knowledgeBase"]["concepts"]
            .get(format!("{project_id}:{id}"))
            .cloned();
        let record = concept_record(project_id, id, input, existing.as_ref(), &now)?;
        state["knowledgeBase"]["concepts"][format!("{project_id}:{id}")] = record.clone();
        record_concept_relation(
            &mut state,
            project_id,
            id,
            &record,
            "introduced",
            input,
            &now,
        );
        self.learning.write(&state)?;
        Ok(
            json!({"created":existing.is_none(),"introduced":existing.is_none(),"canonicalId":id,"concept":record}),
        )
    }

    fn modify_concept(&self, project_id: &str, input: &Value) -> CommandResult<Value> {
        let id = required(input, "id")?.trim();
        let now = timestamp();
        let mut state = self.learning.read()?;
        let key = format!("{project_id}:{id}");
        let existing = state["knowledgeBase"]["concepts"]
            .get(&key)
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    "learning.concept-not-found",
                    format!("Concept {id} is not introduced in this project"),
                )
            })?;
        let record = concept_record(project_id, id, input, Some(&existing), &now)?;
        state["knowledgeBase"]["concepts"][key] = record.clone();
        record_concept_relation(&mut state, project_id, id, &record, "modified", input, &now);
        self.learning.write(&state)?;
        Ok(json!({"modified":true,"canonicalId":id,"concept":record}))
    }

    fn remove_concept(&self, project_id: &str, input: &Value) -> CommandResult<Value> {
        let id = required(input, "id")?.trim();
        let mut state = self.learning.read()?;
        let key = format!("{project_id}:{id}");
        if state["knowledgeBase"]["concepts"]
            .as_object_mut()
            .and_then(|concepts| concepts.remove(&key))
            .is_none()
        {
            return Err(CommandError::new(
                "learning.concept-not-found",
                format!("Concept {id} is not introduced in this project"),
            ));
        }
        if let Some(relations) = state["projects"][project_id]["conceptRelations"].as_object_mut() {
            relations.remove(id);
        }
        self.learning.write(&state)?;
        Ok(json!({"removed":true,"canonicalId":id,"reason":input.get("reason")}))
    }
}

fn concept_record(
    project_id: &str,
    id: &str,
    input: &Value,
    existing: Option<&Value>,
    now: &str,
) -> CommandResult<Value> {
    let mut record = existing.cloned().unwrap_or_else(|| json!({}));
    let object = record.as_object_mut().ok_or_else(|| {
        CommandError::new(
            "learning.invalid-concept",
            "Concept record must be an object",
        )
    })?;
    let fields = [
        "title",
        "content",
        "language",
        "technology",
        "sources",
        "examples",
        "relatedConcepts",
        "masteryLevel",
        "masteryReason",
    ];
    for field in fields {
        if let Some(value) = input.get(field) {
            object.insert(field.into(), value.clone());
        }
    }
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("learning.invalid-concept", "title is required"))?
        .to_string();
    let content = object
        .get("content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("learning.invalid-concept", "content is required"))?
        .to_string();
    let parent_id = input
        .get("parentId")
        .cloned()
        .or_else(|| id.rsplit_once('.').map(|(parent, _)| json!(parent)))
        .unwrap_or(Value::Null);
    object.insert("id".into(), json!(id));
    object.insert("sourceProjectId".into(), json!(project_id));
    object.entry("kind").or_insert_with(|| json!("concept"));
    object.entry("language").or_insert_with(|| json!("unknown"));
    object.insert("parentId".into(), parent_id);
    object.insert(
        "summary".into(),
        json!(content.lines().next().unwrap_or(&title)),
    );
    object.insert(
        "lastChangeReason".into(),
        input
            .get("reason")
            .cloned()
            .unwrap_or_else(|| json!("Updated by Construct Flow.")),
    );
    object.insert(
        "learnerEvidence".into(),
        input.get("evidence").cloned().unwrap_or_else(|| json!([])),
    );
    object.insert("masteryUpdatedAt".into(), json!(now));
    object.insert("lastModifiedAt".into(), json!(now));
    object.entry("savedAt").or_insert_with(|| json!(now));
    Ok(record)
}

fn record_concept_relation(
    state: &mut Value,
    project_id: &str,
    id: &str,
    record: &Value,
    kind: &str,
    input: &Value,
    now: &str,
) {
    ensure_learning_project(state, project_id);
    state["projects"][project_id]["conceptRelations"][id] = json!({
        "conceptId":id,"introducedAt":now,"updatedAt":now,"masteryLevel":record.get("masteryLevel").cloned().unwrap_or(json!(0)),
        "reason":input.get("reason").cloned().unwrap_or(Value::Null),"kind":kind
    });
    if let Some(events) = state["projects"][project_id]["conceptEvents"].as_array_mut() {
        events.push(json!({"id":uuid::Uuid::new_v4().to_string(),"projectId":project_id,"conceptId":id,"kind":kind,"createdAt":now,"reason":input.get("reason").cloned().unwrap_or(Value::Null)}));
    }
}

fn ensure_learning_project(state: &mut Value, project_id: &str) {
    let projects = state["projects"]
        .as_object_mut()
        .expect("learning projects must be an object");
    projects.entry(project_id).or_insert_with(
        || json!({"projectId":project_id,"conceptRelations":{},"conceptEvents":[]}),
    );
}

fn searchable_concept_text(concept: &Value) -> String {
    ["id", "title", "content", "summary"]
        .into_iter()
        .filter_map(|key| concept.get(key).and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

fn required<'a>(value: &'a Value, key: &str) -> CommandResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CommandError::new("mastra.invalid-tool-input", format!("{key} is required")))
}

fn command_is_allowed(command: &str) -> bool {
    let normalized = command.to_lowercase();
    ![
        "sudo ",
        "rm -rf",
        "curl ",
        "wget ",
        "npm install",
        "pnpm add",
        "yarn add",
        "cargo install",
        "git push",
        "git reset --hard",
    ]
    .iter()
    .any(|blocked| normalized.contains(blocked))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_destructive_and_dependency_mutations() {
        assert!(!command_is_allowed("rm -rf ."));
        assert!(!command_is_allowed("npm install"));
        assert!(command_is_allowed("cargo test"));
    }

    #[test]
    fn question_tool_does_not_require_a_workspace_project() {
        let input = json!({
            "question":"What is your Python experience?",
            "choices":["Never used it","Know the basics"]
        });
        let dir = tempfile::tempdir().unwrap();
        let database = crate::storage::Database::open(&dir.path().join("workspace.db")).unwrap();
        let projects = ProjectStore::new(
            crate::storage::Database::open(&dir.path().join("projects.db")).unwrap(),
        );
        let workspace = WorkspaceService::new(ProjectStore::new(database));
        let learning = LearningService::new(
            crate::storage::Database::open(&dir.path().join("learning.db")).unwrap(),
        );
        let host = ToolHost::new(projects, workspace, learning);

        assert_eq!(host.execute("ask_user_question", &input).unwrap(), input);
    }
}
