use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

use crate::error::{CommandError, CommandResult};
use crate::projects::ProjectStore;

use super::framing;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BUFFER: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
enum Language {
    Typescript,
    Python,
    Rust,
    Go,
    Java,
    Cpp,
    Csharp,
    Html,
    Css,
    Json,
}

impl Language {
    fn all() -> &'static [Language] {
        &[
            Self::Typescript,
            Self::Python,
            Self::Rust,
            Self::Go,
            Self::Java,
            Self::Cpp,
            Self::Csharp,
            Self::Html,
            Self::Css,
            Self::Json,
        ]
    }

    fn id(self) -> &'static str {
        match self {
            Self::Typescript => "typescript",
            Self::Python => "python",
            Self::Rust => "rust",
            Self::Go => "go",
            Self::Java => "java",
            Self::Cpp => "cpp",
            Self::Csharp => "csharp",
            Self::Html => "html",
            Self::Css => "css",
            Self::Json => "json",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::all()
            .iter()
            .copied()
            .find(|language| language.id() == value)
    }
}

struct Config {
    label: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    install: &'static str,
    extensions: &'static [&'static str],
}

fn config(language: Language) -> Config {
    match language {
        Language::Typescript => Config {
            label: "TypeScript",
            command: "typescript-language-server",
            args: &["--stdio"],
            install: "npm install --save-dev typescript-language-server typescript",
            extensions: &[".ts", ".tsx", ".js", ".jsx"],
        },
        Language::Python => Config {
            label: "Python",
            command: "pyright-langserver",
            args: &["--stdio"],
            install: "npm install --save-dev pyright",
            extensions: &[".py"],
        },
        Language::Rust => Config {
            label: "Rust",
            command: "rust-analyzer",
            args: &[],
            install: "rustup component add rust-analyzer",
            extensions: &[".rs"],
        },
        Language::Go => Config {
            label: "Go",
            command: "gopls",
            args: &[],
            install: "go install golang.org/x/tools/gopls@latest",
            extensions: &[".go"],
        },
        Language::Java => Config {
            label: "Java",
            command: "jdtls",
            args: &[],
            install: "brew install jdtls",
            extensions: &[".java"],
        },
        Language::Cpp => Config {
            label: "C/C++",
            command: "clangd",
            args: &[],
            install: "brew install llvm",
            extensions: &[".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"],
        },
        Language::Csharp => Config {
            label: "C#",
            command: "csharp-ls",
            args: &[],
            install: "dotnet tool install --global csharp-ls",
            extensions: &[".cs"],
        },
        Language::Html => Config {
            label: "HTML",
            command: "vscode-html-language-server",
            args: &["--stdio"],
            install: "npm install --save-dev vscode-langservers-extracted",
            extensions: &[".html", ".htm"],
        },
        Language::Css => Config {
            label: "CSS",
            command: "vscode-css-language-server",
            args: &["--stdio"],
            install: "npm install --save-dev vscode-langservers-extracted",
            extensions: &[".css", ".scss", ".less"],
        },
        Language::Json => Config {
            label: "JSON",
            command: "vscode-json-language-server",
            args: &["--stdio"],
            install: "npm install --save-dev vscode-langservers-extracted",
            extensions: &[".json", ".jsonc"],
        },
    }
}

struct Server {
    child: Child,
    writer: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
}

#[derive(Default)]
struct LspRegistry {
    servers: BTreeMap<Language, Server>,
}

pub struct LspService {
    projects: ProjectStore,
    registry: Mutex<LspRegistry>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged, rename_all = "camelCase")]
pub enum LspInstallInput {
    Project(String),
    Selection {
        project_id: String,
        language: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEntry {
    label: &'static str,
    command: &'static str,
    install_command: &'static str,
    installed: bool,
    status: &'static str,
    resolved_path: Option<String>,
}

impl LspService {
    pub fn new(projects: ProjectStore) -> Self {
        Self {
            projects,
            registry: Mutex::new(LspRegistry::default()),
        }
    }

    pub fn status(&self, project_id: &str) -> CommandResult<Value> {
        let workspace = self.projects.workspace_path(project_id)?;
        let registry = self.registry.lock().map_err(lock_error)?;
        let mut report = serde_json::Map::new();
        for language in Language::all() {
            let cfg = config(*language);
            let resolved = resolve_executable(&workspace, cfg.command);
            let running = registry.servers.contains_key(language);
            report.insert(
                language.id().into(),
                serde_json::to_value(StatusEntry {
                    label: cfg.label,
                    command: cfg.command,
                    install_command: cfg.install,
                    installed: resolved.is_some(),
                    status: if running {
                        "running"
                    } else if resolved.is_some() {
                        "stopped"
                    } else {
                        "not-installed"
                    },
                    resolved_path: resolved.map(|path| path.to_string_lossy().into_owned()),
                })
                .unwrap(),
            );
        }
        Ok(Value::Object(report))
    }

    pub fn start(&self, app: tauri::AppHandle, project_id: &str) -> CommandResult<Value> {
        let workspace = self.projects.workspace_path(project_id)?;
        let languages = discover_languages(&workspace);
        let mut started = Vec::new();
        let mut skipped = serde_json::Map::new();
        for language in Language::all() {
            if !languages.contains(language) {
                self.stop_language(*language);
                continue;
            }
            let root = if *language == Language::Rust {
                cargo_root(&workspace).unwrap_or_else(|| workspace.clone())
            } else {
                workspace.clone()
            };
            if *language == Language::Rust && !root.join("Cargo.toml").is_file() {
                skipped.insert(language.id().into(), json!({"reason":"no-cargo-project","message":"Skipping Rust language server because no Cargo.toml root was found."}));
                continue;
            }
            if self.start_language(app.clone(), *language, root)? {
                started.push(language.id());
            } else {
                skipped.insert(language.id().into(), json!({"reason":"not-installed","message":format!("Skipping {}; server is not installed.", config(*language).label)}));
            }
        }
        Ok(json!({
            "languages": started,
            "workspacePath": workspace,
            "skipped": if skipped.is_empty() { Value::Null } else { Value::Object(skipped) }
        }))
    }

    pub fn request(&self, app: tauri::AppHandle, mut payload: Value) -> CommandResult<Value> {
        let language = infer_language(&payload);
        let id = payload.get("id").map(id_key);
        if let Some(object) = payload.as_object_mut() {
            object.remove("languageId");
        }
        let (writer, pending) = {
            let registry = self.registry.lock().map_err(lock_error)?;
            let server = registry.servers.get(&language).ok_or_else(|| {
                CommandError::new(
                    "lsp.not-running",
                    format!("{} LSP process not running", config(language).label),
                )
            })?;
            (Arc::clone(&server.writer), Arc::clone(&server.pending))
        };
        let receiver = id.as_ref().map(|key| {
            let (sender, receiver) = mpsc::channel();
            pending.lock().unwrap().insert(key.clone(), sender);
            receiver
        });
        writer
            .lock()
            .map_err(lock_error)?
            .write_all(&framing::encode(&payload))
            .map_err(|error| CommandError::new("lsp.write", error.to_string()))?;
        let Some(receiver) = receiver else {
            return Ok(Value::Null);
        };
        receiver.recv_timeout(REQUEST_TIMEOUT).map_err(|_| {
            if let Some(id) = id {
                pending.lock().ok().map(|mut pending| pending.remove(&id));
            }
            let _ = app.emit(
                "construct:lsp:stderr",
                json!({"language":language.id(),"level":"error","text":"LSP request timed out"}),
            );
            CommandError::new("lsp.timeout", "language server request timed out")
        })
    }

    pub fn install(&self, app: tauri::AppHandle, input: LspInstallInput) -> CommandResult<bool> {
        let (project_id, language) = match input {
            LspInstallInput::Project(project_id) => (project_id, None),
            LspInstallInput::Selection {
                project_id,
                language,
            } => (
                project_id,
                language.and_then(|value| Language::parse(&value)),
            ),
        };
        let workspace = self.projects.workspace_path(&project_id)?;
        let languages = language
            .map(|value| vec![value])
            .unwrap_or_else(|| Language::all().to_vec());
        let mut success = true;
        for language in languages {
            let cfg = config(language);
            let output = shell_command(cfg.install, &workspace)?;
            let _ = app.emit("construct:lsp:install-progress", json!({
                "language": language.id(), "type": if output.0 { "stdout" } else { "stderr" }, "text": output.1
            }));
            success &= output.0;
        }
        Ok(success)
    }

    pub fn stop_all(&self) {
        for language in Language::all() {
            self.stop_language(*language);
        }
    }

    fn start_language(
        &self,
        app: tauri::AppHandle,
        language: Language,
        workspace: PathBuf,
    ) -> CommandResult<bool> {
        let cfg = config(language);
        let Some(executable) = resolve_executable(&workspace, cfg.command) else {
            return Ok(false);
        };
        self.stop_language(language);
        let mut child = Command::new(&executable)
            .args(cfg.args)
            .current_dir(&workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| CommandError::new("lsp.spawn", error.to_string()))?;
        let stdin =
            Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
                CommandError::new("lsp.stdin", "missing LSP stdin")
            })?));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CommandError::new("lsp.stdout", "missing LSP stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| CommandError::new("lsp.stderr", "missing LSP stderr"))?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        spawn_stdout(
            app.clone(),
            language,
            stdout,
            Arc::clone(&stdin),
            Arc::clone(&pending),
        );
        spawn_stderr(app, language, stderr);
        self.registry.lock().map_err(lock_error)?.servers.insert(
            language,
            Server {
                child,
                writer: stdin,
                pending,
            },
        );
        Ok(true)
    }

    fn stop_language(&self, language: Language) {
        let server = self
            .registry
            .lock()
            .ok()
            .and_then(|mut registry| registry.servers.remove(&language));
        if let Some(mut server) = server {
            let _ = server.child.kill();
            if let Ok(mut pending) = server.pending.lock() {
                pending.clear();
            }
        }
    }
}

fn spawn_stdout(
    app: tauri::AppHandle,
    language: Language,
    mut stdout: impl Read + Send + 'static,
    writer: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
) {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 8192];
        while let Ok(count) = stdout.read(&mut chunk) {
            if count == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..count]);
            if buffer.len() > MAX_BUFFER {
                break;
            }
            for message in framing::drain(&mut buffer) {
                if message.get("method").is_some() && message.get("id").is_some() {
                    let response = json!({"jsonrpc":"2.0","id":message["id"],"result":server_request_result(&message)});
                    let _ = writer
                        .lock()
                        .map(|mut writer| writer.write_all(&framing::encode(&response)));
                } else if let Some(id) = message.get("id").map(id_key) {
                    if let Some(sender) = pending
                        .lock()
                        .ok()
                        .and_then(|mut pending| pending.remove(&id))
                    {
                        let _ = sender.send(message);
                    }
                } else if message.get("method").is_some() {
                    let mut event = message;
                    if let Some(object) = event.as_object_mut() {
                        object.insert("languageId".into(), Value::String(language.id().into()));
                    }
                    let _ = app.emit("construct:lsp:notification", event);
                }
            }
        }
    });
}

fn spawn_stderr(app: tauri::AppHandle, language: Language, mut stderr: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&buffer[..count]).into_owned();
            let _ = app.emit(
                "construct:lsp:stderr",
                json!({"language":language.id(),"level":"warn","text":text}),
            );
        }
    });
}

fn server_request_result(message: &Value) -> Value {
    match message.get("method").and_then(Value::as_str) {
        Some("workspace/configuration") => message
            .pointer("/params/items")
            .and_then(Value::as_array)
            .map(|items| Value::Array(items.iter().map(|_| Value::Null).collect()))
            .unwrap_or(Value::Array(vec![])),
        Some("workspace/applyEdit") => {
            json!({"applied":false,"failureReason":"Construct does not apply language-server workspace edits automatically."})
        }
        _ => Value::Null,
    }
}

fn discover_languages(root: &Path) -> HashSet<Language> {
    let mut languages = HashSet::new();
    scan(root, 0, &mut languages);
    languages
}

fn scan(directory: &Path, depth: usize, languages: &mut HashSet<Language>) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            if !name.to_string_lossy().starts_with('.')
                && !matches!(
                    name.to_string_lossy().as_ref(),
                    "node_modules" | "target" | "dist" | ".venv"
                )
            {
                scan(&path, depth + 1, languages);
            }
        } else if let Some(path) = path.to_str() {
            for language in Language::all() {
                if config(*language)
                    .extensions
                    .iter()
                    .any(|extension| path.to_lowercase().ends_with(extension))
                {
                    languages.insert(*language);
                }
            }
        }
    }
}

fn infer_language(payload: &Value) -> Language {
    payload
        .get("languageId")
        .and_then(Value::as_str)
        .and_then(Language::parse)
        .or_else(|| {
            payload
                .pointer("/params/textDocument/uri")
                .and_then(Value::as_str)
                .and_then(|uri| {
                    Language::all().iter().copied().find(|language| {
                        config(*language)
                            .extensions
                            .iter()
                            .any(|extension| uri.to_lowercase().ends_with(extension))
                    })
                })
        })
        .unwrap_or(Language::Typescript)
}

fn cargo_root(workspace: &Path) -> Option<PathBuf> {
    if workspace.join("Cargo.toml").is_file() {
        return Some(workspace.to_path_buf());
    }
    std::fs::read_dir(workspace)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.join("Cargo.toml").is_file())
}

fn resolve_executable(workspace: &Path, command: &str) -> Option<PathBuf> {
    let local = workspace.join("node_modules").join(".bin").join(command);
    if local.is_file() {
        return Some(local);
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(command))
            .find(|candidate| candidate.is_file())
    })
}

fn shell_command(command: &str, cwd: &Path) -> CommandResult<(bool, String)> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let output = Command::new(shell)
        .args(["-c", command])
        .current_dir(cwd)
        .output()
        .map_err(|error| CommandError::new("lsp.install", error.to_string()))?;
    Ok((
        output.status.success(),
        format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
    ))
}

fn id_key(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> CommandError {
    CommandError::new("lsp.lock", "LSP state lock was poisoned")
}
