use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct LegacySidecar(Mutex<Option<CommandChild>>);

fn resolve_sidecar_js<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    if let Ok(path) = std::env::var("CONSTRUCT_SIDECAR_JS") {
        return PathBuf::from(path);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/sidecar.cjs");
    if dev.exists() {
        return dev;
    }
    app.path()
        .resolve("resources/sidecar.cjs", BaseDirectory::Resource)
        .expect("failed to resolve bundled sidecar.cjs")
}

fn resolve_app_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    if let Ok(path) = std::env::var("CONSTRUCT_APP_PATH") {
        return Some(path);
    }
    if cfg!(debug_assertions) {
        return Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .to_string_lossy()
                .to_string(),
        );
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

pub fn spawn<R: Runtime>(app: &tauri::AppHandle<R>) -> (u16, String) {
    let js_arg = resolve_sidecar_js(app).to_string_lossy().to_string();
    let mut command = app
        .shell()
        .sidecar("construct-sidecar")
        .expect("failed to create sidecar command")
        .args([js_arg]);

    if let Some(app_path) = resolve_app_path(app) {
        command = command
            .current_dir(PathBuf::from(&app_path))
            .env("CONSTRUCT_APP_PATH", app_path);
    }
    if !cfg!(debug_assertions) {
        command = command.env("CONSTRUCT_PACKAGED", "1");
    }

    let (mut events, child) = command.spawn().expect("failed to spawn Construct sidecar");
    app.manage(LegacySidecar(Mutex::new(Some(child))));

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<(u16, String)>();
    tauri::async_runtime::spawn(async move {
        let mut buffer = String::new();
        let mut port = None;
        let mut token = None;
        let mut announced = false;

        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(index) = buffer.find('\n') {
                        let raw: String = buffer.drain(..=index).collect();
                        let line = raw.trim();
                        if let Some(value) = line.strip_prefix("CONSTRUCT_BRIDGE_PORT=") {
                            port = value.trim().parse().ok();
                        } else if let Some(value) = line.strip_prefix("CONSTRUCT_BRIDGE_TOKEN=") {
                            token = Some(value.trim().to_string());
                        } else if !line.is_empty() {
                            println!("[legacy-sidecar] {line}");
                        }
                        if !announced {
                            if let (Some(port), Some(token)) = (port, token.clone()) {
                                let _ = ready_tx.send((port, token));
                                announced = true;
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[legacy-sidecar] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[legacy-sidecar] terminated: {payload:?}");
                }
                _ => {}
            }
        }
    });

    ready_rx
        .recv_timeout(Duration::from_secs(30))
        .expect("sidecar did not report its bridge port in time")
}

pub fn stop<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<LegacySidecar>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}
