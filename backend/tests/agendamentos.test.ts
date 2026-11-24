import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { prisma } from '../src/lib/prisma.js';
import { EstoqueInsuficienteError } from '../src/services/estoque.service.js';
import {
  HORIZONTE_AGENDAMENTO_MS,
  agendamentosQueNaoCabem,
  avaliarPedido,
  exigirDisponibilidade,
  intervaloAgendamento,
  intervaloEmprestimoAberto,
  livre,
  pedidoAgendavel,
  picoOcupacao,
  proximoHorarioLivre,
  type DisponibilidadeEquipamento,
  type OcupacaoEmprestimo,
} from '../src/services/disponibilidade.service.js';
import {
  ANTECEDENCIA_CONFIRMACAO_MS,
  TOLERANCIA_DATA_FUTURA_MS,
  confirmarRetirada,
  criarEmprestimo,
  JANELA_EXCLUSAO_EMPRESTIMO_MS,
  excluirEmprestimo,
  planejarRetirada,
  validarJanelaConfirmacao,
} from '../src/services/emprestimo.service.js';
import { criarOcorrencias } from '../src/services/ocorrencia.service.js';
import { emprestimoCreateSchema, emprestimoListQuerySchema } from '../src/schemas/emprestimo.schema.js';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const MIN = 60_000;
const H = 60 * MIN;
const INF = Number.POSITIVE_INFINITY;
/** 2026-11-24 10:00 local-ish reference; only differences matter. */
const T0 = Date.parse('2026-11-24T10:00:00.000Z');
const at = (h: number, m = 0) => T0 + (h - 10) * H + m * MIN;

function erroDe(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError, 'expected an AppError');
    return error;
  }
  assert.fail('expected the call to throw');
}

describe('picoOcupacao (sweep line)', () => {
  it('sums overlapping intervals and ignores touching ones (half-open)', () => {
    const intervalos = [
      { inicio: at(10, 30), fim: at(11, 20), quantidade: 15 },
      { inicio: at(11, 20), fim: at(12), quantidade: 15 },
    ];
    assert.equal(picoOcupacao(intervalos, { inicio: at(10), fim: at(13) }), 15);
    assert.equal(picoOcupacao([...intervalos, { inicio: at(11), fim: at(11, 30), quantidade: 3 }], { inicio: at(10), fim: at(13) }), 18);
  });

  it('only counts what falls inside the window', () => {
    const intervalos = [{ inicio: at(10, 30), fim: at(11, 20), quantidade: 15 }];
    assert.equal(picoOcupacao(intervalos, { inicio: at(11, 20), fim: at(12) }), 0);
    assert.equal(picoOcupacao(intervalos, { inicio: at(9), fim: at(10, 30) }), 0);
    assert.equal(picoOcupacao(intervalos, { inicio: at(11, 19), fim: at(11, 21) }), 15);
    assert.equal(picoOcupacao([], { inicio: at(9), fim: INF }), 0);
  });

  it('handles open-ended intervals and windows', () => {
    const intervalos = [{ inicio: at(8), fim: INF, quantidade: 4 }, { inicio: at(14), fim: INF, quantidade: 2 }];
    assert.equal(picoOcupacao(intervalos, { inicio: at(10), fim: INF }), 6);
    assert.equal(picoOcupacao(intervalos, { inicio: at(10), fim: at(14) }), 4);
  });

  it('20 notebooks: 15 at 10:30–11:20 and 15 at 14:00–15:00 both fit', () => {
    const manha = { inicio: at(10, 30), fim: at(11, 20), quantidade: 15 };
    assert.equal(livre(20, [manha], { inicio: at(14), fim: at(15) }), 20);
    const tarde = { inicio: at(14), fim: at(15), quantidade: 15 };
    assert.equal(livre(20, [manha, tarde], { inicio: at(10), fim: at(16) }), 5);
  });
});

describe('occupation intervals', () => {
  const agora = at(10);

  it('an open loan holds its units until the expected return while it is ahead', () => {
    const janela = intervaloEmprestimoAberto({ dataRetirada: new Date(at(9)), dataPrevistaDevolucao: new Date(at(11)) }, agora);
    assert.deepEqual(janela, { inicio: at(9), fim: at(11) });
  });

  it('overdue and legacy (no expected return) open loans count until returned (+∞)', () => {
    assert.equal(intervaloEmprestimoAberto({ dataRetirada: new Date(at(8)), dataPrevistaDevolucao: new Date(at(9)) }, agora).fim, INF);
    assert.equal(intervaloEmprestimoAberto({ dataRetirada: new Date(at(8)), dataPrevistaDevolucao: new Date(agora) }, agora).fim, INF);
    assert.equal(intervaloEmprestimoAberto({ dataRetirada: new Date(at(8)), dataPrevistaDevolucao: null }, agora).fim, INF);
    // An overdue loan blocks a reservation far in the future.
    const atrasado = { ...intervaloEmprestimoAberto({ dataRetirada: new Date(at(8)), dataPrevistaDevolucao: null }, agora), quantidade: 5 };
    assert.equal(livre(20, [atrasado], { inicio: at(10) + 10 * 24 * H, fim: at(11) + 10 * 24 * H }), 15);
  });

  it('a schedule occupies [dataAgendada, dataPrevistaDevolucao)', () => {
    assert.deepEqual(
      intervaloAgendamento({ dataAgendada: new Date(at(14)), dataRetirada: new Date(at(14)), dataPrevistaDevolucao: new Date(at(15)) }),
      { inicio: at(14), fim: at(15) },
    );
  });
});

describe('proximoHorarioLivre', () => {
  const agora = at(10);
  const reserva = { inicio: at(10, 30), fim: at(11, 20), quantidade: 15 };
  const pedido = (solicitado: number, intervalos = [reserva], capacidade = 20) => [{ equipamentoId: 1, solicitado, capacidade, intervalos }];

  it('is now when the window is already free', () => {
    assert.equal(proximoHorarioLivre(pedido(5), H, agora), agora);
  });

  it('is the end of the blocking occupation otherwise', () => {
    assert.equal(proximoHorarioLivre(pedido(10), H, agora), at(11, 20));
  });

  it('skips candidate ends that still collide with a later reservation', () => {
    const tarde = { inicio: at(12), fim: at(13), quantidade: 15 };
    assert.equal(proximoHorarioLivre(pedido(10, [reserva, tarde]), H, agora), at(13));
  });

  it('requires every item to fit in the same window', () => {
    const outro = { equipamentoId: 2, solicitado: 2, capacidade: 2, intervalos: [{ inicio: at(11), fim: at(12, 30), quantidade: 1 }] };
    assert.equal(proximoHorarioLivre([...pedido(10), outro], H, agora), at(12, 30));
  });

  it('is null beyond the 15-day horizon, when held forever, or above capacity', () => {
    const longa = { inicio: at(9), fim: agora + HORIZONTE_AGENDAMENTO_MS + 1, quantidade: 20 };
    assert.equal(proximoHorarioLivre(pedido(1, [longa]), H, agora), null);
    const noLimite = { ...longa, fim: agora + HORIZONTE_AGENDAMENTO_MS };
    assert.equal(proximoHorarioLivre(pedido(1, [noLimite]), H, agora), agora + HORIZONTE_AGENDAMENTO_MS);
    assert.equal(proximoHorarioLivre(pedido(1, [{ inicio: at(8), fim: INF, quantidade: 20 }]), H, agora), null);
    assert.equal(proximoHorarioLivre(pedido(21, []), H, agora), null);
  });

  it('agendavel is true only when every item fits the capacity', () => {
    assert.equal(pedidoAgendavel(pedido(20)), true);
    assert.equal(pedidoAgendavel(pedido(21)), false);
  });
});

describe('agendamentosQueNaoCabem', () => {
  it('keeps earlier bookings and reports the ones that no longer fit', () => {
    const agora = at(10);
    const agendamentos = [
      { emprestimoId: 2, inicio: at(10, 30), fim: at(11, 20), quantidade: 15 },
      { emprestimoId: 3, inicio: at(11), fim: at(12), quantidade: 3 },
      { emprestimoId: 4, inicio: at(14), fim: at(15), quantidade: 15 },
    ];
    // Capacity dropped from 20 to 17: the 3-unit schedule overlapping the 15-unit one no longer fits.
    assert.deepEqual(agendamentosQueNaoCabem(17, [], agendamentos, agora), [3]);
    // An overdue open loan holding 4 units forever squeezes both 15-unit schedules (4 + 15 > 17); the 3-unit one
    // then fits again because the earlier booking it overlapped was dropped.
    assert.deepEqual(agendamentosQueNaoCabem(17, [{ inicio: at(8), fim: INF, quantidade: 4 }], agendamentos, agora), [2, 4]);
    assert.deepEqual(agendamentosQueNaoCabem(20, [], agendamentos, agora), []);
  });
});

function estadoNotebook(ocupacoes: OcupacaoEmprestimo[], extra: Partial<DisponibilidadeEquipamento> = {}) {
  return new Map<number, DisponibilidadeEquipamento>([[1, {
    equipamentoId: 1, modelo: 'Latitude', categoria: 'Notebook', quantidadeDisponivel: 20, capacidade: 20, ocupacoes, ...extra,
  }]]);
}

describe('exigirDisponibilidade payload', () => {
  const agora = at(10);
  const reserva: OcupacaoEmprestimo = { emprestimoId: 7, status: 'AGENDADO', inicio: at(10, 30), fim: at(11, 20), quantidade: 15 };

  it('immediate 10 until 11:00 overlapping a 15-unit reservation: agendavel + next free slot', () => {
    try {
      exigirDisponibilidade(estadoNotebook([reserva]), new Map([[1, 10]]), { inicio: agora, fim: at(11) }, {
        incluirPrateleira: true, sugestao: { agora, duracaoMs: H },
      });
      assert.fail('expected EstoqueInsuficienteError');
    } catch (error) {
      assert.ok(error instanceof EstoqueInsuficienteError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.itens, [{ equipamentoId: 1, nome: 'Latitude', categoria: 'Notebook', solicitado: 10, disponivel: 5 }]);
      assert.equal(error.extra?.agendavel, true);
      assert.equal(error.extra?.proximoHorarioLivre, new Date(at(11, 20)).toISOString());
      assert.deepEqual(error.extra?.itens, error.itens);
    }
  });

  it('above capacity: agendavel false and no suggestion', () => {
    try {
      exigirDisponibilidade(estadoNotebook([]), new Map([[1, 21]]), { inicio: agora, fim: at(11) }, { sugestao: { agora, duracaoMs: H } });
      assert.fail('expected EstoqueInsuficienteError');
    } catch (error) {
      assert.ok(error instanceof EstoqueInsuficienteError);
      assert.equal(error.extra?.agendavel, false);
      assert.equal(error.extra?.proximoHorarioLivre, null);
    }
  });

  it('passes when the request fits and reports unknown equipment', () => {
    assert.doesNotThrow(() => exigirDisponibilidade(estadoNotebook([reserva]), new Map([[1, 15]]), { inicio: at(14), fim: at(15) }));
    const { insuficientes } = avaliarPedido(estadoNotebook([]), new Map([[99, 1]]), { inicio: agora, fim: INF });
    assert.deepEqual(insuficientes, [{ equipamentoId: 99, nome: 'Equipamento não encontrado', categoria: '', solicitado: 1, disponivel: 0 }]);
  });

  it('immediate loans are also bound by the shelf', () => {
    const estado = estadoNotebook([], { quantidadeDisponivel: 3 });
    const comPrateleira = avaliarPedido(estado, new Map([[1, 5]]), { inicio: agora, fim: INF }, { incluirPrateleira: true });
    assert.equal(comPrateleira.insuficientes[0]?.disponivel, 3);
    // Schedules only look at the time-based model.
    assert.deepEqual(avaliarPedido(estado, new Map([[1, 5]]), { inicio: at(14), fim: at(15) }).insuficientes, []);
  });
});

describe('planejarRetirada', () => {
  const agora = at(10);
  const iso = (ms: number) => new Date(ms).toISOString();

  it('accepts a schedule starting exactly at the 15-day horizon and rejects one past it', () => {
    const inicio = agora + HORIZONTE_AGENDAMENTO_MS;
    assert.equal(planejarRetirada(iso(inicio), iso(inicio + H), agora).agendado, true);
    assert.equal(erroDe(() => planejarRetirada(iso(inicio + 1), iso(inicio + H), agora)).chaveI18n,
      'backend.emprestimos.data_retirada_alem_horizonte');
  });

  it('uses the 5-minute tolerance as the schedule boundary', () => {
    assert.equal(planejarRetirada(iso(agora + TOLERANCIA_DATA_FUTURA_MS), undefined, agora).agendado, false);
    const plano = planejarRetirada(iso(agora + TOLERANCIA_DATA_FUTURA_MS + 1), iso(agora + H), agora);
    assert.equal(plano.agendado, true);
    assert.deepEqual(plano.janela, { inicio: agora + TOLERANCIA_DATA_FUTURA_MS + 1, fim: agora + H });
    assert.equal(plano.duracaoSugestaoMs, H - TOLERANCIA_DATA_FUTURA_MS - 1);
  });

  it('validates dataPrevistaDevolucao', () => {
    const chave = 'backend.emprestimos.devolucao_prevista_invalida';
    assert.equal(erroDe(() => planejarRetirada(iso(at(14)), iso(at(14)), agora)).chaveI18n, chave);
    assert.equal(erroDe(() => planejarRetirada(iso(at(14)), iso(at(13)), agora)).chaveI18n, chave);
    assert.equal(erroDe(() => planejarRetirada(iso(at(14)), iso(at(14) + 15 * 24 * H + 1), agora)).chaveI18n, chave);
    assert.doesNotThrow(() => planejarRetirada(iso(at(14)), iso(at(14) + 15 * 24 * H), agora));
    // Immediate loans: after now and after the (possibly backdated) checkout.
    assert.equal(erroDe(() => planejarRetirada(undefined, iso(agora), agora)).chaveI18n, chave);
    assert.equal(erroDe(() => planejarRetirada(iso(at(8)), iso(at(9)), agora)).chaveI18n, chave);
    const imediato = planejarRetirada(iso(at(8)), iso(at(11)), agora);
    assert.equal(imediato.agendado, false);
    assert.deepEqual(imediato.janela, { inicio: agora, fim: at(11) });
    assert.equal(imediato.dataPrevistaDevolucao?.getTime(), at(11));
    const semPrevista = planejarRetirada(undefined, null, agora);
    assert.deepEqual(semPrevista.janela, { inicio: agora, fim: INF });
    assert.equal(semPrevista.duracaoSugestaoMs, H);
  });
});

describe('validarJanelaConfirmacao', () => {
  const agendamento = { dataAgendada: new Date(at(10, 30)), dataRetirada: new Date(at(10, 30)), dataPrevistaDevolucao: new Date(at(11, 20)) };
  const fora = (agora: number) => erroDe(() => validarJanelaConfirmacao(agendamento, agora));

  it('opens 30 minutes before the scheduled start and closes at the expected return', () => {
    assert.equal(ANTECEDENCIA_CONFIRMACAO_MS, 30 * MIN);
    assert.equal(fora(at(10) - 1).status, 409);
    assert.equal(fora(at(10) - 1).chaveI18n, 'backend.emprestimos.confirmacao_fora_da_janela');
    assert.doesNotThrow(() => validarJanelaConfirmacao(agendamento, at(10)));
    assert.doesNotThrow(() => validarJanelaConfirmacao(agendamento, at(10, 50)));
    assert.doesNotThrow(() => validarJanelaConfirmacao(agendamento, at(11, 20) - 1));
    assert.equal(fora(at(11, 20)).chaveI18n, 'backend.emprestimos.confirmacao_fora_da_janela');
  });
});

describe('schemas', () => {
  it('GET /emprestimos accepts AGENDADO and ATIVO', () => {
    for (const status of ['AGENDADO', 'ABERTO', 'DEVOLVIDO', 'ATIVO']) {
      assert.equal(emprestimoListQuerySchema.parse({ status }).status, status);
    }
    assert.equal(emprestimoListQuerySchema.safeParse({ status: 'CANCELADO' }).success, false);
  });

  it('POST /emprestimos accepts an optional offset-aware dataPrevistaDevolucao', () => {
    const base = { solicitanteNome: 'Ana', responsavelId: 1, itens: [{ equipamentoId: 1, quantidade: 1 }] };
    assert.equal(emprestimoCreateSchema.parse({ ...base, dataPrevistaDevolucao: '2026-11-24T11:20:00-03:00' }).dataPrevistaDevolucao,
      '2026-11-24T11:20:00-03:00');
    assert.equal(emprestimoCreateSchema.parse(base).dataPrevistaDevolucao, undefined);
    assert.equal(emprestimoCreateSchema.parse({ ...base, dataPrevistaDevolucao: null }).dataPrevistaDevolucao, undefined);
    assert.equal(emprestimoCreateSchema.safeParse({ ...base, dataPrevistaDevolucao: '24/11/2026 11:20' }).success, false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Service paths with a fake transaction client (no database needed).

const realTransaction = Object.getOwnPropertyDescriptor(prisma, '$transaction');
afterEach(() => {
  if (realTransaction) Object.defineProperty(prisma, '$transaction', realTransaction);
  else delete (prisma as unknown as Record<string, unknown>).$transaction;
});

/** Records "model.method" calls; `respostas` supplies return values (default: {} / { count: 1 } for updateMany). */
function criarTx(respostas: Record<string, (args: Any) => unknown>) {
  const chamadas: Array<{ op: string; args: Any }> = [];
  const tx = new Proxy({}, {
    get(_alvo, modelo: string) {
      if (modelo === '$queryRaw') return async () => [];
      return new Proxy({}, {
        get(_m, metodo: string) {
          return async (args: Any) => {
            const op = `${modelo}.${metodo}`;
            chamadas.push({ op, args });
            const resposta = respostas[op];
            if (resposta) return resposta(args);
            if (metodo === 'updateMany') return { count: 1 };
            return {};
          };
        },
      });
    },
  });
  Object.defineProperty(prisma, '$transaction', {
    configurable: true, writable: true, enumerable: true, value: async (fn: Any) => fn(tx),
  });
  return { todas: (op: string) => chamadas.filter((c) => c.op === op).map((c) => c.args) };
}

const equipamentoBase = { id: 1, modelo: 'Latitude', quantidadeTotal: 20, quantidadeQuebrada: 0, quantidadeDisponivel: 20, categoria: { nome: 'Notebook' } };
const daqui = (ms: number) => new Date(Date.now() + ms);
const itemReservado = (id: number, inicioMs: number, fimMs: number, quantidade: number) => ({
  equipamentoId: 1, quantidade,
  emprestimo: { id, status: 'AGENDADO', dataRetirada: daqui(inicioMs), dataAgendada: daqui(inicioMs), dataPrevistaDevolucao: daqui(fimMs) },
});

describe('criarEmprestimo with schedules', () => {
  const base = { solicitanteNome: 'Ana', responsavelId: 1, itens: [{ equipamentoId: 1, quantidade: 15 }] };

  it('creates a schedule without touching the shelf', async () => {
    const t = criarTx({
      'responsavel.findUnique': () => ({ ativo: true }),
      'equipamento.findMany': () => [equipamentoBase],
      'ocorrencia.findMany': () => [],
      'itemEmprestimo.findMany': () => [itemReservado(5, 30 * MIN, 80 * MIN, 15)],
      'emprestimo.create': () => ({ id: 9, status: 'AGENDADO', itens: [] }),
    });
    const inicio = daqui(4 * H).toISOString();
    const fim = daqui(5 * H).toISOString();
    await criarEmprestimo({ ...base, dataRetirada: inicio, dataPrevistaDevolucao: fim }, 3);
    const [create] = t.todas('emprestimo.create');
    assert.equal(create.data.status, 'AGENDADO');
    assert.equal(create.data.dataRetirada.toISOString(), inicio);
    assert.equal(create.data.dataAgendada.toISOString(), inicio);
    assert.equal(create.data.dataPrevistaDevolucao.toISOString(), fim);
    assert.equal(t.todas('equipamento.updateMany').length, 0, 'schedules never decrement quantidadeDisponivel');
    assert.deepEqual(t.todas('auditLog.create')[0].data.changedFields,
      ['solicitanteNome', 'responsavelId', 'dataRetirada', 'observacao', 'itens', 'status', 'dataAgendada', 'dataPrevistaDevolucao']);
  });

  it('blocks an immediate loan overlapping a reservation and suggests the next slot', async () => {
    criarTx({
      'responsavel.findUnique': () => ({ ativo: true }),
      'equipamento.findMany': () => [equipamentoBase],
      'ocorrencia.findMany': () => [],
      'itemEmprestimo.findMany': () => [itemReservado(5, 30 * MIN, 80 * MIN, 15)],
    });
    await assert.rejects(
      criarEmprestimo({ ...base, itens: [{ equipamentoId: 1, quantidade: 10 }], dataPrevistaDevolucao: daqui(H).toISOString() }, 3),
      (error: unknown) => {
        assert.ok(error instanceof EstoqueInsuficienteError);
        assert.equal(error.extra?.agendavel, true);
        const proximo = Date.parse(String(error.extra?.proximoHorarioLivre));
        assert.ok(Math.abs(proximo - (Date.now() + 80 * MIN)) < 5000, 'next slot = end of the reservation');
        return true;
      },
    );
  });
});

describe('confirmarRetirada', () => {
  const agendamento = (extra: Record<string, unknown> = {}) => ({
    id: 9, status: 'AGENDADO', solicitanteNome: 'Ana',
    dataAgendada: daqui(10 * MIN), dataRetirada: daqui(10 * MIN), dataPrevistaDevolucao: daqui(H),
    itens: [{ equipamentoId: 1, quantidade: 15 }], ...extra,
  });

  it('moves the units off the shelf and stores the actual pickup time', async () => {
    const t = criarTx({
      'emprestimo.findUnique': () => agendamento(),
      'emprestimo.update': (args) => ({ id: 9, ...args.data, itens: [] }),
    });
    const antes = Date.now();
    await confirmarRetirada(9, 3);
    const [decremento] = t.todas('equipamento.updateMany');
    assert.deepEqual(decremento.data, { quantidadeDisponivel: { decrement: 15 } });
    const [update] = t.todas('emprestimo.update');
    assert.equal(update.data.status, 'ABERTO');
    assert.ok(update.data.dataRetirada.getTime() >= antes);
    assert.equal(update.data.atualizadoPorId, 3);
    assert.equal('dataAgendada' in update.data, false, 'dataAgendada is kept');
    assert.equal(t.todas('auditLog.create')[0].data.action, 'CONFIRM');
  });

  it('rejects loans that are not schedules and confirmations outside the window', async () => {
    criarTx({ 'emprestimo.findUnique': () => agendamento({ status: 'ABERTO' }) });
    await assert.rejects(confirmarRetirada(9, 3), (e: unknown) => e instanceof AppError && e.status === 409 && e.chaveI18n === 'backend.emprestimos.nao_agendado');
    criarTx({ 'emprestimo.findUnique': () => agendamento({ dataAgendada: daqui(2 * H), dataPrevistaDevolucao: daqui(3 * H) }) });
    await assert.rejects(confirmarRetirada(9, 3), (e: unknown) => e instanceof AppError && e.chaveI18n === 'backend.emprestimos.confirmacao_fora_da_janela');
    criarTx({ 'emprestimo.findUnique': () => null });
    await assert.rejects(confirmarRetirada(9, 3), (e: unknown) => e instanceof AppError && e.status === 404);
  });

  it('reports the overdue loans still holding the units', async () => {
    const pendentes = [{ id: 4, solicitanteNome: 'Bruno', dataPrevistaDevolucao: daqui(-10 * MIN) }];
    const t = criarTx({
      'emprestimo.findUnique': () => agendamento(),
      'equipamento.updateMany': () => ({ count: 0 }),
      'equipamento.findMany': () => [{ ...equipamentoBase, quantidadeDisponivel: 12 }],
      'emprestimo.findMany': () => pendentes,
    });
    await assert.rejects(confirmarRetirada(9, 3), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 409);
      assert.equal(error.chaveI18n, 'backend.emprestimos.unidades_nao_devolvidas');
      assert.deepEqual(error.extra?.itens, [{ equipamentoId: 1, nome: 'Latitude', categoria: 'Notebook', solicitado: 15, disponivel: 12 }]);
      assert.deepEqual(error.extra?.emprestimosPendentes, pendentes);
      return true;
    });
    const [consulta] = t.todas('emprestimo.findMany');
    assert.equal(consulta.where.status, 'ABERTO');
    assert.equal(t.todas('emprestimo.update').length, 0);
  });
});

describe('excluirEmprestimo', () => {
  const admin = { id: 3, nivelAcesso: 'ADMINISTRADOR' };
  const editor = { id: 4, nivelAcesso: 'EDITOR' };
  const ha = (ms: number) => new Date(Date.now() - ms);
  const aberto = (createdAgo: number, retiradaAgo: number) => ({
    status: 'ABERTO', createdAt: ha(createdAgo), dataRetirada: ha(retiradaAgo),
    itens: [{ equipamentoId: 7, quantidade: 2 }, { equipamentoId: 2, quantidade: 3 }, { equipamentoId: 7, quantidade: 1 }],
  });
  const semMudancas = (t: ReturnType<typeof criarTx>) => {
    assert.equal(t.todas('equipamento.update').length, 0);
    assert.equal(t.todas('itemEmprestimo.deleteMany').length, 0);
    assert.equal(t.todas('emprestimo.delete').length, 0);
    assert.equal(t.todas('auditLog.create').length, 0);
  };
  const rejeita = (status: number, chave: string) => (e: unknown) => e instanceof AppError && e.status === status && e.chaveI18n === chave;

  it('deletes a schedule and its items with a DELETE audit row, without touching stock', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => ({ status: 'AGENDADO', itens: [{ equipamentoId: 1, quantidade: 5 }] }) });
    await excluirEmprestimo(9, editor);
    assert.deepEqual(t.todas('itemEmprestimo.deleteMany')[0].where, { emprestimoId: 9 });
    assert.deepEqual(t.todas('emprestimo.delete')[0].where, { id: 9 });
    const [audit] = t.todas('auditLog.create');
    assert.equal(audit.data.action, 'DELETE');
    assert.equal(audit.data.entity, 'Emprestimo');
    assert.equal(t.todas('equipamento.update').length + t.todas('equipamento.updateMany').length, 0);
  });

  it('an open loan goes back to stock per item (ordered by equipment) and writes the DELETE audit row', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => aberto(H, H) });
    await excluirEmprestimo(9, admin);
    const updates = t.todas('equipamento.update');
    assert.deepEqual(updates.map((u) => [u.where.id, u.data.quantidadeDisponivel]), [
      [2, { increment: 3 }], [7, { increment: 2 }], [7, { increment: 1 }],
    ]);
    assert.deepEqual(t.todas('itemEmprestimo.deleteMany')[0].where, { emprestimoId: 9 });
    assert.deepEqual(t.todas('emprestimo.delete')[0].where, { id: 9 });
    const [audit] = t.todas('auditLog.create');
    assert.equal(audit.data.action, 'DELETE');
    assert.equal(audit.data.entity, 'Emprestimo');
    assert.equal(audit.data.userId ?? audit.data.usuarioId ?? 3, 3);
  });

  it('an EDITOR may delete an open loan within 24h', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => aberto(23 * H, 23 * H) });
    await excluirEmprestimo(9, editor);
    assert.equal(t.todas('emprestimo.delete').length, 1);
    assert.equal(t.todas('equipamento.update').length, 3);
  });

  it('an EDITOR after 24h gets 403 and nothing changes', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => aberto(25 * H, 25 * H) });
    await assert.rejects(excluirEmprestimo(9, editor), rejeita(403, 'backend.emprestimos.exclusao_fora_do_prazo'));
    semMudancas(t);
  });

  it('an ADMINISTRADOR may delete an open loan after 24h', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => aberto(30 * 24 * H, 30 * 24 * H) });
    await excluirEmprestimo(9, admin);
    assert.equal(t.todas('emprestimo.delete').length, 1);
    assert.equal(t.todas('equipamento.update').length, 3);
  });

  it('the window counts from the latest of createdAt and dataRetirada', async () => {
    // Registered 3 days ago but the pickup was confirmed 1h ago (schedule confirmed): still inside the window.
    const t = criarTx({ 'emprestimo.findUnique': () => aberto(3 * 24 * H, H) });
    await excluirEmprestimo(9, editor);
    assert.equal(t.todas('emprestimo.delete').length, 1);
    // Picked up 3 days ago but created 1h ago (backdated pickup): still inside the window.
    const t2 = criarTx({ 'emprestimo.findUnique': () => aberto(H, 3 * 24 * H) });
    await excluirEmprestimo(9, editor);
    assert.equal(t2.todas('emprestimo.delete').length, 1);
    // Both older than the limit (the later one decides): refused.
    criarTx({ 'emprestimo.findUnique': () => aberto(JANELA_EXCLUSAO_EMPRESTIMO_MS + MIN, JANELA_EXCLUSAO_EMPRESTIMO_MS + 2 * H) });
    await assert.rejects(excluirEmprestimo(9, editor), rejeita(403, 'backend.emprestimos.exclusao_fora_do_prazo'));
  });

  it('the window does not apply to schedules', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => ({ status: 'AGENDADO', createdAt: ha(10 * 24 * H), dataRetirada: ha(9 * 24 * H), itens: [] }) });
    await excluirEmprestimo(9, editor);
    assert.equal(t.todas('emprestimo.delete').length, 1);
  });

  it('refuses returned loans (409) and unknown ids (404)', async () => {
    const t = criarTx({ 'emprestimo.findUnique': () => ({ status: 'DEVOLVIDO', createdAt: ha(H), dataRetirada: ha(H), itens: [] }) });
    await assert.rejects(excluirEmprestimo(9, admin), rejeita(409, 'backend.emprestimos.nao_excluivel'));
    semMudancas(t);
    criarTx({ 'emprestimo.findUnique': () => null });
    await assert.rejects(excluirEmprestimo(9, admin), rejeita(404, 'backend.emprestimos.nao_encontrado'));
  });
});

describe('criarOcorrencias and schedules', () => {
  it('never blocks maintenance but reports the schedules that no longer fit', async () => {
    const afetado = { id: 5, solicitanteNome: 'Ana', dataAgendada: daqui(30 * MIN), dataPrevistaDevolucao: daqui(80 * MIN) };
    let id = 100;
    const t = criarTx({
      'ocorrencia.create': () => ({ id: ++id, equipamentoId: 1, tipo: 'MANUTENCAO' }),
      // 20 units, 2 now in maintenance: capacity 18 < the 20-unit reservation.
      'equipamento.findMany': () => [equipamentoBase],
      'ocorrencia.findMany': () => [{ equipamentoId: 1 }, { equipamentoId: 1 }],
      'itemEmprestimo.findMany': () => [itemReservado(5, 30 * MIN, 80 * MIN, 20)],
      'emprestimo.findMany': () => [afetado],
    });
    const criadas = await criarOcorrencias({ equipamentoId: 1, tipo: 'MANUTENCAO', problema: 'p', descricao: 'd', numeros: ['A', 'B'] }, 3);
    assert.equal(criadas.length, 2);
    for (const criada of criadas) assert.deepEqual(criada.agendamentosAfetados, [afetado]);
    assert.deepEqual(t.todas('emprestimo.findMany')[0].where, { id: { in: [5] } });
  });

  it('observations carry an empty list', async () => {
    criarTx({ 'ocorrencia.create': () => ({ id: 1, equipamentoId: 1, tipo: 'OBSERVACAO' }) });
    const [criada] = await criarOcorrencias({ equipamentoId: 1, tipo: 'OBSERVACAO', problema: 'p', descricao: 'd', numeros: ['A'] }, 3);
    assert.deepEqual(criada.agendamentosAfetados, []);
  });
});
