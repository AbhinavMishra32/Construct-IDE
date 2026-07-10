mod ai;
mod commands;
mod core_state;
mod error;
mod git;
mod learning;
mod lsp;
mod paths;
mod process;
mod projects;
mod settings;
mod storage;
mod terminal;
mod window;
mod workspace;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::system::rust_ui_state_get,
            commands::system::rust_ui_state_set,
            commands::system::rust_storage_flush,
            commands::system::rust_storage_metrics,
            commands::system::rust_runtime_info,
            commands::system::rust_theme_set,
            commands::system::rust_debug_processes,
            commands::system::rust_litellm_state,
            commands::system::rust_litellm_check,
            commands::system::rust_read_lsp_source,
            commands::git::rust_git_status,
            commands::git::rust_git_commit,
            commands::git::rust_git_push,
            commands::terminal::rust_terminal_create,
            commands::terminal::rust_terminal_input,
            commands::terminal::rust_terminal_resize,
            commands::terminal::rust_terminal_kill,
            commands::lsp::rust_lsp_status,
            commands::lsp::rust_lsp_start,
            commands::lsp::rust_lsp_stop,
            commands::lsp::rust_lsp_request,
            commands::lsp::rust_lsp_install,
            commands::projects::rust_projects_list,
            commands::projects::rust_project_open,
            commands::projects::rust_project_update,
            commands::projects::rust_project_ensure,
            commands::projects::rust_project_import,
            commands::projects::rust_project_read_tape,
            commands::projects::rust_project_update_tape,
            commands::projects::rust_flow_create,
            commands::projects::rust_project_delete,
            commands::settings::rust_settings_get,
            commands::settings::rust_settings_update_ai,
            commands::settings::rust_settings_update_app,
            commands::settings::rust_settings_update_observability,
            commands::settings::rust_settings_set_workspace_root,
            commands::settings::rust_settings_open_config,
            commands::settings::rust_settings_features,
            commands::settings::rust_settings_import_opencode_auth,
            commands::settings::rust_settings_list_models,
            commands::learning::rust_learning_get,
            commands::learning::rust_learning_project,
            commands::learning::rust_learning_patch,
            commands::learning::rust_learning_weak,
            commands::learning::rust_learning_save,
            commands::learning::rust_learning_open,
            commands::learning::rust_learning_concept_open,
            commands::learning::rust_learning_remove,
            commands::flow::rust_flow_run,
            commands::flow::rust_flow_research,
            commands::flow::rust_flow_memory_read,
            commands::flow::rust_flow_memory_update,
            commands::flow::rust_flow_rewind,
            commands::flow::rust_flow_submit_task,
            commands::agents::rust_verify_recall,
            commands::agents::rust_interact,
            commands::agents::rust_authoring_review,
            commands::agents::rust_selection_explain,
            commands::agents::rust_code_ghost,
            commands::workspace::rust_workspace_list,
            commands::workspace::rust_workspace_read,
            commands::workspace::rust_workspace_write,
            commands::workspace::rust_workspace_remove,
            commands::workspace::rust_workspace_rename,
            commands::workspace::rust_workspace_create_folder,
            commands::workspace::rust_workspace_duplicate,
            commands::workspace::rust_workspace_watch_start,
            commands::workspace::rust_workspace_watch_stop
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(core_state::CoreState::initialize()?);
            window::create_main_window(&handle, "").expect("failed to build main window");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Construct")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<core_state::CoreState>() {
                    let _ = state.watcher.stop();
                    state.terminal.stop_all();
                    state.lsp.stop_all();
                    state.mastra.stop();
                }
            }
        });
}
