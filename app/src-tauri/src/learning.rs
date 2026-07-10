use diesel::prelude::*;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::CommandResult;
use crate::storage::schema::*;
use crate::storage::Database;

pub struct LearningService {
    database: Database,
}
impl LearningService {
    pub fn new(database: Database) -> Self {
        Self { database }
    }
    pub fn read(&self) -> CommandResult<Value> {
        self.database.with_connection(|connection| {
            if let Some(payload) = construct_learning_documents::table
                .find(1)
                .select(construct_learning_documents::payload_json)
                .first::<String>(connection)
                .optional()?
            {
                return serde_json::from_str(&payload)
                    .map_err(|error| diesel::result::Error::DeserializationError(Box::new(error)));
            }
            let state = hydrate(connection)?;
            write_document(connection, &state)?;
            Ok(state)
        })
    }
    pub fn write(&self, state: &Value) -> CommandResult<()> {
        self.database
            .with_connection(|connection| write_document(connection, state))
    }
    pub fn project(&self, id: &str) -> CommandResult<Value> {
        let mut state = self.read()?;
        Ok(ensure_project(&mut state, id).clone())
    }
    pub fn apply_patch(&self, patch: &Value) -> CommandResult<Value> {
        let mut state = self.read()?;
        apply_patch(&mut state, patch);
        state["sync"]["updatedAt"] = json!(now());
        self.write(&state)?;
        Ok(state)
    }
    pub fn weak(&self, project_id: Option<&str>) -> CommandResult<Vec<Value>> {
        let state = self.read()?;
        let map = project_id
            .and_then(|id| state.pointer(&format!("/projects/{}/conceptUnderstanding", escape(id))))
            .or_else(|| state.pointer("/learner/globalConceptUnderstanding"))
            .and_then(Value::as_object);
        Ok(map
            .into_iter()
            .flat_map(|map| map.values())
            .filter(|value| {
                matches!(
                    value.get("confidence").and_then(Value::as_str),
                    Some("unknown" | "introduced" | "confused" | "fragile" | "weak")
                )
            })
            .cloned()
            .collect())
    }
}

fn hydrate(connection: &mut diesel::SqliteConnection) -> diesel::QueryResult<Value> {
    let meta = construct_learning_meta::table
        .select((construct_learning_meta::key, construct_learning_meta::value))
        .load::<(String, String)>(connection)?
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();
    if meta.is_empty() {
        return Ok(default_state());
    }
    let mut state = default_state();
    state["learner"]["id"] = json!(meta
        .get("learnerId")
        .cloned()
        .unwrap_or_else(|| format!("local:{}", Uuid::new_v4())));
    if let Some(value) = meta.get("preferences") {
        state["learner"]["preferences"] = parse(value, json!({}));
    }
    if let Some(value) = meta.get("sync") {
        state["sync"] = parse(value, json!({}));
    }
    for (concept, payload) in construct_learning_global_concepts::table
        .select((
            construct_learning_global_concepts::concept_id,
            construct_learning_global_concepts::payload_json,
        ))
        .load::<(String, String)>(connection)?
    {
        state["learner"]["globalConceptUnderstanding"][&concept] = parse(&payload, json!({}));
    }
    let assistance = construct_learning_assistance_events::table
        .select((
            construct_learning_assistance_events::project_id,
            construct_learning_assistance_events::payload_json,
        ))
        .order(construct_learning_assistance_events::created_at.asc())
        .load::<(Option<String>, String)>(connection)?;
    state["learner"]["assistanceEvents"] = Value::Array(
        assistance
            .iter()
            .map(|(_, payload)| parse(payload, json!({})))
            .collect(),
    );
    for (project, step, block, block_id) in construct_learning_projects::table
        .select((
            construct_learning_projects::project_id,
            construct_learning_projects::current_step_index,
            construct_learning_projects::current_block_index,
            construct_learning_projects::current_block_id,
        ))
        .load::<(String, Option<i32>, Option<i32>, Option<String>)>(connection)?
    {
        let target = ensure_project(&mut state, &project);
        if let (Some(step), Some(block)) = (step, block) {
            target["currentPosition"] =
                json!({"stepIndex":step,"blockIndex":block,"blockId":block_id});
        }
    }
    for (project, concept, payload) in construct_project_concept_understanding::table
        .select((
            construct_project_concept_understanding::project_id,
            construct_project_concept_understanding::concept_id,
            construct_project_concept_understanding::payload_json,
        ))
        .load::<(String, String, String)>(connection)?
    {
        ensure_project(&mut state, &project)["conceptUnderstanding"][&concept] =
            parse(&payload, json!({}));
    }
    for (project, concept, payload) in construct_project_concept_relations::table
        .select((
            construct_project_concept_relations::project_id,
            construct_project_concept_relations::concept_id,
            construct_project_concept_relations::payload_json,
        ))
        .load::<(String, String, String)>(connection)?
    {
        ensure_project(&mut state, &project)["conceptRelations"][&concept] =
            parse(&payload, json!({}));
    }
    append_payloads(connection, &mut state, "conceptEvents")?;
    append_payloads(connection, &mut state, "artifactAudits")?;
    for (project, concept, payload) in construct_knowledge_concepts::table
        .select((
            construct_knowledge_concepts::project_id,
            construct_knowledge_concepts::concept_id,
            construct_knowledge_concepts::payload_json,
        ))
        .load::<(String, String, String)>(connection)?
    {
        state["knowledgeBase"]["concepts"][format!("{project}:{concept}")] =
            parse(&payload, json!({}));
    }
    for (project, concept, first, last, count) in construct_project_concept_engagement::table
        .select((
            construct_project_concept_engagement::project_id,
            construct_project_concept_engagement::concept_id,
            construct_project_concept_engagement::first_opened_at,
            construct_project_concept_engagement::last_opened_at,
            construct_project_concept_engagement::open_count,
        ))
        .load::<(String, String, String, String, i32)>(connection)?
    {
        ensure_project(&mut state, &project)["conceptEngagement"][&concept] = json!({"conceptId":concept,"firstOpenedAt":first,"lastOpenedAt":last,"openCount":count});
    }
    append_simple::<InteractRows>(connection, &mut state, "constructInteractSessions")?;
    append_simple::<RecallRows>(connection, &mut state, "recallAttempts")?;
    append_simple::<OverlayRows>(connection, &mut state, "plannedOverlays")?;
    append_simple::<StepRows>(connection, &mut state, "generatedLiveSteps")?;
    append_simple::<RunRows>(connection, &mut state, "generatedLiveStepRuns")?;
    for (project, payload) in assistance {
        if let Some(project) = project {
            push(
                ensure_project(&mut state, &project),
                "assistanceEvents",
                parse(&payload, json!({})),
            );
        }
    }
    Ok(state)
}

fn append_payloads(
    connection: &mut diesel::SqliteConnection,
    state: &mut Value,
    key: &str,
) -> diesel::QueryResult<()> {
    let rows = if key == "conceptEvents" {
        construct_project_concept_events::table
            .select((
                construct_project_concept_events::project_id,
                construct_project_concept_events::payload_json,
            ))
            .load::<(String, String)>(connection)?
    } else {
        construct_project_artifact_audits::table
            .select((
                construct_project_artifact_audits::project_id,
                construct_project_artifact_audits::payload_json,
            ))
            .load::<(String, String)>(connection)?
    };
    for (project, payload) in rows {
        push(
            ensure_project(state, &project),
            key,
            parse(&payload, json!({})),
        );
    }
    Ok(())
}
trait SimpleRows {
    fn rows(
        connection: &mut diesel::SqliteConnection,
    ) -> diesel::QueryResult<Vec<(String, String)>>;
}
struct InteractRows;
impl SimpleRows for InteractRows {
    fn rows(c: &mut diesel::SqliteConnection) -> diesel::QueryResult<Vec<(String, String)>> {
        construct_project_interact_sessions::table
            .select((
                construct_project_interact_sessions::project_id,
                construct_project_interact_sessions::payload_json,
            ))
            .load(c)
    }
}
struct RecallRows;
impl SimpleRows for RecallRows {
    fn rows(c: &mut diesel::SqliteConnection) -> diesel::QueryResult<Vec<(String, String)>> {
        construct_project_recall_attempts::table
            .select((
                construct_project_recall_attempts::project_id,
                construct_project_recall_attempts::payload_json,
            ))
            .load(c)
    }
}
struct OverlayRows;
impl SimpleRows for OverlayRows {
    fn rows(c: &mut diesel::SqliteConnection) -> diesel::QueryResult<Vec<(String, String)>> {
        construct_project_planned_overlays::table
            .select((
                construct_project_planned_overlays::project_id,
                construct_project_planned_overlays::payload_json,
            ))
            .load(c)
    }
}
struct StepRows;
impl SimpleRows for StepRows {
    fn rows(c: &mut diesel::SqliteConnection) -> diesel::QueryResult<Vec<(String, String)>> {
        construct_project_generated_live_steps::table
            .select((
                construct_project_generated_live_steps::project_id,
                construct_project_generated_live_steps::payload_json,
            ))
            .load(c)
    }
}
struct RunRows;
impl SimpleRows for RunRows {
    fn rows(c: &mut diesel::SqliteConnection) -> diesel::QueryResult<Vec<(String, String)>> {
        construct_project_generated_live_step_runs::table
            .select((
                construct_project_generated_live_step_runs::project_id,
                construct_project_generated_live_step_runs::payload_json,
            ))
            .load(c)
    }
}
fn append_simple<T: SimpleRows>(
    c: &mut diesel::SqliteConnection,
    state: &mut Value,
    key: &str,
) -> diesel::QueryResult<()> {
    for (project, payload) in T::rows(c)? {
        push(
            ensure_project(state, &project),
            key,
            parse(&payload, json!({})),
        );
    }
    Ok(())
}

fn write_document(
    connection: &mut diesel::SqliteConnection,
    state: &Value,
) -> diesel::QueryResult<()> {
    let payload = serde_json::to_string(state)
        .map_err(|error| diesel::result::Error::SerializationError(Box::new(error)))?;
    let timestamp = now();
    diesel::insert_into(construct_learning_documents::table)
        .values((
            construct_learning_documents::singleton.eq(1),
            construct_learning_documents::payload_json.eq(&payload),
            construct_learning_documents::updated_at.eq(&timestamp),
        ))
        .on_conflict(construct_learning_documents::singleton)
        .do_update()
        .set((
            construct_learning_documents::payload_json.eq(&payload),
            construct_learning_documents::updated_at.eq(&timestamp),
        ))
        .execute(connection)?;
    Ok(())
}
fn default_state() -> Value {
    let id = Uuid::new_v4().to_string();
    json!({"version":1,"learner":{"id":format!("local:{id}"),"preferences":{"adaptiveOverlaysEnabled":false,"constructInteractEnabled":true,"storeKnowledgeOnOpen":true},"globalConceptUnderstanding":{},"assistanceEvents":[]},"projects":{},"knowledgeBase":{"concepts":{}},"sync":{"mode":"local","deviceId":id,"pendingOperations":[],"updatedAt":now()}})
}
fn ensure_project<'a>(state: &'a mut Value, id: &str) -> &'a mut Value {
    if state["projects"].get(id).is_none() {
        state["projects"][id] = json!({"projectId":id,"conceptUnderstanding":{},"conceptRelations":{},"conceptEvents":[],"artifactAudits":[],"constructInteractSessions":[],"recallAttempts":[],"assistanceEvents":[],"conceptEngagement":{},"plannedOverlays":[],"generatedLiveSteps":[],"generatedLiveStepRuns":[]});
    }
    &mut state["projects"][id]
}
fn apply_patch(state: &mut Value, patch: &Value) {
    merge_map(
        &mut state["learner"]["globalConceptUnderstanding"],
        patch.get("globalConceptUnderstanding"),
    );
    if let Some(projects) = patch
        .get("projectConceptUnderstanding")
        .and_then(Value::as_object)
    {
        for (id, concepts) in projects {
            merge_map(
                &mut ensure_project(state, id)["conceptUnderstanding"],
                Some(concepts),
            );
            merge_map(
                &mut state["learner"]["globalConceptUnderstanding"],
                Some(concepts),
            );
        }
    }
    if let Some(event) = patch.get("assistanceEvent") {
        push(&mut state["learner"], "assistanceEvents", event.clone());
        if let Some(id) = event.get("projectId").and_then(Value::as_str) {
            push(ensure_project(state, id), "assistanceEvents", event.clone());
        }
    }
    for (key, target) in [
        ("constructInteractSession", "constructInteractSessions"),
        (
            "constructInteractSessionUpsert",
            "constructInteractSessions",
        ),
        ("recallAttempt", "recallAttempts"),
        ("conceptProjectEvent", "conceptEvents"),
        ("conceptArtifactAudit", "artifactAudits"),
    ] {
        if let Some(value) = patch.get(key) {
            if let Some(id) = value.get("projectId").and_then(Value::as_str) {
                upsert(ensure_project(state, id), target, value.clone());
            }
        }
    }
    if let Some(record) = patch.get("knowledgeConcept") {
        if let (Some(project), Some(concept)) = (
            record.get("sourceProjectId").and_then(Value::as_str),
            record.get("id").and_then(Value::as_str),
        ) {
            state["knowledgeBase"]["concepts"][format!("{project}:{concept}")] = record.clone();
        }
    }
    if let Some(remove) = patch.get("removeKnowledgeConcept") {
        if let (Some(project), Some(concept)) = (
            remove.get("projectId").and_then(Value::as_str),
            remove.get("conceptId").and_then(Value::as_str),
        ) {
            state["knowledgeBase"]["concepts"]
                .as_object_mut()
                .map(|map| map.remove(&format!("{project}:{concept}")));
        }
    }
    if let Some(position) = patch.get("projectPosition") {
        if let Some(id) = position.get("projectId").and_then(Value::as_str) {
            ensure_project(state, id)["currentPosition"] = position.clone();
        }
    }
    if let Some(open) = patch.get("conceptOpen") {
        if let (Some(project), Some(concept), Some(at)) = (
            open.get("projectId").and_then(Value::as_str),
            open.get("conceptId").and_then(Value::as_str),
            open.get("openedAt").and_then(Value::as_str),
        ) {
            let current = ensure_project(state, project)["conceptEngagement"]
                .get(concept)
                .cloned();
            let count = current
                .as_ref()
                .and_then(|value| value.get("openCount"))
                .and_then(Value::as_i64)
                .unwrap_or(0)
                + 1;
            let first = current
                .and_then(|value| value.get("firstOpenedAt").cloned())
                .unwrap_or(json!(at));
            ensure_project(state, project)["conceptEngagement"][concept] = json!({"conceptId":concept,"firstOpenedAt":first,"lastOpenedAt":at,"openCount":count});
        }
    }
}
fn merge_map(target: &mut Value, source: Option<&Value>) {
    if let (Some(target), Some(source)) =
        (target.as_object_mut(), source.and_then(Value::as_object))
    {
        for (key, value) in source {
            let mut merged = target.get(key).cloned().unwrap_or(json!({}));
            if let (Some(base), Some(patch)) = (merged.as_object_mut(), value.as_object()) {
                for (field, value) in patch {
                    base.insert(field.clone(), value.clone());
                }
            }
            target.insert(key.clone(), merged);
        }
    }
}
fn upsert(project: &mut Value, key: &str, value: Value) {
    let list = project[key].as_array_mut().unwrap();
    if let Some(id) = value.get("id") {
        if let Some(index) = list.iter().position(|item| item.get("id") == Some(id)) {
            list[index] = value;
            return;
        }
    }
    list.push(value)
}
fn push(parent: &mut Value, key: &str, value: Value) {
    parent[key].as_array_mut().unwrap().push(value)
}
fn parse(value: &str, fallback: Value) -> Value {
    serde_json::from_str(value).unwrap_or(fallback)
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}
