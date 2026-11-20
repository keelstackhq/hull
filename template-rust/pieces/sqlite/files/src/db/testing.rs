//! Test helpers: a temp directory and a guard that GET requests never write.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use sqlx::{Connection, SqliteConnection};
use tower::ServiceExt;

use super::pool::{Db, options};

/// A new empty directory under the system temp dir (left behind; the OS cleans temp).
pub fn temp_dir(label: &str) -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "svc-{label}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Panics if a GET to any of `paths` changes `PRAGMA data_version` as seen from a separate
/// connection (the value moves when another connection commits). Use it on every read route.
/// Also panics on 404, 405 or 5xx: a wrong path or a failing handler would pass trivially.
pub async fn assert_get_never_writes(router: Router, db: &Db, paths: &[&str]) {
    let mut observer = SqliteConnection::connect_with(&options(&db.path).read_only(true))
        .await
        .expect("observer connection");
    for path in paths {
        let before = data_version(&mut observer).await;
        let request = Request::get(*path).body(Body::empty()).unwrap();
        let status = router.clone().oneshot(request).await.unwrap().status();
        assert!(
            status != StatusCode::NOT_FOUND && status != StatusCode::METHOD_NOT_ALLOWED,
            "GET {path} returned {status}: is the path right?"
        );
        assert!(!status.is_server_error(), "GET {path} returned {status}");
        let after = data_version(&mut observer).await;
        assert_eq!(before, after, "GET {path} wrote to the database");
    }
}

async fn data_version(conn: &mut SqliteConnection) -> i64 {
    sqlx::query_scalar("SELECT data_version FROM pragma_data_version")
        .fetch_one(conn)
        .await
        .expect("data_version")
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::extract::State;
    use axum::routing::get;
    use sqlx::SqlitePool;

    use super::{assert_get_never_writes, temp_dir};
    use crate::db::Db;

    async fn read(State(pool): State<SqlitePool>) -> String {
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&pool)
            .await
            .unwrap();
        n.to_string()
    }

    async fn sneaky_write(State(pool): State<SqlitePool>) -> &'static str {
        sqlx::query("INSERT INTO items (name) VALUES ('from a GET')")
            .execute(&pool)
            .await
            .unwrap();
        "ok"
    }

    async fn open() -> Db {
        let dir = temp_dir("get-guard");
        Db::open_at(&dir.join("app.db"), &dir, 1).await.unwrap()
    }

    #[tokio::test]
    async fn a_reading_get_passes() {
        let db = open().await;
        let router = Router::new()
            .route("/items", get(read))
            .with_state(db.readers.clone());
        assert_get_never_writes(router, &db, &["/items"]).await;
    }

    async fn broken() -> axum::http::StatusCode {
        axum::http::StatusCode::INTERNAL_SERVER_ERROR
    }

    #[tokio::test]
    #[should_panic(expected = "returned 404")]
    async fn a_wrong_path_is_caught() {
        let db = open().await;
        let router = Router::new()
            .route("/items", get(read))
            .with_state(db.readers.clone());
        assert_get_never_writes(router, &db, &["/itemz"]).await;
    }

    #[tokio::test]
    #[should_panic(expected = "returned 500")]
    async fn a_failing_handler_is_caught() {
        let db = open().await;
        let router = Router::new().route("/broken", get(broken));
        assert_get_never_writes(router, &db, &["/broken"]).await;
    }

    #[tokio::test]
    #[should_panic(expected = "wrote to the database")]
    async fn a_writing_get_is_caught() {
        let db = open().await;
        let router = Router::new()
            .route("/bad", get(sneaky_write))
            .with_state(db.writer.clone());
        assert_get_never_writes(router, &db, &["/bad"]).await;
    }
}
