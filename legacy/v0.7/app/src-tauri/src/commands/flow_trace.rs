use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn apply(session: &mut Value, trace: &Value) -> bool {
    let Some(event) = trace.get("event").filter(|event| event.is_object()) else {
        return false;
    };
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type == "iteration" {
        return false;
    }
    upsert(array_mut(session, "agentEvents"), event.clone());
    if event_type == "tool" {
        if let Some(tool_call) = tool_call_record(event) {
            upsert(array_mut(session, "toolCalls"), tool_call);
        }
    }
    if let Some(part) = timeline_part(event) {
        upsert(array_mut(session, "timeline"), part);
    }
    session["updatedAt"] = json!(timestamp());
    true
}

fn tool_call_record(event: &Value) -> Option<Value> {
    let name = event
        .get("toolName")
        .or_else(|| event.get("title"))?
        .as_str()?;
    let id = event.get("toolCallId").or_else(|| event.get("id"))?.clone();
    let status = event.get("status").cloned().unwrap_or(json!("running"));
    let completed = status.as_str() != Some("running");
    let created_at = event
        .get("createdAt")
        .cloned()
        .unwrap_or_else(|| json!(timestamp()));
    let mut record = compact(json!({
        "id":id,
        "name":name,
        "title":event.get("title"),
        "reason":event.get("detail"),
        "input":event.get("input"),
        "outputPreview":event.get("outputPreview"),
        "status":status,
        "createdAt":created_at
    }));
    if completed {
        record["completedAt"] = json!(timestamp());
    }
    Some(record)
}

pub fn finalize_reply(session: &mut Value, reply: &str, status: &str) {
    let now = timestamp();
    settle(array_mut(session, "agentEvents"), status, &now);
    settle(array_mut(session, "timeline"), status, &now);

    let reply = reply.trim();
    let streamed = session["agentEvents"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|event| event.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|event| event.get("text").and_then(Value::as_str))
        .collect::<String>()
        .trim()
        .to_string();
    if reply.is_empty() || streamed == reply {
        return;
    }

    array_mut(session, "agentEvents")
        .retain(|event| event.get("type").and_then(Value::as_str) != Some("message"));
    array_mut(session, "timeline")
        .retain(|part| part.get("kind").and_then(Value::as_str) != Some("message"));
    let id = Uuid::new_v4().to_string();
    array_mut(session, "agentEvents").push(json!({
        "id":id,"type":"message","status":status,"title":"Response","text":reply,"createdAt":now
    }));
    array_mut(session, "timeline").push(json!({
        "id":id,"kind":"message","status":status,"text":reply,"createdAt":now,"updatedAt":now
    }));
}

fn timeline_part(event: &Value) -> Option<Value> {
    let kind = event.get("type")?.as_str()?;
    let id = event
        .get("id")
        .cloned()
        .unwrap_or_else(|| json!(Uuid::new_v4().to_string()));
    let status = event.get("status").cloned().unwrap_or(json!("running"));
    let created_at = event
        .get("createdAt")
        .cloned()
        .unwrap_or_else(|| json!(timestamp()));
    let updated_at = timestamp();
    match kind {
        "message" => Some(json!({
            "id":id,"kind":"message","status":status,
            "text":event.get("text").cloned().unwrap_or(json!("")),
            "createdAt":created_at,"updatedAt":updated_at
        })),
        "reasoning" => Some(compact(json!({
            "id":id,"kind":"reasoning","status":status,
            "title":event.get("title"),"detail":event.get("detail"),"text":event.get("text"),
            "createdAt":created_at,"updatedAt":updated_at
        }))),
        "tool" => Some(compact(json!({
            "id":id,"kind":"tool","status":status,
            "toolCallId":event.get("toolCallId").cloned().unwrap_or_else(|| id.clone()),
            "name":event.get("toolName").or_else(|| event.get("title")),
            "title":event.get("title"),"reason":event.get("detail"),
            "input":event.get("input"),"outputPreview":event.get("outputPreview"),
            "createdAt":created_at,"updatedAt":updated_at
        }))),
        _ => None,
    }
}

fn array_mut<'a>(session: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !session.get(key).is_some_and(Value::is_array) {
        session[key] = json!([]);
    }
    session[key].as_array_mut().expect("array initialized")
}

fn upsert(values: &mut Vec<Value>, next: Value) {
    let id = next.get("id").and_then(Value::as_str);
    if let Some(index) = values
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == id)
    {
        let created_at = values[index].get("createdAt").cloned();
        values[index] = merge(values[index].clone(), next);
        if let Some(created_at) = created_at {
            values[index]["createdAt"] = created_at;
        }
    } else {
        values.push(next);
    }
}

fn merge(mut current: Value, next: Value) -> Value {
    if let (Some(current), Some(next)) = (current.as_object_mut(), next.as_object()) {
        for (key, value) in next {
            if !value.is_null() {
                current.insert(key.clone(), value.clone());
            }
        }
    }
    current
}

fn settle(values: &mut [Value], status: &str, now: &str) {
    for value in values {
        if value.get("status").and_then(Value::as_str) == Some("running") {
            value["status"] = json!(status);
            value["updatedAt"] = json!(now);
            if value.get("kind").and_then(Value::as_str) == Some("tool") {
                value["completedAt"] = json!(now);
            }
        }
    }
}

fn compact(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    value
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_incremental_reasoning_and_tools_into_the_timeline() {
        let mut session = json!({"agentEvents":[],"timeline":[],"toolCalls":[]});
        assert!(apply(
            &mut session,
            &json!({"event":{
                "id":"reasoning-1","type":"reasoning","status":"running","title":"Thinking",
                "text":"Inspecting the workspace","createdAt":"2026-07-10T00:00:00Z"
            }})
        ));
        assert!(apply(
            &mut session,
            &json!({"event":{
                "id":"tool-1","toolCallId":"provider-tool-1","type":"tool","status":"running",
                "title":"Reading file","toolName":"read-file","input":{"path":"src/main.rs"},
                "createdAt":"2026-07-10T00:00:01Z"
            }})
        ));
        assert_eq!(session["timeline"].as_array().unwrap().len(), 2);
        assert_eq!(session["timeline"][0]["kind"], "reasoning");
        assert_eq!(session["timeline"][1]["toolCallId"], "provider-tool-1");
        assert_eq!(session["toolCalls"][0]["id"], "provider-tool-1");
        assert_eq!(session["toolCalls"][0]["name"], "read-file");
    }

    #[test]
    fn persists_completed_question_calls_for_the_waiting_session() {
        let mut session = json!({"agentEvents":[],"timeline":[],"toolCalls":[]});
        assert!(apply(
            &mut session,
            &json!({"event":{
                "id":"visible-tool-1","toolCallId":"provider-question-1","type":"tool",
                "status":"completed","title":"ask_user_question","toolName":"ask_user_question",
                "input":{"question":"What is your Python experience?","choices":["New","Comfortable"]},
                "outputPreview":"Question prepared","createdAt":"2026-07-15T00:00:00Z"
            }})
        ));
        assert_eq!(session["toolCalls"][0]["id"], "provider-question-1");
        assert_eq!(session["toolCalls"][0]["name"], "ask_user_question");
        assert!(session["toolCalls"][0].get("response").is_none());
    }

    #[test]
    fn updates_rows_by_visible_id_and_settles_them_at_completion() {
        let mut session = json!({"agentEvents":[],"timeline":[]});
        apply(
            &mut session,
            &json!({"event":{
                "id":"reasoning-1","type":"reasoning","status":"running","title":"Thinking",
                "text":"First","createdAt":"2026-07-10T00:00:00Z"
            }}),
        );
        apply(
            &mut session,
            &json!({"event":{
                "id":"reasoning-1","type":"reasoning","status":"running","title":"Thinking",
                "text":"First, then second","createdAt":"2026-07-10T00:00:00Z"
            }}),
        );
        finalize_reply(&mut session, "Finished", "completed");
        assert_eq!(session["timeline"].as_array().unwrap().len(), 2);
        assert_eq!(session["timeline"][0]["text"], "First, then second");
        assert_eq!(session["timeline"][0]["status"], "completed");
        assert_eq!(session["timeline"][1]["kind"], "message");
    }
}
