#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL through a protected environment file}"
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p -- "$backup_dir"
file="$backup_dir/eduassets-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-acl --file="$file" "$DATABASE_URL"
chmod 600 "$file"
printf 'Backup created: %s\n' "$file"
