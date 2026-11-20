//! One writer connection and a pool of read-only connections, with durable pragmas.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

use super::config::DbConfig;

/// Applies every migration in `migrations/` (embedded at compile time).
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The database: `writer` has one connection (SQLite allows one writer at a time, so writes queue
/// here instead of failing with "database is locked"); `readers` is read-only.
#[derive(Debug, Clone)]
pub struct Db {
    pub writer: SqlitePool,
    pub readers: SqlitePool,
    pub path: PathBuf,
}

impl Db {
    /// Opens both pools (creating the file) and runs migrations on the writer.
    pub async fn open(config: &DbConfig) -> Result<Self, String> {
        std::fs::create_dir_all(&config.data_dir)
            .map_err(|e| format!("cannot create {}: {e}", config.data_dir.display()))?;
        check_writable(&config.data_dir)?;
        Self::open_at(&config.db_path(), &config.data_dir, config.readers).await
    }

    /// Opens the database at `path`; `tmp_dir` receives SQLite's temporary files.
    pub async fn open_at(path: &Path, tmp_dir: &Path, readers: u32) -> Result<Self, String> {
        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options(path, tmp_dir).create_if_missing(true))
            .await
            .map_err(|e| format!("cannot open database {}: {e}", path.display()))?;
        MIGRATOR
            .run(&writer)
            .await
            .map_err(|e| format!("migration failed: {e}"))?;
        let readers = SqlitePoolOptions::new()
            .max_connections(readers)
            .connect_with(options(path, tmp_dir).read_only(true))
            .await
            .map_err(|e| format!("cannot open read pool: {e}"))?;
        Ok(Self {
            writer,
            readers,
            path: path.to_owned(),
        })
    }

    /// Closes both pools, so the last connection checkpoints the WAL.
    pub async fn close(&self) {
        self.readers.close().await;
        self.writer.close().await;
    }
}

/// Fails early, with the fix, when the data directory is not writable (a Fly volume can mount
/// root-owned while the image runs as uid 65532).
fn check_writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(".write-check");
    std::fs::File::create(&probe).map_err(|e| not_writable_message(dir, &e))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn not_writable_message(dir: &Path, err: &std::io::Error) -> String {
    format!(
        "DATA_DIR {} is not writable ({err}); the service runs as uid 65532, so the volume must be \
         owned by it: see docs/fly.md (Volume ownership)",
        dir.display()
    )
}

/// Connection options with the pragmas every connection needs. The temp directory is set with a
/// pragma because `SQLITE_TMPDIR` would need `set_var`, which is unsafe (the workspace forbids it).
pub fn options(path: &Path, tmp_dir: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        // WAL: readers never block the writer and a crash cannot corrupt the file.
        .journal_mode(SqliteJournalMode::Wal)
        // FULL: every commit is fsynced, so an acknowledged write survives power loss.
        .synchronous(SqliteSynchronous::Full)
        // ON: SQLite does not enforce foreign keys unless asked, per connection.
        .foreign_keys(true)
        // 5 s: wait for a lock (checkpoint, backup) instead of failing at once.
        .busy_timeout(Duration::from_secs(5))
        // ON: deleted content is overwritten with zeros, so it cannot leak from free pages.
        .pragma("secure_delete", "ON")
        // The data volume, not a small /tmp: sorts and VACUUM INTO spill there.
        .pragma(
            "temp_store_directory",
            format!("'{}'", tmp_dir.display().to_string().replace('\'', "''")),
        )
}

#[cfg(test)]
mod tests {
    use super::{Db, MIGRATOR, not_writable_message};
    use crate::db::testing::temp_dir;

    async fn pragma(pool: &sqlx::SqlitePool, name: &str) -> String {
        // Fixed pragma names from this file only.
        let sql = format!("SELECT CAST({name} AS TEXT) FROM pragma_{name}");
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn not_writable_message_names_dir_uid_and_doc() {
        let err = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let m = not_writable_message(std::path::Path::new("/data"), &err);
        assert!(m.contains("DATA_DIR /data"));
        assert!(m.contains("65532"));
        assert!(m.contains("docs/fly.md (Volume ownership)"));
    }

    #[tokio::test]
    async fn open_applies_pragmas_and_migrations() {
        let dir = temp_dir("pool");
        let db = Db::open_at(&dir.join("app.db"), &dir, 2).await.unwrap();
        assert_eq!(pragma(&db.writer, "journal_mode").await, "wal");
        assert_eq!(pragma(&db.writer, "synchronous").await, "2");
        assert_eq!(pragma(&db.writer, "foreign_keys").await, "1");
        assert_eq!(pragma(&db.writer, "secure_delete").await, "1");
        let applied: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&db.writer)
            .await
            .unwrap();
        assert_eq!(applied.0 as usize, MIGRATOR.iter().count());
        db.close().await;
    }

    #[tokio::test]
    async fn readers_cannot_write() {
        let dir = temp_dir("readonly");
        let db = Db::open_at(&dir.join("app.db"), &dir, 2).await.unwrap();
        let attempt = sqlx::query("INSERT INTO items (name) VALUES ('x')")
            .execute(&db.readers)
            .await;
        assert!(attempt.is_err());
        db.close().await;
    }

    #[tokio::test]
    async fn migrations_apply_to_an_empty_database() {
        let dir = temp_dir("empty");
        let pool =
            sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", dir.join("e.db").display()))
                .await
                .unwrap();
        MIGRATOR.run(&pool).await.unwrap();
        pool.close().await;
    }
}
