use serde_json::{json, Value};

use crate::error::CommandResult;
use crate::paths::DataPaths;
use crate::storage::JsonStore;

pub struct SettingsService {
    store: JsonStore,
    paths: DataPaths,
}
impl SettingsService {
    pub fn new(store: JsonStore, paths: DataPaths) -> Self {
        Self { store, paths }
    }
    pub fn read(&self) -> CommandResult<Value> {
        Ok(merge(
            defaults(&self.paths),
            self.store.get("construct.settings")?.unwrap_or(json!({})),
        ))
    }
    pub fn update_section(&self, section: &str, input: &Value) -> CommandResult<Value> {
        let mut settings = self.read()?;
        if let Some(patch) = input.get(section).and_then(Value::as_object) {
            let target = settings
                .get_mut(section)
                .and_then(Value::as_object_mut)
                .unwrap();
            for (key, value) in patch {
                target.insert(key.clone(), value.clone());
            }
        }
        self.store.set("construct.settings", &settings)?;
        Ok(settings)
    }
    pub fn set_workspace_root(&self, root: &str) -> CommandResult<Value> {
        let mut settings = self.read()?;
        settings["workspaceRoot"] = json!(root);
        self.store.set("construct.settings", &settings)?;
        Ok(settings)
    }
}
fn merge(mut base: Value, overlay: Value) -> Value {
    if let (Some(base), Some(overlay)) = (base.as_object_mut(), overlay.as_object()) {
        for (key, value) in overlay {
            if value.is_object() && base.get(key).is_some_and(Value::is_object) {
                base.insert(key.clone(), merge(base[key].clone(), value.clone()));
            } else {
                base.insert(key.clone(), value.clone());
            }
        }
    }
    base
}
fn defaults(paths: &DataPaths) -> Value {
    json!({"workspaceRoot":paths.workspaces,"releaseVersion":env!("CARGO_PKG_VERSION"),"app":{"showStatusBar":true,"codeThemeId":"construct-dark","customCodeThemeJson":""},"ai":{"runtime":"mastra","source":"byok","provider":"openai","reasoningEffort":"auto","openAiApiKey":"","openAiModel":"gpt-5-mini","openAiBaseUrl":"https://api.openai.com/v1","openRouterApiKey":"","openRouterModel":"openai/gpt-5-mini","openRouterBaseUrl":"https://openrouter.ai/api/v1","liteLlmApiKey":"","liteLlmModel":"openai/gpt-5-mini","liteLlmBaseUrl":"http://localhost:4000/v1","liteLlmManageServer":false,"opencodeZenApiKey":"","opencodeZenBaseUrl":"https://opencode.ai/zen/v1","opencodeZenModel":"gpt-5-mini","githubCopilotModel":"gpt-5-mini","constructCloudBaseUrl":"https://api.tryconstruct.cc","constructCloudAccessToken":"","constructCloudModel":"gpt-5-mini","tavilyApiKey":"","featureModels":{},"codeGhostEnabled":true,"conceptFirewallEnabled":true,"flowSourceGroundingEnabled":true},"observability":{"enabled":false,"langfuseBaseUrl":"http://localhost:3000","langfusePublicKey":"","langfuseSecretKey":"","langfuseProjectName":"construct","langfuseEnvironment":"development","capturePayloads":true,"batch":true}})
}
