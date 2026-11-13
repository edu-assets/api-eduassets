import type { Prisma, StatusEmprestimo } from '@prisma/client';
import { prisma, runTransaction } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaEmprestimoInclude } from '../lib/authorship.js';
import {
  agruparQuantidades,
  validarEstoqueDisponivel,
  decrementarComSeguranca,
} from './estoque.service.js';

export interface ItemEmprestimoInput {
  equipamentoId: number;
  quantidade: number;
}

export interface EmprestimoCreateInput {
  solicitanteNome: string;
  responsavelId: number;
  dataRetirada?: string;
  observacao?: string;
  itens: ItemEmprestimoInput[];
}

/** Clock-skew tolerance for client-supplied dates: anything further in the future than this is rejected. */
export const TOLERANCIA_DATA_FUTURA_MS = 5 * 60 * 1000;

function validarNaoFutura(data: Date, agora: number, chaveErro: string): void {
  if (data.getTime() > agora + TOLERANCIA_DATA_FUTURA_MS) throw new AppError(400, chaveErro);
}

/** Exported for tests. Only explicit dates are validated; an omitted date is filled in by the server. */
export function validarDataRetirada(dataRetirada: string | undefined, agora: number = Date.now()): void {
  if (dataRetirada) validarNaoFutura(new Date(dataRetirada), agora, 'backend.emprestimos.data_retirada_futura');
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

/** Optional GET /emprestimos filters (already validated by emprestimoListQuerySchema). */
export interface FiltrosEmprestimo {
  status?: StatusEmprestimo;
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

/** History order: newest checkout first; id breaks ties so the keyset cursor is total and stable. */
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
  if (filtros.status) condicoes.push({ status: filtros.status });
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

/** The cursor stays a loan id (backward compatible); its dataRetirada, which never changes, anchors the keyset. */
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

export async function criarEmprestimo(dados: EmprestimoCreateInput, actorId: number) {
  const { solicitanteNome, responsavelId, dataRetirada, observacao, itens } = dados;
  validarDataRetirada(dataRetirada);
  const dataRetiradaFinal = limitarAoAgora(dataRetirada);

  return runTransaction(async (tx) => {
    // New loans may not name an inactive responsible person; a missing one is still caught by the foreign key.
    const responsavel = await tx.responsavel.findUnique({ where: { id: responsavelId }, select: { ativo: true } });
    if (responsavel && responsavel.ativo === false) {
      throw new AppError(409, 'backend.emprestimos.responsavel_inativo');
    }
    const quantidadesSolicitadas = agruparQuantidades(itens);
    await validarEstoqueDisponivel(tx, quantidadesSolicitadas);

    const emprestimo = await tx.emprestimo.create({
      data: {
        solicitanteNome,
        responsavelId,
        dataRetirada: dataRetiradaFinal,
        observacao,
        criadoPorId: actorId,
        itens: {
          create: itens.map((item) => ({
            equipamentoId: item.equipamentoId,
            quantidade: item.quantidade,
          })),
        },
      },
      include: { itens: true, ...autoriaEmprestimoInclude },
    });

    await decrementarComSeguranca(tx, quantidadesSolicitadas);
    await writeAuditLog(tx, actorId, 'CREATE', 'Emprestimo', emprestimo.id,
      ['solicitanteNome', 'responsavelId', 'dataRetirada', 'observacao', 'itens']);

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
