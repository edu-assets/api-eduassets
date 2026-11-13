import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { prisma } from '../src/lib/prisma.js';

process.env.JWT_SECRET ??= 'synthetic-equipamento-test-secret-0123456789';
const loadService = () => import('../src/services/equipamento.service.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function mockTx(atual: { quantidadeTotal: number; quantidadeDisponivel: number; quantidadeQuebrada: number }, emprestada = 0) {
  const calls: { data?: Any; audit?: Any } = {};
  const tx = {
    $queryRaw: async () => [{ id: 1 }],
    equipamento: {
      findUnique: async () => ({ id: 1, ...atual }),
      update: async ({ data }: Any) => { calls.data = data; return { id: 1, ...atual, ...data }; },
    },
    itemEmprestimo: { aggregate: async () => ({ _sum: { quantidade: emprestada } }) },
    ocorrencia: { count: async () => 0 },
    auditLog: { create: async ({ data }: Any) => { calls.audit = data; return {}; } },
  };
  (prisma as Any).$transaction = async (fn: Any) => fn(tx);
  return calls;
}

test('total increase adds the delta to disponivel', async () => {
  const { atualizarEquipamento } = await loadService();
  const calls = mockTx({ quantidadeTotal: 10, quantidadeDisponivel: 7, quantidadeQuebrada: 0 }, 3);
  await atualizarEquipamento(1, { quantidadeTotal: 15 }, 9);
  assert.equal(calls.data.quantidadeTotal, 15);
  assert.equal(calls.data.quantidadeDisponivel, 12);
  assert.equal(calls.data.atualizadoPorId, 9);
  assert.match(JSON.stringify(calls.audit), /quantidadeDisponivel/);
});

test('total decrease subtracts the delta from disponivel', async () => {
  const { atualizarEquipamento } = await loadService();
  const calls = mockTx({ quantidadeTotal: 10, quantidadeDisponivel: 7, quantidadeQuebrada: 0 }, 3);
  await atualizarEquipamento(1, { quantidadeTotal: 6 }, 9);
  assert.equal(calls.data.quantidadeDisponivel, 3);
});

test('total below units in use is rejected with 409', async () => {
  const { atualizarEquipamento } = await loadService();
  const calls = mockTx({ quantidadeTotal: 10, quantidadeDisponivel: 7, quantidadeQuebrada: 0 }, 3);
  await assert.rejects(
    atualizarEquipamento(1, { quantidadeTotal: 2 }, 9),
    (e: unknown) => e instanceof AppError && e.status === 409 && e.chaveI18n === 'backend.equipamentos.quantidade_em_uso',
  );
  assert.equal(calls.data, undefined);
});

test('explicit total and disponivel keep the sent values', async () => {
  const { atualizarEquipamento } = await loadService();
  const calls = mockTx({ quantidadeTotal: 10, quantidadeDisponivel: 7, quantidadeQuebrada: 0 }, 3);
  await atualizarEquipamento(1, { quantidadeTotal: 12, quantidadeDisponivel: 8 }, 9);
  assert.equal(calls.data.quantidadeTotal, 12);
  assert.equal(calls.data.quantidadeDisponivel, 8);
});
