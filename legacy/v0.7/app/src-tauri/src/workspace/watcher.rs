use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::Emitter;

use crate::error::{CommandError, CommandResult};

use super::paths::is_ignored_path;

const DEBOUNCE: Duration = Duration::from_millis(300);

struct ActiveWatcher {
    watcher: RecommendedWatcher,
    stop: Sender<()>,
    worker: JoinHandle<()>,
}

#[derive(Default)]
pub struct WorkspaceWatcher {
    active: Mutex<Option<ActiveWatcher>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangedPayload {
    event_type: String,
    path: Option<String>,
    paths: Vec<String>,
}

impl WorkspaceWatcher {
    pub fn start(&self, app: tauri::AppHandle, root: PathBuf) -> CommandResult<()> {
        self.stop()?;
        let canonical_root = root.canonicalize().map_err(|error| {
            CommandError::new(
                "watcher.missing-root",
                format!("{}: {error}", root.display()),
            )
        })?;
        let (event_tx, event_rx) = mpsc::channel::<Event>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                let _ = event_tx.send(event);
            }
        })
        .map_err(|error| CommandError::new("watcher.create", error.to_string()))?;
        watcher
            .watch(&canonical_root, RecursiveMode::Recursive)
            .map_err(|error| CommandError::new("watcher.start", error.to_string()))?;

        let worker = std::thread::Builder::new()
            .name("construct-workspace-watcher".into())
            .spawn(move || {
                let mut pending = BTreeSet::new();
                let mut event_type = "change".to_string();
                loop {
                    if stop_rx.try_recv().is_ok() {
                        break;
                    }
                    match event_rx.recv_timeout(DEBOUNCE) {
                        Ok(event) => {
                            event_type = format!("{:?}", event.kind).to_lowercase();
                            for path in event.paths {
                                if let Some(relative) =
                                    relative_visible_path(&canonical_root, &path)
                                {
                                    pending.insert(relative);
                                }
                            }
                        }
                        Err(RecvTimeoutError::Timeout) if !pending.is_empty() => {
                            let paths = pending.iter().cloned().collect::<Vec<_>>();
                            pending.clear();
                            let _ = app.emit(
                                "construct:project:file-changed",
                                FileChangedPayload {
                                    event_type: event_type.clone(),
                                    path: paths.first().cloned(),
                                    paths,
                                },
                            );
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                }
            })
            .map_err(|error| CommandError::new("watcher.worker", error.to_string()))?;

        *self
            .active
            .lock()
            .map_err(|_| CommandError::new("watcher.lock", "watcher lock was poisoned"))? =
            Some(ActiveWatcher {
                watcher,
                stop: stop_tx,
                worker,
            });
        Ok(())
    }

    pub fn stop(&self) -> CommandResult<()> {
        let active = self
            .active
            .lock()
            .map_err(|_| CommandError::new("watcher.lock", "watcher lock was poisoned"))?
            .take();
        if let Some(active) = active {
            drop(active.watcher);
            let _ = active.stop.send(());
            let _ = active.worker.join();
        }
        Ok(())
    }
}

fn relative_visible_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if is_ignored_path(relative) {
        return None;
    }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_ignored_watcher_paths() {
        let root = Path::new("/workspace");
        assert_eq!(
            relative_visible_path(root, Path::new("/workspace/src/main.rs")),
            Some("src/main.rs".into())
        );
        assert_eq!(
            relative_visible_path(root, Path::new("/workspace/target/debug/app")),
            None
        );
    }
}
