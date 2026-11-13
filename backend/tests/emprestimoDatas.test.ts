import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { prisma } from '../src/lib/prisma.js';
import {
  TOLERANCIA_DATA_FUTURA_MS,
  criarEmprestimo,
  devolverEmprestimo,
  validarDataDevolucao,
  validarDataRetirada,
} from '../src/services/emprestimo.service.js';

const AGORA = Date.parse('2026-11-12T22:20:00.000Z');
const iso = (offsetMs: number) => new Date(AGORA + offsetMs).toISOString();

function erroDe(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError, 'expected an AppError');
    return error;
  }
  assert.fail('expected the validation to throw');
}

describe('date validation helpers', () => {
  it('uses a 5 minute tolerance', () => {
    assert.equal(TOLERANCIA_DATA_FUTURA_MS, 5 * 60 * 1000);
  });

  it('rejects a future dataRetirada beyond the tolerance and accepts the boundary and the past', () => {
    const erro = erroDe(() => validarDataRetirada(iso(TOLERANCIA_DATA_FUTURA_MS + 1), AGORA));
    assert.equal(erro.status, 400);
    assert.equal(erro.chaveI18n, 'backend.emprestimos.data_retirada_futura');
    assert.doesNotThrow(() => validarDataRetirada(iso(TOLERANCIA_DATA_FUTURA_MS), AGORA));
    assert.doesNotThrow(() => validarDataRetirada(iso(-30 * 24 * 3600_000), AGORA));
    assert.doesNotThrow(() => validarDataRetirada(undefined, AGORA));
  });

  it('rejects a future dataDevolucao beyond the tolerance', () => {
    const erro = erroDe(() => validarDataDevolucao(iso(TOLERANCIA_DATA_FUTURA_MS + 1), undefined, AGORA));
    assert.equal(erro.status, 400);
    assert.equal(erro.chaveI18n, 'backend.emprestimos.data_devolucao_futura');
    assert.doesNotThrow(() => validarDataDevolucao(iso(TOLERANCIA_DATA_FUTURA_MS), undefined, AGORA));
  });

  it('rejects a dataDevolucao earlier than the stored dataRetirada', () => {
    const retirada = new Date(AGORA - 3600_000);
    const erro = erroDe(() => validarDataDevolucao(iso(-3600_000 - 1), retirada, AGORA));
    assert.equal(erro.status, 400);
    assert.equal(erro.chaveI18n, 'backend.emprestimos.data_devolucao_anterior');
    assert.doesNotThrow(() => validarDataDevolucao(iso(-3600_000), retirada, AGORA));
    assert.doesNotThrow(() => validarDataDevolucao(iso(-60_000), retirada, AGORA));
  });

  it('accepts a return edited to the same minute as a checkout that has seconds', () => {
    const retiradaComSegundos = new Date(AGORA - 3600_000 + 47_000); // hh:mm:47
    assert.doesNotThrow(() => validarDataDevolucao(iso(-3600_000), retiradaComSegundos, AGORA)); // hh:mm:00
    const erro = erroDe(() => validarDataDevolucao(iso(-3600_000 - 1), retiradaComSegundos, AGORA));
    assert.equal(erro.chaveI18n, 'backend.emprestimos.data_devolucao_anterior');
  });

  it('never validates an omitted dataDevolucao, even if the stored dataRetirada is in the future (legacy data)', () => {
    const retiradaFutura = new Date(AGORA + 3600_000);
    assert.doesNotThrow(() => validarDataDevolucao(undefined, retiradaFutura, AGORA));
  });
});

describe('criarEmprestimo date validation', () => {
  const realTransaction = Object.getOwnPropertyDescriptor(prisma, '$transaction');
  let transacoes: number;

  beforeEach(() => {
    transacoes = 0;
    Object.defineProperty(prisma, '$transaction', {
      configurable: true, writable: true, enumerable: true,
      value: async () => { transacoes += 1; throw new Error('transaction reached'); },
    });
  });
  afterEach(() => {
    if (realTransaction) Object.defineProperty(prisma, '$transaction', realTransaction);
    else delete (prisma as unknown as Record<string, unknown>).$transaction;
  });

  const base = { solicitanteNome: 'Ana', responsavelId: 1, itens: [{ equipamentoId: 1, quantidade: 1 }] };

  it('rejects a future dataRetirada before opening any transaction', async () => {
    await assert.rejects(
      criarEmprestimo({ ...base, dataRetirada: new Date(Date.now() + 10 * 60_000).toISOString() }, 1),
      (error: unknown) => error instanceof AppError && error.status === 400 && error.chaveI18n === 'backend.emprestimos.data_retirada_futura',
    );
    assert.equal(transacoes, 0);
  });

  it('accepts a dataRetirada inside the tolerance, a past one and an omitted one (reaches the transaction)', async () => {
    for (const dataRetirada of [new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() - 86_400_000).toISOString(), undefined]) {
      await assert.rejects(criarEmprestimo({ ...base, dataRetirada }, 1), /transaction reached/);
    }
    assert.equal(transacoes, 3);
  });
});

describe('devolverEmprestimo date validation', () => {
  const realTransaction = Object.getOwnPropertyDescriptor(prisma, '$transaction');
  let emprestimo: { id: number; status: 'ABERTO' | 'DEVOLVIDO'; dataRetirada: Date; itens: Array<{ equipamentoId: number; quantidade: number }> };
  let transacoes: number;
  let gravado: { dataDevolucao?: Date } | null;

  beforeEach(() => {
    transacoes = 0;
    gravado = null;
    emprestimo = { id: 5, status: 'ABERTO', dataRetirada: new Date(Date.now() - 3600_000), itens: [{ equipamentoId: 1, quantidade: 2 }] };
    const tx = {
      $queryRaw: async () => [],
      emprestimo: {
        findUnique: async () => emprestimo,
        updateMany: async ({ where, data }: { where: { status: string }; data: { dataDevolucao: Date } }) => {
          if (emprestimo.status !== where.status) return { count: 0 };
          gravado = data;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => emprestimo,
      },
      equipamento: { update: async () => ({}) },
      auditLog: { create: async () => ({}) },
    };
    Object.defineProperty(prisma, '$transaction', {
      configurable: true, writable: true, enumerable: true,
      value: async (fn: (client: unknown) => Promise<unknown>) => { transacoes += 1; return fn(tx); },
    });
  });
  afterEach(() => {
    if (realTransaction) Object.defineProperty(prisma, '$transaction', realTransaction);
    else delete (prisma as unknown as Record<string, unknown>).$transaction;
  });

  const rejeita = (chave: string, status = 400) => (error: unknown) =>
    error instanceof AppError && error.status === status && error.chaveI18n === chave;

  it('rejects a future dataDevolucao without opening a transaction', async () => {
    await assert.rejects(
      devolverEmprestimo(5, new Date(Date.now() + 10 * 60_000).toISOString(), 1),
      rejeita('backend.emprestimos.data_devolucao_futura'),
    );
    assert.equal(transacoes, 0);
  });

  it('rejects a dataDevolucao earlier than the stored dataRetirada', async () => {
    await assert.rejects(
      devolverEmprestimo(5, new Date(emprestimo.dataRetirada.getTime() - 60_000).toISOString(), 1),
      rejeita('backend.emprestimos.data_devolucao_anterior'),
    );
    assert.equal(gravado, null);
  });

  it('accepts an explicit date between retirada and now+tolerance, clamping future ones to now', async () => {
    const data = new Date(Date.now() - 60_000).toISOString();
    await devolverEmprestimo(5, data, 1);
    assert.equal(gravado!.dataDevolucao!.toISOString(), data);
    gravado = null;
    emprestimo.status = 'ABERTO';
    const quaseFuturo = new Date(Date.now() + 60_000).toISOString();
    await devolverEmprestimo(5, quaseFuturo, 1);
    assert.ok(gravado!.dataDevolucao!.getTime() < Date.parse(quaseFuturo), 'clamped to the server clock');
    assert.ok(Math.abs(gravado!.dataDevolucao!.getTime() - Date.now()) < 5000);
  });

  it('uses the server clock when the date is omitted, even if the stored dataRetirada is ahead (legacy data)', async () => {
    emprestimo.dataRetirada = new Date(Date.now() + 3600_000);
    await devolverEmprestimo(5, undefined, 1);
    assert.ok(gravado!.dataDevolucao instanceof Date);
    assert.ok(Math.abs(gravado!.dataDevolucao!.getTime() - Date.now()) < 5000);
  });

  it('keeps reporting 409 for an already returned loan, even with an earlier explicit date', async () => {
    emprestimo.status = 'DEVOLVIDO';
    await assert.rejects(
      devolverEmprestimo(5, new Date(emprestimo.dataRetirada.getTime() - 60_000).toISOString(), 1),
      rejeita('backend.emprestimos.ja_devolvido', 409),
    );
  });
});
