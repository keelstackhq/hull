//! Snapshots: `VACUUM INTO` a consistent copy, scrub it, keep the newest few, optionally upload.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection, SqlitePool};

use super::{Db, DbConfig};

const PREFIX: &str = "snapshot-";
const SUFFIX: &str = ".db";

/// Hook that runs on the snapshot (never the live database) before it is kept or uploaded.
/// Fill it in to blank or delete personal data that must not leave the service.
pub async fn scrub_pii(_conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    Ok(())
}

/// Seconds since the unix epoch.
pub fn unix_now() -> i64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    i64::try_from(secs).unwrap_or(i64::MAX)
}

/// The current UTC time as `YYYYMMDDTHHMMSSZ`: sorts by age and is the SigV4 date format.
pub fn utc_stamp() -> String {
    stamp_at(unix_now())
}

/// Formats unix seconds as `YYYYMMDDTHHMMSSZ` (UTC).
pub fn stamp_at(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Writes a snapshot named for the current time into `dir` and prunes to the newest `keep`.
pub async fn snapshot(readers: &SqlitePool, dir: &Path, keep: usize) -> Result<PathBuf, String> {
    snapshot_at(readers, dir, keep, &utc_stamp()).await
}

/// Like [`snapshot`] with an explicit stamp in the file name.
pub async fn snapshot_at(
    readers: &SqlitePool,
    dir: &Path,
    keep: usize,
    stamp: &str,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let target = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));
    // Written under a temp name and renamed, so a listed snapshot is always complete.
    let partial = dir.join(format!("{PREFIX}{stamp}{SUFFIX}.partial"));
    let _ = std::fs::remove_file(&partial);
    let path = partial.to_str().ok_or("backup path is not UTF-8")?;
    sqlx::query("VACUUM INTO ?")
        .bind(path)
        .execute(readers)
        .await
        .map_err(|e| format!("snapshot failed: {e}"))?;
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&partial)
            .pragma("secure_delete", "ON"),
    )
    .await
    .map_err(|e| format!("cannot open snapshot: {e}"))?;
    let scrubbed = scrub_pii(&mut conn).await;
    let closed = conn.close().await;
    scrubbed.map_err(|e| format!("scrub_pii failed: {e}"))?;
    closed.map_err(|e| format!("cannot close snapshot: {e}"))?;
    std::fs::rename(&partial, &target).map_err(|e| format!("cannot finish snapshot: {e}"))?;
    prune(dir, keep)?;
    Ok(target)
}

/// Snapshot files in `dir`, oldest first.
pub fn list(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(SUFFIX))
        })
        .collect();
    found.sort();
    Ok(found)
}

fn prune(dir: &Path, keep: usize) -> Result<(), String> {
    let all = list(dir)?;
    let excess = all.len().saturating_sub(keep);
    for old in &all[..excess] {
        std::fs::remove_file(old).map_err(|e| format!("cannot remove {}: {e}", old.display()))?;
    }
    Ok(())
}

/// Starts the periodic snapshot loop unless `BACKUP_INTERVAL_SECS` is 0.
pub fn spawn(db: &Db, config: &DbConfig) {
    if config.backup_interval_secs == 0 {
        return;
    }
    let readers = db.readers.clone();
    let config = config.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(config.backup_interval_secs));
        // The first tick fires at once; skip it so a restart loop does not snapshot every boot.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match snapshot(&readers, &config.backup_dir, config.backup_keep).await {
                Ok(path) => {
                    eprintln!("backup written: {}", path.display());
                    #[cfg(feature = "s3-backup")]
                    if let Some(s3) = &config.s3 {
                        match super::s3::upload(s3, &path).await {
                            Ok(()) => eprintln!("backup uploaded"),
                            Err(e) => eprintln!("backup upload failed: {e}"),
                        }
                    }
                }
                Err(e) => eprintln!("backup failed: {e}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{list, snapshot_at, stamp_at};
    use crate::db::Db;
    use crate::db::testing::temp_dir;

    #[test]
    fn stamps_are_utc_and_sortable() {
        assert_eq!(stamp_at(0), "19700101T000000Z");
        assert_eq!(stamp_at(1_369_353_600), "20130524T000000Z");
        assert_eq!(stamp_at(951_782_399), "20000228T235959Z");
        assert_eq!(stamp_at(951_782_400), "20000229T000000Z");
    }

    #[tokio::test]
    async fn snapshots_hold_the_data_and_only_the_newest_are_kept() {
        let dir = temp_dir("backup");
        let db = Db::open_at(&dir.join("app.db"), &dir, 1).await.unwrap();
        sqlx::query("INSERT INTO items (name) VALUES ('kept')")
            .execute(&db.writer)
            .await
            .unwrap();
        let out = dir.join("backups");
        for stamp in ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z"] {
            snapshot_at(&db.readers, &out, 2, stamp).await.unwrap();
        }
        let names: Vec<String> = list(&out)
            .unwrap()
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            [
                "snapshot-20260102T000000Z.db",
                "snapshot-20260103T000000Z.db"
            ]
        );
        let copy = Db::open_at(&out.join(&names[1]), &dir, 1).await;
        // A snapshot is a normal database: opening it (read-write) and counting works.
        let copy = copy.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE name = 'kept'")
            .fetch_one(&copy.readers)
            .await
            .unwrap();
        assert_eq!(n, 1);
    }
}
