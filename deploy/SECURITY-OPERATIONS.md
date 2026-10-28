# Security and recovery runbook

This guide describes controls implemented in the API repository. It is an operator procedure, not evidence that the production VM, firewall, Cloudflare account, or offsite storage has been changed.

## Administrator and RFID access policy

Administrator accounts (`ADMINISTRADOR`) authenticate with username and password. The API rejects both RFID card provisioning and RFID card login for administrator accounts; there is no administrator-card PIN flow. Use the normal password login, which establishes the API's `HttpOnly` session cookie.

RFID is optional and intended for Editor accounts only. When enabled in an appropriate local deployment, the bridge accepts only loopback upgrades from an explicitly trusted browser Origin to `/ws/rfid?auth=cookie`. It sends an opaque, single-use login code that expires after 30 seconds; the raw JWT and user identity are not broadcast over the WebSocket. The public Nginx template blocks the RFID HTTP and WebSocket paths, and the bridge remains disabled unless explicitly enabled by configuration. Do not expose the local bridge directly to the Internet.

## Cloudflare origin restriction

Use `deploy/nginx/eduassets-api.conf.example` as the starting point for the API virtual host. Generate the Cloudflare allowlist with `deploy/scripts/update-cloudflare-nginx-allowlist.sh`, install the resulting snippet at the path included by the Nginx template, configure the API hostname and TLS certificate, and run `nginx -t` before reloading Nginx.

The Nginx ACL returns a denial for a non-allowlisted peer. If the operational requirement is a refused TCP connection rather than an HTTP denial, enforce the same Cloudflare-only source ranges at the cloud firewall/security-list layer as well. Keep the API container bound to loopback and do not trust a client-supplied `X-Forwarded-For`; the template replaces it with Cloudflare's `CF-Connecting-IP` value. The template intentionally has no public port-80 listener.

## Encrypted offsite PostgreSQL backup

Run the backup script on a trusted operations host with `pg_dump`, `age`, `rclone`, and Python installed. Keep secrets in protected files or the host's secret manager; do not commit them or pass database passwords in the URL or command line.

Prepare these values in the operator environment:

```bash
export DATABASE_URL='postgresql://eduassets@db-host:5432/eduassets' # no password in URL
export PGPASSFILE='/etc/eduassets/pgpass'                           # mode 0600
export AGE_RECIPIENT='age1...'                                      # public encryption recipient
export RCLONE_DESTINATION='offsite:eduassets/postgres'              # configured rclone remote:path
export BACKUP_DIR='/var/backups/eduassets'                          # private local directory
./deploy/scripts/backup-postgres.sh
```

`PGPASSFILE` must be a readable regular file with mode `0600` and a line matching the database host, port, name, and user. The script creates a custom-format `pg_dump`, encrypts it before it leaves the private temporary directory, writes a mode-`0600` `.dump.age` file locally, then transfers only that ciphertext through the configured rclone remote. The `age` recipient is public; protect its matching private identity separately from the backup storage. Configure rclone credentials in the host's protected rclone configuration or secret manager, not in this repository.

Use the offsite provider's access controls, retention/versioning, and monitoring to meet the organization's recovery objectives. A successful `rclone copyto` proves transfer completion, not that provider retention or account-level disaster recovery has been configured.

## Safe restore drill

Restore only to a newly created, disposable, empty database. First transfer an encrypted backup and the private age identity through approved protected channels. Set `DATABASE_URL` to a password-free URL for the empty target, use the same protected `PGPASSFILE`, and set `AGE_IDENTITY` to the mode-`0600` private identity file:

```bash
export DATABASE_URL='postgresql://eduassets@restore-host:5432/eduassets_restore'
export PGPASSFILE='/etc/eduassets/pgpass'
export AGE_IDENTITY='/etc/eduassets/age-identity.txt' # private key file, mode 0600
export BACKUP_FILE='/secure-transfer/eduassets-YYYYMMDDTHHMMSSZ.dump.age'
export RESTORE_CONFIRM='RESTORE_TO_EMPTY_DATABASE'
./deploy/scripts/restore-postgres-empty-db.sh
```

The script decrypts into a private temporary directory, refuses to proceed if the target contains user relations, and runs `pg_restore --exit-on-error`. Verify the restored application data and run the application checks before treating a restore as usable. Never point this confirmation at a production database; the empty-target guard is a safety check, not a substitute for an isolated recovery target. Use a scrubbed dataset for drills whenever personal data is involved.

## Validation record

- **2026-10-28 — local disposable drill:** PostgreSQL 16.15 migrations were applied to a newly created local test database; the API integration suite passed (11 passed, 1 environment-specific seeded-admin test skipped); a synthetic category row was included in a custom-format dump, encrypted with `age`, copied through an rclone local-filesystem destination, restored into a separate empty database, and verified through Prisma. Nginx syntax was also checked in a temporary local instance, where a non-allowlisted peer received HTTP 403.
- The local validation covers scripts and mechanics in disposable infrastructure; it does not validate RFID hardware or configure retention/monitoring. The production record below is separate operator-reported evidence.
- **2026-10-28 — operator-reported production record:** commit `14b0716110750857daa27d0e979e3bec574e39e0`; migration `20261028173000_user_management_audit` applied; API restarted with image `eduassets-backend:14b071611075`. A Neon PostgreSQL 18.6 dump was created with `pg_dump` 18.6, encrypted with `age` using the public recipient, and transferred to R2 through `rclone`; the 328366-byte object appeared in the listing. The first upload returned HTTP 501 and the automatic retry succeeded. `/health` and `/ready` succeeded on loopback and the public domain. The immediate Compose snapshot still showed `health: starting`; no later `healthy` state was recorded.
- This record proves one manual backup run and the HTTP checks reported by the operator. It does not record restoration of the production object, scheduled/automatic retention, continuous monitoring, origin/firewall changes, or RFID hardware checks. Keep the private `age` identity off the VM and out of the bucket.
