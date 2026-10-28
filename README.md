# eduAssets

<div align="center">
  <img src="assets/eduAssets_banner.webp" alt="eduAssets — school equipment inventory and loans" width="100%">
</div>

[Português](README_PT.md) · [Frontend](frontend.md) · [Backend](backend.md) · [Documentation repository](https://github.com/edu-assets/docs-eduassets)

> **Status: Official version 1.0.0.** eduAssets is a school-equipment inventory and loan-management application. Its frontend, backend, documentation, and portfolio now have separate repositories. This README describes the product as a whole; the detailed guides and release history are maintained in the central documentation repository.

## Overview

The application supports equipment loans and returns, stock/history views, equipment occurrences, administrative CRUD, exports, and optional RFID login. Access levels include read-only Guest, Editor, and Administrator. The current browser client uses TypeScript and native DOM rendering; React remains a roadmap item, not a current dependency.

## Repository map

| Repository | Responsibility |
| --- | --- |
| [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets) | Frontend application, login gate, in-app About/documentation modal, and Cloudflare Pages build. |
| [`edu-assets/eduAssets`](https://github.com/edu-assets/eduAssets) | Backend API, Prisma/PostgreSQL integration, optional RFID bridge, and deployment templates. This repository. |
| [`edu-assets/docs-eduassets`](https://github.com/edu-assets/docs-eduassets) | Canonical bilingual Markdown and PDF documentation shared by the projects. |
| [`edu-assets/site-eduAssets`](https://github.com/edu-assets/site-eduAssets) | Public portfolio and project overview site. |

## Runtime architecture

```text
Browser ── Cloudflare Pages (app.eduassets.tech)
   │ HTTPS API requests
   ▼
Cloudflare / Nginx ── Oracle Cloud VM
   │ loopback proxy
   ▼
Node.js / Express API ── PostgreSQL

Optional local RFID reader/bridge ── restricted backend RFID endpoints
```

The API is the security boundary. The browser negotiates `HttpOnly`, `SameSite=Lax` session cookies when supported; production HTTPS cookies use `Secure` and the `__Host-` prefix. Cookie-authenticated mutations require a trusted `Origin`. Guest responses use minimized server-side allowlists, and write permissions are enforced in backend routes. The optional RFID flow is disabled or blocked in the public deployment by default.

The topology above reflects the documented deployment design; this repository change does not inspect, restart, or otherwise modify the Oracle VM or hosted services.

## Local backend development

Requirements: Node.js **22.12 or newer**, npm, and a PostgreSQL database for local development.

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

Set a disposable development `DATABASE_URL` and a unique `JWT_SECRET` of at least 32 random characters in `backend/.env`. Never use production credentials for local tests or commit an environment file. Apply migrations only to the intended development database, then run:

The runtime contract also validates `HOST`, `PORT`/`BACKEND_PORT`, `CORS_ORIGIN`, and `TRUST_PROXY`; `DIRECT_URL` is optional and falls back to `DATABASE_URL`. See `backend/.env.example` and `backend/src/config/runtimeConfig.ts` for names and semantics. Do not put actual values in documentation.

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

Useful checks:

```bash
npm test
npm run build
npm run test:integration  # requires an isolated PostgreSQL test database
```

`npm run dev` and `npm run build` at the repository root target the backend only. Frontend setup and commands are in [frontend.md](frontend.md); backend details are in [backend.md](backend.md).

## Documentation and deployment

The canonical bilingual guides live in [`docs-eduassets`](https://github.com/edu-assets/docs-eduassets). The frontend About modal keeps its catalog and renderer in the app repository and can load the central Markdown when its public source is configured; bundled copies remain as a fallback until remote access is verified in production. Backend deployment, VM operations, recovery, API, and architecture procedures are linked from the documentation repository.

GitHub Actions validates code and deployment templates; it does not deploy the frontend, restart the API, or reboot the VM. Ordinary documentation or frontend-only changes do not require an Oracle VM restart. Backend releases use the documented API deployment procedure and do not normally require a full VM reboot.

## License

MIT. See [LICENSE](LICENSE) for the authoritative text.
