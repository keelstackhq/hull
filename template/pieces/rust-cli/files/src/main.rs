mod cli;
mod error;
mod exit;
mod log;
mod output;
mod run;

use std::process::ExitCode;

use clap::Parser;

use crate::cli::Cli;
use crate::error::Error;
use crate::exit::Exit;
use crate::output::Report;

fn main() -> ExitCode {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let json = args.iter().any(|arg| arg == "--json");
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        Err(err) if !err.use_stderr() => {
            // --help and --version: clap prints them to stdout.
            let _ = err.print();
            return Exit::Ok.into();
        }
        Err(err) => {
            let usage = Error::Usage(err.to_string().trim_end().to_owned());
            return finish(&Report::failure("unknown", &usage), json);
        }
    };
    log::init(cli.verbose, cli.quiet);
    let command = cli.command.name();
    let report = run::run(cli).unwrap_or_else(|err| Report::failure(command, &err));
    finish(&report, json)
}

fn finish(report: &Report, json: bool) -> ExitCode {
    match output::emit(report, json) {
        Ok(()) => report.exit().into(),
        Err(_) => Exit::Error.into(),
    }
}
