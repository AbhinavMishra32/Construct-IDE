use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

use crate::ai::tools::ToolHost;
use crate::error::{CommandError, CommandResult};

type Reply = Result<Value, String>;
type EventHandler = Arc<dyn Fn(Value) + Send + Sync>;

struct PendingRequest {
    reply: Sender<Reply>,
    events: Option<EventHandler>,
}

struct WorkerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
}

pub struct MastraWorker {
    state: Mutex<Option<WorkerState>>,
    tools: Arc<ToolHost>,
}

impl MastraWorker {
    pub fn new(tools: ToolHost) -> Self {
        Self {
            state: Mutex::new(None),
            tools: Arc::new(tools),
        }
    }

    pub fn request(
        &self,
        app: tauri::AppHandle,
        method: &str,
        payload: Value,
    ) -> CommandResult<Value> {
        self.request_inner(app, method, payload, None)
    }

    pub fn request_with_events(
        &self,
        app: tauri::AppHandle,
        method: &str,
        payload: Value,
        on_event: impl Fn(Value) + Send + Sync + 'static,
    ) -> CommandResult<Value> {
        self.request_inner(app, method, payload, Some(Arc::new(on_event)))
    }

    fn request_inner(
        &self,
        app: tauri::AppHandle,
        method: &str,
        payload: Value,
        events: Option<EventHandler>,
    ) -> CommandResult<Value> {
        self.ensure_started(&app)?;
        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel();
        let guard = self.state.lock().map_err(lock_error)?;
        let state = guard.as_ref().ok_or_else(|| {
            CommandError::new("mastra.not-running", "Mastra worker did not start")
        })?;
        state.pending.lock().map_err(lock_error)?.insert(
            request_id.clone(),
            PendingRequest {
                reply: sender,
                events,
            },
        );
        let message = json!({"kind":"request","id":request_id,"method":method,"payload":payload});
        write_child(&state.child, &message)?;
        drop(guard);
        receiver
            .recv_timeout(Duration::from_secs(300))
            .map_err(|_| CommandError::new("mastra.timeout", "Mastra worker request timed out"))?
            .map_err(|error| CommandError::new("mastra.request", error))
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.state.lock() {
            if let Some(state) = guard.take() {
                if let Ok(mut child) = state.child.lock() {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    }

    fn ensure_started(&self, app: &tauri::AppHandle) -> CommandResult<()> {
        let mut guard = self.state.lock().map_err(lock_error)?;
        if guard.is_some() {
            return Ok(());
        }
        let script = resolve_worker_script(app)?;
        let (mut events, child) = app
            .shell()
            .sidecar("construct-mastra")
            .map_err(|error| CommandError::new("mastra.sidecar", error.to_string()))?
            .args([script.to_string_lossy().to_string()])
            .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
            .spawn()
            .map_err(|error| CommandError::new("mastra.spawn", error.to_string()))?;
        let child = Arc::new(Mutex::new(Some(child)));
        let pending = Arc::new(Mutex::new(HashMap::<String, PendingRequest>::new()));
        let event_child = Arc::clone(&child);
        let event_pending = Arc::clone(&pending);
        let tools = Arc::clone(&self.tools);
        let event_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut buffer = String::new();
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(index) = buffer.find('\n') {
                            let line: String = buffer.drain(..=index).collect();
                            handle_line(
                                &event_app,
                                &event_child,
                                &event_pending,
                                &tools,
                                line.trim(),
                            );
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let _=event_app.emit("construct:provider:log",json!({"provider":"mastra","level":"info","message":String::from_utf8_lossy(&bytes)}));
                    }
                    CommandEvent::Terminated(_) => {
                        if let Ok(mut child) = event_child.lock() {
                            child.take();
                        }
                        if let Ok(mut pending) = event_pending.lock() {
                            for (_, request) in pending.drain() {
                                let _ = request.reply.send(Err("Mastra worker terminated".into()));
                            }
                        }
                    }
                    _ => {}
                }
            }
        });
        *guard = Some(WorkerState { child, pending });
        Ok(())
    }
}

fn handle_line(
    app: &tauri::AppHandle,
    child: &Arc<Mutex<Option<CommandChild>>>,
    pending: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    tools: &ToolHost,
    line: &str,
) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match message.get("kind").and_then(Value::as_str) {
        Some("result") => {
            if let Some(id) = message.get("id").and_then(Value::as_str) {
                if let Some(request) = pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(id))
                {
                    let reply = if message.get("ok").and_then(Value::as_bool) == Some(true) {
                        Ok(message.get("value").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(message
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("Mastra worker failed")
                            .into())
                    };
                    let _ = request.reply.send(reply);
                }
            }
        }
        Some("event") => {
            if let Some(handler) = event_handler(pending, &message) {
                handler(message.get("payload").cloned().unwrap_or(Value::Null));
            }
            let _ = app.emit("construct:project:agent-log", message);
        }
        Some("tool-call") => {
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let name = message
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let reply = match tools.execute(name, message.get("input").unwrap_or(&Value::Null)) {
                Ok(value) => json!({"kind":"tool-result","id":id,"ok":true,"value":value}),
                Err(error) => {
                    json!({"kind":"tool-result","id":id,"ok":false,"error":error.to_string()})
                }
            };
            let _ = write_child(child, &reply);
        }
        _ => {}
    }
}
fn event_handler(
    pending: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    message: &Value,
) -> Option<EventHandler> {
    let id = message.get("requestId").and_then(Value::as_str)?;
    pending
        .lock()
        .ok()
        .and_then(|pending| pending.get(id).and_then(|request| request.events.clone()))
}
fn write_child(child: &Arc<Mutex<Option<CommandChild>>>, message: &Value) -> CommandResult<()> {
    let mut guard = child.lock().map_err(lock_error)?;
    let child = guard
        .as_mut()
        .ok_or_else(|| CommandError::new("mastra.not-running", "Mastra worker is not running"))?;
    child
        .write(format!("{}\n", message).as_bytes())
        .map_err(|error| CommandError::new("mastra.write", error.to_string()))
}
fn resolve_worker_script(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    if let Ok(path) = std::env::var("CONSTRUCT_MASTRA_WORKER_JS") {
        return Ok(path.into());
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/mastra-worker.cjs");
    if dev.exists() {
        return Ok(dev);
    }
    app.path()
        .resolve("resources/mastra-worker.cjs", BaseDirectory::Resource)
        .map_err(|error| CommandError::new("mastra.resource", error.to_string()))
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> CommandError {
    CommandError::new("mastra.lock", "Mastra worker lock was poisoned")
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[test]
    fn routes_worker_events_only_to_the_matching_live_request() {
        let observed = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&observed);
        let (reply, _) = mpsc::channel();
        let pending = Arc::new(Mutex::new(HashMap::from([(
            "flow-request".to_string(),
            PendingRequest {
                reply,
                events: Some(Arc::new(move |_| {
                    counter.fetch_add(1, Ordering::SeqCst);
                })),
            },
        )])));

        let handler = event_handler(
            &pending,
            &json!({"kind":"event","requestId":"flow-request","payload":{"event":{"type":"reasoning"}}}),
        )
        .expect("matching handler");
        handler(Value::Null);
        assert_eq!(observed.load(Ordering::SeqCst), 1);
        assert!(event_handler(
            &pending,
            &json!({"kind":"event","requestId":"another-request"})
        )
        .is_none());
    }
}
