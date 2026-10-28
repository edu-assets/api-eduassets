# Backend

## English

The backend repository (`edu-assets/api-eduassets`) contains the Node.js/TypeScript API, Express routes and middleware, Prisma schema/migrations, and optional RFID/device support. The root `npm run dev`, `npm run build`, and `npm test` scripts target the backend only.

### Local setup

Requirements: Node.js **22.12 or newer**, npm, and a disposable PostgreSQL database.

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

Set `DATABASE_URL` and a unique `JWT_SECRET` (at least 32 random characters) in the untracked `backend/.env`. Apply migrations only to the intended development database:

The runtime also validates `HOST`, `PORT`/`BACKEND_PORT`, `CORS_ORIGIN`, and `TRUST_PROXY`; `DIRECT_URL` is optional and falls back to `DATABASE_URL`. See `backend/.env.example` and `backend/src/config/runtimeConfig.ts` for the variable contract. Never document real values.

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

Run `npm test` and `npm run build` before proposing a backend change. Integration tests require an isolated PostgreSQL test database. Never use production credentials or data in local tests.

### Security and operations

The backend enforces authentication and authorization; UI checks are not a security boundary. Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` over production HTTPS. Cookie-authenticated mutations require a trusted `Origin`. Keep PostgreSQL and the API container on the documented restricted network path. RFID remains opt-in and requires a separate hardware/network review.

The reference Compose service binds the published API to VM loopback, keeps RFID disabled, checks `/ready`, and runs migrations/seeding only through the explicit `release` profile. The documented production service runs on the Oracle Cloud VM behind Nginx; this repository does not prove live service state. Backend releases follow the deployment and rollback procedure in the central [documentation repository](https://github.com/edu-assets/docs-eduassets). A full VM reboot is not normally required for an API container release; follow the current runbook, verify health, and do not apply migrations without an approved backup/change window.

## Português

O repositório backend (`edu-assets/api-eduassets`) contém a API Node.js/TypeScript, rotas e middlewares Express, schema/migrations Prisma e suporte opcional a RFID/dispositivos. Os scripts raiz `npm run dev`, `npm run build` e `npm test` atuam somente no backend.

### Configuração local

Requisitos: Node.js **22.12 ou mais recente**, npm e um banco PostgreSQL descartável.

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

Defina `DATABASE_URL` e um `JWT_SECRET` exclusivo (pelo menos 32 caracteres aleatórios) em `backend/.env`, que não deve ser versionado. Aplique migrations somente ao banco de desenvolvimento pretendido:

O runtime também valida `HOST`, `PORT`/`BACKEND_PORT`, `CORS_ORIGIN` e `TRUST_PROXY`; `DIRECT_URL` é opcional e usa `DATABASE_URL` como fallback. Consulte `backend/.env.example` e `backend/src/config/runtimeConfig.ts` para o contrato das variáveis. Nunca documente valores reais.

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

Execute `npm test` e `npm run build` antes de propor uma alteração no backend. Testes de integração exigem um banco PostgreSQL isolado. Nunca use credenciais ou dados de produção em testes locais.

### Segurança e operação

O backend aplica autenticação e autorização; verificações da UI não são fronteira de segurança. Os cookies de sessão são `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS de produção. Alterações autenticadas por cookie exigem `Origin` confiável. Mantenha PostgreSQL e o contêiner da API na rede restrita documentada. RFID continua opt-in e exige análise própria de hardware/rede.

O Compose de referência vincula a API publicada ao loopback da VM, mantém RFID desativado, consulta `/ready` e executa migrations/seed somente pelo perfil explícito `release`. O serviço de produção documentado roda na VM Oracle Cloud atrás do Nginx; este repositório não comprova o estado atual dos serviços. Releases seguem o procedimento de implantação e rollback do repositório central de [documentação](https://github.com/edu-assets/docs-eduassets). Um reboot completo da VM normalmente não é necessário para atualizar o contêiner; siga o runbook, verifique a saúde e não aplique migrations sem backup e janela aprovados.
