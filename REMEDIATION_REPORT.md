# Relatório final de remediação — eduAssets

**Data:** 22/10/2026 · **Status:** Beta; não pronto para produção.

## Escopo e alterações

- Mantidas as correções de segurança e integridade: JWT obrigatório, validação de ambiente, Guest DTOs allowlisted, proteção contra replay do timeout Admin, transações/locks de estoque e ocorrências, readiness mínima e deployment com proxy/backups configuráveis.
- Fechado o gap de logout: migration `20261022110000_user_session_version` adiciona `Usuario.sessionVersion`. Cada request protegido compara o claim com o banco. `POST /auth/logout` incrementa a versão e revoga JWTs anteriores da conta; troca de senha também revoga as demais sessões e devolve token renovado ao navegador atual. O frontend limpa o token de imediato e solicita revogação best-effort.
- Implementada e testada sincronização de stores em mudanças de autenticação: Guest carrega apenas os dados públicos, Editor/Administrador atualizam stores autorizadas sem reload, e logout limpa dados privados. RFID permanece no caminho existente e gated por flag.
- Adicionadas constraints SQL e índices em migration Prisma compatível com a versão 6. Seed exige contas explícitas, não sobrescreve contas/senhas existentes e rejeita admin/editor com email duplicado.
- Atualizada documentação PT/EN sobre TLS PostgreSQL (`sslmode=verify-full` com CA confiável e hostname correspondente), operação de proxy/Cloudflare, limites de backup, efeito de reautenticação após migration e o PDF bilíngue do manual.

## Validação executada

No sandbox, exclusivamente com dados e credenciais sintéticos:

- Frontend: 35 testes em 9 arquivos, `npm run typecheck` e `npm run build` aprovados.
- Backend: 24 testes unitários, build TypeScript e `prisma validate` aprovados; a suíte de integração passou em 9/9 casos.
- PostgreSQL 16 local descartável: as 6 migrations aplicaram do zero; seed executado duas vezes. Uma segunda execução com outra senha não substituiu a senha cadastrada, confirmada pelo teste de login. Cobertos Guest DTOs/negação, logout e troca de senha revogáveis, estoque e concorrência de empréstimos/ocorrências.
- `tsc --noEmit -p tsconfig.integration.json`, parse Python/JSON/YAML, `sh -n` dos scripts e `git diff --check` passaram. O PDF atualizado contém 17 páginas e foi inspecionado visualmente.
- A primeira execução hospedada falhou porque o Prisma Client ainda não tinha sido gerado antes do seed. O workflow foi corrigido e a execução `9842516` passou integralmente: migration/seed, testes, builds frontend/backend, startup/readiness, targets Docker runtime/migration e validação de configuração Compose. [Execução CI](https://github.com/edu-assets/eduAssets/actions/runs/39805708848).

Os builds aprovados mantêm avisos não bloqueantes já observados: loader/configuração Vite, CSS vazio em `footer.css` e chunk ExcelJS acima de 500 kB. Não foram feitas otimizações fora do escopo de segurança e release.

O runner também emitiu avisos de migração de Actions Node 20 e do label `ubuntu-latest`; o job passou usando os runtimes disponibilizados. Revisar versões de Actions e imagem do runner antes de uma atualização planejada do CI.

A documentação oficial do PostgreSQL descreve que `verify-full` valida a cadeia de confiança e o hostname, e recomenda esse modo em ambientes sensíveis [1].

## Pendências e checklist do operador

- [x] Confirmar GitHub Actions hospedado verde após a correção do Prisma, incluindo builds Docker e parse da configuração Compose.
- [ ] Executar o stack Compose e validar Nginx (`nginx -t`) no host-alvo. CI construiu as imagens, mas não subiu o stack de produção.
- [ ] Validar Nginx com `nginx -t`, DNS, firewall, origem e ranges Cloudflare atuais, CORS/CSP e headers no host real.
- [ ] Em PostgreSQL gerenciado, confirmar hostname/CA do provedor e conexão TLS verificada; fazer backup antes da migration, aplicar primeiro em staging e comprovar restauração em banco vazio.
- [ ] Planejar novo login dos usuários na release da migration `sessionVersion`, que invalida tokens emitidos sem o novo claim. Se a chamada de logout estiver offline/falhar, token copiado pode continuar válido até expirar.
- [ ] Aprovar grants/RLS e retenção de dados no provedor, monitoramento/RPO/RTO, QA manual de navegador/acessibilidade e hardware RFID. Manter RFID público desativado até teste de rede e hardware.

Nenhum banco remoto, dado real, segredo, DNS, host, firewall ou serviço de produção foi acessado/alterado; não houve deployment. Execução do stack Compose, Nginx, backup/restore externo, Vercel, TLS gerenciado, browser em produção e hardware permanecem não verificados. A atividade de inatividade Admin ainda usa estado em memória e requer uma instância até que seja compartilhada.

## Arquivos-chave

Código: `backend/src/lib/jwt.ts`, `backend/src/middlewares/auth.ts`, `backend/src/services/auth.service.ts`, `backend/src/routes/auth.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261022110000_user_session_version/` e `frontend/src/core/state/authStore.ts`.

Documentação e operação: `frontend/public/docs/DEPLOYMENT.md`, `frontend/public/docs/GUIA_IMPLANTACAO.md`, `frontend/public/docs/ARCHITECTURE.md`, `frontend/public/docs/ARQUITETURA.md`, `frontend/public/docs/ROADMAP.md`, `frontend/public/docs/ROADMAP_EN.md`, manuais Markdown e `frontend/public/docs/eduAssets_manual.pdf`.

[1]: https://www.postgresql.org/docs/current/libpq-ssl.html "PostgreSQL SSL Support"
