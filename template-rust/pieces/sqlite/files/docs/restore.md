# Restore the database from a snapshot

The service snapshots its SQLite database every `BACKUP_INTERVAL_SECS` (default one day) into
`BACKUP_DIR` (default `$DATA_DIR/backups`) as `snapshot-<UTC time>.db`, keeping the newest
`BACKUP_KEEP` (default 7). The snapshot is a consistent `VACUUM INTO` copy that passed the
`scrub_pii` hook (`src/db/backup.rs`). A build with feature `s3-backup` also uploads each snapshot to
`backups/<name>` in the bucket named by `R2_BUCKET` at `R2_ENDPOINT`, signed with
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (region `auto`, override with `BACKUP_S3_REGION`).

## Restore

1. Stop the service. The restore replaces the file the running process holds open.
2. Put the snapshot on the data volume: pick a local one in `BACKUP_DIR`, or download one from the
   bucket (an off-site copy; the volume itself may be lost).
3. Run the binary once in restore mode, with the same `DATA_DIR`:

   ```sh
   ./<service> --restore /data/backups/snapshot-20260101T000000Z.db
   ```

   It runs `PRAGMA integrity_check` on the snapshot and refuses a corrupt one without touching the
   database. Otherwise it moves the old database to `app.db.pre-restore`, removes the WAL and shm
   files, puts the snapshot in place and exits.

4. Start the service. It applies any newer migrations at boot.
5. Delete `app.db.pre-restore` once you are sure; it holds the data you replaced.

Practise this on a copy before you need it.
