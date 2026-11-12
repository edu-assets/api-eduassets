#!/usr/bin/env bash
# Host-side health check for the eduAssets VM (run by a systemd timer every 5 minutes).
# Checks disk, memory, the API container health, the API HTTP 5xx rate and the age of the newest local backup.
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
# Alert when, since the previous run, at least ERROR_5XX_MIN_COUNT responses were 5xx AND they were at least
# ERROR_5XX_MAX_PERCENT of the requests (both conditions, so one error on a quiet VM does not page anyone).
ERROR_5XX_MIN_COUNT="${ERROR_5XX_MIN_COUNT:-5}"
ERROR_5XX_MAX_PERCENT="${ERROR_5XX_MAX_PERCENT:-5}"

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

  # --- HTTP 5xx rate, from the API request log (morgan -> winston JSON on stdout) since the last run ---
  since_file="$STATE_DIR/last-log-check"
  now="$(date +%s)"
  since="$(cat -- "$since_file" 2>/dev/null || echo $((now - 300)))"
  [[ "$since" =~ ^[0-9]+$ ]] && ((since > now - 3600)) || since=$((now - 300))
  if counts="$(docker logs --since "$since" --until "$now" "$container" 2>&1 | awk '
      match($0, /"message":"[^"]*"/) {
        n = split(substr($0, RSTART + 11, RLENGTH - 12), f, " ")
        if (n < 4 || f[2] !~ /^[A-Z]+$/ || f[4] !~ /^[1-5][0-9][0-9]$/) next
        if (f[3] ~ /^\/(health|ready)([?]|$)/) next   # container healthcheck traffic
        total++; if (f[4] ~ /^5/) errors++
      }
      END { print total + 0, errors + 0 }')"; then
    echo "$now" > "$since_file"
    read -r requests errors_5xx <<< "$counts"
    percent=$(( requests > 0 ? errors_5xx * 100 / requests : 0 ))
    if ((errors_5xx >= ERROR_5XX_MIN_COUNT && percent >= ERROR_5XX_MAX_PERCENT)); then
      problem "API returned $errors_5xx HTTP 5xx of $requests requests (${percent}%) since the last check"
    else
      note "API requests since last check: $requests, 5xx: $errors_5xx"
    fi
  else
    problem 'could not read API logs'
  fi
fi

# --- automatic deployment (eduassets-deploy.timer, when enabled) ---
if systemctl is-failed --quiet eduassets-deploy.service 2>/dev/null; then
  problem 'last automatic deployment failed (journalctl -u eduassets-deploy)'
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
