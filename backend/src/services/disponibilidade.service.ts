import { Prisma } from '@prisma/client';
import { EstoqueInsuficienteError, type ItemInsuficiente } from './estoque.service.js';

/**
 * Time-based availability: the single source of truth for loan scheduling (agendamentos).
 *
 * `quantidadeDisponivel` counts the units physically on the shelf right now. Schedules do not touch it; they reserve
 * units for a half-open window [start, end). Whether a request fits is computed per time interval:
 *
 *   capacidade(eq)        = quantidadeTotal − quantidadeQuebrada − open MANUTENCAO occurrences
 *   occupation intervals  = ABERTO items:   [dataRetirada, dataPrevistaDevolucao if still ahead of now, else +∞)
 *                           AGENDADO items: [dataAgendada, dataPrevistaDevolucao)
 *   livre(eq, window)     = capacidade − peak simultaneous occupation inside the window
 *
 * Touching intervals do not overlap, so 15 units at 10:30–11:20 and 15 at 11:20–12:00 fit in 15 units.
 * The pure functions below are exported for unit tests; the database helpers must run inside a transaction that
 * first locked the equipment rows with `bloquearEquipamentos`.
 */

type TxClient = Prisma.TransactionClient;

/** Schedules may start at most this far ahead, and suggestions never go beyond it. */
export const HORIZONTE_AGENDAMENTO_MS = 15 * 24 * 60 * 60 * 1000;
/** Suggestion length for a request without an expected return (an open-ended immediate loan). */
export const DURACAO_SUGESTAO_PADRAO_MS = 60 * 60 * 1000;

/** Half-open time window [inicio, fim) in epoch milliseconds; fim may be +Infinity. */
export interface Janela {
  inicio: number;
  fim: number;
}

export interface IntervaloOcupacao extends Janela {
  quantidade: number;
}

export interface OcupacaoEmprestimo extends IntervaloOcupacao {
  emprestimoId: number;
  status: 'ABERTO' | 'AGENDADO';
}

export function capacidade(equipamento: { quantidadeTotal: number; quantidadeQuebrada: number }, manutencoesAbertas: number): number {
  return equipamento.quantidadeTotal - equipamento.quantidadeQuebrada - manutencoesAbertas;
}

/**
 * An open loan holds its units from the checkout until the expected return while that is still ahead; once overdue
 * (or without an expected return, legacy loans) it holds them until it is actually returned. The start never lies
 * after `agora`: the units are physically out already.
 */
export function intervaloEmprestimoAberto(
  emprestimo: { dataRetirada: Date; dataPrevistaDevolucao: Date | null },
  agora: number,
): Janela {
  const prevista = emprestimo.dataPrevistaDevolucao?.getTime();
  return {
    inicio: Math.min(emprestimo.dataRetirada.getTime(), agora),
    fim: prevista !== undefined && prevista > agora ? prevista : Number.POSITIVE_INFINITY,
  };
}

export function intervaloAgendamento(emprestimo: { dataAgendada: Date | null; dataRetirada: Date; dataPrevistaDevolucao: Date | null }): Janela {
  return {
    inicio: (emprestimo.dataAgendada ?? emprestimo.dataRetirada).getTime(),
    fim: emprestimo.dataPrevistaDevolucao?.getTime() ?? Number.POSITIVE_INFINITY,
  };
}

/** Maximum simultaneous quantity inside `janela` (sweep line; an interval ending at t frees its units at t). */
export function picoOcupacao(intervalos: readonly IntervaloOcupacao[], janela: Janela): number {
  const eventos: Array<[instante: number, delta: number]> = [];
  for (const intervalo of intervalos) {
    const inicio = Math.max(intervalo.inicio, janela.inicio);
    const fim = Math.min(intervalo.fim, janela.fim);
    if (inicio < fim && intervalo.quantidade > 0) eventos.push([inicio, intervalo.quantidade], [fim, -intervalo.quantidade]);
  }
  // Releases (negative deltas) before acquisitions at the same instant: half-open intervals that touch never overlap.
  // Two +Infinity instants compare as NaN, which is falsy, so the delta still decides.
  eventos.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let atual = 0;
  let pico = 0;
  for (const [, delta] of eventos) {
    atual += delta;
    if (atual > pico) pico = atual;
  }
  return pico;
}

export function livre(capacidadeEquipamento: number, intervalos: readonly IntervaloOcupacao[], janela: Janela): number {
  return capacidadeEquipamento - picoOcupacao(intervalos, janela);
}

export interface PedidoEquipamento {
  equipamentoId: number;
  solicitado: number;
  capacidade: number;
  intervalos: readonly IntervaloOcupacao[];
}

/** True when every item could fit in some window, i.e. no request exceeds the equipment's capacity. */
export function pedidoAgendavel(pedido: readonly PedidoEquipamento[]): boolean {
  return pedido.every((item) => item.solicitado <= item.capacidade);
}

/**
 * Earliest start t ≥ agora such that every requested item fits in [t, t + duracaoMs), or null when none exists up to
 * agora + horizonte. Only `agora` and the ends of occupation intervals can be the earliest feasible start: occupation
 * is piecewise constant, so a window can only become feasible when some interval releases its units.
 */
export function proximoHorarioLivre(
  pedido: readonly PedidoEquipamento[],
  duracaoMs: number,
  agora: number,
  horizonteMs: number = HORIZONTE_AGENDAMENTO_MS,
): number | null {
  if (!pedidoAgendavel(pedido)) return null;
  const limite = agora + horizonteMs;
  const candidatos = new Set<number>([agora]);
  for (const item of pedido) {
    for (const intervalo of item.intervalos) {
      if (intervalo.fim > agora && intervalo.fim <= limite) candidatos.add(intervalo.fim);
    }
  }
  for (const inicio of [...candidatos].sort((a, b) => a - b)) {
    const janela = { inicio, fim: inicio + duracaoMs };
    if (pedido.every((item) => item.solicitado <= livre(item.capacidade, item.intervalos, janela))) return inicio;
  }
  return null;
}

/**
 * Schedules that no longer fit after a capacity drop (e.g. a unit sent to maintenance). Earlier bookings (lower id)
 * keep priority: each schedule is checked, from `agora` on, against the fixed occupation (open loans) plus the
 * schedules already accepted; the ones that do not fit are reported (by loan id, ascending).
 */
export function agendamentosQueNaoCabem(
  capacidadeEquipamento: number,
  fixos: readonly IntervaloOcupacao[],
  agendamentos: ReadonlyArray<IntervaloOcupacao & { emprestimoId: number }>,
  agora: number,
): number[] {
  const aceitos: IntervaloOcupacao[] = [...fixos];
  const afetados: number[] = [];
  for (const agendamento of [...agendamentos].sort((a, b) => a.emprestimoId - b.emprestimoId)) {
    const janela = { inicio: Math.max(agendamento.inicio, agora), fim: agendamento.fim };
    if (janela.inicio >= janela.fim) continue;
    if (picoOcupacao(aceitos, janela) + agendamento.quantidade > capacidadeEquipamento) afetados.push(agendamento.emprestimoId);
    else aceitos.push(agendamento);
  }
  return afetados;
}

// ---------------------------------------------------------------------------------------------------------------
// Database helpers (inside a transaction).

/** Locks the equipment rows in id order, so every availability check that leads to a write is serialized. */
export async function bloquearEquipamentos(tx: TxClient, equipamentoIds: Iterable<number>): Promise<void> {
  const ids = [...new Set(equipamentoIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT id FROM "Equipamento" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
}

export interface DisponibilidadeEquipamento {
  equipamentoId: number;
  modelo: string;
  categoria: string;
  quantidadeDisponivel: number;
  capacidade: number;
  ocupacoes: OcupacaoEmprestimo[];
}

/**
 * Loads capacity and occupation of the given equipment. Open loans and schedules whose window has not ended are
 * included; `excluirEmprestimoId` leaves out the loan being edited or confirmed.
 */
export async function carregarDisponibilidade(
  tx: TxClient,
  equipamentoIds: Iterable<number>,
  agora: number,
  opcoes: { excluirEmprestimoId?: number } = {},
): Promise<Map<number, DisponibilidadeEquipamento>> {
  const ids = [...new Set(equipamentoIds)].sort((a, b) => a - b);
  const resultado = new Map<number, DisponibilidadeEquipamento>();
  if (ids.length === 0) return resultado;

  const equipamentos = await tx.equipamento.findMany({ where: { id: { in: ids } }, include: { categoria: true } });
  const manutencoes = await tx.ocorrencia.findMany({
    where: { equipamentoId: { in: ids }, status: 'ABERTO', tipo: 'MANUTENCAO' },
    select: { equipamentoId: true },
  });
  const itens = await tx.itemEmprestimo.findMany({
    where: {
      equipamentoId: { in: ids },
      ...(opcoes.excluirEmprestimoId !== undefined ? { emprestimoId: { not: opcoes.excluirEmprestimoId } } : {}),
      emprestimo: {
        OR: [
          { status: 'ABERTO' },
          { status: 'AGENDADO', dataPrevistaDevolucao: { gt: new Date(agora) } },
        ],
      },
    },
    select: {
      equipamentoId: true,
      quantidade: true,
      emprestimo: { select: { id: true, status: true, dataRetirada: true, dataAgendada: true, dataPrevistaDevolucao: true } },
    },
  });

  const manutencoesPorEquipamento = new Map<number, number>();
  for (const { equipamentoId } of manutencoes) {
    manutencoesPorEquipamento.set(equipamentoId, (manutencoesPorEquipamento.get(equipamentoId) ?? 0) + 1);
  }
  for (const equipamento of equipamentos) {
    resultado.set(equipamento.id, {
      equipamentoId: equipamento.id,
      modelo: equipamento.modelo,
      categoria: equipamento.categoria.nome,
      quantidadeDisponivel: equipamento.quantidadeDisponivel,
      capacidade: capacidade(equipamento, manutencoesPorEquipamento.get(equipamento.id) ?? 0),
      ocupacoes: [],
    });
  }
  for (const item of itens) {
    const alvo = resultado.get(item.equipamentoId);
    const { emprestimo } = item;
    if (!alvo || (emprestimo.status !== 'ABERTO' && emprestimo.status !== 'AGENDADO')) continue;
    const janela = emprestimo.status === 'ABERTO' ? intervaloEmprestimoAberto(emprestimo, agora) : intervaloAgendamento(emprestimo);
    alvo.ocupacoes.push({ ...janela, quantidade: item.quantidade, emprestimoId: emprestimo.id, status: emprestimo.status });
  }
  return resultado;
}

export interface AvaliacaoPedido {
  insuficientes: ItemInsuficiente[];
  pedido: PedidoEquipamento[];
}

/**
 * Compares each requested quantity with livre(eq, janela). With `incluirPrateleira` (immediate loans, janela starting
 * now) the units physically on the shelf also bound the answer: units that the interval model counts as free but
 * that are not on the shelf (e.g. a manual stock correction) are treated as held from now until further notice, so
 * both `disponivel` and the suggested next slot account for them.
 */
export function avaliarPedido(
  estado: ReadonlyMap<number, DisponibilidadeEquipamento>,
  quantidades: ReadonlyMap<number, number>,
  janela: Janela,
  opcoes: { incluirPrateleira?: boolean } = {},
): AvaliacaoPedido {
  const insuficientes: ItemInsuficiente[] = [];
  const pedido: PedidoEquipamento[] = [];
  for (const [equipamentoId, solicitado] of quantidades) {
    const equipamento = estado.get(equipamentoId);
    if (!equipamento) {
      insuficientes.push({ equipamentoId, nome: 'Equipamento não encontrado', categoria: '', solicitado, disponivel: 0 });
      pedido.push({ equipamentoId, solicitado, capacidade: 0, intervalos: [] });
      continue;
    }
    let intervalos: IntervaloOcupacao[] = equipamento.ocupacoes;
    if (opcoes.incluirPrateleira) {
      const livreAgora = livre(equipamento.capacidade, intervalos, { inicio: janela.inicio, fim: janela.inicio + 1 });
      const foraDaPrateleira = livreAgora - Math.max(0, equipamento.quantidadeDisponivel);
      if (foraDaPrateleira > 0) {
        intervalos = [...intervalos, { inicio: janela.inicio, fim: Number.POSITIVE_INFINITY, quantidade: foraDaPrateleira }];
      }
    }
    pedido.push({ equipamentoId, solicitado, capacidade: equipamento.capacidade, intervalos });
    const disponivel = livre(equipamento.capacidade, intervalos, janela);
    if (solicitado > disponivel) {
      insuficientes.push({
        equipamentoId, nome: equipamento.modelo, categoria: equipamento.categoria, solicitado, disponivel: Math.max(0, disponivel),
      });
    }
  }
  return { insuficientes, pedido };
}

/**
 * Throws EstoqueInsuficienteError (400) when the request does not fit. With `sugestao` the payload also carries
 * `agendavel` and `proximoHorarioLivre` (ISO string or null) for a window of `duracaoMs`.
 */
export function exigirDisponibilidade(
  estado: ReadonlyMap<number, DisponibilidadeEquipamento>,
  quantidades: ReadonlyMap<number, number>,
  janela: Janela,
  opcoes: { incluirPrateleira?: boolean; sugestao?: { agora: number; duracaoMs: number } } = {},
): void {
  const { insuficientes, pedido } = avaliarPedido(estado, quantidades, janela, opcoes);
  if (insuficientes.length === 0) return;
  if (!opcoes.sugestao) throw new EstoqueInsuficienteError(insuficientes);
  const proximo = proximoHorarioLivre(pedido, opcoes.sugestao.duracaoMs, opcoes.sugestao.agora);
  throw new EstoqueInsuficienteError(insuficientes, {
    agendavel: pedidoAgendavel(pedido),
    proximoHorarioLivre: proximo === null ? null : new Date(proximo).toISOString(),
  });
}
