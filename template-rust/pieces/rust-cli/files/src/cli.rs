//! Command line definition (clap derive). The binary name and version come from Cargo.toml.

use std::path::PathBuf;

use clap::{ArgAction, Parser, Subcommand};
use clap_complete::Shell;

/// A command line tool. Replace this text and the example command with your own.
#[derive(Debug, Parser)]
#[command(version, propagate_version = true)]
pub struct Cli {
    /// Print one JSON object on stdout instead of text
    #[arg(long, global = true)]
    pub json: bool,

    /// Run as if started in DIR
    #[arg(short = 'C', value_name = "DIR", global = true)]
    pub directory: Option<PathBuf>,

    /// More logs on stderr (repeat for more)
    #[arg(short, long, action = ArgAction::Count, global = true)]
    pub verbose: u8,

    /// Only errors on stderr
    #[arg(short, long, global = true, conflicts_with = "verbose")]
    pub quiet: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Print a greeting (the example command)
    Hello {
        /// Who to greet
        #[arg(long, default_value = "world")]
        name: String,
    },
    /// Print a shell completion script
    Completions {
        /// Shell to generate for
        shell: Shell,
    },
    /// Print the man page (roff)
    Man,
}

impl Command {
    /// Name used in the `command` field of the JSON output.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Hello { .. } => "hello",
            Command::Completions { .. } => "completions",
            Command::Man => "man",
        }
    }
}
