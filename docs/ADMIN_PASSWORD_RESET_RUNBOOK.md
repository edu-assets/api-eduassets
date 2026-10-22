# Runbook — redefinição emergencial de senha administrativa

Este procedimento é para recuperação controlada de uma conta administrativa quando o fluxo autenticado de troca de senha não pode ser usado. Ele exige acesso autorizado ao PostgreSQL e deve ser executado com backup recente e janela de manutenção aprovada.

## Procedimento

1. Identifique a conta pelo login normalizado em minúsculas. Nunca registre a senha temporária em Git, ticket público ou chat.
2. Gere um hash bcrypt fora do banco usando o mesmo custo da aplicação:

```bash
cd backend
node --input-type=module -e "import bcrypt from 'bcrypt'; const senha=process.env.TEMP_ADMIN_PASSWORD; if (!senha || senha.length < 16) throw new Error('TEMP_ADMIN_PASSWORD deve ter pelo menos 16 caracteres'); console.log(await bcrypt.hash(senha, 12))"
```

3. Execute um `UPDATE` parametrizado no SQL client do provedor, substituindo apenas o hash gerado e o login. O `sessionVersion` revoga todos os JWTs existentes:

```sql
UPDATE "Usuario"
SET "passwordHash" = '<BCRYPT_HASH_GERADO>',
    "sessionVersion" = "sessionVersion" + 1
WHERE "login" = LOWER('<LOGIN_DA_CONTA>')
  AND "nivelAcesso" = 'ADMINISTRADOR';
```

4. Confirme que exatamente uma linha foi atualizada. Se o resultado for zero ou mais de uma linha, pare e investigue; não repita às cegas.
5. Remova imediatamente `TEMP_ADMIN_PASSWORD` do ambiente, faça login com a senha temporária e altere-a pelo fluxo autenticado `PATCH /auth/senha`.
6. Registre apenas a execução e o identificador da conta, nunca a senha ou o hash.

## Limites

Este é um procedimento de emergência, não um substituto para uma UI de gestão de usuários. Não use `prisma migrate reset`, `prisma db push`, exclusão de usuários ou atualização sem a condição de administrador. A implementação futura deve oferecer reset administrativo auditável, exigir confirmação forte e revogar sessões com `sessionVersion`.
