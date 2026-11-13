import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { prisma } from '../src/lib/prisma.js';

process.env.JWT_SECRET ??= 'synthetic-usuario-guards-test-secret-0123456789';
const loadUsuario = () => import('../src/services/usuario.service.js');
const loadAuth = () => import('../src/services/auth.service.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function mockTx(before: { nivelAcesso: string; ativo: boolean } | null, outrosAdmins: number) {
  let updated = false;
  const tx = {
    usuario: {
      findUnique: async () => before,
      count: async () => outrosAdmins,
      update: async () => { updated = true; return { id: 1, nome: 'n', login: 'l', nivelAcesso: 'EDITOR', ativo: false, updatedAt: new Date(), rfidTokenHash: null }; },
    },
    auditLog: { create: async () => ({}) },
  };
  (prisma as Any).$transaction = async (fn: Any) => fn(tx);
  return () => updated;
}

const admin = { nivelAcesso: 'ADMINISTRADOR', ativo: true };

async function rejects(p: Promise<unknown>, status: number, key: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.status === status && e.chaveI18n === key);
}

test('admin cannot deactivate or demote self', async () => {
  const { atualizarUsuario } = await loadUsuario();
  const wasUpdated = mockTx(admin, 5);
  await rejects(atualizarUsuario(1, { ativo: false }, 1), 400, 'backend.usuarios.nao_pode_desativar_a_si_mesmo');
  await rejects(atualizarUsuario(1, { nivelAcesso: 'EDITOR' }, 1), 400, 'backend.usuarios.nao_pode_rebaixar_a_si_mesmo');
  assert.equal(wasUpdated(), false);
});

test('last active admin cannot be deactivated or demoted by another actor', async () => {
  const { atualizarUsuario } = await loadUsuario();
  mockTx(admin, 0);
  await rejects(atualizarUsuario(1, { ativo: false }, 2), 409, 'backend.usuarios.ultimo_administrador');
  await rejects(atualizarUsuario(1, { nivelAcesso: 'EDITOR' }, 2), 409, 'backend.usuarios.ultimo_administrador');
});

test('admin can be demoted when another active admin exists', async () => {
  const { atualizarUsuario } = await loadUsuario();
  const wasUpdated = mockTx(admin, 1);
  await atualizarUsuario(1, { nivelAcesso: 'EDITOR' }, 2);
  assert.equal(wasUpdated(), true);
});

test('self can still update own name', async () => {
  const { atualizarUsuario } = await loadUsuario();
  const wasUpdated = mockTx(admin, 0);
  await atualizarUsuario(1, { nome: 'Novo' }, 1);
  assert.equal(wasUpdated(), true);
});

test('obterPerfil returns senhaAlteradaEm from audit log', async () => {
  const { obterPerfil } = await loadAuth();
  const d = new Date('2026-01-02T03:04:05.000Z');
  let found: Any = d;
  (prisma as Any).usuario = { findUnique: async () => ({ id: 1, nome: 'n', login: 'l', nivelAcesso: 'EDITOR' }) };
  (prisma as Any).auditLog = { findFirst: async () => (found ? { createdAt: found } : null) };
  assert.equal((await obterPerfil(1)).senhaAlteradaEm, '2026-01-02T03:04:05.000Z');
  found = null;
  assert.equal((await obterPerfil(1)).senhaAlteradaEm, null);
});

test('login returns senhaAlteradaEm in the user object', async () => {
  const { login } = await loadAuth();
  const bcrypt = (await import('bcrypt')).default;
  const d = new Date('2026-02-03T04:05:06.000Z');
  let found: Any = d;
  const passwordHash = await bcrypt.hash('segredo-sintetico', 4);
  (prisma as Any).usuario = {
    findFirst: async () => ({ id: 1, nome: 'n', login: 'l', nivelAcesso: 'EDITOR', ativo: true, sessionVersion: 0, passwordHash }),
  };
  (prisma as Any).auditLog = { findFirst: async () => (found ? { createdAt: found } : null) };
  assert.equal((await login('l', 'segredo-sintetico')).user.senhaAlteradaEm, '2026-02-03T04:05:06.000Z');
  found = null;
  assert.equal((await login('l', 'segredo-sintetico')).user.senhaAlteradaEm, null);
});
