//! `--restore <snapshot>`: replace the database with a snapshot, then exit.
//!
//! Run it with the service stopped (see `docs/restore.md`): the live process holds the file open.

use std::path::{Path, PathBuf};

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

/// Validates `snapshot` with `PRAGMA integrity_check`, then replaces the database at `db_path`.
/// The old file is kept next to it as `<name>.pre-restore`; its WAL and shm files are removed.
pub async fn restore(snapshot: &Path, db_path: &Path) -> Result<(), String> {
    check(snapshot).await?;
    let tmp = suffixed(db_path, ".restoring");
    std::fs::copy(snapshot, &tmp)
        .map_err(|e| format!("cannot copy {}: {e}", snapshot.display()))?;
    if db_path.exists() {
        std::fs::rename(db_path, suffixed(db_path, ".pre-restore"))
            .map_err(|e| format!("cannot move the old database aside: {e}"))?;
    }
    for ext in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(suffixed(db_path, ext));
    }
    std::fs::rename(&tmp, db_path).map_err(|e| format!("cannot put the snapshot in place: {e}"))?;
    eprintln!("restored {} from {}", db_path.display(), snapshot.display());
    Ok(())
}

async fn check(snapshot: &Path) -> Result<(), String> {
    if !snapshot.is_file() {
        return Err(format!("snapshot {} not found", snapshot.display()));
    }
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(snapshot)
            .read_only(true),
    )
    .await
    .map_err(|e| format!("{} is not a SQLite database: {e}", snapshot.display()))?;
    let rows: Result<Vec<String>, _> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut conn)
        .await;
    let _ = conn.close().await;
    let rows = rows.map_err(|e| format!("{} is not a SQLite database: {e}", snapshot.display()))?;
    if rows == ["ok"] {
        Ok(())
    } else {
        Err(format!(
            "integrity_check failed for {}: {}",
            snapshot.display(),
            rows.join("; ")
        ))
    }
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::restore;
    use crate::db::Db;
    use crate::db::backup::snapshot_at;
    use crate::db::testing::temp_dir;

    #[tokio::test]
    async fn restore_replaces_the_database_with_the_snapshot() {
        let dir = temp_dir("restore");
        let path = dir.join("app.db");
        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        sqlx::query("INSERT INTO items (name) VALUES ('before')")
            .execute(&db.writer)
            .await
            .unwrap();
        let snap = snapshot_at(&db.readers, &dir.join("b"), 3, "20260101T000000Z")
            .await
            .unwrap();
        sqlx::query("INSERT INTO items (name) VALUES ('after')")
            .execute(&db.writer)
            .await
            .unwrap();
        db.close().await;

        restore(&snap, &path).await.unwrap();

        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        let names: Vec<String> = sqlx::query_scalar("SELECT name FROM items ORDER BY id")
            .fetch_all(&db.readers)
            .await
            .unwrap();
        assert_eq!(names, ["before"]);
        assert!(dir.join("app.db.pre-restore").exists());
    }

    #[tokio::test]
    async fn a_corrupt_snapshot_is_refused_and_the_database_untouched() {
        let dir = temp_dir("restore-bad");
        let path = dir.join("app.db");
        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        db.close().await;
        let bad = dir.join("bad.db");
        std::fs::write(&bad, vec![7_u8; 8192]).unwrap();
        let err = restore(&bad, &path).await.unwrap_err();
        assert!(err.contains("bad.db"), "{err}");
        assert!(path.exists());
        assert!(!dir.join("app.db.pre-restore").exists());
    }
}
