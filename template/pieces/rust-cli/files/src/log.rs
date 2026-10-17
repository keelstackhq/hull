//! Logging goes to stderr only; stdout belongs to `output`.

use std::io::IsTerminal;

use tracing_subscriber::EnvFilter;

/// `RUST_LOG` wins; otherwise `-q` is `error`, no flag is `warn`, `-v` is `info`, `-vv` is `debug`
/// and `-vvv` is `trace`. ANSI is off when `NO_COLOR` is set or stderr is not a terminal.
pub fn init(verbose: u8, quiet: bool) {
    let level = match (quiet, verbose) {
        (true, _) => "error",
        (false, 0) => "warn",
        (false, 1) => "info",
        (false, 2) => "debug",
        (false, _) => "trace",
    };
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(level));
    let ansi = std::env::var_os("NO_COLOR").is_none() && std::io::stderr().is_terminal();
    // A second init in one process (unit tests) is not an error worth reporting.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_ansi(ansi)
        .try_init();
}
