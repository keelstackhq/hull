//! Optional TTL sweeper: deletes rows whose `expires_at` (unix seconds) has passed.

use std::time::Duration;

use sqlx::SqlitePool;

use super::{Db, DbConfig};

/// Deletes expired `items` rows; returns how many. Add your own tables here.
pub async fn sweep_once(writer: &SqlitePool, now: i64) -> Result<u64, sqlx::Error> {
    let done = sqlx::query("DELETE FROM items WHERE expires_at IS NOT NULL AND expires_at <= ?")
        .bind(now)
        .execute(writer)
        .await?;
    Ok(done.rows_affected())
}

/// Starts the sweep loop unless `TTL_SWEEP_SECS` is 0.
pub fn spawn(db: &Db, config: &DbConfig) {
    if config.ttl_sweep_secs == 0 {
        return;
    }
    let writer = db.writer.clone();
    let every = Duration::from_secs(config.ttl_sweep_secs);
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(every);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(e) = sweep_once(&writer, super::backup::unix_now()).await {
                eprintln!("ttl sweep failed: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::sweep_once;
    use crate::db::Db;
    use crate::db::testing::temp_dir;

    #[tokio::test]
    async fn only_expired_rows_are_deleted() {
        let dir = temp_dir("sweep");
        let db = Db::open_at(&dir.join("app.db"), &dir, 1).await.unwrap();
        for (name, expires) in [
            ("old", Some(10_i64)),
            ("new", Some(1000)),
            ("forever", None),
        ] {
            sqlx::query("INSERT INTO items (name, expires_at) VALUES (?, ?)")
                .bind(name)
                .bind(expires)
                .execute(&db.writer)
                .await
                .unwrap();
        }
        assert_eq!(sweep_once(&db.writer, 500).await.unwrap(), 1);
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&db.writer)
            .await
            .unwrap();
        assert_eq!(left, 2);
    }
}
