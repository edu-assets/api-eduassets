#!/usr/bin/env bash
# External availability probe for the public eduAssets endpoints.
# Read-only: performs anonymous GET requests and TLS handshakes only. No credentials are used or required.
# Exit status is non-zero when any check fails, so a scheduled CI run turns red and notifies the repository owner.
set -Euo pipefail

API_URL="${API_URL:-https://api.eduassets.tech}"
APP_URL="${APP_URL:-https://app.eduassets.tech}"
SITE_URL="${SITE_URL:-https://eduassets.tech}"
DOCS_PROBE_URL="${DOCS_PROBE_URL:-https://docs.eduassets.tech/docs/CHANGELOG.md}"
TLS_HOSTS="${TLS_HOSTS:-api.eduassets.tech app.eduassets.tech eduassets.tech docs.eduassets.tech}"
TLS_MIN_DAYS="${TLS_MIN_DAYS:-14}"
SECURITY_TXT_MIN_DAYS="${SECURITY_TXT_MIN_DAYS:-30}"
RETRIES="${RETRIES:-3}"

for tool in curl openssl date; do
  command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 2; }
done

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# fetch URL -> prints "<http_code>\n<body>" ; retries transient network errors
fetch() {
  local url="$1" attempt out
  for ((attempt = 1; attempt <= RETRIES; attempt++)); do
    if out="$(curl -sS --max-time 20 -A 'eduassets-uptime-check' -w '\n%{http_code}' "$url" 2>/dev/null)"; then
      printf '%s\n%s' "${out##*$'\n'}" "${out%$'\n'*}"
      return 0
    fi
    sleep $((attempt * 5))
  done
  printf '000\n'
}

check_http() {
  local label="$1" url="$2" expect_body="${3:-}" result code body
  result="$(fetch "$url")"
  code="${result%%$'\n'*}"
  body="${result#*$'\n'}"
  if [[ "$code" != 200 ]]; then
    fail "$label: HTTP $code ($url)"
  elif [[ -n "$expect_body" && "$body" != *"$expect_body"* ]]; then
    fail "$label: unexpected body ($url)"
  else
    pass "$label: HTTP 200"
  fi
}

days_until() {
  local epoch now
  epoch="$(date -u -d "$1" +%s 2>/dev/null)" || return 1
  now="$(date -u +%s)"
  echo $(((epoch - now) / 86400))
}

check_tls() {
  local host="$1" end days
  end="$(echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -z "$end" ]]; then
    fail "TLS $host: certificate not readable"
    return
  fi
  days="$(days_until "$end")" || { fail "TLS $host: cannot parse expiry '$end'"; return; }
  if ((days < TLS_MIN_DAYS)); then
    fail "TLS $host: certificate expires in $days days ($end)"
  else
    pass "TLS $host: $days days left"
  fi
}

check_security_txt() {
  local result code body expires days
  result="$(fetch "$SITE_URL/.well-known/security.txt")"
  code="${result%%$'\n'*}"
  body="${result#*$'\n'}"
  if [[ "$code" != 200 ]]; then
    fail "security.txt: HTTP $code"
    return
  fi
  expires="$(printf '%s\n' "$body" | sed -n 's/^Expires:[[:space:]]*//p' | tr -d '\r' | head -n1)"
  days="$(days_until "$expires")" || { fail "security.txt: missing or invalid Expires"; return; }
  if ((days < SECURITY_TXT_MIN_DAYS)); then
    fail "security.txt: Expires in $days days ($expires) - renew the file"
  else
    pass "security.txt: valid for $days days"
  fi
}

echo "eduAssets public uptime check - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
check_http 'API liveness /health' "$API_URL/health" '"status":"ok"'
check_http 'API readiness /ready (database)' "$API_URL/ready" '"status":"ready"'
check_http 'App' "$APP_URL/"
check_http 'Landing page' "$SITE_URL/"
check_http 'Documentation host' "$DOCS_PROBE_URL"
for host in $TLS_HOSTS; do check_tls "$host"; done
check_security_txt

if ((failures > 0)); then
  echo "$failures check(s) failed."
  exit 1
fi
echo 'All checks passed.'
