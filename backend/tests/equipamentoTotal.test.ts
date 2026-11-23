import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { prisma } from '../src/lib/prisma.js';

process.env.JWT_SECRET ??= 'synthetic-equipamento-test-secret-0123456789';
const loadService = () => import('../src/services/equipamento.service.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `ocupacoes`: open loans / schedules returned by the time-based availability query (disponibilidade.service.ts). */
function mockTx(atual: { quantidadeTotal: number; quantidadeDisponivel: number; quantidadeQuebrada: number }, emprestada = 0, ocupacoes: Any[] = []) {
  const calls: { data?: Any; audit?: Any } = {};
  const tx = {
    $queryRaw: async () => [{ id: 1 }],
    equipamento: {
      findUnique: async () => ({ id: 1, ...atual }),
      findMany: async () => [{ id: 1, modelo: 'Notebook', categoria: { nome: 'TI' }, ...atual }],
      update: async ({ data }: Any) => { calls.data = data; return { id: 1, ...atual, ...data }; },
    },
    itemEmprestimo: { aggregate: async () => ({ _sum: { quantidade: emprestada } }), findMany: async () => ocupacoes },
    ocorrencia: { count: async () => 0, findMany: async () => [] },
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

test('capacity below the peak of future schedules is rejected with quantidade_reservada', async () => {
  const { atualizarEquipamento } = await loadService();
  const hora = 3600_000;
  const agendamento = (id: number, inicioH: number, fimH: number, quantidade: number) => ({
    equipamentoId: 1, quantidade,
    emprestimo: { id, status: 'AGENDADO', dataRetirada: new Date(Date.now() + inicioH * hora),
      dataAgendada: new Date(Date.now() + inicioH * hora), dataPrevistaDevolucao: new Date(Date.now() + fimH * hora) },
  });
  // 20 units, nothing out: 15 reserved at +1h..+2h and 15 at +4h..+5h (peak 15, they do not overlap).
  const ocupacoes = [agendamento(1, 1, 2, 15), agendamento(2, 4, 5, 15)];
  let calls = mockTx({ quantidadeTotal: 20, quantidadeDisponivel: 20, quantidadeQuebrada: 0 }, 0, ocupacoes);
  await assert.rejects(
    atualizarEquipamento(1, { quantidadeTotal: 14 }, 9),
    (e: unknown) => e instanceof AppError && e.status === 409 && e.chaveI18n === 'backend.equipamentos.quantidade_reservada',
  );
  assert.equal(calls.data, undefined);
  calls = mockTx({ quantidadeTotal: 20, quantidadeDisponivel: 20, quantidadeQuebrada: 0 }, 0, ocupacoes);
  await atualizarEquipamento(1, { quantidadeTotal: 15 }, 9);
  assert.equal(calls.data.quantidadeTotal, 15);
  // Marking units as broken lowers the capacity the same way.
  calls = mockTx({ quantidadeTotal: 20, quantidadeDisponivel: 20, quantidadeQuebrada: 0 }, 0, ocupacoes);
  await assert.rejects(
    atualizarEquipamento(1, { quantidadeQuebrada: 6, quantidadeDisponivel: 14 }, 9),
    (e: unknown) => e instanceof AppError && e.chaveI18n === 'backend.equipamentos.quantidade_reservada',
  );
});
