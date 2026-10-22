# eduAssets

<div align="center">
  <img src="frontend/public/assets/img/eduAssets_banner.png" alt="Banner eduAssets" width="100%">
</div>

[README raiz em inglês](README.md) · [Documentação em inglês](frontend/public/docs/README.md) · [Documentação em português](frontend/public/docs/LEIAME.md) · [Guia de implantação em inglês](frontend/public/docs/DEPLOYMENT.md) · [Guia de implantação em português](frontend/public/docs/GUIA_IMPLANTACAO.md)

> **Status: Beta.** O checkout contém um frontend Vite/TypeScript e um backend Node/Express/TypeScript funcionais, autenticação, modo convidado, operações de empréstimo/devolução, controle de ocorrências, exportações e uma integração RFID opcional. Não há um deployment público operacional documentado neste repositório; os passos abaixo descrevem desenvolvimento local e preparação técnica, não uma infraestrutura já publicada. RFID está desligado na implantação pública. Migrations, seed, Docker e testes de integração com o banco não foram executados neste sandbox; os arquivos de implantação são templates e nenhum deployment foi realizado.

## Visão geral

**eduAssets** é uma aplicação para empréstimo de equipamentos escolares e gestão de inventário. Foi projetada para fluxos operacionais frequentes usados por administradores e editores, e não para rastreamento de números de série por unidade.

A aplicação abrange:

- registro de empréstimos e devoluções de equipamentos;
- consultas de estoque e histórico de empréstimos com pesquisa/filtros;
- ocorrências de equipamentos (observação, manutenção e itens quebrados);
- administração CRUD de categorias, equipamentos, responsáveis e usuários;
- exportações CSV, Excel e PDF; e
- sessões autenticadas, permissões de administrador/editor, acesso somente leitura para convidados e login opcional por cartão físico via RFID.

A interface também inclui seleção persistente de tema Claro / Escuro / Sistema. O frontend atual usa TypeScript e renderização nativa do DOM; React é um item futuro do roadmap, não uma dependência atual.

## Topologia de execução

Na configuração local padrão, os processos seguem esta organização:

```text
Navegador ── http://localhost:5173 ── servidor de desenvolvimento Vite
                                          │ proxy (/auth, /usuarios, /ws, ...)
                                          ▼
                                     API :3000 ── PostgreSQL

Bridge RFID opcional ── backend /auth/rfid (somente loopback)
                     └─ provisionador local http://127.0.0.1:3001/provision
```

- O backend escuta na **porta 3000 por padrão**. `PORT` tem precedência sobre `BACKEND_PORT`; cada valor fornecido é validado, e um valor inválido faz a inicialização falhar em vez de usar silenciosamente um valor alternativo.
- `HOST` é usado quando definido. Sem essa variável, o servidor usa `127.0.0.1` fora de produção e `0.0.0.0` em produção. O deployment Docker selecionado publica o contêiner somente no loopback do host.
- O Vite escuta em **`0.0.0.0:5173`** e encaminha os caminhos da aplicação e `/ws` para **`127.0.0.1:3000`**.
- O cliente de API do frontend usa URLs relativas quando `VITE_API_BASE_URL` está vazio, o que é conveniente no desenvolvimento com o proxy do Vite. Uma build de frontend para produção exige `VITE_API_BASE_URL`.
- A bridge RFID opcional inicia um serviço HTTP local de provisionamento em **`127.0.0.1:3001`**. Essa não é a API da aplicação nem uma porta pública.

## Stack tecnológica

### Frontend

- Node.js **>=22.12.0** (execução local no checkout: Node 22.13), TypeScript e módulos ES;
- [Vite](https://vitejs.dev/) 8, configurado em `frontend/vite.config.ts`;
- camadas organizadas por funcionalidade em `src/core`, `src/features`, `src/shared` e `src/types`;
- `flatpickr` para entradas de data/hora;
- ExcelJS, jsPDF e `jspdf-autotable` para exportações;
- `marked` para renderização Markdown; e
- tokens CSS customizados com temas Claro / Escuro.

### Backend

- Node.js **>=22.12.0**, TypeScript e Express 5;
- Prisma 6 com PostgreSQL (`schema.prisma` define o modelo de dados);
- autenticação JWT com hashes de senha bcrypt;
- validação de requisições com Zod, cabeçalhos de segurança Helmet, logs Morgan/Winston e limitação de taxa;
- operações transacionais de estoque; e
- bridge WebSocket `ws` opcional em `/ws/rfid` para eventos de login RFID.

### Hardware RFID opcional

`rpi/rfid/rfid_admin_bridge.py` oferece suporte a um leitor SPI nativo ou a um Arduino Nano via serial USB. Envia tokens de cartão para `POST /auth/rfid` com `X-RFID-Bridge-Secret` e disponibiliza o auxiliar local `POST /provision` na porta 3001. O arquivo `eduassets-rfid.service` fornecido é um template de unidade systemd; instalar a conta, os caminhos, o ambiente Python, as bibliotecas de hardware e a política de rede continua sendo uma tarefa do operador.

## Autenticação e níveis de acesso

- **Convidado:** acesso somente leitura a equipamentos, categorias, resumos de empréstimos e resumos de ocorrências. As respostas anônimas da API usam DTOs permitidos por lista de inclusão no servidor; `GET /responsaveis`, usuários e detalhes operacionais sensíveis exigem autenticação. Operações de alteração nunca ficam disponíveis sem autorização.
- **Editor:** ações operacionais autenticadas, como empréstimos, devoluções e criação/edição de ocorrências, sujeitas às permissões das rotas.
- **Administrador:** CRUD administrativo, gerenciamento de contas/senhas e provisionamento de tokens RFID, além das ações operacionais.

O backend é a fronteira de segurança: rotas de alteração usam autenticação/middleware de administrador e JWTs em `Authorization: Bearer <token>`. Os endpoints de convidado usam projeções minimizadas, permitidas por lista de inclusão no servidor; as proteções do frontend servem apenas à usabilidade. Logout e troca de senha atualizam `sessionVersion` por usuário, persistida no PostgreSQL, invalidando JWTs anteriores entre instâncias; a troca de senha devolve token substituto para o navegador atual. O timeout de inatividade de administradores ainda usa estado local ao processo e só é consistente em uma instância; sessões de editor não usam esse timeout. A recuperação de senha não está implementada; um usuário autenticado pode alterar a própria senha por `PATCH /auth/senha`.

## Superfície da API do backend

O roteador da aplicação inclui:

- `GET /health` para liveness, `GET /ready` para readiness limitada do PostgreSQL e `GET /` para uma resposta básica de status;
- `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` e `PATCH /auth/senha`;
- `POST /auth/rfid` para o fluxo RFID opcional restrito a loopback;
- rotas CRUD para `/categorias`, `/equipamentos`, `/responsaveis`, `/usuarios`, `/emprestimos` e `/ocorrencias`; e
- provisionamento/revogação de tokens RFID, somente para administradores, em `/usuarios/:id/rfid-token`.

Respostas públicas anônimas e minimizadas estão limitadas, por DTOs allowlisted específicos no servidor, às categorias, equipamentos, empréstimos e ocorrências; consultas de responsáveis e usuários exigem autenticação. A autorização de escrita é aplicada no backend. Os dados de demonstração públicos devem ser sintéticos e isolados dos dados operacionais. O schema Prisma contém `Categoria`, `Equipamento`, `Responsavel`, `Usuario`, `Emprestimo`, `ItemEmprestimo` e `Ocorrencia`, com enums para nível de acesso, status de empréstimo, tipo de ocorrência e status de ocorrência.

## Requisitos

- Node.js **22.12 ou mais recente** e npm;
- um banco PostgreSQL acessível por `DATABASE_URL`;
- uma URL PostgreSQL direta quando exigida pelo provedor (`DIRECT_URL`; caso contrário, a configuração Prisma usa `DATABASE_URL` como fallback); e
- hardware RFID físico e dependências Linux/Python somente se o RFID for explicitamente habilitado.

Vercel e Docker/Nginx são templates de implantação selecionados no repositório, não serviços configurados. Nenhuma VM Oracle, DNS, certificado TLS, política Cloudflare, banco hospedado, RLS no provedor ou implantação pública foi verificada.

## Instalar e executar localmente

Na raiz do repositório:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

A instalação na raiz instala o utilitário auxiliar `concurrently`. Backend e frontend têm cada um seu próprio manifesto de pacotes e árvore de dependências; por isso, instale-os como mostrado.

### Configurar o backend

Copie o template para o diretório de trabalho do backend e edite-o com valores locais reais. Não faça commit de segredos:

```bash
cp .env.example backend/.env
```

No mínimo, defina uma URL PostgreSQL e um segredo JWT exclusivo. O seed explícito também exige `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` (consulte [Configuração do banco de dados](#configuração-do-banco-de-dados)). No desenvolvimento local, `NODE_ENV=development` com o host loopback padrão permite o modo CORS local. `DATABASE_URL` é necessária para iniciar fora de `NODE_ENV=test`; em produção também são exigidos `CORS_ORIGIN` e `TRUST_PROXY` explícitos. Fora desse modo local explícito, defina `CORS_ORIGIN` como uma lista de permissões separadas por vírgula.

### Configurar o frontend

Para usar o proxy do Vite, mantenha a base da API vazia em `frontend/.env`:

```env
VITE_API_BASE_URL=
VITE_RFID_BRIDGE_ENABLED=false
```

Se o frontend precisar chamar uma API em outra origem, defina `VITE_API_BASE_URL` com essa origem. Builds de produção falham claramente se essa variável estiver ausente; ela é uma configuração de endpoint público, não um local para segredos.

### Configuração do banco de dados

Com `backend/.env` configurado e PostgreSQL disponível:

```bash
cd backend
npx prisma migrate dev
npm run db:seed
cd ..
```

O seed **exige `SEED_ADMIN_EMAIL` válido e `SEED_ADMIN_PASSWORD` forte** (mínimo 16 caracteres, máximo de 72 bytes UTF-8), é idempotente e não sobrescreve contas ou senhas existentes. Para provisionar Editor, informe ambos `SEED_EDITOR_EMAIL` e `SEED_EDITOR_PASSWORD`. Mantenha os valores em arquivo protegido e não rastreado; execute o seed explicitamente após as migrations, verifique o login, altere a senha inicial pelo fluxo autenticado e limpe as variáveis de seed de uso único. O startup da API não cria administrador. Este README não fornece credenciais demo.

Para um ambiente que já tenha migrations versionadas, o backend também oferece:

```bash
cd backend
npm run migrate:deploy
```

Esse comando aplica migrations existentes; não cria um banco de dados, não provisiona infraestrutura nem estabelece uma política de backup.

### Iniciar o desenvolvimento

Na raiz:

```bash
npm run dev
```

Isso inicia em conjunto o `backend` no modo `tsx watch` e o frontend Vite. Abra `http://localhost:5173`. Para executar cada lado separadamente:

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

A URL de desenvolvimento do backend normalmente é `http://127.0.0.1:3000` (ou o `HOST`/`PORT` configurado), e o proxy Vite mantém as chamadas de API do navegador relativas à porta 5173.

## Scripts disponíveis

### Raiz

| Comando | Efeito |
| --- | --- |
| `npm run dev` | Inicia backend e frontend em paralelo. |
| `npm run build` | Executa primeiro a build do backend e depois a do frontend. |

### Backend

| Comando | Efeito |
| --- | --- |
| `npm run dev` | `tsx watch src/server.ts`. |
| `npm run build` | Gera o Prisma Client e depois compila TypeScript com `tsc`. |
| `npm start` | Inicia `dist/src/server.js` após uma build. |
| `npm run migrate:deploy` | Aplica migrations Prisma existentes. |
| `npm test` | Executa testes unitários do backend (não exige banco de dados). |
| `npm run test:integration` | Executa testes de integração e concorrência HTTP/PostgreSQL; exige um banco de teste isolado com migrations aplicadas. |
| `npm run db:seed` | Aplica o seed idempotente (exige `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`). |

### Frontend

| Comando | Efeito |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento Vite na porta 5173. |
| `npm run build` | Gera `dist/`. |
| `npm run preview` | Pré-visualiza localmente o frontend compilado. |
| `npm run typecheck` | Executa `tsc --noEmit`. |
| `npm test` | Executa a suíte Vitest configurada; este README não afirma resultados. |
| `npm run test:watch` | Inicia Vitest em modo watch. |

Essas entradas descrevem scripts presentes nos manifestos, não evidenciam uma implantação concluída nem uma execução específica de testes.

## Variáveis de ambiente

### Backend e banco de dados

| Variável | Significado |
| --- | --- |
| `NODE_ENV` | `development` habilita o caminho explícito de desenvolvimento local; `production` altera o host padrão e o comportamento do proxy. |
| `PORT` / `BACKEND_PORT` | Porta do backend. Cada valor fornecido é validado; `PORT` tem precedência; o padrão é 3000. `BACKEND_PORT` é a alternativa de compatibilidade. |
| `HOST` | Endereço de bind. O padrão é `127.0.0.1` ou, em produção, `0.0.0.0` quando não definido. |
| `TRUST_PROXY` | Configuração validada de proxy do Express; obrigatória explicitamente em produção. Use `0` sem proxy, ou somente os saltos/IPs exatos e confiáveis para uma cadeia de proxy sanitizada. |
| `CORS_ORIGIN` | Origens HTTP(S) válidas separadas por vírgula (sem caminho/query/fragmento); obrigatória em produção e fora do modo de desenvolvimento local explícito. |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo Prisma; obrigatória. |
| `DIRECT_URL` | Conexão PostgreSQL direta opcional para provedores/migrations; se omitida, o Prisma usa `DATABASE_URL` como fallback. |
| `JWT_SECRET` | Segredo de assinatura JWT; use um valor exclusivo, imprevisível e com pelo menos 32 caracteres. |
| `SEED_ADMIN_EMAIL` | Email válido obrigatório, usado somente no seed inicial explícito. |
| `SEED_ADMIN_PASSWORD` | Obrigatória no seed explícito; mínimo 16 caracteres e máximo de 72 bytes UTF-8. |
| `SEED_EDITOR_EMAIL` / `SEED_EDITOR_PASSWORD` | Par opcional; ambos são necessários para provisionar Editor. |
| `LOG_LEVEL` | Nível de log Winston; o template usa `info` como padrão. |

### Frontend

| Variável | Significado |
| --- | --- |
| `VITE_API_BASE_URL` | Origem da API usada pelo navegador. Vazia em desenvolvimento, usa o proxy do Vite; obrigatória para uma build do frontend de produção. |
| `VITE_RFID_BRIDGE_ENABLED` | Flag do listener RFID do frontend. Mantenha `false`, a menos que a bridge do backend esteja habilitada e a política local de hardware/rede esteja configurada. |

### Bridge RFID

| Variável | Significado |
| --- | --- |
| `RFID_BRIDGE_ENABLED` | Flag do backend. O suporte WebSocket RFID fica **desligado, exceto quando o valor é exatamente `true`**. |
| `RFID_BRIDGE_SECRET` | Segredo compartilhado exigido pelo backend e pela bridge Python; use pelo menos 32 caracteres aleatórios. |
| `EDUASSETS_BACKEND_URL` | Origem da API da bridge; o padrão é `http://localhost:3000`. |
| `RFID_BACKEND` | Modo do leitor: `spi` (padrão) ou `serial`. |
| `RFID_SERIAL_PORT` | Dispositivo serial quando `RFID_BACKEND=serial`; o padrão é `/dev/ttyUSB0`. |
| `RFID_SOUND_DEVICE` | Dispositivo ALSA opcional para tons de feedback sintetizados. |

## Configuração RFID opcional e fronteira de segurança

RFID é intencionalmente desabilitado por padrão. Habilitá-lo exige todos os itens a seguir:

1. definir `RFID_BRIDGE_ENABLED=true` no backend e, ao usar o listener do navegador, `VITE_RFID_BRIDGE_ENABLED=true`;
2. configurar o mesmo `RFID_BRIDGE_SECRET` forte no backend e na bridge;
3. instalar e validar o hardware real do leitor e suas dependências Python;
4. garantir que o backend receba as requisições da bridge como loopback. Tanto `POST /auth/rfid` quanto a atualização para `/ws/rfid` rejeitam pares não loopback; um Raspberry Pi na mesma LAN não é automaticamente suficiente;
5. manter o auxiliar de provisionamento em `127.0.0.1:3001`, proteger seu arquivo de ambiente e restringir a exposição por qualquer proxy reverso/firewall; e
6. validar o comportamento de leitura/gravação do cartão e a política de rede na máquina de destino antes de depender deles.

A bridge pode ser executada manualmente em um host Linux compatível:

```bash
cd rpi/rfid
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export RFID_BRIDGE_SECRET='use-the-same-strong-secret-as-the-backend'
export EDUASSETS_BACKEND_URL='http://localhost:3000'
python3 rfid_admin_bridge.py
```

Use `RFID_BACKEND=serial` e `RFID_SERIAL_PORT` para o caminho do Arduino Nano. O arquivo de unidade espera uma conta dedicada `eduassets`, `/opt/eduassets-rfid`, um ambiente virtual e `/etc/eduassets/rfid_bridge.env` com modo 600. O repositório não realiza essa instalação na máquina, não cria a conta, não verifica systemd no sistema operacional de destino nem certifica uma combinação específica de Raspberry Pi/GPIO.

## Estrutura do projeto

```text
eduAssets/
├── frontend/
│   ├── public/docs/          # documentação interna em inglês e português
│   ├── src/core/             # API, autenticação, estado, primitivas de UI, listener RFID
│   ├── src/features/         # painel, empréstimos, devoluções, controle, administração, exportações...
│   ├── src/shared/           # componentes de UI reutilizáveis
│   ├── src/types/            # tipos TypeScript compartilhados
│   └── vite.config.ts
├── backend/
│   ├── prisma/               # schema, migrations e seed
│   ├── integration-tests/    # testes PostgreSQL HTTP/concorrência (somente CI)
│   └── src/                  # servidor, rotas, controladores, serviços, middleware
├── rpi/rfid/                 # bridge RFID Python opcional e unidade systemd
├── deploy/                   # templates Nginx e de backup/restauração segura
├── .github/workflows/        # verificações CI; não é automação de implantação
├── docker-compose.production.yml
├── .env.example              # template de ambiente local
├── .env.production.example   # somente template de implantação
└── package.json              # orquestração de desenvolvimento/build da raiz
```

O frontend segue uma estrutura em camadas, organizada por funcionalidade. `core` contém infraestrutura e primitivas de estado, `features` é responsável pelos fluxos das telas, `shared` contém componentes visuais reutilizáveis e `types` centraliza os contratos. O HTML dinâmico usa o helper de templates com escape do projeto, em vez de tratar dados do usuário como marcação confiável.

## Limitações atuais e notas de versão

- Nenhum deployment público, operação/migration de banco de produção, rotação de segredos ou configuração de hospedagem foi realizado. Os templates de implantação do repositório são apenas artefatos de preparação. Domínios planejados não comprovam disponibilidade.
- O controle de acesso às requisições da aplicação é implementado no backend. Grants/PostgREST do provedor não fazem parte do caminho de requisições do app; se forem expostos por um provedor selecionado, revise-os separadamente e bloqueie acesso anônimo não intencional.
- Produção exige `CORS_ORIGIN` e `TRUST_PROXY` explícitos; valide a topologia real de proxy e firewall antes da implantação.
- RFID é uma integração de hardware opt-in, não um método alternativo de login. Exige leitor compatível, dependências Linux/Python, segredo compartilhado forte, conectividade loopback e política explícita de firewall/proxy.
- As quantidades de ativos são controladas no nível de modelo/categoria; rastreamento individual por número de série está fora do escopo do modelo atual.
- Os níveis de acesso são Administrador e Editor; não há sistema de funções mais granulares por painel.
- A recuperação de senha não está implementada. A alteração de senha está disponível somente para um usuário autenticado.
- O modal de devolução envia e persiste o timestamp selecionado com offset; clientes antigos podem omiti-lo e usar o horário do servidor.
- A validação manual restante inclui execução em CI/PostgreSQL/Docker, comportamento no hardware de destino, política de proxy Nginx/Cloudflare, configuração TLS/Vercel, backup/restauração, acessibilidade e fluxos nos navegadores. Templates não constituem garantias verificadas.

## Roadmap

Os caminhos de código concluídos incluem frontend TypeScript, controle de acesso JWT, DTOs de convidado allowlisted, temas Claro/Escuro/Sistema, operações transacionais de estoque, exportações, limitação de taxa, timeout de inatividade do administrador, data de devolução selecionada e RFID opcional. A integração PostgreSQL e a CI hospedada estão preparadas, mas não foram executadas; primeiro deployment, verificação manual de acessibilidade/hardware/proxy e migração para React continuam no roadmap.

## Licença

O projeto é distribuído sob a licença MIT. Consulte o arquivo de licença do repositório para o texto oficial.

## Implantação e operações

A topologia selecionada, alvos Docker, variáveis de build Vercel, fronteira de confiança Nginx, TLS, firewall, backup/restauração, monitoramento, release e procedimentos de rollback estão documentados no [guia de implantação em inglês](frontend/public/docs/DEPLOYMENT.md) e no [guia em português](frontend/public/docs/GUIA_IMPLANTACAO.md). São templates que exigem verificação do operador; não realizam uma implantação.
