#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Operator-run generator. No privilege escalation, firewall changes, or reloads.
out_dir="${CLOUDFLARE_NGINX_SNIPPET_DIR:-/etc/nginx/snippets}"
allow_out="$out_dir/eduassets-cloudflare-allowlist.conf"
mkdir -p -- "$out_dir"
work="$(mktemp -d "$out_dir/.eduassets-cloudflare.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

command -v curl >/dev/null || { echo 'curl is required.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 is required.' >&2; exit 1; }
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://www.cloudflare.com/ips-v4 -o "$work/ipv4"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://www.cloudflare.com/ips-v6 -o "$work/ipv6"

python3 - "$work/ipv4" "$work/ipv6" "$work/allowlist" <<'PY'
import ipaddress
import pathlib
import sys

v4_path, v6_path, allow_path = map(pathlib.Path, sys.argv[1:])
ranges = []
for path, version in ((v4_path, 4), (v6_path, 6)):
    lines = path.read_text(encoding="ascii").splitlines()
    if not lines:
        raise SystemExit(f"Cloudflare returned an empty IPv{version} list")
    for line in lines:
        value = line.strip()
        if not value:
            continue
        try:
            network = ipaddress.ip_network(value, strict=True)
        except ValueError as exc:
            raise SystemExit(f"Invalid Cloudflare CIDR {value!r}: {exc}")
        if network.version != version:
            raise SystemExit(f"Wrong address family in IPv{version} list: {value}")
        ranges.append(str(network))
if not any("." in item for item in ranges) or not any(":" in item for item in ranges):
    raise SystemExit("Both IPv4 and IPv6 ranges are required")
allow_path.write_text(
    "# Generated from Cloudflare's official IP list endpoints. Do not edit.\n" +
    "".join(f"allow {cidr};\n" for cidr in ranges), encoding="ascii")
PY
chmod 0644 "$work/allowlist"
# A same-filesystem rename replaces the active ACL atomically after full validation.
mv -f -- "$work/allowlist" "$allow_out"
printf 'Updated Cloudflare Nginx allowlist: %s\n' "$allow_out"
printf 'Run nginx -t and arrange an operator-reviewed reload separately.\n'
