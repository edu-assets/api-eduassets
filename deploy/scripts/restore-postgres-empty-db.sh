#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL to a newly created, disposable, empty target database}"
: "${BACKUP_FILE:?Set BACKUP_FILE to the selected custom-format backup}"
if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_TO_EMPTY_DATABASE" ]]; then
  echo 'Refusing restore. Set RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE after verifying the target is disposable and empty.' >&2
  exit 2
fi
[[ -r "$BACKUP_FILE" ]] || { echo 'Backup file is not readable.' >&2; exit 2; }
command -v psql >/dev/null && command -v pg_restore >/dev/null || { echo 'Install PostgreSQL client tools first.' >&2; exit 2; }
# Deliberately never uses --clean/--if-exists. The restore is restricted to an empty DB.
objects="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f');")"
[[ "$objects" == "0" ]] || { echo 'Refusing restore: target database contains user objects.' >&2; exit 2; }
pg_restore --exit-on-error --no-owner --no-acl --dbname="$DATABASE_URL" "$BACKUP_FILE"
echo 'Restore completed into the verified empty target database.'
