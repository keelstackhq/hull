//! The only module that writes to stdout. With `--json` a run prints exactly one object and a
//! newline; without it, the human text. Errors without `--json` go to stderr.

use std::io::{self, Write};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::Error;
use crate::exit::Exit;

/// Top-level keys of the JSON object that command data must not reuse.
const RESERVED_KEYS: [&str; 6] = ["version", "command", "ok", "exit_code", "messages", "error"];

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub kind: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub version: u8,
    pub command: String,
    pub ok: bool,
    pub exit_code: u8,
    pub messages: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
    #[serde(flatten)]
    pub data: Map<String, Value>,
    /// Text printed without `--json`.
    #[serde(skip)]
    pub human: String,
}

impl Report {
    /// A successful run. `data` should be a JSON object; its keys join the top-level object.
    pub fn success(command: &str, human: impl Into<String>, data: Value) -> Self {
        let data = match data {
            Value::Object(map) => map,
            other => Map::from_iter([("value".to_owned(), other)]),
        };
        debug_assert!(
            data.keys()
                .all(|key| !RESERVED_KEYS.contains(&key.as_str())),
            "data keys must not reuse a reserved top-level key: {RESERVED_KEYS:?}"
        );
        Report {
            version: 1,
            command: command.to_owned(),
            ok: true,
            exit_code: Exit::Ok.code(),
            messages: Vec::new(),
            error: None,
            data,
            human: human.into(),
        }
    }

    pub fn failure(command: &str, error: &Error) -> Self {
        let message = error.to_string();
        Report {
            version: 1,
            command: command.to_owned(),
            ok: false,
            exit_code: error.exit().code(),
            messages: Vec::new(),
            error: Some(ErrorBody {
                kind: error.kind(),
                message: message.clone(),
            }),
            data: Map::new(),
            human: format!("error: {message}\n"),
        }
    }

    pub fn exit(&self) -> Exit {
        match self.exit_code {
            0 => Exit::Ok,
            1 => Exit::Failure,
            2 => Exit::Usage,
            _ => Exit::Error,
        }
    }
}

pub fn render_json(report: &Report) -> Result<String, serde_json::Error> {
    let mut text = serde_json::to_string(report)?;
    text.push('\n');
    Ok(text)
}

pub fn render_human(report: &Report) -> &str {
    &report.human
}

/// Print the report: stdout for JSON and for successful human output, stderr for human errors.
pub fn emit(report: &Report, json: bool) -> Result<(), Error> {
    if json {
        io::stdout()
            .lock()
            .write_all(render_json(report)?.as_bytes())?;
    } else if report.ok {
        io::stdout()
            .lock()
            .write_all(render_human(report).as_bytes())?;
    } else {
        io::stderr()
            .lock()
            .write_all(render_human(report).as_bytes())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_is_one_line_with_the_contract_keys_first() {
        let report = Report::success("hello", "hi\n", serde_json::json!({ "greeting": "hi" }));
        assert_eq!(
            render_json(&report).unwrap(),
            "{\"version\":1,\"command\":\"hello\",\"ok\":true,\"exit_code\":0,\"messages\":[],\"greeting\":\"hi\"}\n"
        );
    }

    #[test]
    #[should_panic(expected = "reserved top-level key")]
    fn data_may_not_reuse_a_reserved_key() {
        Report::success("hello", "", serde_json::json!({ "ok": false }));
    }

    #[test]
    fn errors_carry_kind_and_message_and_their_exit_code() {
        let report = Report::failure("hello", &Error::Usage("bad".into()));
        assert_eq!(
            render_json(&report).unwrap(),
            "{\"version\":1,\"command\":\"hello\",\"ok\":false,\"exit_code\":2,\"messages\":[],\"error\":{\"kind\":\"usage\",\"message\":\"bad\"}}\n"
        );
        assert_eq!(report.exit(), Exit::Usage);
    }
}
