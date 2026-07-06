use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Node sidecar so it can be killed when the app exits.
struct SidecarProcess(Mutex<Option<CommandChild>>);

/// Resolve the sidecar JS bundle: explicit override, then the dev build
/// (relative to the crate), then the packaged resource.
fn resolve_sidecar_js(app: &tauri::AppHandle) -> PathBuf {
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

/// The app root the sidecar reports as Electron's `app.getAppPath()`.
fn resolve_app_path(app: &tauri::AppHandle) -> Option<String> {
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
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // --- Spawn the Node sidecar (the former Electron main process) ---
            let js_arg = resolve_sidecar_js(&handle).to_string_lossy().to_string();
            let mut command = handle
                .shell()
                .sidecar("construct-sidecar")
                .expect("failed to create sidecar command")
                .args([js_arg]);
            if let Some(app_path) = resolve_app_path(&handle) {
                command = command.env("CONSTRUCT_APP_PATH", app_path);
            }
            if !cfg!(debug_assertions) {
                command = command.env("CONSTRUCT_PACKAGED", "1");
            }

            let (mut rx, child) = command.spawn().expect("failed to spawn Construct sidecar");
            app.manage(SidecarProcess(Mutex::new(Some(child))));

            // --- Read the bridge port + token from the sidecar's stdout ---
            let (ready_tx, ready_rx) = std::sync::mpsc::channel::<(u16, String)>();
            tauri::async_runtime::spawn(async move {
                let mut buffer = String::new();
                let mut port: Option<u16> = None;
                let mut token: Option<String> = None;
                let mut announced = false;

                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some(idx) = buffer.find('\n') {
                                let raw: String = buffer.drain(..=idx).collect();
                                let line = raw.trim();
                                if let Some(v) = line.strip_prefix("CONSTRUCT_BRIDGE_PORT=") {
                                    port = v.trim().parse().ok();
                                } else if let Some(v) = line.strip_prefix("CONSTRUCT_BRIDGE_TOKEN=") {
                                    token = Some(v.trim().to_string());
                                } else if !line.is_empty() {
                                    println!("[sidecar] {line}");
                                }
                                if !announced {
                                    if let (Some(p), Some(t)) = (port, token.clone()) {
                                        let _ = ready_tx.send((p, t));
                                        announced = true;
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[sidecar] terminated: {payload:?}");
                        }
                        _ => {}
                    }
                }
            });

            let (port, token) = ready_rx
                .recv_timeout(Duration::from_secs(30))
                .expect("sidecar did not report its bridge port in time");

            // --- Create the window, injecting the bridge config before load ---
            let init_script = format!(
                "window.__CONSTRUCT_BRIDGE__ = {{ port: {}, token: {} }};",
                port,
                serde_json::to_string(&token).expect("token is serializable")
            );

            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                    .title("Construct")
                    .inner_size(1180.0, 780.0)
                    .min_inner_size(860.0, 560.0)
                    .resizable(true)
                    .initialization_script(&init_script);

            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(16.0, 17.0))
                    .transparent(true);
            }
            #[cfg(target_os = "windows")]
            {
                builder = builder.decorations(false).transparent(false);
            }

            let window = builder.build().expect("failed to build main window");

            // --- Native window materials, matching the former Electron chrome ---
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                );
            }
            #[cfg(target_os = "windows")]
            {
                let _ = window_vibrancy::apply_acrylic(&window, Some((0, 0, 0, 0)));
            }
            let _ = &window;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Construct")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarProcess>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
