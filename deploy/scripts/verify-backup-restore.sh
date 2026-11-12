#!/usr/bin/env bash
# Restore drill for eduAssets backups. Proves that an encrypted backup can actually be recovered.
#
# Runs on a trusted operator machine that holds the age PRIVATE identity (never the VM): it decrypts a
# backup, restores it into a throwaway PostgreSQL container bound to 127.0.0.1, checks the schema and
# row counts, prints a report and destroys the container and the plaintext dump on exit.
# It never connects to the production database.
#
# Required: docker, age; rclone too when BACKUP_FILE is not given (the newest remote object is fetched).
#   AGE_IDENTITY=/secure/age-identity.txt   (mode 0600)
#   BACKUP_FILE=/path/eduassets-YYYYMMDDTHHMMSSZ.dump.age   or   RCLONE_SOURCE=remote:path
# Optional:
#   PG_IMAGE=postgres:18            server major must be >= the pg_dump major used for the backup
#   EXPECTED_MIGRATION=<name>       fail if the newest applied Prisma migration differs
#   MIN_USUARIOS=1                  fail if fewer user rows are restored
set -Eeuo pipefail
umask 077

# Git Bash on Windows: stop MSYS from rewriting container-side paths (e.g. /tmp/database.dump)
# and convert host paths explicitly before handing them to native tools (docker, age, rclone).
export MSYS_NO_PATHCONV=1
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w -- "$1"; else printf '%s\n' "$1"; fi; }

: "${AGE_IDENTITY:?Set AGE_IDENTITY to the age private identity file (mode 0600)}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
MIN_USUARIOS="${MIN_USUARIOS:-1}"

[[ -f "$AGE_IDENTITY" && -r "$AGE_IDENTITY" ]] || { echo 'AGE_IDENTITY must be a readable regular file.' >&2; exit 2; }
if [[ "$(uname -s)" == Linux* || "$(uname -s)" == Darwin* ]]; then
  mode="$(stat -c '%a' -- "$AGE_IDENTITY" 2>/dev/null || stat -f '%Lp' -- "$AGE_IDENTITY")"
  [[ "$mode" == 600 || "$mode" == 400 ]] || { echo 'AGE_IDENTITY must have mode 0600 or 0400.' >&2; exit 2; }
fi
for tool in docker age; do command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 2; }; done

workdir="$(mktemp -d "${TMPDIR:-/tmp}/eduassets-drill.XXXXXX")"
container="eduassets-restore-drill-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$workdir"
}
trap cleanup EXIT
chmod 700 "$workdir"

# --- 1. obtain the encrypted backup ---
if [[ -z "${BACKUP_FILE:-}" ]]; then
  : "${RCLONE_SOURCE:?Set BACKUP_FILE or RCLONE_SOURCE}"
  command -v rclone >/dev/null || { echo 'rclone is required when BACKUP_FILE is not set.' >&2; exit 2; }
  newest="$(rclone lsf --files-only --include 'eduassets-*.dump.age' "${RCLONE_SOURCE%/}" | sort | tail -n1)"
  [[ -n "$newest" ]] || { echo 'No eduassets-*.dump.age object found at RCLONE_SOURCE.' >&2; exit 1; }
  rclone copyto "${RCLONE_SOURCE%/}/$newest" "$(host_path "$workdir/$newest")"
  BACKUP_FILE="$workdir/$newest"
fi
[[ -r "$BACKUP_FILE" ]] || { echo 'Encrypted backup file is not readable.' >&2; exit 2; }
backup_name="$(basename -- "$BACKUP_FILE")"
echo "Backup under test: $backup_name ($(wc -c < "$BACKUP_FILE") bytes)"

# --- 2. decrypt locally (plaintext stays inside the private workdir) ---
dump="$workdir/database.dump"
age --decrypt --identity "$(host_path "$AGE_IDENTITY")" --output "$(host_path "$dump")" "$(host_path "$BACKUP_FILE")"
chmod 600 "$dump"

# --- 3. throwaway PostgreSQL, loopback only, random password ---
pg_password="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
docker run -d --name "$container" -e POSTGRES_PASSWORD="$pg_password" -e POSTGRES_DB=restore_drill \
  -p 127.0.0.1::5432 "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U postgres -d restore_drill >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d restore_drill >/dev/null || { echo 'Disposable PostgreSQL did not start.' >&2; exit 1; }

# --- 4. restore ---
docker cp "$(host_path "$dump")" "$container:/tmp/database.dump"
docker exec "$container" pg_restore --exit-on-error --no-owner --no-acl -U postgres -d restore_drill /tmp/database.dump

psql_q() { docker exec "$container" psql -U postgres -d restore_drill -X -A -t -v ON_ERROR_STOP=1 -c "$1" | tr -d '\r'; }

# --- 5. verify ---
problems=0
latest_migration="$(psql_q "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1;")" \
  || { echo 'FAIL  _prisma_migrations table missing or unreadable'; problems=$((problems + 1)); latest_migration=''; }
failed_migrations="$(psql_q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null || echo '?')"
echo "Newest applied migration: ${latest_migration:-<none>}"
[[ "$failed_migrations" == 0 ]] || { echo "FAIL  unfinished migrations: $failed_migrations"; problems=$((problems + 1)); }
if [[ -n "${EXPECTED_MIGRATION:-}" && "$latest_migration" != "$EXPECTED_MIGRATION" ]]; then
  echo "FAIL  expected migration $EXPECTED_MIGRATION"; problems=$((problems + 1))
fi

echo 'Row counts (exact):'
tables="$(psql_q "SELECT quote_ident(table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name;")"
[[ -n "$tables" ]] || { echo 'FAIL  no application tables restored'; problems=$((problems + 1)); }
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  printf '  %-28s %s\n' "$table" "$(psql_q "SELECT count(*) FROM public.$table;")"
done <<< "$tables"

usuarios="$(psql_q 'SELECT count(*) FROM public."Usuario";' 2>/dev/null || echo 0)"
if ((usuarios < MIN_USUARIOS)); then
  echo "FAIL  restored Usuario rows: $usuarios (minimum $MIN_USUARIOS)"; problems=$((problems + 1))
fi

if ((problems > 0)); then
  echo "RESTORE DRILL FAILED for $backup_name ($problems problem(s))."
  exit 1
fi
echo "RESTORE DRILL PASSED for $backup_name on $(date -u +%Y-%m-%dT%H:%M:%SZ) using $PG_IMAGE."
echo 'Record the date, backup name, newest migration and row counts in the operations log (no data values).'
