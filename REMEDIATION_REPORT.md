# Relatório final de remediação — eduAssets

**Data:** 22/10/2026 · **Status:** Beta; não pronto para produção.

## Escopo e alterações

- Mantidas as correções de segurança e integridade: JWT obrigatório, validação de ambiente, Guest DTOs allowlisted, proteção contra replay do timeout Admin, transações/locks de estoque e ocorrências, readiness mínima e deployment com proxy/backups configuráveis.
- Fechado o gap de logout: migration `20261022110000_user_session_version` adiciona `Usuario.sessionVersion`. Cada request protegido compara o claim com o banco. `POST /auth/logout` incrementa a versão e revoga JWTs anteriores da conta; troca de senha também revoga as demais sessões e devolve token renovado ao navegador atual. O frontend limpa o token de imediato e solicita revogação best-effort.
- Implementada e testada sincronização de stores em mudanças de autenticação: Guest carrega apenas os dados públicos, Editor/Administrador atualizam stores autorizadas sem reload, e logout limpa dados privados. RFID permanece no caminho existente e gated por flag.
- Adicionadas constraints SQL e índices em migration Prisma compatível com a versão 6. Seed exige contas explícitas, não sobrescreve contas/senhas existentes e rejeita admin/editor com email duplicado.
- Atualizada documentação PT/EN sobre TLS PostgreSQL, separando parâmetros libpq de parâmetros Prisma, operação de proxy/Cloudflare, limites de backup, efeito de reautenticação após migration e o PDF bilíngue do manual.
- Corrigido o contrato opcional de `DIRECT_URL`: Compose não o injeta vazio, a validação trata string vazia como ausente, o Prisma usa `DATABASE_URL` como fallback e há regressão explícita.
- Atualizada a CSP para permitir somente `https://api.eduassets.tech` além de `'self'`; esse é o hostname documentado/intencional, não uma verificação de DNS ou headers Vercel.
- O Docker agora instala `openssl` no stage compartilhado (herdado por migração/runtime) e executa `node dist/src/server.js` diretamente; o CI ganhou um job de smoke em produção com PostgreSQL descartável, migrações, `/ready`, filesystem somente leitura e encerramento limpo.
- O template Nginx retorna 404 para `/auth/rfid` e `/ws/rfid` na instância pública; o loopback do backend permanece apenas para o quiosque local e não é tratado como autenticação atrás de proxy.
- O desenvolvimento local gera o Prisma Client no install/build e aplica migrations somente por comando explícito `npm run dev:db`; erros Prisma de conexão/schema retornam 503 traduzível, o frontend verifica `/ready` antes das cargas da sessão e `npm run dev` encerra o frontend se o backend falhar.

## Validação executada

No sandbox, exclusivamente com dados e credenciais sintéticos:

- Backend: `JWT_SECRET=<synthetic> NODE_ENV=test npm test` passou em 30/30 testes, incluindo a classificação de falhas Prisma. Build TypeScript e `prisma generate` passaram.
- `prisma validate` passou com `DIRECT_URL` omitido e com `DIRECT_URL=''`, usando `DATABASE_URL` sintética como fallback.
- Frontend: 36 testes em 9 arquivos, `npm run typecheck` e `VITE_API_BASE_URL=https://api.eduassets.tech npm run build` passaram.
- Asserções estáticas da CSP e dos blocos Nginx RFID passaram; `git diff --check` passou.
- O remote Git canônico (`edu-assets/eduAssets`) foi confirmado; o checkout atual contém as correções desta rodada; `package.json` foi alinhado ao mesmo repositório, corrigindo o metadata antigo `dasilva-thiago/edu-assets`.
- Docker, PostgreSQL local, `pg_isready`, Nginx e Compose não estão disponíveis neste sandbox; YAML foi validado com PyYAML localmente. Portanto, migrations, seed, testes de integração, build/execução da imagem, `/ready` contra PostgreSQL, shutdown do container e `nginx -t` não foram executados.
- O run hospedado `39806752284` pertence a um HEAD anterior e não valida este conjunto de alterações. O novo job de smoke em `NODE_ENV=production` ainda não foi executado; o hostname `api.eduassets.tech` também não teve DNS, TLS, Vercel ou headers reais verificados.

O build do frontend emitiu avisos não bloqueantes sobre loader/configuração Vite, CSS vazio em `footer.css` e chunk ExcelJS acima de 500 kB. Não foram feitas otimizações fora do escopo.

A documentação oficial do PostgreSQL descreve o comportamento de verificação TLS do libpq; os parâmetros efetivos devem ser confirmados separadamente para libpq e Prisma [1].

## Auditoria de dependências

A auditoria completa do backend reportou três vulnerabilidades high na cadeia de desenvolvimento `prisma` → `@prisma/config` → `deepmerge-ts` (GHSA-ggr8-5vv4-36mx, stack exhaustion em grafos recursivos). `npm audit --omit=dev` ainda reportou a cadeia do Prisma no lockfile atual; o resultado observado foi de 3 high. A origem é a cadeia da ferramenta Prisma no lockfile; o impacto do runtime de produção precisa ser confirmado no container com instalação omitindo devDependencies; não foi aplicado `npm audit fix --force` nem upgrade major sem validação. Reavaliar quando houver versão Prisma compatível que elimine a cadeia.

## Pendências e checklist do operador

- [ ] Confirmar GitHub Actions hospedado no repositório/HEAD corretos após a correção, incluindo o novo smoke de produção.
- [ ] Executar o stack Compose e validar Nginx (`nginx -t`), DNS, firewall, origem, ranges Cloudflare atuais, CORS/CSP e headers no host-alvo. A configuração e os bloqueios foram revisados estaticamente, mas o stack não subiu.
- [ ] Em PostgreSQL gerenciado, confirmar hostname/CA do provedor e conexão TLS verificada; fazer backup antes da migration, aplicar primeiro em staging e comprovar restauração em banco vazio.
- [ ] Planejar novo login dos usuários na release da migration `sessionVersion`, que invalida tokens emitidos sem o novo claim. Se a chamada de logout estiver offline/falhar, token copiado pode continuar válido até expirar.
- [ ] Aprovar grants/RLS e retenção de dados no provedor, monitoramento/RPO/RTO, QA manual de navegador/acessibilidade e hardware RFID. Manter RFID público desativado até teste de rede e hardware.

Nenhum banco local/remoto, dado real, segredo, DNS, host, firewall ou serviço de produção foi acessado/alterado; não houve deployment. Execução do stack Compose, container contra PostgreSQL, Nginx, backup/restore externo, Vercel, TLS gerenciado, browser em produção e hardware permanecem não verificados. A atividade de inatividade Admin ainda usa estado em memória e requer uma instância até que seja compartilhada.

## Arquivos-chave

Código: `backend/src/lib/jwt.ts`, `backend/src/middlewares/auth.ts`, `backend/src/services/auth.service.ts`, `backend/src/routes/auth.ts`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261022110000_user_session_version/` e `frontend/src/core/state/authStore.ts`.

Documentação e operação: `frontend/public/docs/DEPLOYMENT.md`, `frontend/public/docs/GUIA_IMPLANTACAO.md`, `frontend/public/docs/ARCHITECTURE.md`, `frontend/public/docs/ARQUITETURA.md`, `frontend/public/docs/ROADMAP.md`, `frontend/public/docs/ROADMAP_EN.md`, manuais Markdown e `frontend/public/docs/eduAssets_manual.pdf`.

[1]: https://www.postgresql.org/docs/current/libpq-ssl.html "PostgreSQL SSL Support"
