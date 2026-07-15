use std::collections::BTreeSet;

use chrono::Utc;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{CommandError, CommandResult};
use crate::storage::schema::storage_items;
use crate::storage::Database;

const PROFILE_SCOPE: &str = "profile:default";
const PROFILE_KEY: &str = "construct.profile.identity.v1";
const ACTIVITY_KEY: &str = "construct.profile.activity.v1";
const MAX_ACTIVITY_EVENTS: usize = 5_000;
const MAX_AVATAR_BYTES: usize = 400_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructProfile {
    pub name: String,
    pub handle: String,
    pub avatar_color: String,
    pub avatar_image: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileActivityEvent {
    pub kind: String,
    pub project_id: Option<String>,
    pub at: String,
}

pub struct ProfileService {
    database: Database,
}

impl ProfileService {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn get(&self) -> CommandResult<ConstructProfile> {
        Ok(self
            .read_value(PROFILE_KEY)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_else(default_profile))
    }

    pub fn update(&self, input: ConstructProfile) -> CommandResult<ConstructProfile> {
        let profile = validate_profile(input)?;
        self.write_value(
            PROFILE_KEY,
            &serde_json::to_value(&profile).map_err(encode_error)?,
        )?;
        Ok(profile)
    }

    pub fn record_activity(&self, kind: &str, project_id: Option<&str>) -> CommandResult<()> {
        let mut events = self.activity_events()?;
        events.push(ProfileActivityEvent {
            kind: kind.to_string(),
            project_id: project_id.map(str::to_string),
            at: Utc::now().to_rfc3339(),
        });
        if events.len() > MAX_ACTIVITY_EVENTS {
            events.drain(..events.len() - MAX_ACTIVITY_EVENTS);
        }
        self.write_value(
            ACTIVITY_KEY,
            &serde_json::to_value(events).map_err(encode_error)?,
        )
    }

    pub fn snapshot(&self, projects: &[Value], learning: &Value) -> CommandResult<Value> {
        let profile = self.get()?;
        let mut events = self.activity_events()?;
        let mut completed_projects = 0_u64;
        let mut flow_sessions = 0_u64;
        let mut verification_passes = 0_u64;
        let mut progress_total = 0_u64;
        let mut flow_projects = 0_u64;
        let mut best_project: Option<(&str, u64)> = None;

        for project in projects {
            let project_id = project.get("id").and_then(Value::as_str);
            let title = project
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled project");
            let progress = project.get("progress").and_then(Value::as_u64).unwrap_or(0);
            progress_total += progress.min(100);
            if project
                .get("completedAt")
                .is_some_and(|value| !value.is_null())
                || progress >= 100
            {
                completed_projects += 1;
            }

            push_timestamp_event(
                &mut events,
                "project-created",
                project_id,
                project
                    .pointer("/flow/createdAt")
                    .or_else(|| project.get("createdAt")),
            );
            push_timestamp_event(
                &mut events,
                "project-completed",
                project_id,
                project.get("completedAt"),
            );

            let mut score = progress;
            if let Some(sessions) = project.pointer("/flow/sessions").and_then(Value::as_array) {
                flow_projects += 1;
                flow_sessions += sessions.len() as u64;
                for session in sessions {
                    let mut found_user_message = false;
                    if let Some(messages) = session.get("messages").and_then(Value::as_array) {
                        for message in messages {
                            if message.get("role").and_then(Value::as_str) == Some("user") {
                                found_user_message = true;
                                push_timestamp_event(
                                    &mut events,
                                    "flow-turn",
                                    project_id,
                                    message.get("createdAt"),
                                );
                                score += 5;
                            }
                        }
                    }
                    if !found_user_message {
                        push_timestamp_event(
                            &mut events,
                            "flow-session",
                            project_id,
                            session.get("createdAt"),
                        );
                        score += 3;
                    }
                }
            }

            if let Some(results) = project
                .get("verificationResults")
                .and_then(Value::as_object)
            {
                let passes = results
                    .values()
                    .filter(|result| result.get("passed").and_then(Value::as_bool) == Some(true))
                    .count() as u64;
                verification_passes += passes;
                score += passes * 4;
            }
            if let Some(blocks) = project.get("completedBlocks").and_then(Value::as_object) {
                score += blocks
                    .values()
                    .filter(|value| value.as_bool() == Some(true))
                    .count() as u64;
            }
            if best_project
                .map(|(_, best_score)| score > best_score)
                .unwrap_or(true)
            {
                best_project = Some((title, score));
            }
        }

        let concepts = unique_concept_count(learning);
        append_learning_events(&mut events, learning);
        events.sort_by(|left, right| left.at.cmp(&right.at));

        Ok(json!({
            "profile": profile,
            "stats": {
                "projects": projects.len(),
                "completedProjects": completed_projects,
                "concepts": concepts,
                "flowSessions": flow_sessions,
                "verificationPasses": verification_passes,
                "averageProgress": if projects.is_empty() { 0 } else { progress_total / projects.len() as u64 }
            },
            "activityEvents": events,
            "mostWorkedProject": best_project.map(|(title, _)| title),
            "projectMix": {
                "flow": flow_projects,
                "tape": projects.len() as u64 - flow_projects
            },
            "evidenceVersion": 1
        }))
    }

    fn activity_events(&self) -> CommandResult<Vec<ProfileActivityEvent>> {
        Ok(self
            .read_value(ACTIVITY_KEY)?
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
    }

    fn read_value(&self, key: &str) -> CommandResult<Option<Value>> {
        let payload = self.database.with_connection(|connection| {
            storage_items::table
                .filter(storage_items::scope.eq(PROFILE_SCOPE))
                .filter(storage_items::key.eq(key))
                .select(storage_items::value)
                .first::<String>(connection)
                .optional()
        })?;
        payload
            .map(|payload| {
                serde_json::from_str(&payload)
                    .map_err(|error| CommandError::new("profile.decode", error.to_string()))
            })
            .transpose()
    }

    fn write_value(&self, key: &str, value: &Value) -> CommandResult<()> {
        let payload = serde_json::to_string(value).map_err(encode_error)?;
        let updated_at = Utc::now().timestamp_millis().to_string();
        self.database.with_connection(|connection| {
            diesel::insert_into(storage_items::table)
                .values((
                    storage_items::scope.eq(PROFILE_SCOPE),
                    storage_items::key.eq(key),
                    storage_items::value.eq(&payload),
                    storage_items::target.eq(0),
                    storage_items::updated_at.eq(&updated_at),
                ))
                .on_conflict((storage_items::scope, storage_items::key))
                .do_update()
                .set((
                    storage_items::value.eq(&payload),
                    storage_items::updated_at.eq(&updated_at),
                ))
                .execute(connection)?;
            Ok(())
        })
    }
}

fn validate_profile(mut profile: ConstructProfile) -> CommandResult<ConstructProfile> {
    profile.name = profile.name.trim().to_string();
    if profile.name.is_empty() || profile.name.chars().count() > 80 {
        return Err(CommandError::new(
            "profile.invalid-name",
            "Display name must be between 1 and 80 characters",
        ));
    }
    profile.handle = normalize_handle(&profile.handle);
    if profile.handle.len() < 2 {
        return Err(CommandError::new(
            "profile.invalid-handle",
            "Handle must contain at least one letter or number",
        ));
    }
    if !valid_hex_color(&profile.avatar_color) {
        return Err(CommandError::new(
            "profile.invalid-color",
            "Avatar color must be a six-digit hex color",
        ));
    }
    if let Some(image) = profile.avatar_image.as_deref() {
        let allowed = image.starts_with("data:image/jpeg;base64,")
            || image.starts_with("data:image/png;base64,")
            || image.starts_with("data:image/webp;base64,");
        if !allowed || image.len() > MAX_AVATAR_BYTES {
            return Err(CommandError::new(
                "profile.invalid-avatar",
                "Avatar must be a JPEG, PNG, or WebP image under 300 KB",
            ));
        }
    }
    profile.updated_at = Some(Utc::now().to_rfc3339());
    Ok(profile)
}

fn default_profile() -> ConstructProfile {
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "construct-user".to_string());
    let name = username
        .split(['.', '_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    ConstructProfile {
        name: if name.is_empty() {
            "Construct User".to_string()
        } else {
            name
        },
        handle: normalize_handle(&username),
        avatar_color: "#2563eb".to_string(),
        avatar_image: None,
        updated_at: None,
    }
}

fn normalize_handle(value: &str) -> String {
    let normalized = value
        .trim_start_matches('@')
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .take(32)
        .collect::<String>();
    format!("@{normalized}")
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn push_timestamp_event(
    events: &mut Vec<ProfileActivityEvent>,
    kind: &str,
    project_id: Option<&str>,
    value: Option<&Value>,
) {
    if let Some(at) = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        events.push(ProfileActivityEvent {
            kind: kind.to_string(),
            project_id: project_id.map(str::to_string),
            at: at.to_string(),
        });
    }
}

fn append_learning_events(events: &mut Vec<ProfileActivityEvent>, learning: &Value) {
    if let Some(projects) = learning.get("projects").and_then(Value::as_object) {
        for (project_id, project) in projects {
            if let Some(engagements) = project.get("conceptEngagement").and_then(Value::as_object) {
                for engagement in engagements.values() {
                    push_timestamp_event(
                        events,
                        "concept-open",
                        Some(project_id),
                        engagement.get("lastOpenedAt"),
                    );
                }
            }
            for key in [
                "recallAttempts",
                "constructInteractSessions",
                "conceptEvents",
            ] {
                if let Some(items) = project.get(key).and_then(Value::as_array) {
                    for item in items {
                        let timestamp = item
                            .get("createdAt")
                            .or_else(|| item.get("at"))
                            .or_else(|| item.get("updatedAt"));
                        push_timestamp_event(events, key, Some(project_id), timestamp);
                    }
                }
            }
        }
    }
}

fn unique_concept_count(learning: &Value) -> usize {
    let mut concepts = BTreeSet::new();
    if let Some(global) = learning
        .pointer("/learner/globalConceptUnderstanding")
        .and_then(Value::as_object)
    {
        concepts.extend(global.keys().cloned());
    }
    if let Some(records) = learning
        .pointer("/knowledgeBase/concepts")
        .and_then(Value::as_object)
    {
        for (key, record) in records {
            concepts.insert(
                record
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or(key)
                    .to_string(),
            );
        }
    }
    concepts.len()
}

fn encode_error(error: serde_json::Error) -> CommandError {
    CommandError::new("profile.encode", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_round_trips_profile_identity() {
        let directory = tempfile::tempdir().unwrap();
        let service = ProfileService::new(
            Database::open(directory.path().join("construct.sqlite3")).unwrap(),
        );
        let saved = service
            .update(ConstructProfile {
                name: "Ada Lovelace".into(),
                handle: "@Ada.Dev".into(),
                avatar_color: "#7c3aed".into(),
                avatar_image: None,
                updated_at: None,
            })
            .unwrap();
        assert_eq!(saved.handle, "@adadev");
        assert_eq!(service.get().unwrap().name, "Ada Lovelace");
    }
}
