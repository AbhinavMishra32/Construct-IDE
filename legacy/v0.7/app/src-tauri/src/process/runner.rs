use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{CommandError, CommandResult};

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;

pub struct ProcessOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Default)]
pub struct ProcessRunner;

impl ProcessRunner {
    pub fn run(&self, program: &str, args: &[&str], cwd: &Path) -> CommandResult<ProcessOutput> {
        let output = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| {
                CommandError::new("process.spawn", format!("failed to run {program}: {error}"))
            })?;
        Ok(ProcessOutput {
            success: output.status.success(),
            stdout: bounded_text(output.stdout),
            stderr: bounded_text(output.stderr),
        })
    }
}

fn bounded_text(bytes: Vec<u8>) -> String {
    let start = bytes.len().saturating_sub(MAX_CAPTURE_BYTES);
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}
