#!/usr/bin/env bash
# Pull-based continuous deployment for the eduAssets API (run as root by eduassets-deploy.timer).
#
# On each run: fetch origin/main; if it moved forward and the required GitHub CI jobs passed for that exact
# commit, fast-forward the checkout, build the new image, take an encrypted backup and apply Prisma migrations
# (only when the release adds migrations), recreate the API and wait for it to become healthy. If the new API
# does not become healthy, the code and the container are rolled back to the previous commit/image.
# Nothing inbound is opened: the VM only makes outbound HTTPS calls to GitHub.
#
# A commit whose deployment failed is recorded and not retried (the unit stays failed so vm-health-check.sh
# reports it); pushing a new commit, or deleting $STATE_DIR/failed-sha, allows a new attempt.
# Rolling back code/images never reverts a migration (see the deployment guide: expand/migrate/contract).
set -Euo pipefail

main() {
  local REPO="${REPO:-/opt/api-eduassets}"
  local REPO_USER="${REPO_USER:-ubuntu}"
  local GITHUB_REPO="${GITHUB_REPO:-edu-assets/api-eduassets}"
  local REQUIRED_CHECKS="${REQUIRED_CHECKS:-verify production-smoke}"
  local COMPOSE_PROJECT="${COMPOSE_PROJECT:-eduassets}"
  local BACKUP_SCRIPT="${BACKUP_SCRIPT:-$REPO/deploy/scripts/run-scheduled-backup.sh}"
  local HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
  local STATE_DIR="${STATE_DIR:-/var/lib/eduassets-deploy}"

  log() { printf '[deploy] %s\n' "$*"; }
  as_repo_user() { runuser -u "$REPO_USER" -- env HOME="$(getent passwd "$REPO_USER" | cut -d: -f6)" "$@"; }
  git_repo() { as_repo_user git -C "$REPO" "$@"; }
  compose() { docker compose -p "$COMPOSE_PROJECT" --env-file "$REPO/.env.production" -f "$REPO/docker-compose.production.yml" "$@"; }
  api_container() { docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter 'label=com.docker.compose.service=api' | head -n1; }

  [[ "$(id -u)" == 0 ]] || { log 'must run as root'; exit 2; }
  mkdir -p -- "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || { log 'another deployment is running'; exit 0; }

  git_repo fetch --quiet origin main || { log 'git fetch failed'; exit 1; }
  local head target container prev_image prev_tag deployed
  head="$(git_repo rev-parse HEAD)"
  target="$(git_repo rev-parse origin/main)"
  # "Deployed" means the image the API runs (tagged with the commit), not the checkout: a manual
  # `git pull` without a rebuild still gets deployed here.
  container="$(api_container)"
  prev_image="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
  prev_tag="${prev_image##*:}"
  [[ "$prev_tag" != "${target:0:12}" ]] || exit 0
  deployed="$(git_repo rev-parse --verify --quiet "${prev_tag:-none}^{commit}" 2>/dev/null || echo "$head")"

  if [[ "$(cat -- "$STATE_DIR/failed-sha" 2>/dev/null)" == "$target" ]]; then
    log "not retrying ${target:0:12}: its deployment already failed (push a fix or delete $STATE_DIR/failed-sha)"
    exit 1
  fi
  if ! git_repo merge-base --is-ancestor "$head" "$target"; then
    log "origin/main (${target:0:12}) is not a fast-forward of the deployed commit (${head:0:12}); deploy manually"
    echo "$target" > "$STATE_DIR/failed-sha"; exit 1
  fi
  if [[ -n "$(git_repo status --porcelain --untracked-files=no)" ]]; then
    log 'the checkout has local changes; refusing to deploy'
    echo "$target" > "$STATE_DIR/failed-sha"; exit 1
  fi

  # --- CI gate: every required job must have completed successfully for this exact commit ---
  local ci
  ci="$(curl -fsS -m 20 --retry 2 -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/$GITHUB_REPO/commits/$target/check-runs?per_page=100" |
    python3 -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
state = "success"
for name in sys.argv[1].split():
    matching = [r for r in runs if r.get("name") == name]
    if not matching:
        state = "pending" if state == "success" else state
        continue
    run = max(matching, key=lambda r: r.get("started_at") or "")
    if run.get("status") != "completed":
        state = "pending" if state == "success" else state
    elif run.get("conclusion") != "success":
        state = "failure"
print(state)' "$REQUIRED_CHECKS")" || { log 'could not read CI status from GitHub; will retry'; exit 0; }
  case "$ci" in
    success) ;;
    pending) log "CI still running for ${target:0:12}; will retry"; exit 0 ;;
    *) log "CI did not pass for ${target:0:12}; not deploying"; exit 0 ;;
  esac

  local migrations tag
  migrations="$(git_repo diff --name-only "$deployed" "$target" -- backend/prisma/migrations)"
  tag="${target:0:12}"
  log "deploying ${deployed:0:12} -> $tag (previous image: ${prev_image:-none}; migrations: $([[ -n "$migrations" ]] && echo yes || echo no))"

  abort() {  # before the API was touched: restore the checkout only
    log "FAILED: $1 - the API was not changed"
    git_repo reset --hard --quiet "$head"
    echo "$target" > "$STATE_DIR/failed-sha"
    exit 1
  }
  wait_healthy() {
    local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) id health
    while ((SECONDS < deadline)); do
      id="$(api_container)"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)"
      if [[ "$health" == healthy ]] && curl -fsS -m 5 -o /dev/null http://127.0.0.1:3000/ready; then return 0; fi
      sleep 5
    done
    return 1
  }

  if [[ "$head" != "$target" ]]; then git_repo merge --ff-only --quiet "$target" || abort 'fast-forward failed'; fi
  export EDUASSETS_IMAGE_TAG="$tag"
  compose config --quiet || abort 'compose configuration is invalid'
  if [[ -n "$migrations" ]]; then
    compose build --pull api migrate || abort 'image build failed'
    log 'release adds migrations: taking an encrypted backup first'
    as_repo_user env EDUASSETS_BACKUP_ENV=/etc/eduassets/backup.env "$BACKUP_SCRIPT" || abort 'pre-migration backup failed'
    compose --profile release run --rm --no-deps migrate \
      || abort 'migration failed (check _prisma_migrations before retrying)'
  else
    compose build --pull api || abort 'image build failed'
  fi

  compose up -d --no-build --force-recreate api || log 'compose up reported an error'
  if wait_healthy; then
    log "deployed $tag; API healthy"
    rm -f -- "$STATE_DIR/failed-sha"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $target" >> "$STATE_DIR/history"
    # keep only the current and previous images so the disk does not fill up
    docker images --format '{{.Repository}}:{{.Tag}}' \
      | grep -E '^eduassets-backend(-migration)?:' | grep -vE ":(${tag}|${prev_tag:-$tag})\$" \
      | xargs -r docker rmi >/dev/null 2>&1 || true
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi

  log "FAILED: API did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s - rolling back to ${head:0:12}"
  echo "$target" > "$STATE_DIR/failed-sha"
  git_repo reset --hard --quiet "$head"
  if [[ -n "$prev_tag" ]]; then
    EDUASSETS_IMAGE_TAG="$prev_tag" compose up -d --no-build --force-recreate api
    if wait_healthy; then log "rolled back to image $prev_image; API healthy"; else log 'ROLLBACK DID NOT RECOVER THE API - manual action required'; fi
  else
    log 'no previous image recorded - manual action required'
  fi
  [[ -z "$migrations" ]] || log 'note: migrations from the failed release stay applied; the previous code must remain compatible'
  exit 1
}

# Wrapped in a function so bash parses the whole script before the checkout (which contains it) is updated.
main "$@"
