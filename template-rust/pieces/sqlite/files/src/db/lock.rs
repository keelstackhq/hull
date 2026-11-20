//! An advisory lock on `$DATA_DIR/app.db.lock`: the running service holds it, so `--restore`
//! refuses to replace the database under a live process. The OS drops it when the process dies.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

/// The lock file next to the database.
pub fn lock_path(db_path: &Path) -> PathBuf {
    let mut name = db_path.as_os_str().to_owned();
    name.push(".lock");
    PathBuf::from(name)
}

/// Takes the lock for the database at `db_path`; keep the returned file open to hold it.
/// Fails at once, without waiting, when another process holds it.
pub fn acquire(db_path: &Path) -> Result<File, String> {
    let path = lock_path(db_path);
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(format!(
            "{} is locked: the service (or another --restore) is running on this data directory; \
             stop it first",
            path.display()
        )),
        Err(TryLockError::Error(e)) => Err(format!("cannot lock {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::acquire;
    use crate::db::testing::temp_dir;

    #[test]
    fn a_second_holder_is_refused_until_the_first_lets_go() {
        let db = temp_dir("lock").join("app.db");
        let first = acquire(&db).unwrap();
        let err = acquire(&db).unwrap_err();
        assert!(
            err.contains("app.db.lock") && err.contains("stop it"),
            "{err}"
        );
        drop(first);
        assert!(acquire(&db).is_ok());
    }
}
