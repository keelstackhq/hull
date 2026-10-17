//! Process exit codes. The numbers are part of the CLI contract; do not renumber them.

use std::process::ExitCode;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Exit {
    /// Success.
    Ok = 0,
    /// A negative result: the command ran, the answer is "no" (a check failed, drift found).
    Failure = 1,
    /// Usage error: bad flags or arguments (clap).
    Usage = 2,
    /// Config, environment or runtime error.
    Error = 3,
}

impl Exit {
    pub fn code(self) -> u8 {
        self as u8
    }
}

impl From<Exit> for ExitCode {
    fn from(exit: Exit) -> Self {
        ExitCode::from(exit.code())
    }
}
