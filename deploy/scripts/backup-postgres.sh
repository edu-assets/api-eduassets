#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?Set a password-free DATABASE_URL}"
: "${PGPASSFILE:?Set PGPASSFILE to a protected password file}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to an age recipient}"
: "${RCLONE_DESTINATION:?Set RCLONE_DESTINATION to a configured rclone remote:path}"

check_database_url() {
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
}
check_passfile() {
  [[ -f "$PGPASSFILE" && -r "$PGPASSFILE" ]] || { echo 'PGPASSFILE must be a readable regular file.' >&2; exit 2; }
  local mode
  mode="$(stat -c '%a' -- "$PGPASSFILE")"
  [[ "$mode" == 600 ]] || { echo 'PGPASSFILE must have mode 0600.' >&2; exit 2; }
}
check_database_url
check_passfile
for tool in pg_dump age rclone python3; do command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 2; }; done

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_dir/eduassets-$stamp.dump.age"
tmpdir="$(mktemp -d "$backup_dir/.backup.XXXXXX")"
trap 'rm -rf -- "$tmpdir"' EXIT
raw="$tmpdir/database.dump"
encrypted="$tmpdir/database.dump.age"
PGPASSFILE="$PGPASSFILE" pg_dump --format=custom --no-owner --no-acl --file="$raw" "$DATABASE_URL"
age --recipient "$AGE_RECIPIENT" --output "$encrypted" "$raw"
chmod 600 "$encrypted"
mv -- "$encrypted" "$final"
# Only ciphertext is sent offsite. Failure leaves the encrypted local copy for retry.
rclone copyto "$final" "${RCLONE_DESTINATION%/}/$(basename -- "$final")"
printf 'Encrypted backup created and uploaded: %s\n' "$final"
