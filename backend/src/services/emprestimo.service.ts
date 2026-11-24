import type { Prisma, StatusEmprestimo } from '@prisma/client';
import { prisma, runTransaction } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaEmprestimoInclude } from '../lib/authorship.js';
import {
  agruparQuantidades,
  validarEstoqueDisponivel,
  decrementarComSeguranca,
  EstoqueInsuficienteError,
  type ItemInsuficiente,
} from './estoque.service.js';
import {
  DURACAO_SUGESTAO_PADRAO_MS,
  HORIZONTE_AGENDAMENTO_MS,
  bloquearEquipamentos,
  carregarDisponibilidade,
  exigirDisponibilidade,
  type Janela,
} from './disponibilidade.service.js';

export interface ItemEmprestimoInput {
  equipamentoId: number;
  quantidade: number;
}

export interface EmprestimoCreateInput {
  solicitanteNome: string;
  responsavelId: number;
  dataRetirada?: string;
  /** Expected return / end of the reserved window. Required for schedules, optional for immediate loans. */
  dataPrevistaDevolucao?: string | null;
  observacao?: string;
  itens: ItemEmprestimoInput[];
}

/**
 * Clock-skew tolerance for client-supplied dates. A return date further in the future than this is rejected; a
 * checkout further in the future than this is a schedule (AGENDADO), anything up to it is an immediate loan.
 */
export const TOLERANCIA_DATA_FUTURA_MS = 5 * 60 * 1000;
/** A schedule's window (dataAgendada → dataPrevistaDevolucao) may last at most this long. */
export const DURACAO_MAXIMA_AGENDAMENTO_MS = 15 * 24 * 60 * 60 * 1000;
/** A schedule's pickup may be confirmed from this long before dataAgendada (until dataPrevistaDevolucao). */
export const ANTECEDENCIA_CONFIRMACAO_MS = 30 * 60 * 1000;

function validarNaoFutura(data: Date, agora: number, chaveErro: string): void {
  if (data.getTime() > agora + TOLERANCIA_DATA_FUTURA_MS) throw new AppError(400, chaveErro);
}

/** How POST /emprestimos will store a loan, decided before any database access. */
export interface PlanoRetirada {
  agendado: boolean;
  /** Stored dataRetirada: the scheduled start (AGENDADO) or the checkout clamped to the server clock (ABERTO). */
  dataRetirada: Date;
  dataPrevistaDevolucao: Date | null;
  /** Window checked against availability: [start, prevista) for schedules, [now, prevista ?? +∞) for immediate loans. */
  janela: Janela;
  /** Length of the window used to suggest proximoHorarioLivre (1 h for an open-ended immediate loan). */
  duracaoSugestaoMs: number;
}

/**
 * Exported for tests. dataRetirada beyond now + TOLERANCIA_DATA_FUTURA_MS makes a schedule: it must start within
 * HORIZONTE_AGENDAMENTO_MS, have a dataPrevistaDevolucao after its start and last at most
 * DURACAO_MAXIMA_AGENDAMENTO_MS (it is never clamped). Otherwise the loan is immediate, as before: the checkout is
 * clamped to the server clock and an optional dataPrevistaDevolucao must lie after both the checkout and now.
 */
export function planejarRetirada(
  dataRetirada: string | undefined,
  dataPrevistaDevolucao: string | null | undefined,
  agora: number = Date.now(),
): PlanoRetirada {
  const prevista = dataPrevistaDevolucao ? new Date(dataPrevistaDevolucao) : null;
  const solicitada = dataRetirada ? new Date(dataRetirada).getTime() : undefined;

  if (solicitada !== undefined && solicitada > agora + TOLERANCIA_DATA_FUTURA_MS) {
    if (solicitada > agora + HORIZONTE_AGENDAMENTO_MS) throw new AppError(400, 'backend.emprestimos.data_retirada_alem_horizonte');
    if (!prevista) throw new AppError(400, 'backend.emprestimos.devolucao_prevista_obrigatoria');
    const fim = prevista.getTime();
    if (fim <= solicitada || fim - solicitada > DURACAO_MAXIMA_AGENDAMENTO_MS) {
      throw new AppError(400, 'backend.emprestimos.devolucao_prevista_invalida');
    }
    return {
      agendado: true, dataRetirada: new Date(solicitada), dataPrevistaDevolucao: prevista,
      janela: { inicio: solicitada, fim }, duracaoSugestaoMs: fim - solicitada,
    };
  }

  // A client date inside the clock-skew tolerance but still ahead of the server is stored as the server's now.
  const retirada = Math.min(solicitada ?? agora, agora);
  if (prevista && (prevista.getTime() <= retirada || prevista.getTime() <= agora)) {
    throw new AppError(400, 'backend.emprestimos.devolucao_prevista_invalida');
  }
  return {
    agendado: false, dataRetirada: new Date(retirada), dataPrevistaDevolucao: prevista,
    janela: { inicio: agora, fim: prevista?.getTime() ?? Number.POSITIVE_INFINITY },
    duracaoSugestaoMs: prevista ? prevista.getTime() - agora : DURACAO_SUGESTAO_PADRAO_MS,
  };
}

/** Exported for tests. A pickup may be confirmed from 30 min before the scheduled start until the window ends. */
export function validarJanelaConfirmacao(
  agendamento: { dataAgendada: Date | null; dataRetirada: Date; dataPrevistaDevolucao: Date | null },
  agora: number = Date.now(),
): void {
  const inicio = (agendamento.dataAgendada ?? agendamento.dataRetirada).getTime();
  const fim = agendamento.dataPrevistaDevolucao?.getTime() ?? Number.POSITIVE_INFINITY;
  if (agora < inicio - ANTECEDENCIA_CONFIRMACAO_MS || agora >= fim) {
    throw new AppError(409, 'backend.emprestimos.confirmacao_fora_da_janela');
  }
}

/** Compares an explicit return date with the stored checkout. The app's picker works in whole minutes, so the
 * same minute as the checkout is accepted. */
export function validarDevolucaoPosteriorRetirada(dataDevolucao: string | undefined, dataRetirada: Date): void {
  if (!dataDevolucao) return;
  const inicioDoMinutoDaRetirada = Math.floor(dataRetirada.getTime() / 60_000) * 60_000;
  if (new Date(dataDevolucao).getTime() < inicioDoMinutoDaRetirada) {
    throw new AppError(400, 'backend.emprestimos.data_devolucao_anterior');
  }
}

export function validarDataDevolucao(dataDevolucao: string | undefined, dataRetirada?: Date, agora: number = Date.now()): void {
  if (!dataDevolucao) return;
  validarNaoFutura(new Date(dataDevolucao), agora, 'backend.emprestimos.data_devolucao_futura');
  if (dataRetirada) validarDevolucaoPosteriorRetirada(dataDevolucao, dataRetirada);
}

/** A client date inside the clock-skew tolerance but still ahead of the server is stored as the server's now. */
function limitarAoAgora(data: string | undefined): Date {
  return data ? new Date(Math.min(new Date(data).getTime(), Date.now())) : new Date();
}

/** Status filter of GET /emprestimos: a stored status, or ATIVO = ABERTO or AGENDADO. */
export type FiltroStatusEmprestimo = StatusEmprestimo | 'ATIVO';

/** Optional GET /emprestimos filters (already validated by emprestimoListQuerySchema). */
export interface FiltrosEmprestimo {
  status?: FiltroStatusEmprestimo;
  /** Inclusive lower bound on dataRetirada. */
  de?: Date;
  /** Inclusive upper bound on dataRetirada. */
  ate?: Date;
  /** Authenticated callers only: case-insensitive substring of borrower, responsible person or equipment model. */
  q?: string;
}

export interface ConsultaPaginaEmprestimos {
  filtros?: FiltrosEmprestimo;
  limit: number;
  /** id of the last loan of the previous page (the page's nextCursor). */
  cursor?: number;
}

/**
 * History order: newest checkout first (a schedule sorts by its scheduled start); id breaks ties so the keyset cursor
 * is total and stable.
 */
export const ORDEM_HISTORICO_EMPRESTIMOS: Prisma.EmprestimoOrderByWithRelationInput[] = [
  { dataRetirada: 'desc' },
  { id: 'desc' },
];

const itensComEquipamentoInclude = { itens: { include: { equipamento: { include: { categoria: true } } } } } as const;
const emprestimoPublicoInclude = { responsavel: true, ...itensComEquipamentoInclude } as const;
const emprestimoAutenticadoInclude = { ...autoriaEmprestimoInclude, ...emprestimoPublicoInclude } as const;

/** Exported for tests. One AND-condition per supplied filter; no filter yields an empty list. */
export function condicoesFiltroEmprestimos(filtros: FiltrosEmprestimo = {}): Prisma.EmprestimoWhereInput[] {
  const condicoes: Prisma.EmprestimoWhereInput[] = [];
  if (filtros.status === 'ATIVO') condicoes.push({ status: { in: ['ABERTO', 'AGENDADO'] } });
  else if (filtros.status) condicoes.push({ status: filtros.status });
  if (filtros.de || filtros.ate) {
    condicoes.push({ dataRetirada: { ...(filtros.de ? { gte: filtros.de } : {}), ...(filtros.ate ? { lte: filtros.ate } : {}) } });
  }
  if (filtros.q) {
    // ILIKE on PostgreSQL: case-insensitive, not accent-insensitive (Prisma has no unaccent support).
    const contem = { contains: filtros.q, mode: 'insensitive' as const };
    condicoes.push({
      OR: [
        { solicitanteNome: contem },
        { responsavel: { nome: contem } },
        { itens: { some: { equipamento: { modelo: contem } } } },
      ],
    });
  }
  return condicoes;
}

/** Exported for tests. Rows strictly after the anchor in ORDEM_HISTORICO_EMPRESTIMOS. */
export function condicaoAposCursor(ancora: { id: number; dataRetirada: Date }): Prisma.EmprestimoWhereInput {
  return {
    OR: [
      { dataRetirada: { lt: ancora.dataRetirada } },
      { dataRetirada: ancora.dataRetirada, id: { lt: ancora.id } },
    ],
  };
}

function combinarCondicoes(condicoes: Prisma.EmprestimoWhereInput[]): Prisma.EmprestimoWhereInput | undefined {
  if (condicoes.length === 0) return undefined;
  return condicoes.length === 1 ? condicoes[0] : { AND: condicoes };
}

/**
 * The cursor stays a loan id (backward compatible); its current dataRetirada anchors the keyset. dataRetirada changes
 * exactly once, when a schedule's pickup is confirmed (scheduled start → actual pickup time), so a loan confirmed
 * while a client is paging may move between pages; the app dedupes pages by id.
 */
async function prepararPagina({ filtros, limit, cursor }: ConsultaPaginaEmprestimos) {
  const condicoes = condicoesFiltroEmprestimos(filtros);
  if (cursor !== undefined) {
    const ancora = await prisma.emprestimo.findUnique({ where: { id: cursor }, select: { id: true, dataRetirada: true } });
    if (!ancora) {
      throw new AppError(400, 'backend.validacao.dados_invalidos', {
        detalhes: [{ campo: 'cursor', mensagem: 'Cursor de paginação desconhecido.' }],
      });
    }
    condicoes.push(condicaoAposCursor(ancora));
  }
  return { where: combinarCondicoes(condicoes), take: limit + 1, orderBy: ORDEM_HISTORICO_EMPRESTIMOS };
}

function fecharPagina<T extends { id: number }>(registros: T[], limit: number) {
  const items = registros.slice(0, limit);
  return { items, nextCursor: registros.length > limit ? items.at(-1)?.id ?? null : null };
}

/**
 * Authenticated full array (legacy contract of GET /emprestimos without `paginado`). Without filters the query is
 * exactly the pre-1.5 one; with filters (e.g. status=ABERTO for Devoluções) only the matching loans are returned.
 */
export async function listarEmprestimos(filtros: FiltrosEmprestimo = {}) {
  return prisma.emprestimo.findMany({
    where: combinarCondicoes(condicoesFiltroEmprestimos(filtros)),
    include: emprestimoAutenticadoInclude,
    orderBy: { createdAt: 'desc' },
  });
}

/** Authenticated history page (with authorship). */
export async function listarPaginaEmprestimos(consulta: ConsultaPaginaEmprestimos) {
  const pagina = await prepararPagina(consulta);
  return fecharPagina(await prisma.emprestimo.findMany({ ...pagina, include: emprestimoAutenticadoInclude }), consulta.limit);
}

/** Guest page: never loads authorship; the caller maps items through publicLoan and must not pass `q`. */
export async function listarPaginaPublicaEmprestimos(consulta: ConsultaPaginaEmprestimos) {
  // Defence in depth: the text search matches personal names, so it never runs for guests.
  const pagina = await prepararPagina({ ...consulta, filtros: { ...consulta.filtros, q: undefined } });
  return fecharPagina(await prisma.emprestimo.findMany({ ...pagina, include: emprestimoPublicoInclude }), consulta.limit);
}

/** Shape returned by create and pickup confirmation. */
const emprestimoCriadoInclude = { itens: true, ...autoriaEmprestimoInclude } as const;

/**
 * Creates an immediate loan (ABERTO, units leave the shelf now) or, when dataRetirada lies beyond the clock-skew
 * tolerance, a schedule (AGENDADO) that only reserves units for its window. Either way the request must fit in the
 * time-based availability of every item (disponibilidade.service.ts); immediate loans are also bound by the shelf.
 */
export async function criarEmprestimo(dados: EmprestimoCreateInput, actorId: number) {
  const { solicitanteNome, responsavelId, dataRetirada, dataPrevistaDevolucao, observacao, itens } = dados;
  const agora = Date.now();
  const plano = planejarRetirada(dataRetirada, dataPrevistaDevolucao, agora);

  return runTransaction(async (tx) => {
    // New loans may not name an inactive responsible person; a missing one is still caught by the foreign key.
    const responsavel = await tx.responsavel.findUnique({ where: { id: responsavelId }, select: { ativo: true } });
    if (responsavel && responsavel.ativo === false) {
      throw new AppError(409, 'backend.emprestimos.responsavel_inativo');
    }
    const quantidadesSolicitadas = agruparQuantidades(itens);
    await bloquearEquipamentos(tx, quantidadesSolicitadas.keys());
    const disponibilidade = await carregarDisponibilidade(tx, quantidadesSolicitadas.keys(), agora);
    exigirDisponibilidade(disponibilidade, quantidadesSolicitadas, plano.janela, {
      incluirPrateleira: !plano.agendado,
      sugestao: { agora, duracaoMs: plano.duracaoSugestaoMs },
    });

    const emprestimo = await tx.emprestimo.create({
      data: {
        solicitanteNome,
        responsavelId,
        status: plano.agendado ? 'AGENDADO' : 'ABERTO',
        dataRetirada: plano.dataRetirada,
        dataAgendada: plano.agendado ? plano.dataRetirada : null,
        dataPrevistaDevolucao: plano.dataPrevistaDevolucao,
        observacao,
        criadoPorId: actorId,
        itens: {
          create: itens.map((item) => ({
            equipamentoId: item.equipamentoId,
            quantidade: item.quantidade,
          })),
        },
      },
      include: emprestimoCriadoInclude,
    });

    // Schedules never touch the shelf count; only the pickup confirmation moves units out.
    if (!plano.agendado) await decrementarComSeguranca(tx, quantidadesSolicitadas);
    const campos = ['solicitanteNome', 'responsavelId', 'dataRetirada', 'observacao', 'itens'];
    if (plano.agendado) campos.push('status', 'dataAgendada');
    if (plano.dataPrevistaDevolucao) campos.push('dataPrevistaDevolucao');
    await writeAuditLog(tx, actorId, 'CREATE', 'Emprestimo', emprestimo.id, campos);

    return emprestimo;
  });
}

export async function atualizarItensEmprestimo(id: number, itens: ItemEmprestimoInput[], actorId: number) {
  return runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Emprestimo" WHERE id = ${id} FOR UPDATE`;
    const emprestimoAtual = await tx.emprestimo.findUnique({ where: { id } });
    if (!emprestimoAtual) {
      throw new AppError(404, 'backend.emprestimos.nao_encontrado');
    }
    if (emprestimoAtual.status !== 'ABERTO') {
      throw new AppError(409, 'backend.emprestimos.nao_editavel');
    }

    const itensAntigos = await tx.itemEmprestimo.findMany({ where: { emprestimoId: id } });

    const quantidadesDevolvidas = agruparQuantidades(
      itensAntigos.map((item: { equipamentoId: number; quantidade: number }) => ({
        equipamentoId: item.equipamentoId,
        quantidade: item.quantidade,
      }))
    );
    const quantidadesSolicitadas = agruparQuantidades(itens);

    const agora = Date.now();
    await bloquearEquipamentos(tx, [...quantidadesDevolvidas.keys(), ...quantidadesSolicitadas.keys()]);
    // Increases must also respect future schedules over the rest of this loan ([now, prevista) or open-ended, as in
    // the occupation model). Unchanged or reduced quantities never make availability worse and are not re-checked.
    const aumentos = new Map([...quantidadesSolicitadas].filter(([equipamentoId, quantidade]) =>
      quantidade > (quantidadesDevolvidas.get(equipamentoId) ?? 0)));
    if (aumentos.size > 0) {
      const prevista = emprestimoAtual.dataPrevistaDevolucao?.getTime();
      const disponibilidade = await carregarDisponibilidade(tx, aumentos.keys(), agora, { excluirEmprestimoId: id });
      exigirDisponibilidade(disponibilidade, aumentos, {
        inicio: agora,
        fim: prevista !== undefined && prevista > agora ? prevista : Number.POSITIVE_INFINITY,
      });
    }

    await validarEstoqueDisponivel(tx, quantidadesSolicitadas, quantidadesDevolvidas);

    for (const item of [...itensAntigos].sort((a, b) => a.equipamentoId - b.equipamentoId) as Array<{ equipamentoId: number; quantidade: number }>) {
      await tx.equipamento.update({
        where: { id: item.equipamentoId },
        data: { quantidadeDisponivel: { increment: item.quantidade } },
      });
    }

    await tx.itemEmprestimo.deleteMany({ where: { emprestimoId: id } });

    await tx.itemEmprestimo.createMany({
      data: itens.map((item) => ({
        emprestimoId: id,
        equipamentoId: item.equipamentoId,
        quantidade: item.quantidade,
      })),
    });

    await decrementarComSeguranca(tx, quantidadesSolicitadas);

    const atualizado = await tx.emprestimo.update({
      where: { id },
      data: { atualizadoPorId: actorId, atualizadoEm: new Date() },
      include: { ...autoriaEmprestimoInclude, responsavel: true, itens: { include: { equipamento: true } } },
    });
    await writeAuditLog(tx, actorId, 'UPDATE', 'Emprestimo', id, ['itens']);
    return atualizado;
  });
}

export async function devolverEmprestimo(id: number, dataDevolucao: string | undefined, actorId: number) {
  // Future-date check needs no database; the comparison with the stored dataRetirada happens inside the transaction.
  validarDataDevolucao(dataDevolucao);
  return runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Emprestimo" WHERE id = ${id} FOR UPDATE`;
    const emprestimoAtual = await tx.emprestimo.findUnique({ where: { id } });
    if (!emprestimoAtual) {
      throw new AppError(404, 'backend.emprestimos.nao_encontrado');
    }
    if (emprestimoAtual.status === 'AGENDADO') {
      throw new AppError(409, 'backend.emprestimos.agendamento_nao_confirmado');
    }
    // Already-returned loans keep reporting 409 below; an omitted date is never validated (legacy data may have a
    // retirada slightly ahead of the server clock).
    if (emprestimoAtual.status === 'ABERTO') validarDevolucaoPosteriorRetirada(dataDevolucao, emprestimoAtual.dataRetirada);

    const resultado = await tx.emprestimo.updateMany({
      where: { id, status: 'ABERTO' },
      data: { status: 'DEVOLVIDO', dataDevolucao: limitarAoAgora(dataDevolucao), devolvidoPorId: actorId },
    });

    if (resultado.count === 0) {
      throw new AppError(409, 'backend.emprestimos.ja_devolvido');
    }

    const emprestimo = await tx.emprestimo.findUniqueOrThrow({
      where: { id },
      include: { itens: true, ...autoriaEmprestimoInclude },
    });

    for (const item of [...emprestimo.itens].sort((a, b) => a.equipamentoId - b.equipamentoId)) {
      await tx.equipamento.update({
        where: { id: item.equipamentoId },
        data: { quantidadeDisponivel: { increment: item.quantidade } },
      });
    }

    await writeAuditLog(tx, actorId, 'RETURN', 'Emprestimo', id, ['status', 'dataDevolucao']);

    return emprestimo;
  });
}

/** Open loans still holding units of the given equipment past their expected return (or without one). */
async function emprestimosPendentes(tx: Prisma.TransactionClient, equipamentoIds: number[], agora: Date) {
  return tx.emprestimo.findMany({
    where: {
      status: 'ABERTO',
      itens: { some: { equipamentoId: { in: equipamentoIds } } },
      OR: [{ dataPrevistaDevolucao: null }, { dataPrevistaDevolucao: { lte: agora } }],
    },
    select: { id: true, solicitanteNome: true, dataPrevistaDevolucao: true },
    orderBy: [{ dataRetirada: 'asc' }, { id: 'asc' }],
  });
}

/**
 * PATCH /emprestimos/:id/confirmar-retirada: the schedule's units leave the shelf now. dataRetirada becomes the
 * actual pickup time; dataAgendada and dataPrevistaDevolucao are kept. Fails with 409 unidades_nao_devolvidas when
 * the shelf does not hold the units yet (late returns), listing the overdue loans that still hold them.
 */
export async function confirmarRetirada(id: number, actorId: number) {
  return runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Emprestimo" WHERE id = ${id} FOR UPDATE`;
    const agendamento = await tx.emprestimo.findUnique({ where: { id }, include: { itens: true } });
    if (!agendamento) throw new AppError(404, 'backend.emprestimos.nao_encontrado');
    if (agendamento.status !== 'AGENDADO') throw new AppError(409, 'backend.emprestimos.nao_agendado');
    const agora = new Date();
    validarJanelaConfirmacao(agendamento, agora.getTime());

    const quantidades = agruparQuantidades(agendamento.itens);
    await bloquearEquipamentos(tx, quantidades.keys());
    try {
      await decrementarComSeguranca(tx, quantidades);
    } catch (error) {
      if (!(error instanceof EstoqueInsuficienteError)) throw error;
      // A failed conditional decrement changes no row, so the transaction is still usable for this lookup.
      const itensFaltantes: ItemInsuficiente[] = error.itens;
      const pendentes = await emprestimosPendentes(tx, itensFaltantes.map((item) => item.equipamentoId), agora);
      throw new AppError(409, 'backend.emprestimos.unidades_nao_devolvidas', {
        itens: itensFaltantes,
        emprestimosPendentes: pendentes,
      });
    }

    const confirmado = await tx.emprestimo.update({
      where: { id },
      data: { status: 'ABERTO', dataRetirada: agora, atualizadoPorId: actorId, atualizadoEm: agora },
      include: emprestimoCriadoInclude,
    });
    await writeAuditLog(tx, actorId, 'CONFIRM', 'Emprestimo', id, ['status', 'dataRetirada']);
    return confirmado;
  });
}

/** An EDITOR may delete an open loan only within this long after it was registered (ADMINISTRADOR has no limit). */
export const JANELA_EXCLUSAO_EMPRESTIMO_MS = 24 * 60 * 60 * 1000;

const CAMPOS_AUDITORIA_EXCLUSAO = ['solicitanteNome', 'responsavelId', 'status', 'dataRetirada', 'dataAgendada', 'dataPrevistaDevolucao', 'observacao', 'itens'];

/**
 * DELETE /emprestimos/:id: removes a loan registered by mistake.
 * - AGENDADO: items and loan are deleted; no stock was ever moved for a schedule.
 * - ABERTO: same, and the loan's units go back to stock. An EDITOR may do it only within 24h of
 *   max(createdAt, dataRetirada); ADMINISTRADOR has no limit.
 * - DEVOLVIDO: 409 nao_excluivel (history is kept).
 * The loan row is locked first and the status re-read inside the transaction, so a concurrent return or delete
 * cannot restore stock twice (the loser sees a missing row / non-ABERTO status).
 */
export async function excluirEmprestimo(id: number, actor: { id: number; nivelAcesso: string }): Promise<void> {
  await runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Emprestimo" WHERE id = ${id} FOR UPDATE`;
    const emprestimo = await tx.emprestimo.findUnique({ where: { id }, include: { itens: true } });
    if (!emprestimo) throw new AppError(404, 'backend.emprestimos.nao_encontrado');
    if (emprestimo.status === 'DEVOLVIDO') throw new AppError(409, 'backend.emprestimos.nao_excluivel');

    if (emprestimo.status === 'ABERTO') {
      // Fail closed: only ADMINISTRADOR is exempt, so any other or future role gets the 24h window.
      if (actor.nivelAcesso !== 'ADMINISTRADOR') {
        const registradoEm = Math.max(emprestimo.createdAt.getTime(), emprestimo.dataRetirada.getTime());
        if (Date.now() - registradoEm > JANELA_EXCLUSAO_EMPRESTIMO_MS) {
          throw new AppError(403, 'backend.emprestimos.exclusao_fora_do_prazo');
        }
      }
      await bloquearEquipamentos(tx, agruparQuantidades(emprestimo.itens).keys());
      for (const item of [...emprestimo.itens].sort((a, b) => a.equipamentoId - b.equipamentoId)) {
        await tx.equipamento.update({
          where: { id: item.equipamentoId },
          data: { quantidadeDisponivel: { increment: item.quantidade } },
        });
      }
    }

    await tx.itemEmprestimo.deleteMany({ where: { emprestimoId: id } });
    await tx.emprestimo.delete({ where: { id } });
    await writeAuditLog(tx, actor.id, 'DELETE', 'Emprestimo', id, CAMPOS_AUDITORIA_EXCLUSAO);
  });
}
