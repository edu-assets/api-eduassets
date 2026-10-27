# Frontend

## English

The browser application is maintained in [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets), not in this backend repository. It contains the login gate, role-aware UI, equipment/inventory workflows, settings, About panel, and documentation modal. The UI is TypeScript with Vite and native DOM rendering.

From a clone of `app-eduassets`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Production builds use the public `VITE_API_BASE_URL` setting for the API. `VITE_DOCS_BASE_URL` is optional; when configured, the documentation service tries the central docs repository first and falls back to the bundled Markdown. Never put secrets in `VITE_*` variables. The canonical bilingual documents are in [`docs-eduassets`](https://github.com/edu-assets/docs-eduassets), under `public/docs/`.

The frontend is deployed independently through its Cloudflare Pages pipeline. Frontend-only changes do not require a pull, rebuild, or restart on the Oracle API VM.

## Português

A aplicação de navegador é mantida em [`edu-assets/app-eduassets`](https://github.com/edu-assets/app-eduassets), não neste repositório do backend. Ela contém a tela de login, a interface por nível de acesso, os fluxos de equipamento/inventário, configurações, painel Sobre e modal de documentação. A UI usa TypeScript, Vite e renderização nativa do DOM.

Em um clone de `app-eduassets`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Builds de produção usam a variável pública `VITE_API_BASE_URL` para indicar a API. `VITE_DOCS_BASE_URL` é opcional; quando configurada, o serviço tenta primeiro o repositório central de documentação e mantém fallback para os Markdown incluídos no frontend. Nunca coloque segredos em variáveis `VITE_*`. A documentação bilíngue canônica está em [`docs-eduassets`](https://github.com/edu-assets/docs-eduassets), em `public/docs/`.

O frontend é implantado separadamente pelo pipeline Cloudflare Pages. Alterações somente do frontend não exigem pull, rebuild ou reinício da VM Oracle da API.
