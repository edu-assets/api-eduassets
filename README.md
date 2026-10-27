# eduAssets Backend

[Português](README_PT.md) · [Frontend application](https://github.com/edu-assets/app-eduassets)

> **Status: Beta.** This repository contains the eduAssets API, database integration, and backend deployment/support files. The browser application is maintained separately in [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets).

## Overview

The eduAssets service supports equipment inventory and loan workflows for schools. Its API handles authentication, guest read-only access, equipment and category management, loans and returns, occurrences, exports, and optional RFID login integration.

The production topology is split by service:

```text
Browser → Cloudflare Pages: app.eduassets.tech
                         │ HTTPS API requests
                         ▼
              Cloudflare → Nginx on Oracle VM
                         │ loopback proxy
                         ▼
                  Docker API: 127.0.0.1:3000
                         │ PostgreSQL TLS
                         ▼
                       Neon
```

The frontend is in [`app-eduassets`](https://github.com/edu-assets/app-eduassets). This repository does not contain the Pages application or its build configuration. The API is the authorization boundary; frontend controls are only usability measures.

## Repository contents

- `backend/` — Node.js/TypeScript API, Express routes, Prisma schema, tests, and database migrations;
- `deploy/` and `docker-compose.production.yml` — Nginx and container deployment templates;
- `docs/` — backend operations runbooks;
- `rpi/` and `eduStation/` — optional RFID and device-support code;
- `.env.example` and `.env.production.example` — variable templates only; never commit real secrets.

## Stack and security

- Node.js **>=22.12.0**, TypeScript, and Express 5;
- Prisma 6 with PostgreSQL;
- bcrypt password hashing, JWT-backed sessions, request validation, rate limiting, and security headers;
- session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` over production HTTPS, and host-only; cookie-authenticated mutations require a trusted `Origin`;
- authorization is enforced by backend route policy. Guest responses use minimized allowlisted DTOs; sensitive listings and mutations require authentication;
- optional RFID bridge endpoints are disabled/blocked in the public deployment by default.

See the [API reference](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/API_REFERENCE.md), [architecture guide](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/ARCHITECTURE.md), and [operations and recovery guide](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/OPERATIONS_AND_RECOVERY.md) for the detailed contracts. The frontend repository also contains the bilingual product and deployment documentation.

## Requirements

- Node.js **22.12 or newer** and npm;
- PostgreSQL for local development and tests;
- Docker Engine and Docker Compose for the documented production deployment;
- Linux/Python and compatible RFID hardware only when the optional bridge is explicitly enabled.

## Local development

From the repository root:

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

On Windows PowerShell, use `Copy-Item .env.example backend/.env`. Edit `backend/.env` with a disposable development database URL and a unique `JWT_SECRET` of at least 32 random characters. Do not use production credentials for local tests and do not commit the environment file. The example configures local development; use the deployment templates and guides for production values.

Apply migrations only to the intended development database, then start the API:

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

The root `npm run dev` and `npm run build` scripts now target the backend only. The API listens on `127.0.0.1:3000` by default in development. The frontend can be run separately from the `app-eduassets` repository; its Vite development proxy targets this API port.

## Backend checks

```bash
npm --prefix backend test
npm --prefix backend run test:integration
npm run build
```

Integration tests require the configured disposable PostgreSQL database. The GitHub Actions workflow validates backend tests/build and the deployment templates; it does not deploy to Cloudflare or the Oracle VM.

## Production operations

The API is deployed as a Docker Compose service on the Oracle Cloud VM, behind Nginx at `api.eduassets.tech`. The container binds to host loopback; do not expose port `3000` or PostgreSQL publicly.

After a backend code/configuration change, update and recreate the API service using the documented procedure:

```bash
cd /opt/eduassets
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --force-recreate api
```

A full VM reboot is not required for ordinary application changes. Database migrations are separate, explicit operations; follow the deployment guide and verify backups before applying them. See the [deployment guide](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/DEPLOYMENT.md), [Portuguese deployment guide](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/GUIA_IMPLANTACAO.md), and the local [password reset runbook](docs/ADMIN_PASSWORD_RESET_RUNBOOK.md).
