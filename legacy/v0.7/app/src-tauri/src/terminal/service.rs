use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use uuid::Uuid;

use crate::error::{CommandError, CommandResult};
use crate::projects::ProjectStore;

type SharedChild = Arc<Mutex<Box<dyn Child + Send + Sync>>>;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: SharedChild,
}

#[derive(Default)]
struct TerminalRegistry {
    sessions: HashMap<String, TerminalSession>,
    latest_output: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInput {
    pub project_id: String,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreated {
    pub session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    exit_code: i32,
}

pub struct TerminalService {
    projects: ProjectStore,
    registry: Arc<Mutex<TerminalRegistry>>,
}

impl TerminalService {
    pub fn new(projects: ProjectStore) -> Self {
        Self {
            projects,
            registry: Arc::new(Mutex::new(TerminalRegistry::default())),
        }
    }

    pub fn create(
        &self,
        app: tauri::AppHandle,
        input: TerminalCreateInput,
    ) -> CommandResult<TerminalCreated> {
        let workspace = self.projects.workspace_path(&input.project_id)?;
        let shell = resolve_shell();
        let pty = native_pty_system();
        let pair = pty
            .openpty(size(input.cols, input.rows))
            .map_err(|error| CommandError::new("terminal.open-pty", error.to_string()))?;
        let mut command = CommandBuilder::new(&shell);
        command.arg("-i");
        command.cwd(&workspace);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| CommandError::new("terminal.spawn", error.to_string()))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| CommandError::new("terminal.reader", error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| CommandError::new("terminal.writer", error.to_string()))?;
        let session_id = Uuid::new_v4().to_string();
        let shared_child = Arc::new(Mutex::new(child));
        let session = TerminalSession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::clone(&shared_child),
        };
        self.registry
            .lock()
            .map_err(|_| CommandError::new("terminal.lock", "terminal registry lock was poisoned"))?
            .sessions
            .insert(session_id.clone(), session);
        spawn_output_pump(
            app.clone(),
            Arc::clone(&self.registry),
            session_id.clone(),
            input.project_id,
            reader,
        );
        spawn_exit_monitor(
            app,
            Arc::clone(&self.registry),
            session_id.clone(),
            shared_child,
        );
        Ok(TerminalCreated { session_id })
    }

    pub fn write(&self, input: TerminalInput) -> CommandResult<()> {
        let registry = self.registry.lock().map_err(|_| {
            CommandError::new("terminal.lock", "terminal registry lock was poisoned")
        })?;
        let session = registry.sessions.get(&input.session_id).ok_or_else(|| {
            CommandError::new("terminal.not-found", "terminal session is not running")
        })?;
        let mut writer = session.writer.lock().map_err(|_| {
            CommandError::new("terminal.writer-lock", "terminal writer lock was poisoned")
        })?;
        writer
            .write_all(input.data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| CommandError::new("terminal.write", error.to_string()))
    }

    pub fn resize(&self, input: TerminalResizeInput) -> CommandResult<()> {
        if input.cols == 0 || input.rows == 0 {
            return Ok(());
        }
        let registry = self.registry.lock().map_err(|_| {
            CommandError::new("terminal.lock", "terminal registry lock was poisoned")
        })?;
        let session = registry.sessions.get(&input.session_id).ok_or_else(|| {
            CommandError::new("terminal.not-found", "terminal session is not running")
        })?;
        session
            .master
            .resize(size(input.cols, input.rows))
            .map_err(|error| CommandError::new("terminal.resize", error.to_string()))
    }

    pub fn kill(&self, session_id: &str) -> CommandResult<()> {
        let session = self
            .registry
            .lock()
            .map_err(|_| CommandError::new("terminal.lock", "terminal registry lock was poisoned"))?
            .sessions
            .remove(session_id);
        if let Some(session) = session {
            session
                .child
                .lock()
                .map_err(|_| {
                    CommandError::new("terminal.child-lock", "terminal child lock was poisoned")
                })?
                .kill()
                .map_err(|error| CommandError::new("terminal.kill", error.to_string()))?;
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        let ids = self
            .registry
            .lock()
            .map(|registry| registry.sessions.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for id in ids {
            let _ = self.kill(&id);
        }
    }
}

fn spawn_output_pump(
    app: tauri::AppHandle,
    registry: Arc<Mutex<TerminalRegistry>>,
    session_id: String,
    project_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let (chunk_tx, chunk_rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if chunk_tx
                .send(String::from_utf8_lossy(&buffer[..count]).into_owned())
                .is_err()
            {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(mut data) = chunk_rx.recv() {
            loop {
                match chunk_rx.recv_timeout(Duration::from_millis(8)) {
                    Ok(chunk) => data.push_str(&chunk),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            if let Ok(mut registry) = registry.lock() {
                let output = registry
                    .latest_output
                    .entry(project_id.clone())
                    .or_default();
                output.push_str(&data);
                if output.len() > 30_000 {
                    output.drain(..output.len() - 30_000);
                }
            }
            let _ = app.emit(
                "construct:project:terminal-data",
                TerminalDataEvent {
                    session_id: session_id.clone(),
                    data,
                },
            );
        }
    });
}

fn spawn_exit_monitor(
    app: tauri::AppHandle,
    registry: Arc<Mutex<TerminalRegistry>>,
    session_id: String,
    child: SharedChild,
) {
    std::thread::spawn(move || loop {
        let status = child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok())
            .flatten();
        if let Some(status) = status {
            if let Ok(mut registry) = registry.lock() {
                registry.sessions.remove(&session_id);
            }
            let _ = app.emit(
                "construct:project:terminal-exit",
                TerminalExitEvent {
                    session_id,
                    exit_code: status.exit_code() as i32,
                },
            );
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    });
}

fn resolve_shell() -> PathBuf {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            ["/bin/zsh", "/bin/bash", "/bin/sh"]
                .iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
        })
        .unwrap_or_else(|| Path::new("/bin/sh").to_path_buf())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}
