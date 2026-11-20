# Adding sqlite to an existing rust-service

`splice add sqlite` writes `src/db/**`, `migrations/**` and `tests/strict.rs`, but `src/main.rs` is
a seed file of rust-service and is not re-rendered. Wire it by hand in
`crates/<service>/src/main.rs`.

Add next to the other `mod` lines:

```rust
mod db;
```

In `run()`, after `let config = Config::from_env()?;` and before binding the listener:

```rust
    let db_config = db::DbConfig::from_env()?;
    if let Some(snapshot) = db::restore_snapshot_arg() {
        return db::restore::restore(&snapshot, &db_config.db_path()).await;
    }
    let db = db::Db::open(&db_config).await?;
    db::backup::spawn(&db, &db_config);
    db::sweeper::spawn(&db, &db_config);
```

Then pass `db.readers` / `db.writer` to your routes. See `docs/restore.md` for backups and
`--restore`.
