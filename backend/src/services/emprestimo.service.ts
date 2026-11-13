import { prisma, runTransaction } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { writeAuditLog } from '../lib/auditLog.js';
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

export async function listarEmprestimos() {
  return prisma.emprestimo.findMany({
    include: {
      responsavel: true,
      itens: {
        include: {
          equipamento: {
            include: { categoria: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listarPaginaPublicaEmprestimos(limit: number, cursor?: number) {
  const registros = await prisma.emprestimo.findMany({
    where: cursor === undefined ? undefined : { id: { lt: cursor } },
    take: limit + 1,
    include: {
      responsavel: true,
      itens: { include: { equipamento: { include: { categoria: true } } } },
    },
    orderBy: { id: 'desc' },
  });
  const hasMore = registros.length > limit;
  const items = registros.slice(0, limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function criarEmprestimo(dados: EmprestimoCreateInput, actorId: number) {
  const { solicitanteNome, responsavelId, dataRetirada, observacao, itens } = dados;
  validarDataRetirada(dataRetirada);
  const dataRetiradaFinal = limitarAoAgora(dataRetirada);

  return runTransaction(async (tx) => {
    const quantidadesSolicitadas = agruparQuantidades(itens);
    await validarEstoqueDisponivel(tx, quantidadesSolicitadas);

    const emprestimo = await tx.emprestimo.create({
      data: {
        solicitanteNome,
        responsavelId,
        dataRetirada: dataRetiradaFinal,
        observacao,
        itens: {
          create: itens.map((item) => ({
            equipamentoId: item.equipamentoId,
            quantidade: item.quantidade,
          })),
        },
      },
      include: { itens: true },
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

    const atualizado = await tx.emprestimo.findUnique({
      where: { id },
      include: { responsavel: true, itens: { include: { equipamento: true } } },
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
      data: { status: 'DEVOLVIDO', dataDevolucao: limitarAoAgora(dataDevolucao) },
    });

    if (resultado.count === 0) {
      throw new AppError(409, 'backend.emprestimos.ja_devolvido');
    }

    const emprestimo = await tx.emprestimo.findUniqueOrThrow({
      where: { id },
      include: { itens: true },
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
