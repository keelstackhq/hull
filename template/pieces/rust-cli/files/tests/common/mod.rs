//! Test helper: always build the command under test with `cli()`.
//!
//! The command starts from an empty environment, so a test can never see the developer's tokens,
//! config or terminal settings. Nothing here changes the test process's own environment.

use std::ops::{Deref, DerefMut};

use assert_cmd::Command;
use assert_cmd::cargo::cargo_bin_cmd;
use tempfile::TempDir;

/// The command under test and the temp directory that is its HOME (removed on drop).
pub struct Cli {
    command: Command,
    _home: TempDir,
}

impl Deref for Cli {
    type Target = Command;

    fn deref(&self) -> &Command {
        &self.command
    }
}

impl DerefMut for Cli {
    fn deref_mut(&mut self) -> &mut Command {
        &mut self.command
    }
}

pub fn cli() -> Cli {
    let home = tempfile::tempdir().expect("create a temp HOME");
    let mut command = cargo_bin_cmd!();
    command
        .env_clear()
        .env("HOME", home.path())
        .env("XDG_CONFIG_HOME", home.path().join("config"))
        .env("XDG_CACHE_HOME", home.path().join("cache"))
        .env("XDG_DATA_HOME", home.path().join("data"))
        .env("XDG_STATE_HOME", home.path().join("state"))
        .env("NO_COLOR", "1");
    if let Some(path) = std::env::var_os("PATH") {
        command.env("PATH", path);
    }
    Cli {
        command,
        _home: home,
    }
}
