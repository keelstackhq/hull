//! SQLite: pools, migrations, backups, restore and the optional TTL sweeper.
//!
//! This is starter API: an app uses the parts it needs, so dead-code lints stay off here.
#![allow(dead_code)]

pub mod backup;
pub mod config;
pub mod lock;
pub mod pool;
pub mod restore;
#[cfg(feature = "s3-backup")]
pub mod s3;
pub mod sweeper;
#[cfg(test)]
pub mod testing;

pub use config::DbConfig;
pub use pool::Db;

use std::path::PathBuf;

/// The snapshot path after a `--restore` argument, if the process was started that way.
pub fn restore_snapshot_arg() -> Option<PathBuf> {
    parse_restore_arg(std::env::args().skip(1))
}

fn parse_restore_arg(args: impl IntoIterator<Item = String>) -> Option<PathBuf> {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--restore" {
            return args.next().map(PathBuf::from);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_restore_arg;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn restore_flag_takes_the_next_argument() {
        let got = parse_restore_arg(args(&["--restore", "/data/backups/snap.db"]));
        assert_eq!(got.unwrap().to_str(), Some("/data/backups/snap.db"));
    }

    #[test]
    fn no_flag_means_a_normal_start() {
        assert!(parse_restore_arg(args(&[])).is_none());
        assert!(parse_restore_arg(args(&["--other"])).is_none());
    }
}
