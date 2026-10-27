# Backend do eduAssets

[README em inglês](README.md) · [Aplicação frontend](https://github.com/edu-assets/app-eduassets)

> **Status: Beta.** Este repositório contém a API do eduAssets, a integração com o banco de dados e arquivos de suporte à implantação/operação do backend. A aplicação de navegador é mantida separadamente em [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets).

## Visão geral

O serviço eduAssets atende fluxos de inventário e empréstimo de equipamentos escolares. A API gerencia autenticação, acesso de convidado somente leitura, equipamentos e categorias, empréstimos e devoluções, ocorrências e integração opcional de login RFID.

A topologia de produção está dividida por serviço:

```text
Navegador → Cloudflare Pages: app.eduassets.tech
                            │ requisições HTTPS à API
                            ▼
                 Cloudflare → Nginx na VM Oracle
                            │ proxy pelo loopback
                            ▼
                     API Docker: 127.0.0.1:3000
                            │ PostgreSQL TLS
                            ▼
                          Neon
```

O frontend está em [`app-eduassets`](https://github.com/edu-assets/app-eduassets). Este repositório não contém a aplicação Pages nem sua configuração de build. A API é a fronteira de autorização; controles no frontend são apenas medidas de usabilidade.

## Conteúdo do repositório

- `backend/` — API Node.js/TypeScript, rotas Express, schema Prisma, testes e migrations;
- `deploy/` e `docker-compose.production.yml` — templates de implantação de Nginx e contêineres;
- `docs/` — runbooks operacionais do backend;
- `rpi/` e `eduStation/` — código opcional de suporte a RFID e dispositivos;
- `.env.example` e `.env.production.example` — somente templates de variáveis; nunca faça commit de segredos reais.

## Stack e segurança

- Node.js **>=22.12.0**, TypeScript e Express 5;
- Prisma 6 com PostgreSQL;
- hashes de senha com bcrypt, sessões baseadas em JWT, validação de requisições, limitação de taxa e cabeçalhos de segurança;
- cookies de sessão `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS de produção e restritos ao host; mutações autenticadas por cookie exigem um `Origin` confiável;
- a autorização é aplicada pelas políticas de rota do backend. Respostas de convidado usam DTOs minimizados e allowlisted; consultas sensíveis e mutações exigem autenticação;
- endpoints da bridge RFID opcional ficam desativados/bloqueados no deployment público por padrão.

Consulte a [Referência da API](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/REFERENCIA_API.md), o [guia de arquitetura](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/ARQUITETURA.md) e [Operação e recuperação](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/OPERACAO_E_RECUPERACAO.md) para os contratos detalhados. O repositório do frontend também contém a documentação bilíngue do produto e de implantação.

## Requisitos

- Node.js **22.12 ou mais recente** e npm;
- PostgreSQL para desenvolvimento local e testes;
- Docker Engine e Docker Compose para a implantação de produção documentada;
- Linux/Python e hardware RFID compatível somente se a bridge opcional for explicitamente habilitada.

## Desenvolvimento local

Na raiz do repositório:

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

No Windows PowerShell, use `Copy-Item .env.example backend/.env`. Edite `backend/.env` com uma URL de banco de desenvolvimento descartável e um `JWT_SECRET` exclusivo, com pelo menos 32 caracteres aleatórios. Não use credenciais de produção nos testes locais e não faça commit desse arquivo. O exemplo configura desenvolvimento local; use os templates e guias de implantação para valores de produção.

Aplique migrations somente ao banco de desenvolvimento correto e inicie a API:

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

Os scripts de raiz `npm run dev` e `npm run build` agora executam somente o backend. Em desenvolvimento, a API escuta por padrão em `127.0.0.1:3000`. O frontend é executado separadamente a partir do repositório `app-eduassets`; o proxy de desenvolvimento Vite desse repositório aponta para essa porta.

## Verificações do backend

```bash
npm --prefix backend test
npm --prefix backend run test:integration
npm run build
```

Os testes de integração exigem o PostgreSQL descartável configurado. O GitHub Actions verifica testes/build do backend e templates de implantação; não faz deploy no Cloudflare nem na VM Oracle.

## Operação de produção

A API é executada como serviço Docker Compose na VM Oracle Cloud, atrás do Nginx em `api.eduassets.tech`. O contêiner publica a porta somente no loopback do host; não exponha publicamente a porta `3000` nem o PostgreSQL.

Após uma alteração de código/configuração do backend, atualize e recrie o serviço da API pelo procedimento documentado:

```bash
cd /opt/eduassets
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --force-recreate api
```

Um reboot completo da VM não é necessário para alterações comuns da aplicação. Migrations de banco são operações separadas e explícitas; siga o guia de implantação e confirme os backups antes de aplicá-las. Consulte o [guia de implantação](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/GUIA_IMPLANTACAO.md), o [guia em inglês](https://github.com/edu-assets/app-eduassets/blob/main/public/docs/DEPLOYMENT.md) e o runbook local de [redefinição de senha](docs/ADMIN_PASSWORD_RESET_RUNBOOK.md).
