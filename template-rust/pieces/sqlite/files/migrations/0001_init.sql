-- STRICT tables only (tests/strict.rs enforces it): SQLite then rejects values of the wrong type.
CREATE TABLE items (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    expires_at INTEGER
) STRICT;
