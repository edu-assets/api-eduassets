#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?Set a password-free DATABASE_URL for a newly created empty target database}"
: "${PGPASSFILE:?Set PGPASSFILE to a protected password file}"
: "${AGE_IDENTITY:?Set AGE_IDENTITY to a protected age private identity file}"
: "${BACKUP_FILE:?Set BACKUP_FILE to an age-encrypted custom-format backup}"
if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_TO_EMPTY_DATABASE" ]]; then
  echo 'Refusing restore. Set RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE only after verifying the disposable target.' >&2
  exit 2
fi
[[ -r "$BACKUP_FILE" ]] || { echo 'Encrypted backup file is not readable.' >&2; exit 2; }
[[ -f "$PGPASSFILE" && -r "$PGPASSFILE" ]] || { echo 'PGPASSFILE must be a readable regular file.' >&2; exit 2; }
[[ "$(stat -c '%a' -- "$PGPASSFILE")" == 600 ]] || { echo 'PGPASSFILE must have mode 0600.' >&2; exit 2; }
[[ -f "$AGE_IDENTITY" && -r "$AGE_IDENTITY" ]] || { echo 'AGE_IDENTITY must be a readable regular file.' >&2; exit 2; }
[[ "$(stat -c '%a' -- "$AGE_IDENTITY")" == 600 ]] || { echo 'AGE_IDENTITY must have mode 0600.' >&2; exit 2; }
python3 - "$DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlsplit
try:
    parsed = urlsplit(sys.argv[1])
    if parsed.scheme not in ("postgres", "postgresql") or parsed.password is not None:
        raise ValueError
except Exception:
    raise SystemExit("DATABASE_URL must be a valid PostgreSQL URL with no password in its userinfo")
PY
for tool in psql pg_restore age python3; do command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 2; }; done

private_dir="$(mktemp -d "${TMPDIR:-/tmp}/eduassets-restore.XXXXXX")"
trap 'rm -rf -- "$private_dir"' EXIT
chmod 700 "$private_dir"
dump="$private_dir/database.dump"
age --decrypt --identity "$AGE_IDENTITY" --output "$dump" "$BACKUP_FILE"
chmod 600 "$dump"

# Count all user-owned relations; any table/view/sequence/foreign table blocks restore.
objects="$(PGPASSFILE="$PGPASSFILE" psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f');")"
[[ "$objects" == "0" ]] || { echo 'Refusing restore: target database contains user tables or other user relations.' >&2; exit 2; }
PGPASSFILE="$PGPASSFILE" pg_restore --exit-on-error --no-owner --no-acl --dbname="$DATABASE_URL" "$dump"
echo 'Restore completed into the verified empty target database.'
