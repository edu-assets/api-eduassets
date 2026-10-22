# EduAssets remediation record

## Scope and status

Implemented in the selected checkout on 2026-10-22. No deployment, remote database operation, migration, or secret rotation was performed. The checkout began clean on `main`; audit files were treated as hypotheses.

| Finding | Result | Evidence / residual risk |
|---|---|---|
| B1 in-memory/demo auth fallback | Fixed | Removed `InMemoryDb`, seeded demo user/hash, fallback proxy and fallback transactions. `prisma` is typed PrismaClient; database errors propagate. |
| B2 async admin middleware | Fixed | `requireAdmin` now awaits `requireAuth`; Express 5 propagates rejected middleware promises. |
| B3 RFID WS exposure/flag | Partially fixed | WS starts only when `RFID_BRIDGE_ENABLED=true`; wrong upgrade paths are destroyed. Still depends on loopback exposure/network policy and controlled proxy testing. |
| B4 predictable JWT secret | Fixed | JWT_SECRET required and minimum 32 chars, with no fallback. No secret values recorded. |
| B5 frameguard disabled | Fixed | Helmet frameguard denies framing. |
| B6 local CORS mode | Fixed | `NODE_ENV=development` plus loopback host is explicit; other environments require an origin allowlist. Production/proxy behavior not exercised on remote host. |
| B7 personal data / PostgREST | Blocked | No Supabase project credentials or authorized target policies available; did not change remote grants/RLS. Public API payload minimization requires a product/privacy decision and endpoint-by-endpoint review. |
| B8 port/host contract | Partially fixed | Backend defaults to 3000, honors `PORT` then `BACKEND_PORT`, binds all interfaces in production; Vite is on 5173 and proxies API to 3000. Provisioning bridge remains loopback 3001. Simultaneous process/network test not run. |
| B9 reproducible dependencies | Partially fixed | Root lockfile added; subprojects retain their own lockfiles and build-time tools in devDependencies. `npm ci --omit=dev` deployment pipeline not established/tested; production migration stage must include Prisma CLI. |
| B10 Prisma DIRECT_URL | Partially fixed | Prisma 6.19.3 config falls back to DATABASE_URL for direct URL. `prisma generate` verified; migration was not run without disposable PostgreSQL. |
| B11 Node engine | Fixed | Backend/frontend declare Node >=22.12.0; verified with Node 22.13.0 and locked Vite/Vitest engines. |
| B12 RFID timeout | Fixed in code | Empty UID returns false before select/write. Syntax checked; real reader and hardware exception behavior unavailable. |
| B13 systemd | Partially fixed | Removed machine-specific path and `pi` account assumption; standardized `/opt/eduassets-rfid`, venv and env filename, dedicated service user and mode check. Install procedure/user creation and `systemd-analyze verify` unavailable here. |
| B14 Pi 5 GPIO | Blocked | No Raspberry Pi/target OS; kept hardware dependencies unchanged rather than guessing incompatibility. |
| F1 measures attribute | Fixed | Added safe HTML attribute serializer with escaping (not raw interpolation); malformed edit-action attribute also fixed. |
| F2 missing translation | Fixed | Added PT/EN key. |
| F3 return edit spinner/stale state | Fixed | Spinner targets save button; original items update only after successful save. |
| F4 refreshed registration stores | Not reproduced/partially unresolved | Existing registration/store refresh patterns vary by entity; no end-to-end browser/database environment available for reliable full-flow verification. |
| F5 CSV export | Partially fixed | Added BOM, quoting, delimiter/newline escaping, formula-prefix neutralization and inclusive end-of-day filter. Added 6 unit cases. Local timezone/calendar boundary and Excel/LibreOffice application check not run. |
| F6 expired JWT | Fixed | API client broadcasts on every 401; listener clears any authenticated session, not only admins. 403/network errors are unchanged. |
| F7 selected return date | Not fixed | Current UI/backend contract stores server current time; changing historical date semantics needs a domain decision and backend schema validation. Do not treat the date field as implemented. |
| D1 Vercel API URL | Partially fixed | Production frontend throws clearly if `VITE_API_BASE_URL` is absent; no Vercel project/build env access for preview verification. |
| D2 README and localized documentation | Fixed | The English and Portuguese READMEs, architecture, changelog, data model, user manual, and roadmaps were reconciled against the current source. The bundled PDF manual was regenerated from the bilingual Markdown manuals. |
| D3 license | Fixed | Root/backend/frontend manifests now match the existing MIT license text. |
| D4 leftovers/markup | Fixed | Fixed the malformed attribute in the targeted template; a source/docs sweep confirmed that the `[cite: 22]` marker is no longer present outside this historical report entry. |
| D5 guest action styling | Not addressed | Backend remains authorization boundary; guest-mode affordance/accessibility requires visual/manual product QA. |

## Changes

`backend/package.json`, `backend/prisma.config.ts`, `backend/src/app.ts`, `backend/src/lib/{jwt,prisma,rfidBridge}.ts`, `backend/src/middlewares/{auth,security}.ts`, `backend/src/server.ts`; `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/core/{api/{apiClient.ts,apiConfig.ts},auth/sessionTimeout.ts,services/csv.ts,utils/html.ts,i18n/{en,pt}.json}`, `frontend/src/features/{cadastros/events.ts,controle/templates.ts,devolucao/events.ts,exportar/service.ts}`, `frontend/src/tests/{csv.test.ts,html.test.ts}`; root `package.json`, `package-lock.json`; `rpi/rfid/{spi_rfid_reader.py,eduassets-rfid.service}`; `README.md`, `frontend/public/docs/README.md`, `frontend/public/docs/LEIAME.md`, and the bilingual documentation set under `frontend/public/docs/`.

## Validation actually run

- Node `v22.13.0`, npm `10.9.2`, Python `3.12.3`; Prisma CLI `6.19.3`.
- `npm --prefix frontend test`: 27 passed across 5 files.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run build`: passed (existing Vite config/CSS-empty/chunk-size warnings remain).
- `JWT_SECRET=<synthetic test-only value> npm --prefix backend test`: 9 passed.
- `JWT_SECRET=<synthetic test-only value> npm --prefix backend run build`: passed.
- `DATABASE_URL=<loopback disposable placeholder> npx prisma generate`: passed; no DB connection or migration was made.
- Python syntax check and `git diff --check`: passed.
- Missing-JWT startup check: rejected as expected; must be repeated with direct `tsx` invocation if exact stack/output verification is needed (the initial Node loader wrapper only established nonzero exit).

## Release checklist for human operator

1. Configure unique `JWT_SECRET` (>=32 chars), database URLs, production `CORS_ORIGIN`, `NODE_ENV=production`, and the hosting-provided `PORT`; set `HOST=0.0.0.0` if the platform requires it.
2. Set Vercel `VITE_API_BASE_URL` to the actual API origin. Keep secrets out of frontend build variables.
3. In a disposable database, run Prisma migration deployment with documented direct connection and confirm backup/recovery first; do not point tests at production.
4. If enabling RFID, set `RFID_BRIDGE_ENABLED=true` and shared secret on the backend/bridge; block public access to WebSocket and provisioning ports at firewall/reverse proxy, then test authorized loopback/proxy behavior.
5. Install service using a dedicated account, validate GPIO library and actual card read/write on target Raspberry Pi model/OS; run `systemd-analyze verify` there.
6. Review anonymous PostgREST access, RLS, grants, views and public API payloads in the actual Supabase test project; approve personal-data exposure policy before production.
7. Run browser/manual checks for guest styling, registration refresh, return date semantics, end-date timezone behavior, and exports in Excel/LibreOffice.
