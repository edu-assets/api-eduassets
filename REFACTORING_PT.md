# eduAssets — Refatoração da Arquitetura do Backend

> **Status revisado em 2026-10-22:** O trabalho no repositório foi implementado incrementalmente no checkout atual. Este arquivo é mantido como registro histórico de projeto/aceitação, não como evidência de um serviço implantado ou pronto para produção. Consulte `REMEDIATION_REPORT.md` e os guias de implantação bilíngues; o workflow CI foi escrito, mas não executado. Implantação específica do ambiente, integração PostgreSQL, hardware e validação do lado dos provedores continuam sendo etapas pendentes.

## Contexto

Estou refatorando o backend do **eduAssets**, um sistema de empréstimo de equipamentos escolares e gerenciamento de inventário desenvolvido como projeto educacional de portfólio e destinado à integração com o **eduStation**, um quiosque local com hardware RFID opcional.

**Stack atual:**
- Frontend: Vite + TypeScript, arquitetura feature-first.
- Backend: Node.js, Express 5, TypeScript.
- Banco de dados: PostgreSQL + Prisma.
- Validação: Zod.
- Autenticação: JWT + bcrypt, com as funções `ADMINISTRADOR` e `EDITOR`.
- Hardware: ponte RFID opcional Raspberry Pi/Arduino, com comunicação HTTP/WebSocket restrita a loopback.
- Recursos existentes: Modo Convidado, empréstimos, devoluções, ocorrências com equipamentos, inventário, histórico e exportação de dados.

Inspecione o repositório e a implementação real antes de modificar qualquer coisa. A documentação existente pode conter informações desatualizadas; priorize o código atual e as decisões abaixo.

O pedido original fazia referência a capturas de tela da arquitetura de uma conversa anterior; essas imagens não estão armazenadas neste repositório e não são tratadas como evidência de implementação.

## 1. Arquitetura-alvo

Refatore `backend/src/` em direção a esta estrutura:

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

Responsabilidades:

- **`server.ts`**: inicializar a infraestrutura HTTP e WebSocket.
- **`app.ts`**: configurar o Express, `/health`, roteadores, middleware e tratamento centralizado de erros.
- **`routes/`**: mapear endpoints para controllers e aplicar o middleware apropriado.
- **`controllers/`**: tratar solicitações e respostas HTTP, delegando a lógica de negócio aos services.
- **`services/`**: implementar regras de negócio independentemente do Express.
- **`schemas/`**: manter a validação de requisições com Zod.
- **`middlewares/`**: autenticação, autorização, segurança, validação, registro de requisições, tratamento de erros e tratamento de 404.
- **`errors/`**: erros centralizados da aplicação.
- **`lib/`**: infraestrutura e serviços técnicos reutilizáveis.

Mova `middleware/` para `middlewares/` e atualize todos os imports. A lógica de negócio atual do estoque está nos services (por exemplo, `services/estoque.service.ts`) e preserva o comportamento atômico; não se deve inferir desta nota histórica que seja necessário migrar um `lib/estoque.ts` legado.

O pedido original fazia referência a `skills.md`, `skillsJS.md` e `architectureskills.md`; esses arquivos não foram encontrados no checkout atual. Mantenha claras as responsabilidades das funcionalidades, evite abstrações prematuras e não introduza um novo framework.

## 2. Decisões arquiteturais aprovadas

### Tratamento de erros

Introduza `AppError(status, chaveI18n, extra?)` para substituir, quando apropriado, classes de erro de domínio duplicadas.

- Services lançam erros da aplicação ou de domínio.
- O Express 5 trata promises rejeitadas dos controllers.
- Controllers não devem conter blocos repetitivos de `try/catch` usados apenas para encaminhar erros.
- O handler centralizado de erros mapeia erros para respostas HTTP.
- JSON malformado deve retornar HTTP 400.
- Erros inesperados devem ser registrados com seu stack, nunca expostos integralmente ao cliente.
- Adicione ou atualize as chaves de tradução do frontend em `pt.json` e `en.json` sempre que necessário.

Preserve códigos de status HTTP significativos e os contratos de API existentes sempre que possível.

### Transações e estoque

Centralize a configuração de transações interativas do Prisma com um **timeout de 15 segundos**, usando um helper corretamente tipado que não prejudique transações em lote nem a semântica de transações existente no Prisma.

Preserve as alterações atômicas de estoque e a proteção contra condições de corrida.

Regras de negócio importantes:
- A edição de empréstimo substitui a coleção completa de itens, pois o frontend envia a lista completa. Não introduza atualizações baseadas em diferenças (diff) nem paginação.
- O histórico de empréstimos deve continuar disponível por meio da abordagem existente de exclusão lógica/status.
- A resolução de uma ocorrência realiza seu ajuste de estoque exatamente uma vez.
- A exclusão de uma ocorrência já resolvida não deve ajustar o estoque novamente.
- Preserve o rollback da transação caso qualquer operação de estoque falhe.

### Autenticação e autorização

`requireAuth` deve verificar se o usuário autenticado ainda existe e obter do banco de dados o nível de acesso atual. Um usuário excluído ou cujo papel tenha sido alterado não deve manter acesso por meio de declarações JWT desatualizadas.

Não introduza `tokenVersion` nem uma migração adicional apenas para revogar JWTs nesta refatoração.

Use o algoritmo explícito `HS256` para assinatura e verificação de JWT. Quando apropriado, aplique comparações em tempo constante a segredos compartilhados, tratando comprimentos diferentes de buffers com segurança.

Preserve os limites de acesso existentes por função:
- **Convidado:** acesso de demonstração somente para leitura.
- **Editor:** ações operacionais autorizadas, sem privilégios administrativos.
- **Administrador:** permissões completas, incluindo Cadastros, gerenciamento de usuários e provisionamento de cartões RFID.

Preserve o timeout de inatividade existente de 30 minutos para Administradores. Não introduza timeout de inatividade para Editores nem altere a política estabelecida de JWT de oito horas para Editores.

A recuperação automatizada de senha por e-mail permanece fora do escopo; usuários que esquecerem suas senhas devem entrar em contato com o administrador.

### Modo Convidado e acesso à API pública

**O Modo Convidado deve continuar funcional. Não proteja indiscriminadamente todos os endpoints GET.**

Implementado: o acesso GET anônimo é restrito às visualizações de leitura atuais e usa listas de permissões de DTOs específicas por endpoint no servidor; `GET /responsaveis` e as rotas de gerenciamento de usuários exigem autenticação. Revise novamente esta lista de permissões antes de qualquer alteração na interface pública ou no payload.

- Endpoints públicos devem retornar somente os campos necessários à interface de convidado.
- `GET /usuarios` e os endpoints de gerenciamento de usuários devem ser devidamente protegidos.
- Nunca exponha hashes de senha, tokens RFID, segredos compartilhados ou outras informações sensíveis.
- Todas as operações de escrita devem impor autorização no backend.
- Qualquer implantação pública deve usar dados sintéticos de demonstração em um banco de dados dedicado, isolado de qualquer banco de dados escolar ou do eduStation; este repositório não configura nenhuma implantação/banco de dados desse tipo.
- Não introduza um novo fluxo de autenticação para convidados.

Audite as rotas existentes e o uso pelo frontend antes de definir a lista de permissões.

### RFID

RFID continua sendo uma integração local opcional do eduStation, não um requisito para a implantação pública.

- Preserve as restrições de loopback da ponte e do WebSocket.
- Não torne endpoints RFID acessíveis remotamente para acomodar hospedagem pública.
- Mantenha a mensagem existente exibida ao usuário explicando que RFID não está disponível quando nenhum leitor físico está configurado.
- Em `usuarios.ts`, valide se o usuário de destino existe e está apto antes de gerar dados de provisionamento ou invocar a ponte física.
- Se a validação falhar, não acione o hardware.

### Middleware de segurança e registro de logs

Preserve e revise as proteções existentes do Helmet, CORS e limitação de taxa. Não enfraqueça a segurança de produção nem introduza middleware desnecessário.

- A produção deve exigir explicitamente `NODE_ENV=production` e um `CORS_ORIGIN` configurado.
- Não codifique configurações específicas de provedores antes de a hospedagem ser definida.
- Preserve os limites de taxa existentes para autenticação e RFID, incluindo qualquer limitador dedicado à alteração de senha que já esteja implementado.
- Mantenha consistentes os cabeçalhos de segurança existentes e o comportamento de tratamento de erros.
- Use Winston como logger centralizado e Morgan para registro de requisições HTTP se estiverem presentes ou incluídos na implementação atual; integre os logs de requisição ao pipeline centralizado de logging.
- Prefira logs em console/stdout para portabilidade da implantação.
- Nunca registre senhas, JWTs, tokens RFID ou segredos compartilhados.

## 3. Migração recurso por recurso

Refatore incrementalmente, mantendo o build funcional após cada fase.

**Fase 1 — Infraestrutura**
- Introduzir `AppError` e tratamento centralizado de erros.
- Adicionar `/health`.
- Separar a configuração da aplicação Express da inicialização HTTP/WebSocket.
- Padronizar a organização do middleware.
- Revisar `tsconfig`, `rootDir` e `engines`.
- Manter `seed.ts` e `prisma.config.ts` executáveis por meio das ferramentas para as quais foram destinados.
- Exigir tratamento explícito do algoritmo JWT.

**Fase 2 — Recursos básicos**
- Categorias
- Responsáveis (`responsaveis`)
- Equipamentos

Mova o tratamento HTTP para controllers e as regras de negócio para services sem alterar os contratos de resposta bem-sucedida.

**Fase 3 — Usuários e autenticação**
- Auditar e corrigir `GET /usuarios`, que atualmente parece retornar objetos vazios.
- Verificar os endpoints necessários para criação de usuários e adicioná-los ou corrigi-los somente quando o contrato existente exigir isso.
- Garantir que os papéis atuais no banco de dados sejam aplicados.
- Corrigir a ordem de validação do provisionamento RFID.
- Centralizar o logging e manter comparações seguras de segredos.

**Fase 4 — Empréstimos e ocorrências**
- Migrar a lógica de empréstimos e ocorrências.
- Preservar atualizações atômicas do estoque e o rollback de transações.
- Aplicar o timeout da transação de maneira consistente.
- Verificar se há ajustes duplicados de estoque durante a resolução de ocorrências.
- Preservar o comportamento existente de edição de empréstimos e de histórico.

**Fase 5 — Schema, migrações e seed do Prisma**
- Adicionar índices somente quando justificados por consultas reais.
- Adicionar restrições de banco de dados somente quando justificadas por invariantes do domínio e compatíveis com os dados existentes.
- Validar qualquer migração SQL antes de aplicá-la.
- Manter o seed idempotente e garantir que executá-lo novamente não sobrescreva a senha de um administrador existente.
- Preservar registros; nunca use resets destrutivos como atalho.

## 4. Ferramentas e documentação

Execute as validações disponíveis de dependências, verificação de tipos e build. Corrija problemas reais de TypeScript ou de peer dependencies sem atualizar pacotes indiscriminadamente.

Mantenha o lockfile reproduzível e verifique se uma instalação limpa funciona.

Os modelos de ambiente e os guias bilíngues de implantação documentam agora um frontend estático no Cloudflare Pages e um backend Docker atrás do Nginx/Cloudflare como topologia proposta. Nenhum host Oracle, DNS, TLS, política do Cloudflare, projeto Cloudflare Pages, banco de dados hospedado ou implantação foi verificado ou alterado; mantenha esses estados claramente identificados como planejados até que sejam verificados externamente.

Este repositório não autoriza nem verifica um hostname de produção. O operador deve escolher e verificar os nomes DNS, certificados TLS e configuração do provedor antes de substituir os placeholders dos templates de implantação. O projeto separado da página de apresentação em Astro está fora do escopo desta refatoração do backend.

## 5. Requisitos de validação

Após cada fase, execute as verificações disponíveis pertinentes:
- Verificação de tipos do TypeScript.
- Builds do frontend e do backend quando afetados.
- Testes da lógica de negócio modificada.
- Validação do schema do Prisma e geração do client.
- Testes pertinentes de rotas, autorização e transações de estoque.

Não execute comandos destrutivos de banco de dados nem migrações de produção sem validação.

Preste atenção especial a regressões no Modo Convidado, permissões por função, histórico de empréstimos, consistência do estoque, resolução de ocorrências, provisionamento RFID e formatos de resposta da API consumidos pelo frontend.

## Instruções de trabalho

O plano de refatoração está aprovado. **Não reinicie a discussão sobre a arquitetura nem peça aprovação novamente.** Comece pela Fase 1, inspecione o repositório real e implemente as alterações diretamente, em etapas pequenas e verificáveis.

Evite redesigns não relacionados da interface, novos recursos, paginação, recuperação por e-mail ou migrações desnecessárias. Preserve i18n e o comportamento existente, a menos que um bug documentado exija uma correção.

Ao concluir, forneça um relatório conciso contendo:
1. O que mudou e os arquivos afetados.
2. Testes, verificações de tipos e builds realmente executados, incluindo seus resultados.
3. Quaisquer defeitos ou riscos restantes.
4. Migrações de banco de dados ou alterações de ambiente ainda necessárias antes da implantação.

O objetivo é um backend seguro e de fácil manutenção que preserve o comportamento existente do eduAssets/eduStation e permita que a preparação para implantação prossiga sem expansão desnecessária do escopo.
