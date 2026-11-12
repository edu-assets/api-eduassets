#!/usr/bin/env bash
# Retention for encrypted eduAssets backups (local directory and rclone remote).
# Safety rule: nothing is deleted unless at least BACKUP_MIN_KEEP backups newer than the retention
# window exist, so a broken backup job can never prune the last good copies.
set -Eeuo pipefail
umask 077

: "${RCLONE_DESTINATION:?Set RCLONE_DESTINATION to the configured rclone remote:path}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
REMOTE_RETENTION_DAYS="${REMOTE_RETENTION_DAYS:-30}"
BACKUP_MIN_KEEP="${BACKUP_MIN_KEEP:-3}"
PATTERN='eduassets-*.dump.age'

for value in "$LOCAL_RETENTION_DAYS" "$REMOTE_RETENTION_DAYS" "$BACKUP_MIN_KEEP"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { echo 'Retention values must be positive integers.' >&2; exit 2; }
done
command -v rclone >/dev/null || { echo 'rclone is required.' >&2; exit 2; }

# --- local copies ---
if [[ -d "$BACKUP_DIR" ]]; then
  recent_local="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$PATTERN" -mtime "-$LOCAL_RETENTION_DAYS" | wc -l)"
  if ((recent_local >= BACKUP_MIN_KEEP)); then
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "$PATTERN" -mtime "+$LOCAL_RETENTION_DAYS" -print -delete
  else
    echo "Local prune skipped: only $recent_local recent backup(s), minimum is $BACKUP_MIN_KEEP." >&2
  fi
fi

# --- offsite copies ---
remote="${RCLONE_DESTINATION%/}"
recent_remote="$(rclone lsf --files-only --include "$PATTERN" --max-age "${REMOTE_RETENTION_DAYS}d" "$remote" | wc -l)"
if ((recent_remote >= BACKUP_MIN_KEEP)); then
  rclone delete --include "$PATTERN" --min-age "${REMOTE_RETENTION_DAYS}d" -v "$remote"
else
  echo "Remote prune skipped: only $recent_remote recent backup(s), minimum is $BACKUP_MIN_KEEP." >&2
fi
echo 'Retention completed.'
