//! Every `CREATE TABLE` in `migrations/*.sql` must be `STRICT`.

use std::fs;
use std::path::Path;

#[test]
fn every_created_table_is_strict() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut bad = Vec::new();
    for entry in fs::read_dir(&dir).expect("migrations dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().is_none_or(|e| e != "sql") {
            continue;
        }
        let text = fs::read_to_string(&path).expect("read migration");
        // Drop `--` comments, then check each statement.
        let code: String = text
            .lines()
            .map(|l| l.split("--").next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        for stmt in code.split(';') {
            let upper = stmt.to_uppercase();
            if upper.contains("CREATE TABLE") && !upper.trim_end().ends_with("STRICT") {
                bad.push(format!("{}: {}", path.display(), stmt.trim()));
            }
        }
    }
    assert!(bad.is_empty(), "tables without STRICT:\n{}", bad.join("\n"));
}
