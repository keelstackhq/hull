# Restore the database from a snapshot

The service snapshots its SQLite database every `BACKUP_INTERVAL_SECS` (default one day) into
`BACKUP_DIR` (default `$DATA_DIR/backups`) as `snapshot-<UTC time>.db`, keeping the newest
`BACKUP_KEEP` (default 7). The snapshot is a consistent `VACUUM INTO` copy that passed the
`scrub_pii` hook (`src/db/backup.rs`). A build with feature `s3-backup` also uploads each snapshot to
`backups/<name>` in the bucket named by `R2_BUCKET` at `R2_ENDPOINT`, signed with
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (region `auto`, override with `BACKUP_S3_REGION`).

The upload reads the whole snapshot into memory and gives up after `BACKUP_S3_TIMEOUT_SECS`
(default 300), logging the error and trying again at the next interval. That is fine up to a few
hundred MB; for a bigger database, replace it with a streamed multipart upload in `src/db/s3.rs`.

## Restore

1. Stop the service. The running service holds a lock on `$DATA_DIR/app.db.lock`; `--restore`
   refuses with an error while that lock is held.
2. Put the snapshot on the data volume: pick a local one in `BACKUP_DIR`, or download one from the
   bucket (an off-site copy; the volume itself may be lost).
3. Run the binary once in restore mode, with the same `DATA_DIR`:

   ```sh
   ./<service> --restore /data/backups/snapshot-20260101T000000Z.db
   ```

   It runs `PRAGMA integrity_check` on the snapshot and refuses a corrupt one without touching the
   database. Otherwise it moves the old database to `app.db.pre-restore` (and its WAL and shm files
   to `app.db.pre-restore-wal` / `-shm`), puts the snapshot in place and exits. It refuses to run
   while a `app.db.pre-restore*` file from an earlier restore exists: move it away first.

4. Start the service. It applies any newer migrations at boot.
5. Delete the `app.db.pre-restore*` files once you are sure; they hold the data you replaced.

On Fly, stop the machine and run the restore in a one-off machine on the same volume: see
`docs/fly.md`, "Restore on Fly".

Practise this on a copy before you need it.
