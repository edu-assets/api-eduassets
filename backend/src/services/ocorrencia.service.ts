import { prisma, runTransaction } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { decrementarComSeguranca } from './estoque.service.js';

export const ocorrenciaInclude = {
  equipamento: { include: { categoria: true } },
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

export async function criarOcorrencias(dados: OcorrenciaCreateInput) {
  const { equipamentoId, tipo, problema, descricao, numeros } = dados;
  const quantidade = numeros.length;

  return runTransaction(async (tx) => {
    if (tipo === 'MANUTENCAO' || tipo === 'QUEBRADO') {
      await decrementarComSeguranca(tx, new Map([[equipamentoId, quantidade]]));
    }

    const criadas = await Promise.all(
      numeros.map((numero) =>
        tx.ocorrencia.create({
          data: { equipamentoId, tipo, problema, descricao, numero },
          include: ocorrenciaInclude,
        })
      )
    );

    if (tipo === 'QUEBRADO') {
      await tx.equipamento.update({
        where: { id: equipamentoId },
        data: { quantidadeQuebrada: { increment: quantidade } },
      });
    }

    return criadas;
  });
}

export async function atualizarOcorrencia(id: number, dados: OcorrenciaUpdateInput) {
  const { problema, descricao, numero, medidasTomadas } = dados;

  return prisma.ocorrencia.update({
    where: { id },
    data: {
      problema,
      descricao,
      numero,
      ...(medidasTomadas !== undefined ? { medidasTomadas } : {}),
    },
    include: ocorrenciaInclude,
  });
}

export async function resolverOcorrencia(id: number, medidasTomadas: string) {
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
      data: { status: 'RESOLVIDO', resolvidoEm: new Date(), medidasTomadas },
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

    return resolvida;
  });
}

export async function excluirOcorrencia(id: number) {
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
  });
}
