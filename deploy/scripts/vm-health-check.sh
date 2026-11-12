#!/usr/bin/env bash
# Host-side health check for the eduAssets VM (run by a systemd timer every 5 minutes).
# Checks disk, memory, the API container health and the age of the newest local backup.
# The container is restarted only after it stays "unhealthy" for UNHEALTHY_RESTART_AFTER consecutive
# runs, because Docker's `restart: unless-stopped` does not act on healthcheck status.
# Optional dead-man switch: HEALTH_PING_URL (healthchecks.io-style) receives <url> or <url>/fail.
set -Euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-eduassets}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/eduassets}"
DISK_PATHS="${DISK_PATHS:-/ /var/lib/docker}"
DISK_MAX_PERCENT="${DISK_MAX_PERCENT:-85}"
MEM_MIN_AVAILABLE_MB="${MEM_MIN_AVAILABLE_MB:-150}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
UNHEALTHY_RESTART_AFTER="${UNHEALTHY_RESTART_AFTER:-3}"
STATE_DIR="${STATE_DIR:-/var/lib/eduassets-health}"

problems=()
note() { printf '%s\n' "$1"; }
problem() { problems+=("$1"); printf 'PROBLEM: %s\n' "$1" >&2; }

# --- disk ---
for path in $DISK_PATHS; do
  [[ -e "$path" ]] || continue
  used="$(df -P -- "$path" | awk 'NR==2 {gsub("%","",$5); print $5}')"
  if ((used >= DISK_MAX_PERCENT)); then problem "disk $path at ${used}% (limit ${DISK_MAX_PERCENT}%)"; else note "disk $path: ${used}%"; fi
done

# --- memory ---
available_mb="$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
if ((available_mb < MEM_MIN_AVAILABLE_MB)); then problem "memory available ${available_mb} MB (minimum ${MEM_MIN_AVAILABLE_MB} MB)"; else note "memory available: ${available_mb} MB"; fi

# --- API container ---
mkdir -p -- "$STATE_DIR"
counter_file="$STATE_DIR/unhealthy-count"
# Find the container by Compose labels: `docker compose ps` would need .env.production to parse the file.
container="$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter 'label=com.docker.compose.service=api' | head -n1)"
if [[ -z "$container" ]]; then
  problem 'API container is not running'
else
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo unknown)"
  if [[ "$health" == unhealthy ]]; then
    count=$(( $(cat -- "$counter_file" 2>/dev/null || echo 0) + 1 ))
    echo "$count" > "$counter_file"
    if ((count >= UNHEALTHY_RESTART_AFTER)); then
      problem "API container unhealthy for $count checks - restarting"
      docker restart "$container" >/dev/null || problem 'API restart failed'
      echo 0 > "$counter_file"
    else
      problem "API container unhealthy ($count/$UNHEALTHY_RESTART_AFTER before restart)"
    fi
  else
    echo 0 > "$counter_file"
    note "API container health: $health"
  fi
fi

# --- backup freshness ---
newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eduassets-*.dump.age' -printf '%T@\n' 2>/dev/null | sort -n | tail -n1)"
if [[ -z "$newest" ]]; then
  problem "no backup found in $BACKUP_DIR"
else
  age_hours=$(( ($(date +%s) - ${newest%.*}) / 3600 ))
  if ((age_hours > BACKUP_MAX_AGE_HOURS)); then problem "newest backup is ${age_hours}h old (limit ${BACKUP_MAX_AGE_HOURS}h)"; else note "newest backup: ${age_hours}h old"; fi
fi

if [[ -n "${HEALTH_PING_URL:-}" ]]; then
  suffix=''; ((${#problems[@]} > 0)) && suffix='/fail'
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$(printf '%s\n' "${problems[@]:-ok}")" "${HEALTH_PING_URL%/}$suffix" \
    || echo 'Warning: health ping failed.' >&2
fi

((${#problems[@]} == 0)) || exit 1
note 'VM health OK.'
