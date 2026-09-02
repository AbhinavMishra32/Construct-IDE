use serde_json::{json, Value};
use tauri::State;

use crate::core_state::CoreState;
use crate::error::{CommandError, CommandResult};

#[tauri::command]
pub fn rust_settings_get(state: State<'_, CoreState>) -> CommandResult<Value> {
    state.settings.read()
}
#[tauri::command]
pub fn rust_settings_update_ai(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    state.settings.update_section("ai", &input)
}
#[tauri::command]
pub fn rust_settings_update_app(state: State<'_, CoreState>, input: Value) -> CommandResult<Value> {
    state.settings.update_section("app", &input)
}
#[tauri::command]
pub fn rust_settings_update_observability(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    state.settings.update_section("observability", &input)
}
#[tauri::command]
pub fn rust_settings_set_workspace_root(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    let root = input
        .get("workspaceRoot")
        .and_then(Value::as_str)
        .unwrap_or_else(|| state.paths.workspaces.to_str().unwrap_or_default());
    std::fs::create_dir_all(root)
        .map_err(|error| CommandError::new("settings.workspace", error.to_string()))?;
    let settings = state.settings.set_workspace_root(root)?;
    Ok(json!({"settings":settings,"projects":state.projects.summaries()?}))
}
#[tauri::command]
pub fn rust_settings_open_config(state: State<'_, CoreState>) -> CommandResult<String> {
    let path = state.paths.user_data_root.join("construct.config.json");
    if !path.exists() {
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&state.settings.read()?).unwrap_or_default(),
        )
        .map_err(|error| CommandError::new("settings.config", error.to_string()))?;
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn rust_settings_features(state: State<'_, CoreState>) -> CommandResult<Value> {
    let settings = state.settings.read()?;
    let models = settings
        .pointer("/ai/featureModels")
        .cloned()
        .unwrap_or(json!({}));
    Ok(
        json!([{"id":"construct-flow","label":"Flow","model":models.get("construct-flow")},{"id":"construct-interact","label":"Interact","model":models.get("construct-interact")},{"id":"selection-explain","label":"Selection Explain","model":models.get("selection-explain")},{"id":"code-ghost","label":"Code Ghost","model":models.get("code-ghost")}]),
    )
}
#[tauri::command]
pub fn rust_settings_import_opencode_auth() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let payload = std::fs::read_to_string(
        std::path::PathBuf::from(home).join(".local/share/opencode/auth.json"),
    )
    .ok()?;
    let value: Value = serde_json::from_str(&payload).ok()?;
    value
        .pointer("/opencode/apiKey")
        .or_else(|| value.pointer("/opencode-zen/apiKey"))
        .and_then(Value::as_str)
        .map(str::to_string)
}
#[tauri::command]
pub fn rust_settings_list_models(
    state: State<'_, CoreState>,
    input: Value,
) -> CommandResult<Value> {
    let settings = state.settings.read()?;
    let provider = input
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("openai");
    let (base, key) = match provider {
        "openrouter" => (
            settings.pointer("/ai/openRouterBaseUrl"),
            settings.pointer("/ai/openRouterApiKey"),
        ),
        "opencode-zen" => (
            settings.pointer("/ai/opencodeZenBaseUrl"),
            settings.pointer("/ai/opencodeZenApiKey"),
        ),
        "construct-cloud" => (
            settings.pointer("/ai/constructCloudBaseUrl"),
            settings.pointer("/ai/constructCloudAccessToken"),
        ),
        _ => (
            settings.pointer("/ai/openAiBaseUrl"),
            settings.pointer("/ai/openAiApiKey"),
        ),
    };
    let url = format!(
        "{}/models",
        base.and_then(Value::as_str)
            .unwrap_or("https://api.openai.com/v1")
            .trim_end_matches('/')
    );
    let api_key = input
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .or_else(|| key.and_then(Value::as_str))
        .unwrap_or_default();
    let mut request = reqwest::blocking::Client::new().get(url);
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .map_err(|error| CommandError::new("settings.models", error.to_string()))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .map_err(|error| CommandError::new("settings.models", error.to_string()))?;
    if !status.is_success() {
        return Err(CommandError::new(
            "settings.models",
            format!("model lookup failed: {status}"),
        ));
    }
    let models = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|model| {
            model
                .get("id")
                .and_then(Value::as_str)
                .map(|id| json!({"id":id,"name":id,"provider":provider,"providerId":provider}))
        })
        .collect::<Vec<_>>();
    Ok(Value::Array(models))
}
