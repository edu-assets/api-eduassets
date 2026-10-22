# Remediation Report — eduAssets

**Date:** 22/10/2026 · **Scope:** changes in the current checkout, with no commit, push, deployment, remote database access, or infrastructure changes. This report supersedes the previous record, which contained obsolete statuses.

## Executive verdict

**Not ready for production.** The listed source and deployment blockers were addressed in this checkout, and unit tests, typecheck, builds, schema validation, CSP assertions, and Nginx static assertions passed locally. The production container was not run because Docker/PostgreSQL/Nginx are unavailable in this sandbox; hosted CI, proxy, TLS, backup/restore, Vercel, or hardware were also not validated. The existence of templates is not evidence of operation.

## Findings and execution matrix

| Item / risk | Implementation and current evidence | Status / residual risk |
|---|---|---|
| B1 — in-memory database/authentication fallback | Removed `InMemoryDb`/proxy and demo credentials; typed Prisma; missing/invalid configuration does not create fictitious persistence; `/ready` returns generic, limited unavailability. | **Fixed in code.** Unit tests/build; actual database unavailability was not exercised. |
| B2 — asynchronous admin middleware | Authorization flow awaits/propagates authentication failures. | **Fixed in code.** No HTTP test with a database in this run. |
| B3 — bridge/WebSocket without flag/invalid routes | Startup requires `RFID_BRIDGE_ENABLED=true`; invalid upgrades are rejected; public Compose forces RFID off; the public Nginx template returns 404 for `/auth/rfid` and `/ws/rfid`. | **Fixed in code/template.** Proxy/network simulation not run. |
| B4 — default JWT secret | `JWT_SECRET` is required wherever a token is used, with a minimum of 32 characters; no predictable fallback. | **Fixed and covered by config/JWT tests.** Production secret remains external. |
| B5 — disabled frameguard | Security headers re-enabled; Vercel contains CSP, anti-frame, MIME, referrer, and permissions headers. | **Fixed in code/config.** Headers actually served by Vercel not verified. |
| B6 — CORS/environment detection | Central config validates `NODE_ENV`, exact HTTP(S) origins, allowlist, and trust proxy; permissive mode limited to local development. | **Fixed in code/unit tests.** End-to-end CORS/preflight not run. |
| B7 — personal data in public reads / PostgREST | Endpoint allowlist DTOs minimize loans/incidents/equipment; guardians and users require login; Guest remains read-only. The app uses Prisma directly and no PostgREST route was identified. | **API minimization fixed/tested.** Provider not accessed; grants/RLS apply only if that service is exposed. Isolated synthetic demo database was not provisioned. |
| B8 — port/host contracts | `PORT` takes precedence over `BACKEND_PORT`; each supplied value is validated; default 3000; explicit bind/trust proxy for production. Bridge remains on 3001/loopback. | **Fixed in code/docs/unit tests.** Backend and hardware were not started simultaneously. |
| B9 — Prisma generation/build/runtime | Build generates Prisma Client before TypeScript; the shared Docker stage explicitly installs `openssl` for build/migration/runtime; runtime invokes `node dist/src/server.js` directly; Node `>=22.12.0` aligned with CI/Docker. | **Clean install, generation, and local build passed.** Image build and runtime not run (Docker unavailable); actual OpenSSL/Prisma runtime compatibility remains unverified. |
| B10 — inconsistent `DIRECT_URL` | Production Compose no longer injects an empty `DIRECT_URL`; runtime validation treats an empty optional value as absent; `prisma.config.ts` uses `DATABASE_URL` fallback; migration script explicitly uses config. | **Unit regression, schema validation with omitted/empty values, generation and build passed.** `migrate deploy`/seed not run without disposable PostgreSQL. |
| B11 — missing Node version | Minimum version declared in manifests; Node 22.13 in CI/Docker and in this run's environment. | **Fixed and local compatibility tested.** Not tested on all target hosts. |
| B12 — RFID write timeout with no card | Reader validates missing UID before selecting/writing and returns a safe timeout instead of terminating the loop. | **Fixed in code; Python syntax passed.** No hardware/reader available for functional testing. |
| B13 — systemd unit with inconsistent paths/account | Unit uses a dedicated user/group, installation paths, env file consistent with permission 600, restart, and hardening. | **Fixed in file.** `systemd-analyze verify` could not complete because `/opt/eduassets-rfid/venv/bin/python3` is not present in the sandbox; target-host verification/installation remains pending. |
| B14 — Raspberry Pi 5 GPIO | No hardware/OS to confirm library/pins; GPIO dependencies were not changed based on assumptions; public RFID remains off. | **Blocked by hardware/target OS.** Requires real read/write testing. |
| F1 — `data-medidas` attribute | Contextual escaping via attribute helper; no `raw()` for the untrusted field; test for the attribute. | **Fixed/tested.** Visual browser flow pending. |
| F2 — translation missing items | PT/EN key and usage verified/fixed. | **Fixed; frontend suite/build passed.** |
| F3 — return spinner/stale state | Visual state and data source updated only after operation completes; correct button. | **Fixed.** Manual browser test pending. |
| F4 — stores after registration | Dependent stores reload after successful creation. | **Fixed in code.** End-to-end DB/browser flow pending. |
| F5 — CSV/filter/date | BOM, escaping delimiters/quotes/line breaks, formula neutralization, and inclusive filters by local calendar. | **Fixed; tests in UTC and `America/Sao_Paulo` passed previously and final suite passed.** Excel/LibreOffice not opened in this run. |
| F6 — expired JWT/401 | 401 clears token/session even without a hydrated user; 403 and network failure are not treated as expiration. | **Fixed in code/available tests.** Real browser flow pending. |
| F7 — ignored return date | API validates and persists the selected offset-aware timestamp; older clients may omit it and use server time. | **Fixed; request schema tested.** PostgreSQL persistence still pending. |
| P1 — incorrect current password ends session | Business-rule error is not classified as an expired session; auth distinguishes missing/invalid session. | **Fixed in code.** Real API test pending. |
| P1 — trust proxy/rate limits | Proxy trust is no longer implicit and accepts only validated values; production requires declaration. Nginx overwrites forwarding headers and requires current Cloudflare ranges. | **Partially verified.** Ranges, spoofing, NAT, and rate limits require host/CI integration test; real network not tested. |
| P1 — administrative replay timeout | Expiration uses JWT identifier and fails closed without trusted state; the same JWT does not restart as a new session. | **Fixed/unit test passed.** State is a local `Map`: single instance; share session state before scaling. |
| P2 — loan/incident concurrency | Lock/conditional transitions in transactions prevent concurrent returns, edits, resolution/deletion, and duplicate inventory; concurrent HTTP tests created. | **Implemented; integration suite compiles.** Not run against PostgreSQL; concurrent state in the database not verified. |
| P2 — API host/network | Compose publishes only `127.0.0.1`; bridge is outside public Compose. | **Template created; Docker and firewall unavailable/not run.** |
| P2 — reusable RFID token | Card uses an opaque random token; server persists hash; session JWT is not stored on the card. | **Risk reduced, not eliminated:** MIFARE is clonable and key/card security depends on hardware; RFID is isolated and disabled publicly, and must not be called secure MFA. |
| P2 — integration coverage | 5 HTTP tests cover Guest/denial, login/password, concurrent return, edit-vs-return, and concurrent resolution with inventory. | **Added and compiles.** Execution requires disposable PostgreSQL in CI; not run locally. |
| D1 — Vercel/API/CSP | Vercel is the primary configuration; `VITE_API_BASE_URL` required in production build; CSP allows only `'self'` plus the documented intended `https://api.eduassets.tech`; alternative `_headers` removed. | **Code/docs aligned and static assertion passed.** DNS, Vercel preview, and actual headers not verified; hostname remains an operator assumption. |
| D2 — inconsistent READMEs | READMEs and docs updated for scripts, Guest, ports, return, env, and deployment limits. | **PT/EN pairs reviewed; Markdown relative-link check found 0 missing links across 23 files.** The PDF retains both language headings; the internal report is not published with frontend assets. |
| D3 — MIT/ISC license | `LICENSE` and manifests aligned to MIT. | **Fixed.** |
| D4 — junk/markup | Editorial marker removed; attribute separated and safe; obsolete references reviewed; redundant configs and metadata/lockfiles aligned. | **Fixed; final search found no editorial markers or stale claims in active docs.** |
| D5 — Guest UX | `data-requires-auth`/`data-requires-admin` actions have visual styling indicating unavailability in Guest/Editor; backend remains authoritative. | **Partially improved.** Keyboard/screen-reader support and accessibility QA not manually validated. |
| P0 — deployment artifacts | Multi-stage Docker, loopback/RFID-off Compose, direct Node entrypoint, Nginx/Cloudflare template with explicit RFID denies, production env, liveness/readiness, backup/restore only on empty DB, and PT/EN guides. | **Source/template fixes written.** Docker/Nginx/backup/restore/monitoring not run in a real service. |
| CI/health/login timing/cleanup | GitHub Actions now includes a dedicated production smoke job with PostgreSQL, migration image, omitted `DIRECT_URL`, `/ready` polling, read-only runtime and shutdown check, alongside existing tests/builds. | **New job not run.** Hosted run `39806752284` passed only the prior `verify` job on base HEAD `408cb82641b8546689647c0f4fd5e355a35a9feb`; it does not cover these uncommitted local changes. |

## Main files and artifacts

- **Security/runtime:** `backend/src/config/runtimeConfig.ts`, `backend/src/lib/{prisma,jwt,adminActivity,readiness,publicDto}.ts`, loan and incident middlewares/auth/services/controllers/routes.
- **Frontend and RFID:** CSV/date filters, returns, auth/session timeout, HTML templates with escaped attributes, `frontend/src/styles/components/auth.css`, `rpi/rfid/spi_rfid_reader.py`, `rpi/rfid/eduassets-rfid.service`.
- **Build/tests:** manifests/lockfiles, `backend/prisma/schema.prisma`, `backend/tsconfig.integration.json`, `backend/integration-tests/api.integration.test.ts`, `.github/workflows/ci.yml`.
- **Operations:** `.env.example`, `.env.production.example`, `backend/Dockerfile`, `docker-compose.production.yml`, `deploy/nginx/`, `deploy/scripts/`.
- **Documentation:** READMEs, architecture, changelog, data model, manuals, roadmaps, and PT/EN deployment guides; bilingual manual PDF.

## Local evidence

Clean lockfile-based installation passed at the root, backend, and frontend (`npm ci`, using `--prefix` for both packages). Backend installation reported 3 high-severity audit findings in existing dependency resolution; no bulk updates or `npm audit fix` were made. Frontend installation emitted deprecated transitive dependency warnings.

| Check | Result |
|---|---|
| `JWT_SECRET=<synthetic> NODE_ENV=test npm --prefix backend test` | **25/25 tests passed.** A first run without `JWT_SECRET` failed during service-test module loading; the correctly configured run passed. |
| `DATABASE_URL=<synthetic> env -u DIRECT_URL npx prisma validate --config prisma.config.ts` and the same command with `DIRECT_URL=''` | **Both passed**, confirming omitted and empty fallback paths. |
| `DATABASE_URL=<synthetic> npm --prefix backend run build` | **Passed**, including `prisma generate` and TypeScript. |
| `npm --prefix frontend run typecheck` | **Passed.** |
| `npm --prefix frontend test` | **35/35 tests across 9 files passed.** |
| `VITE_API_BASE_URL=https://api.eduassets.tech npm --prefix frontend run build` | **Passed.** Warnings: Vite native loader, empty `footer.css`, and ExcelJS chunk above 500 kB. |
| JSON parse, CSP/Nginx static assertions, and `git diff --check` | **Passed.** |

Git remote canonicalization was confirmed as `edu-assets/eduAssets` at base HEAD `408cb82641b8546689647c0f4fd5e355a35a9feb`; root `package.json` metadata was corrected from the stale `dasilva-thiago/edu-assets` reference to the same repository.

## Not run / blockers

- `docker`, `podman`, `nginx`, `psql`, and `pg_restore` are unavailable in this environment. Migrations, seed, DB integration tests, image builds, Compose, Nginx, backup, or restore were not run. `systemd-analyze verify` did not complete because the unit's interpreter at its installation path is not present in this sandbox.
- A YAML parser is not available in the installed packages; JSON and targeted source assertions passed, but workflow/Compose YAML did not receive automated local parsing.
- The production smoke workflow was added but needs hosted execution or another Docker/PostgreSQL environment. Run `39806752284` passed for the canonical repository/base HEAD, but not for this unpushed working tree or its new smoke job.
- No credentials/authorization for Vercel, Oracle/VM, Cloudflare, domain, certificate, or managed database; no DNS, grant/RLS, firewall, secret, data, or remote service was changed.
- No Raspberry Pi/reader/target OS to validate GPIO, card, systemd, or RFID UX. MIFARE cloning risk remains; keep RFID disabled on the public API.
- In-memory administrator timeout is consistent only in a single instance; shared state is required before scaling.
- Browser QA, accessibility, real CORS/proxy, rate limiting with NAT/Cloudflare, and opening in Excel/LibreOffice remain pending.

## Release checklist

- [ ] **Before public demo:** green CI; PostgreSQL and Docker tests; dedicated synthetic demo DB; `VITE_API_BASE_URL`, CSP, CORS, proxy, firewall, TLS, and headers verified on host; RFID off.
- [ ] **Before personal/school data:** privacy review, provider grants/roles and DB isolation; access/retention policy; monitoring/incident response; encrypted backup off-host and proven restore drill.
- [ ] **Before production:** strong secret and operational rotation, staging smoke tests, migration after confirmed backup, schema-compatible rollout/rollback, readiness, monitored rate limits/logs; domain/Cloudflare/Vercel confirmed.
- [ ] **Before RFID kiosk:** supported hardware/OS, dependencies/pins/card tested, secrets in restricted file, loopback/network/firewall reviewed; assess clonable card without calling it MFA.
- [ ] **Future:** shared session for multiple instances, permission/unit granularity, password recovery, and roadmap accessibility improvements.

---

**No commit or push in this run. No deployment, destructive database operation, secret change, or infrastructure change was performed.**
