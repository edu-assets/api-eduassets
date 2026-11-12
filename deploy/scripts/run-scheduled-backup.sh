#!/usr/bin/env bash
# Entry point for the scheduled backup (systemd timer): encrypted dump + offsite upload + retention.
# Optional dead-man switch: BACKUP_PING_URL (healthchecks.io-style). Start, success and failure are
# reported as <url>/start, <url> and <url>/fail, so a *missing* daily ping raises an alert.
set -Eeuo pipefail
umask 077

ENV_FILE="${EDUASSETS_BACKUP_ENV:-/etc/eduassets/backup.env}"
[[ -f "$ENV_FILE" ]] || { echo "Backup environment file not found: $ENV_FILE" >&2; exit 2; }
[[ "$(stat -c '%a' -- "$ENV_FILE")" == 600 ]] || { echo "$ENV_FILE must have mode 0600." >&2; exit 2; }
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ping() {
  [[ -n "${BACKUP_PING_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL%/}$1" || echo "Warning: ping $1 failed." >&2
}

ping /start
if "$script_dir/backup-postgres.sh" && "$script_dir/prune-backups.sh"; then
  ping ''
  echo 'Scheduled backup finished successfully.'
else
  status=$?
  ping /fail
  echo "Scheduled backup FAILED (exit $status)." >&2
  exit "$status"
fi
