import assert from 'node:assert/strict';
import test from 'node:test';
import { alterarSenhaSchema, loginSchema } from '../src/schemas/auth.schema.js';
import { senhaForte, usuarioCreateSchema, usuarioPasswordResetSchema, usuarioUpdateSchema } from '../src/schemas/usuario.schema.js';
import { emprestimoCreateSchema } from '../src/schemas/emprestimo.schema.js';
import { ocorrenciaCreateSchema } from '../src/schemas/ocorrencia.schema.js';

test('normalizes login identifiers before authentication and persistence', () => {
  assert.equal(loginSchema.parse({ login: '  Admin@Example.COM ', password: 'secret' }).login, 'admin@example.com');
  assert.equal(
    usuarioCreateSchema.parse({
      nome: 'Admin',
      login: '  Admin@Example.COM ',
      senha: 'Strong-pass1!',
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

test('validates strong reset passwords and constrained user updates without database access', () => {
  assert.equal(senhaForte('Strong-pass1!'), true);
  assert.equal(senhaForte('weak-password'), false);
  assert.equal(usuarioPasswordResetSchema.safeParse({ senha: 'Strong-pass1!' }).success, true);
  assert.equal(usuarioPasswordResetSchema.safeParse({ senha: 'weak-password' }).success, false);
  assert.deepEqual(usuarioUpdateSchema.parse({ login: ' Admin@Example.COM ' }), { login: 'admin@example.com' });
  assert.equal(usuarioUpdateSchema.safeParse({}).success, false);
  assert.equal(usuarioUpdateSchema.safeParse({ passwordHash: 'sensitive' }).success, false);
});

test('accepts exactly 72 UTF-8 bytes and rejects 73 across every bcrypt password boundary', () => {
  const exactly72Bytes = `Aa1!${'x'.repeat(68)}`;
  const over72Bytes = `Aa1!${'x'.repeat(69)}`;
  assert.equal(Buffer.byteLength(exactly72Bytes, 'utf8'), 72);
  assert.equal(Buffer.byteLength(over72Bytes, 'utf8'), 73);

  assert.equal(loginSchema.safeParse({ login: 'user@example.invalid', password: exactly72Bytes }).success, true);
  assert.equal(loginSchema.safeParse({ login: 'user@example.invalid', password: over72Bytes }).success, false);
  assert.equal(alterarSenhaSchema.safeParse({ senhaAtual: exactly72Bytes, novaSenha: exactly72Bytes }).success, true);
  assert.equal(alterarSenhaSchema.safeParse({ senhaAtual: over72Bytes, novaSenha: exactly72Bytes }).success, false);
  assert.equal(usuarioCreateSchema.safeParse({ nome: 'User', login: 'user@example.invalid', senha: exactly72Bytes, nivelAcesso: 'EDITOR' }).success, true);
  assert.equal(usuarioCreateSchema.safeParse({ nome: 'User', login: 'user@example.invalid', senha: over72Bytes, nivelAcesso: 'EDITOR' }).success, false);
  assert.equal(usuarioPasswordResetSchema.safeParse({ senha: over72Bytes }).success, false);
});
