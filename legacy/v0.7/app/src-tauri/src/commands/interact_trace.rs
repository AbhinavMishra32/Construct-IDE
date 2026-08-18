use chrono::Utc;
use serde_json::{json, Value};

pub fn apply(session: &mut Value, trace: &Value) -> bool {
    let mut changed = false;
    if let Some(text) = trace.get("responseText").and_then(Value::as_str) {
        session["reply"] = json!(text);
        changed = true;
    }
    if let Some(event) = trace.get("event").filter(|event| event.is_object()) {
        upsert(events(session), event.clone());
        changed = true;
    }
    if let Some(partial) = trace.get("partialObject").and_then(Value::as_object) {
        for key in [
            "status",
            "confidence",
            "reply",
            "coveredConceptIds",
            "missingConceptIds",
            "assistanceLevel",
            "shouldAdvance",
            "assessment",
            "actions",
            "dynamicSteps",
            "generatedLiveSteps",
        ] {
            if let Some(value) = partial.get(key) {
                session[key] = value.clone();
                changed = true;
            }
        }
    }
    if changed {
        session["updatedAt"] = json!(Utc::now().to_rfc3339());
    }
    changed
}

pub fn complete(session: &mut Value, result: &Value, run_status: &str) {
    for key in [
        "status",
        "confidence",
        "reply",
        "coveredConceptIds",
        "missingConceptIds",
        "assistanceLevel",
        "assessment",
        "actions",
        "dynamicSteps",
        "dynamicStepValidation",
        "generatedLiveSteps",
        "liveStepValidation",
        "toolCalls",
        "agentEvents",
        "durationMs",
    ] {
        if let Some(value) = result.get(key) {
            session[key] = value.clone();
        }
    }
    session["runStatus"] = json!(run_status);
    session["updatedAt"] = json!(Utc::now().to_rfc3339());
    let settled = if run_status == "error" {
        "error"
    } else {
        "completed"
    };
    for event in events(session) {
        if event.get("status").and_then(Value::as_str) == Some("running") {
            event["status"] = json!(settled);
        }
    }
}

fn events(session: &mut Value) -> &mut Vec<Value> {
    if !session.get("agentEvents").is_some_and(Value::is_array) {
        session["agentEvents"] = json!([]);
    }
    session["agentEvents"]
        .as_array_mut()
        .expect("array initialized")
}

fn upsert(values: &mut Vec<Value>, next: Value) {
    let id = next.get("id").and_then(Value::as_str);
    if let Some(index) = values
        .iter()
        .position(|value| value.get("id").and_then(Value::as_str) == id)
    {
        values[index] = next;
    } else {
        values.push(next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_partial_text_and_append_only_activity() {
        let mut session = json!({"reply":"","agentEvents":[]});
        assert!(apply(
            &mut session,
            &json!({
                "responseText":"A partial answer",
                "event":{"id":"thought-1","type":"reasoning","status":"running","title":"Thinking","createdAt":"now"}
            })
        ));
        assert_eq!(session["reply"], "A partial answer");
        assert_eq!(session["agentEvents"].as_array().unwrap().len(), 1);
        apply(
            &mut session,
            &json!({
                "event":{"id":"tool-1","type":"tool","status":"running","title":"Reading","createdAt":"now"}
            }),
        );
        assert_eq!(session["agentEvents"].as_array().unwrap().len(), 2);
    }
}
