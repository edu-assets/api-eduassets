# eduAssets — Backend Architecture Refactoring

> **Status reviewed 2026-10-22:** Repository-side work was implemented incrementally in the current checkout. This file is retained as a historical design/acceptance record, not as evidence of a deployed or production-ready service. See `REMEDIATION_REPORT.md` and the bilingual deployment guides; the CI workflow has been authored but not executed. Environment-specific deployment, PostgreSQL integration, hardware and provider-side validation remain gates.

## Context

I am refactoring the backend of **eduAssets**, a school equipment loan and inventory management system developed as an educational portfolio project and intended to integrate with **eduStation**, a local kiosk with optional RFID hardware.

**Current stack:**
- Frontend: Vite + TypeScript, feature-first architecture.
- Backend: Node.js, Express 5, TypeScript.
- Database: PostgreSQL + Prisma.
- Validation: Zod.
- Authentication: JWT + bcrypt, with `ADMINISTRADOR` and `EDITOR` roles.
- Hardware: optional Raspberry Pi/Arduino RFID bridge, with loopback-only HTTP/WebSocket communication.
- Existing capabilities: Guest Mode, loans, returns, equipment issues, inventory, history and data export.

Inspect the repository and actual implementation before modifying anything. Existing documentation may contain outdated information; prioritize the current code and the decisions below.

The original request referenced architecture screenshots from an earlier conversation; those images are not stored in this repository and are not treated as implementation evidence.

## 1. Target architecture

Refactor `backend/src/` toward this structure:

```text
src/
├── app.ts
├── server.ts
├── routes/
├── controllers/
├── services/
├── schemas/
├── middlewares/
├── errors/
│   └── AppError.ts
└── lib/
    ├── prisma.ts
    ├── jwt.ts
    ├── logger.ts
    ├── rfidToken.ts
    ├── rfidBridge.ts
    └── adminActivity.ts
```

Responsibilities:

- **`server.ts`**: bootstrap HTTP and WebSocket infrastructure.
- **`app.ts`**: configure Express, `/health`, routers, middleware and centralized error handling.
- **`routes/`**: map endpoints to controllers and apply the appropriate middleware.
- **`controllers/`**: handle HTTP requests and responses, delegating business logic to services.
- **`services/`**: implement business rules independently of Express.
- **`schemas/`**: retain Zod request validation.
- **`middlewares/`**: authentication, authorization, security, validation, request logging, error handling and 404 handling.
- **`errors/`**: centralized application errors.
- **`lib/`**: infrastructure and reusable technical services.

Move `middleware/` to `middlewares/` and update all imports. Current stock business logic resides in services (for example `services/estoque.service.ts`) and preserves atomic behavior; no legacy `lib/estoque.ts` migration should be inferred from this historical note.

The original request referenced `skills.md`, `skillsJS.md` and `architectureskills.md`; those files were not found in the current repository checkout. Keep feature responsibilities clear, avoid premature abstractions and do not introduce a new framework.

## 2. Approved architectural decisions

### Error handling

Introduce `AppError(status, chaveI18n, extra?)` to replace duplicated domain-error classes where appropriate.

- Services throw application or domain errors.
- Express 5 handles rejected controller promises.
- Controllers should not contain repetitive `try/catch` blocks solely to forward errors.
- The centralized error handler maps errors to HTTP responses.
- Malformed JSON must return HTTP 400.
- Unexpected errors must be logged with their stack, never exposed in full to the client.
- Add or update frontend translation keys in both `pt.json` and `en.json` whenever necessary.

Preserve meaningful HTTP status codes and existing API contracts wherever possible.

### Transactions and stock

Centralize interactive Prisma transaction configuration with a **15-second timeout**, using a correctly typed helper that does not break batch transactions or Prisma's existing transaction semantics.

Preserve atomic stock changes and race-condition protection.

Important business rules:
- Loan editing replaces the complete item collection because the frontend sends the full list. Do not introduce diff-based updates or pagination.
- Loan history must remain available through the existing soft-delete/status approach.
- Resolving an occurrence performs its stock adjustment exactly once.
- Deleting an already resolved occurrence must not reverse stock again.
- Preserve transaction rollback if any stock operation fails.

### Authentication and authorization

`requireAuth` must verify that the authenticated user still exists and obtain the current access level from the database. A deleted user or a user whose role changed must not retain access through stale JWT claims.

Do not introduce `tokenVersion` or an additional migration solely to revoke JWTs in this refactoring.

Use an explicit `HS256` algorithm for JWT signing and verification. Apply constant-time comparisons to shared secrets where appropriate, handling unequal buffer lengths safely.

Preserve the existing role boundaries:
- **Guest:** read-only demonstration access.
- **Editor:** authorized operational actions, without administrative privileges.
- **Administrator:** full permissions, including Cadastros, user management and RFID card provisioning.

Preserve the existing administrator idle timeout of 30 minutes. Do not introduce an idle timeout for Editors or change the established eight-hour Editor JWT policy.

Automated password recovery by email remains out of scope; users who forget their passwords must contact the administrator.

### Guest Mode and public API access

**Guest Mode must remain functional. Do not protect every GET endpoint indiscriminately.**

Implemented: anonymous GET access is restricted to the current read views and uses endpoint-specific server-side DTO allowlists; `GET /responsaveis` and user-management routes require authentication. Re-review this allowlist before any change to the public UI or payload.

- Public endpoints must return only the fields required by the guest interface.
- `GET /usuarios` and user-management endpoints must be protected appropriately.
- Never expose password hashes, RFID tokens, shared secrets or other sensitive information.
- All write operations must enforce authorization on the backend.
- Any public deployment must use synthetic demonstration data in a dedicated database, isolated from any school or eduStation database; no such deployment/database is configured by this repository.
- Do not introduce a new guest-authentication flow.

Audit the existing routes and frontend usage before defining the allowlist.

### RFID

RFID remains an optional local eduStation integration, not a requirement for the public deployment.

- Preserve loopback-only bridge and WebSocket restrictions.
- Do not make RFID endpoints remotely accessible to accommodate public hosting.
- Keep the existing user-facing message explaining that RFID is unavailable when no physical reader is configured.
- In `usuarios.ts`, validate that the target user exists and is eligible before generating provisioning data or invoking the physical bridge.
- If validation fails, do not trigger the hardware.

### Security middleware and logging

Preserve and review the existing Helmet, CORS and rate-limiting protections. Do not weaken production security or introduce unnecessary middleware.

- Production must explicitly require `NODE_ENV=production` and a configured `CORS_ORIGIN`.
- Do not hardcode provider-specific configuration before hosting is finalized.
- Preserve existing authentication and RFID rate limits, including any dedicated password-change limiter already implemented.
- Keep the existing security headers and error-handling behavior consistent.
- Use Winston as the centralized logger and Morgan for HTTP request logging if present or included in the current implementation; integrate request logs into the centralized logging pipeline.
- Prefer console/stdout logging for deployment portability.
- Never log passwords, JWTs, RFID tokens or shared secrets.

## 3. Resource-by-resource migration

Refactor incrementally, maintaining a working build after every phase.

**Phase 1 — Infrastructure**
- Introduce `AppError` and centralized error handling.
- Add `/health`.
- Separate Express application configuration from HTTP/WebSocket bootstrap.
- Standardize middleware organization.
- Review `tsconfig`, `rootDir` and `engines`.
- Keep `seed.ts` and `prisma.config.ts` executable through their intended tooling.
- Enforce explicit JWT algorithm handling.

**Phase 2 — Basic resources**
- Categories
- Responsible staff (`responsaveis`)
- Equipment

Move HTTP handling to controllers and business rules to services without changing successful response contracts.

**Phase 3 — Users and authentication**
- Audit and fix `GET /usuarios`, which currently appears to return empty objects.
- Verify required user-creation endpoints and add or fix them only where the existing contract requires.
- Ensure current database roles are enforced.
- Correct RFID provisioning validation order.
- Centralize logging and maintain secure secret comparisons.

**Phase 4 — Loans and occurrences**
- Migrate loan and occurrence logic.
- Preserve atomic stock updates and transaction rollback.
- Apply the transaction timeout consistently.
- Check for duplicate stock adjustments during occurrence resolution.
- Preserve existing loan editing and historical behavior.

**Phase 5 — Prisma schema, migrations and seed**
- Add indexes only when justified by actual queries.
- Add database constraints only when justified by domain invariants and compatible with existing data.
- Validate any SQL migration before applying it.
- Keep the seed idempotent and ensure re-running it does not overwrite an existing administrator's password.
- Preserve records; never use destructive resets as a shortcut.

## 4. Toolchain and documentation

Run the available dependency, type-check and build validations. Fix genuine TypeScript or peer-dependency problems without indiscriminately upgrading packages.

Keep the lockfile reproducible and verify that clean installation works.

Environment templates and bilingual deployment guides now document a static Cloudflare Pages frontend and a Docker backend behind Nginx/Cloudflare as a proposed topology. No Oracle host, DNS, TLS, Cloudflare policy, Cloudflare Pages project, hosted DB or deployment was verified or changed; keep those states clearly labelled as planned until externally verified.

No production hostname is authorized or verified by this repository. The operator must choose and verify the DNS names, TLS certificates, and provider configuration before replacing the placeholders in deployment templates. The separate Astro landing-page project is outside the scope of this backend refactoring.

## 5. Validation requirements

After each phase, run the relevant available checks:
- TypeScript type checking.
- Frontend and backend builds where affected.
- Tests for modified business logic.
- Prisma schema validation and client generation.
- Relevant route, authorization and stock transaction tests.

Do not run destructive database commands or production migrations without validation.

Pay particular attention to regressions in Guest Mode, role permissions, loan history, stock consistency, occurrence resolution, RFID provisioning and frontend API response shapes.

## Working instructions

The refactoring plan is approved. **Do not restart the architecture discussion or ask for approval again.** Begin with Phase 1, inspect the real repository and implement the changes directly in small, verifiable steps.

Avoid unrelated UI redesigns, new features, pagination, email recovery or unnecessary migrations. Preserve i18n and existing behavior unless a documented bug requires a correction.

At completion, provide a concise report containing:
1. What changed and the affected files.
2. Tests, type checks and builds actually executed, including their results.
3. Any remaining defects or risks.
4. Database migrations or environment changes still required before deployment.

The goal is a maintainable, secure backend that preserves the existing eduAssets/eduStation behavior and allows deployment preparation to proceed without unnecessary scope expansion.
