#!/usr/bin/env bash
# Restore a backup into a NEW, EMPTY database, then check it. Never restores over a live database.
# Usage: TARGET_ADMIN_URL=postgres://.../sampintel_restore scripts/restore.sh backups/sampintel-....dump
# After the restore, re-run migrations (they are idempotent) and grant si_app to the login role.
set -euo pipefail
: "${TARGET_ADMIN_URL:?set TARGET_ADMIN_URL to an empty database}"
file="${1:?path to a .dump file}"
sha256sum --check "$file.sha256"
tables="$(psql "$TARGET_ADMIN_URL" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$tables" != "0" ]; then
  echo "refusing: target database already has $tables tables; restore into an empty database" >&2
  exit 1
fi
# Roles are cluster-wide and not in the dump; the restore needs si_app to exist for the RLS policies.
psql "$TARGET_ADMIN_URL" -qc "do \$\$ begin if not exists (select from pg_roles where rolname = 'si_app') then create role si_app nologin; end if; end \$\$"
pg_restore --exit-on-error --no-owner --dbname="$TARGET_ADMIN_URL" "$file"
psql "$TARGET_ADMIN_URL" -At <<'SQL'
select 'tenants=' || count(*) from tenants;
select 'ai_projects=' || count(*) from ai_projects;
select 'synthetic_sessions=' || count(*) from synthetic_sessions;
select 'audit_logs=' || count(*) from audit_logs;
select 'rls_tables=' || count(*) from pg_tables where schemaname = 'public' and rowsecurity;
SQL
echo "restore ok into $(psql "$TARGET_ADMIN_URL" -Atc 'select current_database()')"
