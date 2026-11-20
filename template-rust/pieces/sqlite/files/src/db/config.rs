//! Database settings from environment variables, read once at boot.

use std::path::PathBuf;
use std::str::FromStr;

#[cfg(feature = "s3-backup")]
use super::s3::S3Config;

/// Settings for the database, backups and the sweeper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbConfig {
    /// Directory holding the database file (`DATA_DIR`, default `/data`).
    pub data_dir: PathBuf,
    /// Read-only connections (`DB_READERS`, default 4, at least 1).
    pub readers: u32,
    /// Where snapshots go (`BACKUP_DIR`, default `$DATA_DIR/backups`).
    pub backup_dir: PathBuf,
    /// Newest snapshots to keep (`BACKUP_KEEP`, default 7).
    pub backup_keep: usize,
    /// Seconds between snapshots (`BACKUP_INTERVAL_SECS`, default 86400, 0 = off).
    pub backup_interval_secs: u64,
    /// Seconds between TTL sweeps (`TTL_SWEEP_SECS`, default 0 = off).
    pub ttl_sweep_secs: u64,
    /// Snapshot upload target; `None` unless all `R2_*` variables are set.
    #[cfg(feature = "s3-backup")]
    pub s3: Option<S3Config>,
}

impl DbConfig {
    /// Reads the process environment.
    pub fn from_env() -> Result<Self, String> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Reads settings through `lookup`, so tests never touch the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let data_dir = PathBuf::from(lookup("DATA_DIR").unwrap_or_else(|| "/data".to_owned()));
        let readers: u32 = number(&lookup, "DB_READERS", 4)?;
        if readers == 0 {
            return Err("DB_READERS must be at least 1".to_owned());
        }
        let backup_dir =
            lookup("BACKUP_DIR").map_or_else(|| data_dir.join("backups"), PathBuf::from);
        Ok(Self {
            readers,
            backup_dir,
            backup_keep: number(&lookup, "BACKUP_KEEP", 7)?,
            backup_interval_secs: number(&lookup, "BACKUP_INTERVAL_SECS", 86_400)?,
            ttl_sweep_secs: number(&lookup, "TTL_SWEEP_SECS", 0)?,
            #[cfg(feature = "s3-backup")]
            s3: S3Config::from_lookup(&lookup)?,
            data_dir,
        })
    }

    /// The database file inside the data directory.
    #[must_use]
    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("app.db")
    }
}

fn number<T: FromStr>(
    lookup: &impl Fn(&str) -> Option<String>,
    key: &str,
    default: T,
) -> Result<T, String> {
    match lookup(key) {
        None => Ok(default),
        Some(v) => v
            .parse()
            .map_err(|_| format!("{key} must be a non-negative number, got {v:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::DbConfig;

    #[test]
    fn defaults() {
        let c = DbConfig::from_lookup(|_| None).unwrap();
        assert_eq!(c.data_dir.to_str(), Some("/data"));
        assert_eq!(c.readers, 4);
        assert_eq!(c.backup_dir.to_str(), Some("/data/backups"));
        assert_eq!(c.backup_keep, 7);
        assert_eq!(c.backup_interval_secs, 86_400);
        assert_eq!(c.ttl_sweep_secs, 0);
        assert_eq!(c.db_path().to_str(), Some("/data/app.db"));
    }

    #[test]
    fn backup_dir_follows_data_dir() {
        let c = DbConfig::from_lookup(|k| (k == "DATA_DIR").then(|| "/v".to_owned())).unwrap();
        assert_eq!(c.backup_dir.to_str(), Some("/v/backups"));
    }

    #[test]
    fn bad_numbers_name_the_variable() {
        let err = DbConfig::from_lookup(|k| (k == "BACKUP_KEEP").then(|| "many".to_owned()));
        assert!(err.unwrap_err().contains("BACKUP_KEEP"));
        let err = DbConfig::from_lookup(|k| (k == "DB_READERS").then(|| "0".to_owned()));
        assert!(err.unwrap_err().contains("DB_READERS"));
    }
}
