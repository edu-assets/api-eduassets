# eduAssets

<div align="center">
  <img src="assets/eduAssets_banner.webp" alt="eduAssets — inventário e empréstimos de equipamentos escolares" width="100%">
</div>

[README em inglês](README.md) · [Frontend](frontend.md) · [Backend](backend.md) · [Repositório de documentação](https://github.com/edu-assets/docs-eduassets) · [Runbook de segurança e recuperação](deploy/SEGURANCA-E-OPERACOES.md)

> **Status: Versão oficial 1.0.1.** O eduAssets é uma aplicação de inventário e empréstimo de equipamentos escolares. Frontend, backend, documentação e portfólio agora têm repositórios separados. Este README apresenta o produto como um todo; os guias detalhados e o histórico de versões são mantidos no repositório central de documentação.

## Visão geral

A aplicação oferece empréstimos e devoluções de equipamentos, consultas de estoque/histórico, ocorrências, CRUD administrativo, exportações e login RFID opcional. Os níveis de acesso incluem Convidado somente leitura, Editor e Administrador. O cliente atual usa TypeScript e renderização nativa do DOM; React continua no roadmap, não é uma dependência atual.

## Mapa dos repositórios

| Repositório | Responsabilidade |
| --- | --- |
| [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets) | Aplicação frontend, tela inicial de login, painel Sobre/modal de documentação e build do Cloudflare Pages. |
| [`edu-assets/api-eduassets`](https://github.com/edu-assets/api-eduassets) | API backend, integração Prisma/PostgreSQL, bridge RFID opcional e templates de implantação. Este repositório. |
| [`edu-assets/docs-eduassets`](https://github.com/edu-assets/docs-eduassets) | Documentação canônica bilíngue em Markdown e PDF, compartilhada entre os projetos. |
| [`edu-assets/site-eduAssets`](https://github.com/edu-assets/site-eduAssets) | Site público do portfólio e visão geral do projeto. |

## Arquitetura de execução

```text
Navegador ── Cloudflare Pages (app.eduassets.tech)
   │ chamadas HTTPS à API
   ▼
Cloudflare / Nginx ── Oracle Cloud VM
   │ proxy de loopback
   ▼
API Node.js / Express ── PostgreSQL

Leitor/bridge RFID local opcional ── endpoints RFID restritos do backend
```

A API é a fronteira de segurança. O app no navegador usa sessões exclusivamente por cookie (`HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS de produção e prefixo `__Host-`) e nunca persiste JWT em `localStorage`; se não confirmar suporte à sessão por cookie, o login falha fechado. A API ainda aceita Bearer para clientes legados não-browser, não como fallback do app. Alterações autenticadas por cookie exigem `Origin` confiável. Respostas de Convidado usam allowlists minimizadas no servidor, e as permissões de escrita são aplicadas nas rotas do backend. O fluxo RFID opcional fica desabilitado ou bloqueado na implantação pública por padrão.

A topologia acima corresponde ao desenho de implantação documentado; esta alteração de repositório não inspeciona, reinicia nem modifica a VM Oracle ou serviços hospedados.

## Desenvolvimento local do backend

Requisitos: Node.js **22.12 ou mais recente**, npm e um banco PostgreSQL para desenvolvimento local.

```bash
npm ci --prefix backend
cp .env.example backend/.env
```

Defina em `backend/.env` uma `DATABASE_URL` de desenvolvimento descartável e um `JWT_SECRET` exclusivo com pelo menos 32 caracteres aleatórios. Nunca use credenciais de produção em testes locais nem faça commit de arquivos de ambiente. Aplique migrations somente ao banco de desenvolvimento pretendido e execute:
O runtime também valida `HOST`, `PORT`/`BACKEND_PORT`, `CORS_ORIGIN` e `TRUST_PROXY`; `DIRECT_URL` é opcional e usa `DATABASE_URL` como fallback. Consulte `backend/.env.example` e `backend/src/config/runtimeConfig.ts` para nomes e semântica. Não inclua valores reais na documentação.

```bash
npm --prefix backend run migrate:deploy
npm run dev
```

Verificações úteis:

```bash
npm test
npm run build
npm run test:integration  # exige banco PostgreSQL isolado para testes
```

`npm run dev` e `npm run build` na raiz deste repositório atuam somente no backend. A configuração e os comandos do frontend estão em [frontend.md](frontend.md); os detalhes do backend, em [backend.md](backend.md).

## Documentação e implantação

Os guias bilíngues canônicos ficam em [`docs-eduassets`](https://github.com/edu-assets/docs-eduassets). O modal Sobre mantém seu catálogo e renderizador no repositório do app e pode carregar o Markdown central quando a origem pública estiver configurada; cópias incluídas no frontend permanecem como fallback até validar a leitura remota em produção. O [runbook de segurança e recuperação](deploy/SEGURANCA-E-OPERACOES.md) deste repositório cobre política de Administradores/RFID, restrição de origem, backups criptografados e o exercício local de restauração datado.

O GitHub Actions valida o código e os templates de implantação; não publica o frontend, não reinicia a API e não reinicia a VM. Alterações somente de documentação ou frontend não exigem reinicialização da VM Oracle. Releases do backend seguem o procedimento documentado de atualização da API e normalmente não exigem reboot completo da VM.

## Licença

MIT. Consulte [LICENSE](LICENSE) para o texto oficial.
