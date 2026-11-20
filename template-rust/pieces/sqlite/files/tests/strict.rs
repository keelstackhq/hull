//! Every `CREATE TABLE` in `migrations/*.sql` must be `STRICT`.

use std::fs;
use std::path::Path;

/// Removes `--` line comments and `/* */` block comments.
fn strip_comments(sql: &str) -> String {
    let mut out = String::new();
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, chars.peek()) {
            ('-', Some('-')) => {
                for n in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut prev = ' ';
                for n in chars.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    prev = n;
                }
                out.push(' ');
            }
            _ => out.push(c),
        }
    }
    out
}

/// The `CREATE [TEMP] TABLE` statements in `sql` that lack `STRICT` among their table options
/// (`) STRICT`, `) STRICT, WITHOUT ROWID`, ...). `CREATE VIRTUAL TABLE` is not checked.
fn non_strict_tables(sql: &str) -> Vec<String> {
    let mut bad = Vec::new();
    for stmt in strip_comments(sql).split(';') {
        let stmt = stmt.split_whitespace().collect::<Vec<_>>().join(" ");
        let upper = stmt.to_uppercase();
        let creates_table = [
            "CREATE TABLE ",
            "CREATE TEMP TABLE ",
            "CREATE TEMPORARY TABLE ",
        ]
        .iter()
        .any(|p| upper.starts_with(p));
        if !creates_table {
            continue;
        }
        let options = upper.rfind(')').map_or("", |i| &upper[i + 1..]);
        if !options.split(',').any(|o| o.trim() == "STRICT") {
            bad.push(stmt);
        }
    }
    bad
}

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
        for stmt in non_strict_tables(&text) {
            bad.push(format!("{}: {stmt}", path.display()));
        }
    }
    assert!(bad.is_empty(), "tables without STRICT:\n{}", bad.join("\n"));
}

#[test]
fn strict_tables_pass() {
    assert!(non_strict_tables("CREATE TABLE a (x INTEGER) STRICT;").is_empty());
    assert!(non_strict_tables("create\n  table a (x INTEGER)\n  strict").is_empty());
    assert!(non_strict_tables("CREATE TABLE a (x INTEGER) STRICT, WITHOUT ROWID;").is_empty());
    assert!(non_strict_tables("CREATE TEMP TABLE a (x INTEGER) WITHOUT ROWID, STRICT;").is_empty());
    assert!(non_strict_tables("CREATE VIRTUAL TABLE t USING fts5(body);").is_empty());
}

#[test]
fn loose_tables_are_found() {
    assert_eq!(non_strict_tables("CREATE TABLE a (x INTEGER);").len(), 1);
    assert_eq!(
        non_strict_tables("CREATE TABLE a (x INTEGER) WITHOUT ROWID;").len(),
        1
    );
    assert_eq!(non_strict_tables("CREATE TEMPORARY TABLE a (x);").len(), 1);
    assert_eq!(non_strict_tables("create   table\na (x);").len(), 1);
    assert_eq!(
        non_strict_tables("CREATE TABLE a (x INTEGER); CREATE TABLE b (y) STRICT;").len(),
        1
    );
}

#[test]
fn comments_neither_hide_nor_fake_a_table() {
    // a STRICT in a comment does not count
    assert_eq!(
        non_strict_tables("CREATE TABLE a (x) -- STRICT\n;").len(),
        1
    );
    assert_eq!(
        non_strict_tables("CREATE TABLE a (x) /* STRICT */;").len(),
        1
    );
    // a commented-out table is not a table
    assert!(non_strict_tables("-- CREATE TABLE a (x);\n/* CREATE TABLE b (y); */").is_empty());
    assert!(non_strict_tables("CREATE TABLE a (x) /* note */ STRICT -- done\n;").is_empty());
}
