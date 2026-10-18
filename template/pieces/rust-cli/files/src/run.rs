//! Command dispatch. Commands return a `Report`; they never print.

use clap::CommandFactory;
use serde_json::json;

use crate::cli::{Cli, Command};
use crate::error::Error;
use crate::output::Report;

pub fn run(cli: Cli) -> Result<Report, Error> {
    if let Some(dir) = &cli.directory {
        std::env::set_current_dir(dir).map_err(|err| {
            Error::Config(format!(
                "cannot use -C {}: {err}; pass an existing directory",
                dir.display()
            ))
        })?;
    }
    let name = cli.command.name();
    tracing::debug!(command = name, "running");
    match cli.command {
        Command::Hello { name: who } => {
            if who.trim().is_empty() {
                return Err(Error::Usage("--name must not be empty".to_owned()));
            }
            let greeting = format!("hello, {who}");
            Ok(Report::success(
                name,
                format!("{greeting}\n"),
                json!({ "greeting": greeting }),
            ))
        }
        Command::Completions { shell } => {
            let mut command = Cli::command();
            let bin = command.get_name().to_owned();
            let mut buf = Vec::new();
            clap_complete::generate(shell, &mut command, bin, &mut buf);
            let script = String::from_utf8_lossy(&buf).into_owned();
            Ok(Report::success(
                name,
                script.clone(),
                json!({ "shell": shell.to_string(), "script": script }),
            ))
        }
        Command::Man => {
            let mut buf = Vec::new();
            clap_mangen::Man::new(Cli::command()).render(&mut buf)?;
            let page = String::from_utf8_lossy(&buf).into_owned();
            Ok(Report::success(name, page.clone(), json!({ "page": page })))
        }
    }
}
