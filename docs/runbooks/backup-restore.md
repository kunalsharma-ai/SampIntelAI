# Backup and restore

## Backups

`scripts/backup.sh` takes a custom-format, zstd-compressed `pg_dump` as the owner role (`DATABASE_ADMIN_URL`; the app
role would only see what row-level security allows), writes a `.sha256` beside it and checks the archive lists.
Run it nightly and before every production deployment; keep 30 daily and 12 monthly copies in storage that the
database hosts cannot delete. Use the `pg_dump` that matches the server's major version (18); run it in the
`postgres:18` image when the host's client is older.

If the managed database offers point-in-time recovery, keep it on as well; the dumps are the portable copy.

## Restore

`scripts/restore.sh` only restores into a new, empty database and refuses anything else:

```
createdb sampintel_restore
TARGET_ADMIN_URL=postgres://owner@host/sampintel_restore scripts/restore.sh backups/sampintel-<stamp>.dump
```

It verifies the checksum, creates the `si_app` role if the cluster lacks it, restores, and prints row counts and the
number of tables with row-level security. Then run migrations (idempotent) and grant `si_app` to the login role.

## Drill

Quarterly, restore the latest nightly backup into a scratch database and compare counts with production.
Drill on 2026-11-26 (local Postgres 18.7): backup of 192 KB in 0.2 s; restore in 0.4 s; tenants 2/2, ai_projects
1/1, synthetic_sessions 21/21, audit_logs 1,811/1,811 matched the source; 24 tables with row-level security; a second
restore into the now non-empty database was refused.
