//! `--restore <snapshot>`: replace the database with a snapshot, then exit.
//!
//! Run it with the service stopped (see `docs/restore.md`): it takes the service's data-directory
//! lock and refuses while a service holds it.

use std::path::{Path, PathBuf};

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

/// Validates `snapshot` with `PRAGMA integrity_check`, then replaces the database at `db_path`.
/// The old file is kept next to it as `<name>.pre-restore`, its WAL and shm files as
/// `<name>.pre-restore-wal` and `-shm`; nothing is deleted. Refuses when a `.pre-restore*` file
/// from an earlier restore is still there.
pub async fn restore(snapshot: &Path, db_path: &Path) -> Result<(), String> {
    if let Some(dir) = db_path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let _lock = super::lock::acquire(db_path)?;
    check(snapshot).await?;
    for ext in PRE_RESTORE {
        let old = suffixed(db_path, ext);
        if old.exists() {
            return Err(format!(
                "{} exists from an earlier restore; move or delete it first",
                old.display()
            ));
        }
    }
    let tmp = suffixed(db_path, ".restoring");
    std::fs::copy(snapshot, &tmp)
        .map_err(|e| format!("cannot copy {}: {e}", snapshot.display()))?;
    for (live, kept) in [
        ("", ".pre-restore"),
        ("-wal", ".pre-restore-wal"),
        ("-shm", ".pre-restore-shm"),
    ] {
        let live = suffixed(db_path, live);
        if live.exists() {
            std::fs::rename(&live, suffixed(db_path, kept))
                .map_err(|e| format!("cannot move {} aside: {e}", live.display()))?;
        }
    }
    std::fs::rename(&tmp, db_path).map_err(|e| format!("cannot put the snapshot in place: {e}"))?;
    eprintln!("restored {} from {}", db_path.display(), snapshot.display());
    Ok(())
}

const PRE_RESTORE: [&str; 3] = [".pre-restore", ".pre-restore-wal", ".pre-restore-shm"];

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
    async fn the_old_wal_and_shm_are_kept_not_deleted() {
        let dir = temp_dir("restore-wal");
        let path = dir.join("app.db");
        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        let snap = snapshot_at(&db.readers, &dir.join("b"), 3, "20260101T000000Z")
            .await
            .unwrap();
        db.close().await;
        std::fs::write(dir.join("app.db-wal"), b"wal").unwrap();
        std::fs::write(dir.join("app.db-shm"), b"shm").unwrap();

        restore(&snap, &path).await.unwrap();

        assert_eq!(
            std::fs::read(dir.join("app.db.pre-restore-wal")).unwrap(),
            b"wal"
        );
        assert_eq!(
            std::fs::read(dir.join("app.db.pre-restore-shm")).unwrap(),
            b"shm"
        );
        assert!(!dir.join("app.db-wal").exists());
    }

    #[tokio::test]
    async fn an_earlier_pre_restore_file_blocks_the_restore() {
        let dir = temp_dir("restore-twice");
        let path = dir.join("app.db");
        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        let snap = snapshot_at(&db.readers, &dir.join("b"), 3, "20260101T000000Z")
            .await
            .unwrap();
        db.close().await;
        std::fs::write(dir.join("app.db.pre-restore"), b"precious").unwrap();

        let err = restore(&snap, &path).await.unwrap_err();

        assert!(
            err.contains("app.db.pre-restore") && err.contains("move or delete"),
            "{err}"
        );
        assert_eq!(
            std::fs::read(dir.join("app.db.pre-restore")).unwrap(),
            b"precious"
        );
        assert!(path.exists());
    }

    #[tokio::test]
    async fn a_running_service_blocks_the_restore() {
        let dir = temp_dir("restore-locked");
        let path = dir.join("app.db");
        let db = Db::open_at(&path, &dir, 1).await.unwrap();
        let snap = snapshot_at(&db.readers, &dir.join("b"), 3, "20260101T000000Z")
            .await
            .unwrap();
        db.close().await;
        let _running = crate::db::lock::acquire(&path).unwrap();

        let err = restore(&snap, &path).await.unwrap_err();

        assert!(err.contains("locked"), "{err}");
        assert!(!dir.join("app.db.pre-restore").exists());
    }

    #[tokio::test]
    async fn an_open_db_holds_the_lock_until_it_is_dropped() {
        let other = temp_dir("restore-src");
        let src = Db::open_at(&other.join("app.db"), &other, 1).await.unwrap();
        let snap = snapshot_at(&src.readers, &other.join("b"), 3, "20260101T000000Z")
            .await
            .unwrap();
        src.close().await;
        let dir = temp_dir("restore-open");
        let data = dir.to_str().unwrap().to_owned();
        let config =
            crate::db::DbConfig::from_lookup(|k| (k == "DATA_DIR").then(|| data.clone())).unwrap();
        let db = Db::open(&config).await.unwrap();

        let err = restore(&snap, &config.db_path()).await.unwrap_err();
        assert!(err.contains("locked"), "{err}");

        db.close().await;
        drop(db);
        restore(&snap, &config.db_path()).await.unwrap();
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
