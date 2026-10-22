# Relatório de remediação — eduAssets

**Data:** 22/10/2026 · **Escopo:** alterações no checkout atual, sem commit, push, deployment, acesso a banco remoto ou alteração de infraestrutura. Este relatório substitui o registro anterior, que continha estados obsoletos.

## Veredito executivo

**Não pronto para produção.** Foram corrigidos problemas de segurança e integridade e criados artefatos de CI/implantação; testes unitários, typecheck, builds e validação de schema passaram localmente. Porém, os testes HTTP concorrentes contra PostgreSQL, a execução hospedada do CI e os alvos Docker não foram executados. Também não foram validados host, proxy, TLS, backup/restore, Vercel ou hardware. A existência de templates não é evidência de operação.

## Matriz de achados e execução

| Item / risco | Implementação e evidência atual | Estado / risco residual |
|---|---|---|
| B1 — fallback de banco/autenticação em memória | Removidos `InMemoryDb`/proxy e credenciais de demonstração; Prisma tipado; configuração ausente/inválida não cria persistência fictícia; `/ready` retorna indisponibilidade genérica e limitada. | **Corrigido no código.** Testes unitários/build; indisponibilidade de banco real não foi exercitada. |
| B2 — middleware admin assíncrono | Fluxo de autorização aguarda/propaga falhas de autenticação. | **Corrigido no código.** Sem teste HTTP com banco nesta execução. |
| B3 — bridge/WebSocket sem flag/rotas inválidas | Inicialização exige `RFID_BRIDGE_ENABLED=true`; upgrades inválidos são recusados; Compose público força RFID desligado e não encaminha `/ws`. | **Corrigido no código/template.** Simulação de proxy/rede não executada. |
| B4 — segredo JWT padrão | `JWT_SECRET` obrigatório onde token é usado, mínimo 32 caracteres; sem fallback previsível. | **Corrigido e coberto por testes de config/JWT.** Segredo de produção permanece externo. |
| B5 — frameguard desabilitado | Headers de segurança reativados; Vercel contém CSP, anti-frame, MIME, referrer e permissions headers. | **Corrigido em código/config.** Headers efetivamente servidos por Vercel não verificados. |
| B6 — detecção CORS/ambiente | Config central valida `NODE_ENV`, origens HTTP(S) exatas, allowlist e trust proxy; modo permissivo limitado a desenvolvimento local. | **Corrigido em código/testes unitários.** CORS/preflight ponta-a-ponta não executado. |
| B7 — dados pessoais em leituras públicas / PostgREST | DTOs allowlist por endpoint minimizam empréstimos/ocorrências/equipamentos; responsáveis e usuários exigem login; Guest permanece somente leitura. O app usa Prisma direto e não possui rota PostgREST identificada. | **Minimização da API corrigida/testada.** Provedor não acessado; grants/RLS só se aplicam se esse serviço estiver exposto. Banco demo sintético isolado não foi provisionado. |
| B8 — contratos de porta/host | `PORT` precede `BACKEND_PORT`, cada valor fornecido é validado; padrão 3000; bind/trust proxy explícitos para produção. Bridge permanece em 3001/loopback. | **Corrigido em código/docs/testes unitários.** Backend e hardware não iniciados simultaneamente. |
| B9 — geração/build/execução Prisma | Build gera Prisma Client antes de TypeScript; Docker separa runtime/migration; runtime não usa `tsx`; Node `>=22.12.0` alinhado a CI/Docker. | **Install limpa, geração e build local aprovados.** Build de imagem e migration stage não executados (Docker indisponível). |
| B10 — `DIRECT_URL` inconsistente | `directUrl` removido do schema; `prisma.config.ts` usa fallback `DATABASE_URL`; migration script usa config explicitamente. | **Schema validado, geração/build sem `DIRECT_URL` aprovados.** `migrate deploy`/seed não executados sem PostgreSQL descartável. |
| B11 — versão Node ausente | Versão mínima declarada nos manifests; Node 22.13 no CI/Docker e no ambiente desta execução. | **Corrigido e compatibilidade local testada.** Não testado em todos os hosts-alvo. |
| B12 — timeout de escrita RFID sem cartão | Leitor valida UID ausente antes de selecionar/escrever e retorna timeout seguro em vez de encerrar o loop. | **Corrigido no código; sintaxe Python passou.** Sem hardware/leitor para teste funcional. |
| B13 — unit systemd com caminhos/conta inconsistentes | Unit usa usuário/grupo dedicado, caminhos de instalação, arquivo env consistente com permissão 600, restart e hardening. | **Corrigido no arquivo.** `systemd-analyze verify` não completou porque `/opt/eduassets-rfid/venv/bin/python3` ainda não existe no sandbox; verificação/instalação no host-alvo pendentes. |
| B14 — GPIO Raspberry Pi 5 | Sem hardware/OS para confirmar biblioteca/pinos; dependências GPIO não foram trocadas por suposição; RFID público fica desligado. | **Bloqueado por hardware/OS-alvo.** Exige teste real de leitura/escrita. |
| F1 — atributo `data-medidas` | Escape contextual por helper de atributo; sem `raw()` para o campo não confiável; teste para atributo. | **Corrigido/testado.** Fluxo visual em browser pendente. |
| F2 — tradução sem itens | Chave e uso PT/EN verificados/corrigidos. | **Corrigido; suite frontend/build passaram.** |
| F3 — spinner/estado obsoleto de devolução | Estado visual e origem de dados atualizados somente após operação concluída; botão correto. | **Corrigido.** Teste manual de browser pendente. |
| F4 — stores após cadastro | Stores dependentes recarregam após criação bem-sucedida. | **Corrigido no código.** Fluxo DB/browser ponta-a-ponta pendente. |
| F5 — CSV/filtro/data | BOM, escape de delimitadores/aspas/quebras, neutralização de fórmulas e filtros inclusivos pelo calendário local. | **Corrigido; testes em UTC e `America/Sao_Paulo` passaram previamente e suite final passou.** Excel/LibreOffice não abertos nesta execução. |
| F6 — JWT expirado/401 | 401 limpa token/sessão mesmo sem usuário hidratado; 403 e falha de rede não são tratados como expiração. | **Corrigido no código/testes disponíveis.** Fluxo real de navegador pendente. |
| F7 — data de devolução ignorada | API valida e persiste timestamp offset-aware selecionado; clientes antigos podem omitir e usar hora do servidor. | **Corrigido; schema de request testado.** Persistência PostgreSQL ainda pendente. |
| P1 — senha atual incorreta encerra sessão | Erro de regra de negócio não é classificado como sessão expirada; auth distingue sessão ausente/inválida. | **Corrigido no código.** Teste API real pendente. |
| P1 — trust proxy/rate limits | Proxy trust deixou de ser implícito e só aceita valores validados; produção exige declaração. Nginx sobrescreve forwarding headers e exige ranges atuais de Cloudflare. | **Parcialmente verificado.** Ranges, spoofing, NAT e rate-limit precisam de host/CI integration test; rede real não testada. |
| P1 — timeout administrativo replay | Expiração usa identificador JWT e falha fechada sem estado confiável; o mesmo JWT não recomeça como sessão nova. | **Corrigido/teste unitário passou.** Estado é `Map` local: single instance; antes de escalar, compartilhar estado de sessão. |
| P2 — concorrência empréstimo/ocorrência | Lock/transições condicionais em transações evitam devolução, edição, resolução/exclusão concorrentes e estoque duplicado; testes HTTP concorrentes criados. | **Implementado; suite integra compila.** Não executada contra PostgreSQL; estado concorrente no banco não verificado. |
| P2 — host/rede API | Compose publica somente `127.0.0.1`; bridge fora do Compose público. | **Template criado; Docker e firewall indisponíveis/não executados.** |
| P2 — RFID token reutilizável | Cartão usa token aleatório opaco; servidor persiste hash; JWT de sessão não é armazenado no cartão. | **Risco reduzido, não eliminado:** MIFARE é clonável e chave/cartão dependem de hardware; RFID isolado e desativado publicamente, não deve ser chamado MFA seguro. |
| P2 — cobertura integração | 5 testes HTTP cobrem Guest/negação, login/senha, devolução concorrente, edição-vs-retorno e resolução concorrente com estoque. | **Adicionado e compila.** Execução exige PostgreSQL descartável no CI; não rodou localmente. |
| D1 — Vercel/API/CSP | Vercel é configuração primária; `VITE_API_BASE_URL` obrigatório em build de produção; CSP contém domínio proposto e precisa ser atualizada para origem verificada; `_headers` alternativo removido. | **Código/docs alinhados.** Preview e headers reais Vercel não verificados. |
| D2 — README inconsistentes | READMEs e docs atualizados para scripts, Guest, portas, devolução, env e limites de deployment. | **Pares PT/EN revisados; verificação de links Markdown relativos encontrou 0 faltantes em 23 arquivos.** PDF mantém os títulos dos dois idiomas; o relatório interno não é publicado com os assets frontend. |
| D3 — licença MIT/ISC | `LICENSE` e manifests alinhados a MIT. | **Corrigido.** |
| D4 — lixo/markup | Marcador editorial removido; atributo separado e seguro; referências obsoletas revisadas; configurações redundantes e metadata/lockfiles alinhados. | **Corrigido; busca final não encontrou marcadores editoriais nem claims obsoletos nos docs ativos.** |
| D5 — UX Guest | Ações `data-requires-auth`/`data-requires-admin` têm estilo visual indisponível em Guest/Editor; backend continua autoridade. | **Melhorado parcialmente.** Teclado/leitor de tela e QA acessível não foram validados manualmente. |
| P0 — artefatos de implantação | Multi-stage Docker, Compose loopback/RFID off, Nginx/Cloudflare template, env production, liveness/readiness, backup/restore somente em DB vazio e guias PT/EN. | **Artefatos escritos.** Docker/Nginx/backup/restore/monitoramento não executados em serviço real. |
| CI/health/login timing/limpeza | GitHub Actions com PostgreSQL, migrations/seed, unit/integration tests, builds, smoke `/ready`, Docker targets e Compose; readiness limitada; dummy bcrypt mitiga enumeração. | **Workflow preparado, não acionado.** Não se afirma CI hospedado nem monitoramento configurado. |

## Arquivos e artefatos principais

- **Segurança/runtime:** `backend/src/config/runtimeConfig.ts`, `backend/src/lib/{prisma,jwt,adminActivity,readiness,publicDto}.ts`, middlewares/auth/services/controllers/rotas de empréstimos e ocorrências.
- **Frontend e RFID:** filtros CSV/data, retorno, auth/session timeout, templates HTML com atributos escapados, `frontend/src/styles/components/auth.css`, `rpi/rfid/spi_rfid_reader.py`, `rpi/rfid/eduassets-rfid.service`.
- **Build/testes:** manifests/lockfiles, `backend/prisma/schema.prisma`, `backend/tsconfig.integration.json`, `backend/integration-tests/api.integration.test.ts`, `.github/workflows/ci.yml`.
- **Operação:** `.env.example`, `.env.production.example`, `backend/Dockerfile`, `docker-compose.production.yml`, `deploy/nginx/`, `deploy/scripts/`.
- **Documentação:** READMEs, arquitetura, changelog, modelo de dados, manuais, roadmaps e guias de implantação PT/EN; PDF bilíngue do manual.

## Evidência local

Instalação limpa por lockfile passou na raiz, backend e frontend (`npm ci --no-audit --no-fund`, usando `--prefix` nos dois pacotes). `npm ci` emitiu avisos de dependências transitivas depreciadas; nenhuma atualização em massa foi feita.

| Verificação | Resultado |
|---|---|
| `JWT_SECRET=<sintético> DATABASE_URL=<sintético> npm --prefix backend test` | **20/20 testes passaram.** Um primeiro run falhou por fixture sem `DATABASE_URL`; expectativa corrigida e run posterior passou. |
| `cd backend && npx tsc --noEmit -p tsconfig.integration.json` | **Passou** (compilação da suite; não executa requests). |
| `cd backend && unset DIRECT_URL && DATABASE_URL=<sintético> npx prisma validate --config prisma.config.ts` | **Passou** sem `DIRECT_URL`. |
| `env -u DIRECT_URL ... npm --prefix backend run build` | **Passou**, incluindo `prisma generate` e TypeScript. |
| `npm --prefix frontend run typecheck` | **Passou.** |
| `npm --prefix frontend test -- --reporter=dot` | **29/29 testes, 6 arquivos passaram.** |
| `VITE_API_BASE_URL=https://api.example.invalid npm --prefix frontend run build` | **Passou.** Avisos: loader nativo Vite, `footer.css` vazio e chunk ExcelJS acima de 500 kB. |
| `python3 -m py_compile ...` | **Passou** para os dois scripts RFID; não substitui teste de hardware. |
| `bash -n` nos scripts backup/restore, parse JSON, links Markdown e `git diff --check` | **Passaram nesta validação final**; 23 Markdown examinados, 0 links relativos faltantes. |

## O que não foi executado / bloqueios

- `docker`, `podman`, `nginx`, `psql` e `pg_restore` não estão disponíveis neste ambiente. Não foram executados migrations, seed, integration tests com DB, builds de imagem, Compose, Nginx, backup ou restore. `systemd-analyze verify` não concluiu porque o interpretador no caminho de instalação do unit não existe neste sandbox.
- Ruby e parsers YAML não estão disponíveis nos pacotes instalados; os arquivos JSON passaram no parse, mas YAML do workflow/Compose não recebeu validação automatizada local.
- A suíte PostgreSQL compila, mas precisa rodar no workflow hospedado/ambiente isolado; CI ainda não foi acionado.
- Sem credenciais/autorização para Vercel, Oracle/VM, Cloudflare, domínio, certificado ou banco gerenciado; nenhuma DNS, grant/RLS, firewall, segredo, dado ou serviço remoto foi alterado.
- Sem Raspberry Pi/leitor/OS-alvo para validar GPIO, cartão, systemd ou UX RFID. Risco de clonagem MIFARE permanece; mantenha RFID desligado na API pública.
- Timeout de administrador em memória só é consistente em uma instância; compartilhamento de estado é requisito antes de escalar.
- QA de navegador, acessibilidade, CORS/proxy real, rate limit com NAT/Cloudflare e abertura no Excel/LibreOffice permanecem pendentes.

## Checklist de liberação

- [ ] **Antes de demo pública:** CI verde; testes PostgreSQL e Docker; DB demo dedicado e sintético; `VITE_API_BASE_URL`, CSP, CORS, proxy, firewall, TLS e headers verificados no host; RFID desligado.
- [ ] **Antes de dados pessoais/escolares:** revisão de privacidade, grants/perfis do provedor e isolamento de DB; política de acesso/retenção; monitoring/incident response; backup cifrado fora do host e restore drill comprovado.
- [ ] **Antes de produção:** segredo forte e rotação operacional, staging smoke tests, migration após backup confirmado, rollout/rollback compatível com schema, readiness, rate limits/logs monitorados; domínio/Cloudflare/Vercel confirmados.
- [ ] **Antes de quiosque RFID:** hardware/OS suportados, dependências/pinos/cartão testados, segredos em arquivo restrito, loopback/rede/firewall revisados; avaliar cartão clonável sem chamá-lo MFA.
- [ ] **Futuro:** sessão compartilhada para múltiplas instâncias, granularidade de permissões/unidades, recuperação de senha e melhorias acessíveis do roadmap.

---

**Sem commit ou push nesta execução. Nenhum deployment, operação destrutiva de banco, alteração de segredo ou infraestrutura foi realizado.**
