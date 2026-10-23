//! Errors a command can return. Messages say how to fix the problem.

use crate::exit::Exit;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Usage(String),
    #[error("{0}")]
    Config(String),
    #[error("could not write output: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not encode output: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// Stable machine-readable name, the `error.kind` of the JSON output.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Usage(_) => "usage",
            Error::Config(_) => "config",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }

    pub fn exit(&self) -> Exit {
        match self {
            Error::Usage(_) => Exit::Usage,
            Error::Config(_) | Error::Io(_) | Error::Json(_) => Exit::Error,
        }
    }
}
