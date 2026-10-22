# eduAssets

<div align="center">
  <img src="frontend/public/assets/img/eduAssets_banner.png" alt="eduAssets banner" width="100%">
</div>

[Português](README_PT.md) · [English documentation](frontend/public/docs/README.md) · [Documentação em português](frontend/public/docs/LEIAME.md) · [Deployment guide](frontend/public/docs/DEPLOYMENT.md) · [Guia de implantação](frontend/public/docs/GUIA_IMPLANTACAO.md)

> **Status: Beta.** The current checkout contains a TypeScript frontend and backend, authentication, Guest mode, loan/return workflows, occurrence management, exports and optional RFID integration. No operational public deployment is documented in this repository; the steps below describe local development and technical preparation, not infrastructure that has already been published.

## Overview

**eduAssets** is a school-equipment loan and inventory-management application. It is designed for frequent operational workflows used by administrators and editors rather than for per-unit serial-number tracking.

The application covers:

- equipment-loan registration and returns;
- stock and loan-history views with search/filter;
- equipment occurrences (observation, maintenance and broken items);
- CRUD administration for categories, equipment, responsible people and users;
- CSV, Excel and PDF exports; and
- authenticated sessions, administrator/editor permissions, guest read-only access and optional physical-card login through RFID.

The interface also includes persisted Light / Dark / System theme selection. The current frontend is TypeScript plus native DOM rendering; React is a future roadmap item, not a current dependency.

## Runtime topology

In the default local setup, the processes fit this arrangement:

```text
Browser ── http://localhost:5173 ── Vite dev server
                                      │ proxy (/auth, /usuarios, /ws, ...)
                                      ▼
                                 API :3000 ── PostgreSQL

Optional RFID bridge (local kiosk) ── backend /auth/rfid (not exposed by the public proxy)
                     └─ local provisioner http://127.0.0.1:3001/provision
```

- The backend listens on **port 3000 by default**. `PORT` takes precedence over `BACKEND_PORT`; each supplied value is validated and an invalid value fails startup instead of silently falling back.
- `HOST` is used when set. Without it, the server uses `127.0.0.1` outside production and `0.0.0.0` in production. The selected Docker deployment publishes the container only on host loopback.
- Vite listens on **`0.0.0.0:5173`** and proxies the application paths and `/ws` to **`127.0.0.1:3000`**.
- The frontend API client uses relative URLs when `VITE_API_BASE_URL` is empty, which is the convenient development mode with the Vite proxy. A production frontend build requires `VITE_API_BASE_URL`.
- The optional RFID bridge starts a local provisioning HTTP service at **`127.0.0.1:3001`**. This is not the application API and is not a public port.

## Tech stack

### Frontend

- Node.js **>=22.12.0**, TypeScript and ES modules;
- [Vite](https://vitejs.dev/) 8, configured in `frontend/vite.config.ts`;
- feature-first layers under `src/core`, `src/features`, `src/shared` and `src/types`;
- `flatpickr` for date/time inputs;
- ExcelJS, jsPDF and `jspdf-autotable` for exports;
- `marked` for Markdown rendering; and
- CSS custom-property tokens with Light / Dark themes.

### Backend

- Node.js **>=22.12.0**, TypeScript and Express 5;
- Prisma 6 with PostgreSQL (`schema.prisma` defines the data model);
- JWT authentication with bcrypt password hashes;
- Zod request validation, Helmet security headers, Morgan/Winston logging and rate limiting;
- transactional stock operations; and
- an opt-in `ws` WebSocket bridge at `/ws/rfid` for RFID login events.

### Optional RFID hardware

`rpi/rfid/rfid_admin_bridge.py` supports a native SPI reader or an Arduino Nano over USB serial. It sends card tokens to `POST /auth/rfid` with `X-RFID-Bridge-Secret`, and exposes the local `POST /provision` helper on port 3001. The shipped `eduassets-rfid.service` is a systemd unit template; installing the account, paths, Python environment, hardware libraries and network policy remains an operator task.

## Authentication and access levels

- **Guest:** read-only access to equipment, categories, loan summaries and occurrence summaries. Anonymous API responses use server-side allowlisted DTOs; `GET /responsaveis`, users and sensitive operational details require authentication. Mutating operations are never available without authorization.
- **Editor:** authenticated operational actions such as loans, returns and creating/editing occurrences, subject to the route permissions.
- **Administrator:** administrative CRUD, account/password management and RFID-token provisioning in addition to operational actions.

The backend is the security boundary: mutating routes use authentication/administrator middleware and JWTs in `Authorization: Bearer <token>`. Guest endpoints use minimized, server-side allowlisted projections; frontend guards are for usability only. Logout and password changes update a PostgreSQL-backed per-user `sessionVersion`, invalidating older JWTs across instances; password change returns a replacement JWT for the current browser. Administrator inactivity still uses process-local state and is consistent only on a single backend instance; editor sessions do not use that idle timeout. Password recovery is not implemented; an authenticated user can change their own password through `PATCH /auth/senha`.

## Backend API surface

The application router includes:

- `GET /health` for liveness, `GET /ready` for bounded PostgreSQL readiness, and `GET /` for a basic status response;
- `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` and `PATCH /auth/senha`;
- `POST /auth/rfid` for the optional local-kiosk RFID flow; the public Nginx template returns 404 for this endpoint and `/ws/rfid`;
- CRUD routes for `/categorias`, `/equipamentos`, `/responsaveis`, `/usuarios`, `/emprestimos` and `/ocorrencias`; and
- administrator-only RFID-token provisioning/revocation under `/usuarios/:id/rfid-token`.

Guest responses use endpoint-specific server-side allowlists; responsible-party and user listings require authentication. Write authorization is enforced in the backend. Public demo data must be synthetic and isolated from operational data. The Prisma schema contains `Categoria`, `Equipamento`, `Responsavel`, `Usuario`, `Emprestimo`, `ItemEmprestimo` and `Ocorrencia`, with enums for access level, loan status, occurrence type and occurrence status.

## Requirements

- Node.js **22.12 or newer** and npm;
- a PostgreSQL database reachable through `DATABASE_URL`;
- a direct PostgreSQL URL when the provider requires one (`DIRECT_URL`, otherwise the Prisma configuration falls back to `DATABASE_URL`); and
- physical RFID hardware plus the Linux/Python dependencies only if RFID is explicitly enabled.

Vercel and Docker/Nginx are selected repository-side deployment templates, not configured services. No Oracle VM, DNS, TLS certificate, Cloudflare policy, hosted database, provider-side RLS or public deployment has been verified.

## Install and run locally

From the repository root:

```bash
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

The root `npm ci` installs the `concurrently` helper. Backend and frontend each have their own package manifest and lockfile, so install them as shown.

### Configure the backend

Copy the template to the backend working directory and edit it with real, local values. Do not commit secrets:

```bash
cp .env.example backend/.env
```

At minimum, set a PostgreSQL URL and a unique JWT secret. The explicit seed also requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (see [Database setup](#database-setup)). In local development, `NODE_ENV=development` with the default loopback host permits the local CORS mode. `DATABASE_URL` is required to start outside `NODE_ENV=test`; production also requires explicit `CORS_ORIGIN` and `TRUST_PROXY`. Outside that explicit local mode, set `CORS_ORIGIN` to a comma-separated allowlist.

### Configure the frontend

For the Vite proxy, keep the API base empty in `frontend/.env`:

```env
VITE_API_BASE_URL=
VITE_RFID_BRIDGE_ENABLED=false
```

If the frontend must call an API at another origin, set `VITE_API_BASE_URL` to that origin instead. Production builds fail clearly when this variable is absent; it is a public endpoint setting, not a place for secrets.

### Database setup

With `backend/.env` configured and PostgreSQL available:

```bash
cd backend
npx prisma migrate dev
npm run db:seed
cd ..
```

The seed **requires a valid `SEED_ADMIN_EMAIL` and a strong `SEED_ADMIN_PASSWORD`** (minimum 16 characters, maximum 72 UTF-8 bytes), is idempotent, and does not overwrite existing accounts or passwords. Optional editor provisioning requires both `SEED_EDITOR_EMAIL` and `SEED_EDITOR_PASSWORD`. Keep seed values in a protected, untracked env file; explicitly run the seed only after migrations, verify administrator login, change the initial password using the authenticated account flow, and clear the one-time seed variables. API startup never creates an administrator. This README provides no demo credentials.

For an environment that already has committed migrations, the backend also exposes:

```bash
cd backend
npm run migrate:deploy
```

That command applies existing migrations; it does not create a database, provision infrastructure or establish a backup policy.

### Start development

From the root:

```bash
npm run dev
```

Before starting `backend`, its `predev` script generates Prisma Client and applies committed migrations with `prisma migrate deploy`. It does not create the database or start PostgreSQL; configure `backend/.env` and the PostgreSQL service first. If the API or migrations fail, `concurrently` now stops the frontend too instead of leaving an interface open without a backend. Once ready, the command invokes `backend` in `tsx watch` mode and the Vite frontend together. Open `http://localhost:5173`. To run one side separately:

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

The backend's development URL is normally `http://127.0.0.1:3000` (or the configured `HOST`/`PORT`), and the Vite proxy keeps browser API calls relative to port 5173.

## Available scripts

### Root

| Command | Effect |
| --- | --- |
| `npm run dev` | Starts backend and frontend concurrently. |
| `npm run build` | Runs the backend build and then the frontend build. |

### Backend

| Command | Effect |
| --- | --- |
| `npm run dev` | `tsx watch src/server.ts`. |
| `npm run build` | Generates Prisma Client, then compiles TypeScript with `tsc`. |
| `npm start` | Starts `dist/src/server.js` after a build. |
| `npm run migrate:deploy` | Applies existing Prisma migrations. |
| `npm test` | Runs backend unit tests (no DB required). |
| `npm run test:integration` | Runs HTTP/PostgreSQL integration and concurrency tests; requires an isolated migrated test database. |
| `npm run db:seed` | Explicitly applies the idempotent seed (requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`). |

### Frontend

| Command | Effect |
| --- | --- |
| `npm run dev` | Vite development server on port 5173. |
| `npm run build` | Builds `dist/`. |
| `npm run preview` | Previews the built frontend locally. |
| `npm run typecheck` | Runs `tsc --noEmit`. |
| `npm test` | Runs the configured Vitest suite; this README makes no claim about results. |
| `npm run test:watch` | Starts Vitest in watch mode. |

These entries describe scripts present in the manifests, not evidence of a completed deployment or a particular test run.

## Environment variables

### Backend and database

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `development` enables the explicit local-development path; `production` changes the default host and proxy behavior. |
| `PORT` / `BACKEND_PORT` | Backend port. Each provided value is validated; `PORT` has precedence; default is 3000. `BACKEND_PORT` is the compatibility fallback. |
| `HOST` | Bind address. Default is `127.0.0.1`, or `0.0.0.0` in production when unset. |
| `TRUST_PROXY` | Validated Express proxy setting; required explicitly in production. Use `0` without a proxy, or only the exact trusted hops/IPs for a sanitized proxy chain. |
| `CORS_ORIGIN` | Comma-separated valid HTTP(S) origins (no path/query/fragment); required in production and outside explicit local development. |
| `DATABASE_URL` | PostgreSQL connection used by Prisma; required. |
| `DIRECT_URL` | Optional direct PostgreSQL connection for providers/migrations; Prisma falls back to `DATABASE_URL` when omitted. |
| `JWT_SECRET` | JWT signing secret; use a unique, unpredictable value of at least 32 characters. |
| `SEED_ADMIN_EMAIL` | Valid email required by the explicit first-time seed. |
| `SEED_ADMIN_PASSWORD` | Required by the explicit seed; at least 16 characters and at most 72 UTF-8 bytes. |
| `SEED_EDITOR_EMAIL` / `SEED_EDITOR_PASSWORD` | Optional pair; both must be supplied to seed an editor. |
| `LOG_LEVEL` | Winston log level; the template defaults to `info`. |

### Frontend

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | API origin used by the browser. Empty in development uses Vite's proxy; required for a production frontend build. |
| `VITE_RFID_BRIDGE_ENABLED` | Frontend RFID-listener flag. Keep `false` unless the backend bridge is enabled and the local hardware/network policy is in place. |

### RFID bridge

| Variable | Meaning |
| --- | --- |
| `RFID_BRIDGE_ENABLED` | Backend flag. RFID WebSocket support is **off unless exactly `true`**. |
| `RFID_BRIDGE_SECRET` | Shared secret required by the backend and Python bridge; use at least 32 random characters. |
| `EDUASSETS_BACKEND_URL` | Bridge API origin; defaults to `http://localhost:3000`. |
| `RFID_BACKEND` | Reader mode: `spi` (default) or `serial`. |
| `RFID_SERIAL_PORT` | Serial device when `RFID_BACKEND=serial`; defaults to `/dev/ttyUSB0`. |
| `RFID_SOUND_DEVICE` | Optional ALSA device for synthesized feedback tones. |

## Optional RFID setup and security boundary

RFID is intentionally disabled by default. Enabling it requires all of the following:

1. set `RFID_BRIDGE_ENABLED=true` on the backend and, when using the browser listener, `VITE_RFID_BRIDGE_ENABLED=true`;
2. configure the same strong `RFID_BRIDGE_SECRET` on backend and bridge;
3. install and validate the actual reader hardware and its Python dependencies;
4. use a separate local-kiosk instance without a public proxy for the bridge. Both `POST /auth/rfid` and the `/ws/rfid` upgrade reject non-loopback peers; behind Nginx, the backend sees the proxy loopback and that is not proof the original caller is local. The public template blocks both routes with 404;
5. keep the provisioning helper on `127.0.0.1:3001`, protect its environment file and restrict any reverse proxy/firewall exposure; and
6. validate card read/write behavior and the network policy on the target machine before relying on it.

The bridge can be run manually on a compatible Linux host:

```bash
cd rpi/rfid
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export RFID_BRIDGE_SECRET='use-the-same-strong-secret-as-the-backend'
export EDUASSETS_BACKEND_URL='http://localhost:3000'
python3 rfid_admin_bridge.py
```

Use `RFID_BACKEND=serial` and `RFID_SERIAL_PORT` for the Arduino-Nano path. The unit file expects a dedicated `eduassets` account, `/opt/eduassets-rfid`, a virtual environment and `/etc/eduassets/rfid_bridge.env` with mode 600. The repository does not perform that machine installation, create the account, verify systemd on the target OS or certify a specific Raspberry Pi/GPIO combination.

## Project structure

```text
eduAssets/
├── frontend/
│   ├── public/docs/          # English and Portuguese in-app documentation
│   ├── src/core/             # API, auth, state, UI primitives, RFID listener
│   ├── src/features/         # dashboard, loans, returns, control, admin, exports...
│   ├── src/shared/           # reusable UI pieces
│   ├── src/types/            # shared TypeScript types
│   └── vite.config.ts
├── backend/
│   ├── prisma/               # schema, migrations and seed
│   ├── integration-tests/    # PostgreSQL HTTP/race tests (CI only)
│   └── src/                  # server, routes, controllers, services, middleware
├── rpi/rfid/                 # optional Python RFID bridge and systemd unit
├── deploy/                   # Nginx and safe backup/restore templates
├── .github/workflows/        # CI checks; not deployment automation
├── docker-compose.production.yml
├── .env.example              # local environment template
├── .env.production.example   # deployment template only
└── package.json              # root dev/build orchestration
```

The frontend follows a feature-first, layered structure. `core` contains infrastructure and state primitives, `features` owns screen workflows, `shared` contains reusable view pieces, and `types` centralizes contracts. Dynamic HTML uses the project's escaping template helper rather than treating user data as trusted markup.

## Current limitations and release notes

- No public deployment, production database operation/migration, secret rotation or hosting configuration was performed. Repository deployment templates are preparation artifacts only. Planned domains are not proof of availability.
- Access control for application requests is implemented in the backend. Provider-side grants/PostgREST are not part of the app's request path; if exposed by a selected provider, review them separately and block unintended anonymous access.
- Production requires explicit `CORS_ORIGIN` and `TRUST_PROXY`; validate the actual proxy and firewall topology before deployment.
- RFID is an opt-in hardware integration, not a fallback login. It needs a compatible reader, Linux/Python dependencies, a strong shared secret, loopback reachability and an explicit firewall/proxy policy.
- Asset quantities are tracked at model/category level; individual serial-number tracking is out of scope for the current model.
- Access levels are Administrator and Editor; there is no finer-grained per-panel role system.
- Password recovery is not implemented. Password change is available only to an authenticated user.
- The return modal sends and persists the selected offset-aware timestamp; old clients may omit it and use server time.
- Remaining manual validation includes CI-hosted/PostgreSQL/Docker execution, target-hardware behavior, Nginx/Cloudflare proxy policy, TLS/Vercel configuration, backup/restore, accessibility and browser flows. Templates do not make these verified guarantees.

## Roadmap

Completed code paths include the TypeScript frontend, JWT access control, allowlisted Guest DTOs, Light/Dark/System themes, transactional stock operations, exports, rate limiting, admin idle timeout, selected return date and optional RFID. PostgreSQL integration and hosted CI are prepared but unexecuted; first deployment, manual accessibility/hardware/proxy verification and React migration remain roadmap items.

## License

The project is released under the MIT license. See the repository license file for the authoritative text.

## Deployment and operations

The selected topology, Docker targets, Vercel build variables, Nginx trust boundary, TLS, firewall, backup/restore, monitoring, release and rollback steps are documented in the [English deployment guide](frontend/public/docs/DEPLOYMENT.md) and [Portuguese guide](frontend/public/docs/GUIA_IMPLANTACAO.md). These are templates requiring operator verification; they do not perform a deployment.
