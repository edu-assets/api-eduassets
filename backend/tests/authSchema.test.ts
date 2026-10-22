import assert from 'node:assert/strict';
import test from 'node:test';
import { loginSchema } from '../src/schemas/auth.schema.js';
import { usuarioCreateSchema } from '../src/schemas/usuario.schema.js';
import { emprestimoCreateSchema } from '../src/schemas/emprestimo.schema.js';
import { ocorrenciaCreateSchema } from '../src/schemas/ocorrencia.schema.js';

test('normalizes login identifiers before authentication and persistence', () => {
  assert.equal(loginSchema.parse({ login: '  Admin@Example.COM ', password: 'secret' }).login, 'admin@example.com');
  assert.equal(
    usuarioCreateSchema.parse({
      nome: 'Admin',
      login: '  Admin@Example.COM ',
      senha: 'strong-password',
      nivelAcesso: 'ADMINISTRADOR',
    }).login,
    'admin@example.com'
  );
});

test('enforces stronger passwords and bounded batch payloads', () => {
  assert.throws(() => usuarioCreateSchema.parse({
    nome: 'Editor', login: 'editor@example.com', senha: 'short-pass', nivelAcesso: 'EDITOR',
  }));
  assert.throws(() => emprestimoCreateSchema.parse({
    solicitanteNome: 'Pessoa', responsavelId: 1,
    itens: Array.from({ length: 101 }, (_, i) => ({ equipamentoId: i + 1, quantidade: 1 })),
  }));
  assert.throws(() => ocorrenciaCreateSchema.parse({
    equipamentoId: 1, tipo: 'OBSERVACAO', problema: 'Problema', descricao: 'Descrição',
    numeros: Array.from({ length: 101 }, (_, i) => `NB-${i}`),
  }));
});
