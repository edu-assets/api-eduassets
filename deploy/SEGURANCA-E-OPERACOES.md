# Runbook de segurança e recuperação

Este guia descreve controles implementados no repositório da API. É um procedimento operacional, não uma declaração de que a VM de produção, o firewall, a conta Cloudflare ou o armazenamento externo foram alterados.

## Acesso de Administradores e política de RFID

Contas Administradoras (`ADMINISTRADOR`) entram com login e senha. A API rejeita tanto o provisionamento de cartão RFID quanto o login por cartão para contas Administradoras; não existe fluxo de PIN para cartão de Administrador. Use o login normal por senha, que estabelece o cookie de sessão `HttpOnly` da API.

RFID é opcional e destinado somente a contas Editoras. Quando ativada em uma implantação local apropriada, a bridge aceita apenas upgrades de loopback, com origem de navegador explicitamente confiável, para `/ws/rfid?auth=cookie`. Ela envia um código de login opaco, de uso único e validade de 30 segundos; o JWT bruto e a identidade do usuário não são transmitidos pelo WebSocket. O template público do Nginx bloqueia os caminhos HTTP e WebSocket de RFID, e a bridge permanece desabilitada até ser explicitamente habilitada por configuração. Não exponha a bridge local diretamente à Internet.

## Restrição de origem no Cloudflare

Use `deploy/nginx/eduassets-api.conf.example` como ponto de partida para o virtual host da API. Gere a allowlist do Cloudflare com `deploy/scripts/update-cloudflare-nginx-allowlist.sh`, instale o snippet no caminho incluído pelo template, configure hostname e certificado TLS e execute `nginx -t` antes de recarregar o Nginx.

A ACL do Nginx nega peers fora da allowlist. Se o requisito operacional for recusar a conexão TCP, em vez de retornar uma negação HTTP, aplique também as mesmas faixas de origem exclusivas do Cloudflare no firewall/security list da nuvem. Mantenha o container da API vinculado ao loopback e não confie em `X-Forwarded-For` enviado pelo cliente; o template o substitui pelo valor `CF-Connecting-IP` do Cloudflare. O template intencionalmente não possui listener público na porta 80.

## Backup PostgreSQL externo e criptografado

Execute o script de backup em um host operacional confiável com `pg_dump`, `age`, `rclone` e Python instalados. Mantenha segredos em arquivos protegidos ou no gerenciador de segredos do host; não os faça commit nem coloque a senha do banco na URL ou na linha de comando.

Prepare os valores no ambiente do operador:

```bash
export DATABASE_URL='postgresql://eduassets@db-host:5432/eduassets' # sem senha na URL
export PGPASSFILE='/etc/eduassets/pgpass'                           # modo 0600
export AGE_RECIPIENT='age1...'                                      # destinatário público de criptografia
export RCLONE_DESTINATION='externo:eduassets/postgres'              # remote:path configurado no rclone
export BACKUP_DIR='/var/backups/eduassets'                          # diretório local privado
./deploy/scripts/backup-postgres.sh
```

`PGPASSFILE` deve ser um arquivo regular, legível e com modo `0600`, contendo uma linha compatível com host, porta, banco e usuário. O script cria um dump customizado, criptografa-o antes que saia do diretório temporário privado, grava localmente um arquivo `.dump.age` com modo `0600` e transfere somente o ciphertext pelo remote do rclone. O destinatário `age` é público; proteja a identidade privada correspondente separadamente do armazenamento dos backups. Configure as credenciais do rclone no arquivo protegido do host ou no gerenciador de segredos, nunca neste repositório.

Configure controles de acesso, retenção/versionamento e monitoramento do provedor externo de acordo com os objetivos de recuperação da organização. Um `rclone copyto` concluído comprova a transferência, não a configuração de retenção nem a recuperação da conta do provedor.

## Exercício seguro de restauração

Restaure somente em um banco descartável, recém-criado e vazio. Primeiro transfira um backup criptografado e a identidade privada `age` por canais protegidos aprovados. Defina `DATABASE_URL` para uma URL sem senha do alvo vazio, use o `PGPASSFILE` protegido e configure `AGE_IDENTITY` para o arquivo de identidade privada com modo `0600`:

```bash
export DATABASE_URL='postgresql://eduassets@restore-host:5432/eduassets_restore'
export PGPASSFILE='/etc/eduassets/pgpass'
export AGE_IDENTITY='/etc/eduassets/age-identity.txt' # chave privada, modo 0600
export BACKUP_FILE='/secure-transfer/eduassets-YYYYMMDDTHHMMSSZ.dump.age'
export RESTORE_CONFIRM='RESTORE_TO_EMPTY_DATABASE'
./deploy/scripts/restore-postgres-empty-db.sh
```

O script descriptografa em um diretório temporário privado, recusa continuar se o alvo contiver relações de usuário e executa `pg_restore --exit-on-error`. Verifique os dados restaurados e execute as verificações da aplicação antes de considerar a restauração utilizável. Nunca use essa confirmação em um banco de produção; a proteção de alvo vazio não substitui um ambiente de recuperação isolado. Prefira dados anonimizados nos exercícios sempre que houver dados pessoais.

## Registro de validação

- **2026-10-28 — exercício local descartável:** as migrations do PostgreSQL 16.15 foram aplicadas a um banco de teste local recém-criado; a suíte de integração da API passou (11 aprovados, 1 teste de Administrador previamente seedado ignorado por depender de ambiente); uma linha sintética de categoria foi incluída em um dump customizado, criptografada com `age`, copiada por um destino local de sistema de arquivos do rclone, restaurada em outro banco vazio e verificada pelo Prisma. A sintaxe do Nginx também foi checada em uma instância local temporária, na qual um peer fora da allowlist recebeu HTTP 403.
- A validação local cobre scripts e mecânica em ambiente descartável; não valida hardware RFID nem configura retenção ou monitoramento. O registro de produção abaixo é uma evidência separada relatada pelo operador.
- **2026-10-28 — registro de produção relatado pelo operador:** commit `14b0716110750857daa27d0e979e3bec574e39e0`; migration `20261028173000_user_management_audit` aplicada; API reiniciada com a imagem `eduassets-backend:14b071611075`. Um dump Neon PostgreSQL 18.6 foi criado com `pg_dump` 18.6, criptografado com `age` usando destinatário público e transferido para R2 via `rclone`; o objeto de 328366 bytes apareceu na listagem. O primeiro envio retornou HTTP 501 e a repetição automática teve sucesso. `/health` e `/ready` responderam com sucesso no loopback e no domínio público. A leitura imediata do Compose ainda mostrava `health: starting`; estado `healthy` posterior não foi registrado.
- Esse registro comprova uma execução manual do backup e as verificações HTTP fornecidas pelo operador. Não registra restore do objeto de produção, agendamento/retention automática, monitoramento contínuo, alteração do firewall/origem ou checagem do hardware RFID. A identidade privada `age` deve permanecer fora da VM e do bucket.
