# eduAssets

<div align="center">
  <img src="frontend/public/assets/img/eduAssets_banner.png" alt="eduAssets banner" width="100%">
</div>

[English docs](frontend/public/docs/README.md) · [Documentação em português](frontend/public/docs/LEIAME.md)

> **Status: Beta.** O checkout contém o frontend e o backend funcionais em TypeScript, autenticação, modo convidado, operações de empréstimo/devolução, controle de ocorrências, exportações e uma integração RFID opcional. Não há um deployment público operacional documentado neste repositório; os passos abaixo descrevem desenvolvimento local e preparação técnica, não uma infraestrutura já publicada.

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

Optional RFID bridge ── backend /auth/rfid (loopback-only)
                     └─ local provisioner http://127.0.0.1:3001/provision
```

- The backend listens on **port 3000 by default**. `PORT` takes precedence over `BACKEND_PORT`; when neither produces a usable port, the fallback is 3000.
- `HOST` is used when set. Without it, the server uses `127.0.0.1` outside production and `0.0.0.0` when `NODE_ENV=production`.
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

- **Guest:** read-only access to public GET views. Mutating operations are not available without authentication.
- **Editor:** authenticated operational actions such as loans, returns and creating/editing occurrences, subject to the route permissions.
- **Administrator:** administrative CRUD, account/password management and RFID-token provisioning in addition to operational actions.

The backend is the security boundary: mutating routes use authentication/administrator middleware and JWTs in `Authorization: Bearer <token>`. Frontend guards are for usability only. Administrator inactivity is tracked server-side and expires after 30 minutes; editor sessions do not use that idle timeout. Password recovery is not implemented; an authenticated user can change their own password through `PATCH /auth/senha`.

## Backend API surface

The application router includes:

- `GET /health` and `GET /` for basic status responses;
- `POST /auth/login`, `GET /auth/me` and `PATCH /auth/senha`;
- `POST /auth/rfid` for the optional loopback RFID flow;
- CRUD routes for `/categorias`, `/equipamentos`, `/responsaveis`, `/usuarios`, `/emprestimos` and `/ocorrencias`; and
- administrator-only RFID-token provisioning/revocation under `/usuarios/:id/rfid-token`.

Guest read access and write authorization are enforced by the backend route implementation. The Prisma schema contains `Categoria`, `Equipamento`, `Responsavel`, `Usuario`, `Emprestimo`, `ItemEmprestimo` and `Ocorrencia`, with enums for access level, loan status, occurrence type and occurrence status.

## Requirements

- Node.js **22.12 or newer** and npm;
- a PostgreSQL database reachable through `DATABASE_URL`;
- a direct PostgreSQL URL when the provider requires one (`DIRECT_URL`, otherwise the Prisma configuration falls back to `DATABASE_URL`); and
- physical RFID hardware plus the Linux/Python dependencies only if RFID is explicitly enabled.

No cloud provider, hosting platform, Supabase project, RLS policy or public domain is assumed by the code or by these instructions.

## Install and run locally

From the repository root:

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

The root `npm install` installs the `concurrently` helper. Backend and frontend each have their own package manifest and dependency tree, so install them as shown.

### Configure the backend

Copy the template to the backend working directory and edit it with real, local values. Do not commit secrets:

```bash
cp .env.example backend/.env
```

At minimum, set a PostgreSQL URL and a unique JWT secret. The seed also requires `SEED_ADMIN_PASSWORD` (see [Database setup](#database-setup)). In local development, `NODE_ENV=development` with the default loopback host permits the local CORS mode. Outside that explicit local mode, set `CORS_ORIGIN` to a comma-separated allowlist.

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
npx prisma db seed
cd ..
```

The seed is idempotent and **requires `SEED_ADMIN_PASSWORD`**. It creates the initial administrator using the password supplied by that variable; it does not contain a password in source. `SEED_EDITOR_PASSWORD` is optional and, when set, creates an editor account. No demo password or ready-made credential is provided by this README.

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

This invokes `backend` in `tsx watch` mode and the Vite frontend together. Open `http://localhost:5173`. To run one side separately:

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
| `npm run build` | Compiles TypeScript with `tsc`. |
| `npm start` | Starts `dist/src/server.js` after a build. |
| `npm run migrate:deploy` | Applies existing Prisma migrations. |
| `npm test` | Runs the repository's configured Node test pattern; this README makes no claim about results. |

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
| `PORT` / `BACKEND_PORT` | Backend port. `PORT` has precedence; default is 3000. `BACKEND_PORT` is the compatibility fallback. |
| `HOST` | Bind address. Default is `127.0.0.1`, or `0.0.0.0` in production when unset. |
| `TRUST_PROXY` | Optional explicit Express proxy setting. In production without it, the app assumes one proxy hop; set it deliberately for the real topology. |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins. Required outside local development. |
| `DATABASE_URL` | PostgreSQL connection used by Prisma; required. |
| `DIRECT_URL` | Optional direct PostgreSQL connection for Prisma migrations/providers; configuration falls back to `DATABASE_URL` when absent. |
| `JWT_SECRET` | JWT signing secret; use a unique, unpredictable value of at least 32 characters. |
| `SEED_ADMIN_PASSWORD` | Required only when running the seed; password for the initial administrator. |
| `SEED_EDITOR_PASSWORD` | Optional seed password; when present, creates an editor account. |
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
4. ensure the backend sees bridge requests as loopback. Both `POST /auth/rfid` and the `/ws/rfid` upgrade reject non-loopback peers; a Raspberry Pi on the same LAN is not automatically sufficient;
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
│   └── src/                  # server, routes, controllers, services, middleware
├── rpi/rfid/                 # optional Python RFID bridge and systemd unit
├── .env.example              # environment template
└── package.json              # root dev/build orchestration
```

The frontend follows a feature-first, layered structure. `core` contains infrastructure and state primitives, `features` owns screen workflows, `shared` contains reusable view pieces, and `types` centralizes contracts. Dynamic HTML uses the project's escaping template helper rather than treating user data as trusted markup.

## Current limitations and release notes

- No public deployment, cloud database operation, migration run, secret rotation or hosting configuration is performed by this repository. Planned domains are not proof of availability.
- The code does not establish or verify provider-side RLS, grants or anonymous PostgREST policy. Review those policies separately before exposing personal data through a hosted PostgreSQL/Supabase setup.
- Production requires an explicit `CORS_ORIGIN`; a reverse proxy must be reflected in `TRUST_PROXY` and in the real network policy.
- RFID is an opt-in hardware integration, not a fallback login. It needs a compatible reader, Linux/Python dependencies, a strong shared secret, loopback reachability and an explicit firewall/proxy policy.
- Asset quantities are tracked at model/category level; individual serial-number tracking is out of scope for the current model.
- Access levels are Administrator and Editor; there is no finer-grained per-panel role system.
- Password recovery is not implemented. Password change is available only to an authenticated user.
- The return-date UI does not change the server's current-time semantics; do not treat it as historical-date persistence.
- The remediation record notes remaining manual validation areas such as target-hardware behavior, deployment/proxy behavior and some browser flows. This README does not convert those open checks into guarantees.

## Roadmap

Completed areas include the TypeScript frontend migration, real API integration, JWT access control, Guest Mode, Light/Dark/System theme handling, transactional stock operations, exports, rate limiting, administrator idle timeout and optional RFID code paths. Remaining roadmap items include accessibility improvements, a broader utility/service test strategy, first public deployment and a possible React rendering migration.

## License

The project is released under the MIT license. See the repository license file for the authoritative text.
