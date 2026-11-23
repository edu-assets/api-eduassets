import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaOcorrenciaInclude } from '../lib/authorship.js';
import { AppError } from '../errors/AppError.js';
import { decrementarComSeguranca } from './estoque.service.js';
import {
  agendamentosQueNaoCabem,
  bloquearEquipamentos,
  carregarDisponibilidade,
} from './disponibilidade.service.js';
import type { Prisma } from '@prisma/client';

/** Shape loaded for Guest Mode (projected by publicOccurrence): no authorship. */
export const ocorrenciaPublicaInclude = {
  equipamento: { include: { categoria: true } },
};

/** Authenticated shape: equipment plus who created, edited and resolved the occurrence ({ id, nome } only). */
export const ocorrenciaInclude = {
  ...ocorrenciaPublicaInclude,
  ...autoriaOcorrenciaInclude,
};

export interface OcorrenciaCreateInput {
  equipamentoId: number;
  tipo: 'OBSERVACAO' | 'MANUTENCAO' | 'QUEBRADO';
  problema: string;
  descricao: string;
  numeros: string[];
}

export interface OcorrenciaUpdateInput {
  problema?: string;
  descricao?: string;
  numero?: string;
  medidasTomadas?: string;
}

export async function listarOcorrencias() {
  return prisma.ocorrencia.findMany({
    include: ocorrenciaInclude,
    orderBy: { createdAt: 'desc' },
  });
}

/** Guest Mode list: never loads authorship. */
export async function listarOcorrenciasPublicas() {
  return prisma.ocorrencia.findMany({
    include: ocorrenciaPublicaInclude,
    orderBy: { createdAt: 'desc' },
  });
}

/** A current or future schedule that no longer fits after an occurrence reduced the equipment's capacity. */
export interface AgendamentoAfetado {
  id: number;
  solicitanteNome: string;
  dataAgendada: Date | null;
  dataPrevistaDevolucao: Date | null;
}

/** Schedules of the equipment (window not over yet) that the current capacity can no longer honor. */
async function listarAgendamentosAfetados(
  tx: Prisma.TransactionClient,
  equipamentoId: number,
  agora: number,
): Promise<AgendamentoAfetado[]> {
  const estado = (await carregarDisponibilidade(tx, [equipamentoId], agora)).get(equipamentoId);
  if (!estado) return [];
  const fixos = estado.ocupacoes.filter((ocupacao) => ocupacao.status === 'ABERTO');
  // One entry per schedule (a schedule may hold several lines of the same equipment).
  const porAgendamento = new Map<number, { emprestimoId: number; inicio: number; fim: number; quantidade: number }>();
  for (const ocupacao of estado.ocupacoes) {
    if (ocupacao.status !== 'AGENDADO') continue;
    const atual = porAgendamento.get(ocupacao.emprestimoId);
    if (atual) atual.quantidade += ocupacao.quantidade;
    else porAgendamento.set(ocupacao.emprestimoId, { ...ocupacao });
  }
  const ids = agendamentosQueNaoCabem(estado.capacidade, fixos, [...porAgendamento.values()], agora);
  if (ids.length === 0) return [];
  return tx.emprestimo.findMany({
    where: { id: { in: ids } },
    select: { id: true, solicitanteNome: true, dataAgendada: true, dataPrevistaDevolucao: true },
    orderBy: [{ dataAgendada: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Creates one occurrence per patrimony number. MANUTENCAO/QUEBRADO take units off the shelf and are never blocked by
 * schedules; every created occurrence carries `agendamentosAfetados`, the schedules that no longer fit afterwards
 * (empty for OBSERVACAO), so the app can warn the operator.
 */
export async function criarOcorrencias(dados: OcorrenciaCreateInput, actorId: number) {
  const { equipamentoId, tipo, problema, descricao, numeros } = dados;
  const quantidade = numeros.length;
  const reduzCapacidade = tipo === 'MANUTENCAO' || tipo === 'QUEBRADO';

  return runTransaction(async (tx) => {
    if (reduzCapacidade) {
      await bloquearEquipamentos(tx, [equipamentoId]);
      await decrementarComSeguranca(tx, new Map([[equipamentoId, quantidade]]));
    }

    const criadas = await Promise.all(
      numeros.map(async (numero) => {
        const criada = await tx.ocorrencia.create({
          data: { equipamentoId, tipo, problema, descricao, numero, criadoPorId: actorId },
          include: ocorrenciaInclude,
        });
        await writeAuditLog(tx, actorId, 'CREATE', 'Ocorrencia', criada.id,
          ['equipamentoId', 'tipo', 'problema', 'descricao', 'numero']);
        return criada;
      })
    );

    if (tipo === 'QUEBRADO') {
      await tx.equipamento.update({
        where: { id: equipamentoId },
        data: { quantidadeQuebrada: { increment: quantidade } },
      });
    }

    const agendamentosAfetados = reduzCapacidade ? await listarAgendamentosAfetados(tx, equipamentoId, Date.now()) : [];
    return criadas.map((criada) => ({ ...criada, agendamentosAfetados }));
  });
}

export async function atualizarOcorrencia(id: number, dados: OcorrenciaUpdateInput, actorId: number) {
  const { problema, descricao, numero, medidasTomadas } = dados;

  return runTransaction(async (tx) => {
    const atualizada = await tx.ocorrencia.update({
      where: { id },
      data: {
        problema, descricao, numero, ...(medidasTomadas !== undefined ? { medidasTomadas } : {}),
        atualizadoPorId: actorId, atualizadoEm: new Date(),
      },
      include: ocorrenciaInclude,
    });
    await writeAuditLog(tx, actorId, 'UPDATE', 'Ocorrencia', id, Object.keys(dados));
    return atualizada;
  });
}

export async function resolverOcorrencia(id: number, medidasTomadas: string, actorId: number) {
  return runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Ocorrencia" WHERE id = ${id} FOR UPDATE`;
    const ocorrenciaAtual = await tx.ocorrencia.findUnique({ where: { id } });
    if (!ocorrenciaAtual) {
      throw new AppError(404, 'backend.geral.registro_nao_encontrado');
    }

    // Garante que resolver uma ocorrência ajusta o estoque exatamente uma vez
    if (ocorrenciaAtual.status === 'RESOLVIDO') {
      throw new AppError(409, 'backend.geral.registro_duplicado');
    }

    const claim = await tx.ocorrencia.updateMany({
      where: { id, status: 'ABERTO' },
      data: { status: 'RESOLVIDO', resolvidoEm: new Date(), medidasTomadas, resolvidoPorId: actorId },
    });
    if (claim.count !== 1) throw new AppError(409, 'backend.geral.registro_duplicado');

    const resolvida = await tx.ocorrencia.findUniqueOrThrow({
      where: { id },
      include: ocorrenciaInclude,
    });

    if (resolvida.tipo === 'MANUTENCAO' || resolvida.tipo === 'QUEBRADO') {
      await tx.equipamento.update({
        where: { id: resolvida.equipamentoId },
        data: {
          quantidadeDisponivel: { increment: 1 },
          ...(resolvida.tipo === 'QUEBRADO' ? { quantidadeQuebrada: { decrement: 1 } } : {}),
        },
      });
    }

    await writeAuditLog(tx, actorId, 'RESOLVE', 'Ocorrencia', id,
      ['status', 'resolvidoEm', 'medidasTomadas']);

    return resolvida;
  });
}

export async function excluirOcorrencia(id: number, actorId: number) {
  return runTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Ocorrencia" WHERE id = ${id} FOR UPDATE`;
    const ocorrencia = await tx.ocorrencia.findUnique({ where: { id } });
    if (!ocorrencia) return;

    // Se a ocorrência ainda estava aberta, devolve ao estoque disponível;
    // se já estava resolvida, o ajuste já foi feito na resolução e não deve ser revertido novamente.
    if (ocorrencia.status === 'ABERTO' && (ocorrencia.tipo === 'MANUTENCAO' || ocorrencia.tipo === 'QUEBRADO')) {
      await tx.equipamento.update({
        where: { id: ocorrencia.equipamentoId },
        data: {
          quantidadeDisponivel: { increment: 1 },
          ...(ocorrencia.tipo === 'QUEBRADO' ? { quantidadeQuebrada: { decrement: 1 } } : {}),
        },
      });
    }

    await tx.ocorrencia.delete({ where: { id } });
    await writeAuditLog(tx, actorId, 'DELETE', 'Ocorrencia', id,
      ['equipamentoId', 'tipo', 'problema', 'descricao', 'numero', 'status', 'resolvidoEm', 'medidasTomadas']);
  });
}
