mod commands;
mod core_state;
mod error;
mod legacy_sidecar;
mod paths;
mod storage;
mod window;

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
            commands::system::rust_storage_metrics
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(core_state::CoreState::initialize()?);
            let (port, token) = legacy_sidecar::spawn(&handle);
            let initialization_script = format!(
                "window.__CONSTRUCT_BRIDGE__ = {{ port: {}, token: {} }};",
                port,
                serde_json::to_string(&token).expect("token is serializable")
            );
            window::create_main_window(&handle, &initialization_script)
                .expect("failed to build main window");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Construct")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                legacy_sidecar::stop(app);
            }
        });
}
