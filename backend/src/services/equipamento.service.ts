import { prisma, runTransaction } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';

export interface EquipamentoCreateInput {
  categoriaId: number;
  modelo: string;
  quantidadeTotal: number;
}

export interface EquipamentoUpdateInput {
  quantidadeTotal?: number;
  quantidadeDisponivel?: number;
  quantidadeQuebrada?: number;
}

export async function listarEquipamentos() {
  return prisma.equipamento.findMany({
    include: { categoria: true },
    orderBy: { categoria: { nome: 'asc' } },
  });
}

export async function criarEquipamento(dados: EquipamentoCreateInput) {
  const { categoriaId, modelo, quantidadeTotal } = dados;

  return prisma.equipamento.create({
    data: {
      categoriaId,
      modelo,
      quantidadeTotal,
      quantidadeDisponivel: quantidadeTotal,
    },
    include: { categoria: true },
  });
}

export async function atualizarEquipamento(id: number, dados: EquipamentoUpdateInput) {
  const { quantidadeTotal, quantidadeDisponivel, quantidadeQuebrada } = dados;

  return runTransaction(async (tx) => {
    // Serialize admin stock edits with loan and occurrence inventory updates.
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Equipamento" WHERE id = ${id} FOR UPDATE`;
    const atual = await tx.equipamento.findUnique({ where: { id } });
    if (!atual) throw new AppError(404, 'backend.equipamentos.nao_encontrado');

    const totalFinal = quantidadeTotal ?? atual.quantidadeTotal;
    const disponivelFinal = quantidadeDisponivel ?? atual.quantidadeDisponivel;
    const quebradaFinal = quantidadeQuebrada ?? atual.quantidadeQuebrada;
    const emprestados = await tx.itemEmprestimo.aggregate({
      where: { equipamentoId: id, emprestimo: { status: 'ABERTO' } },
      _sum: { quantidade: true },
    });
    const manutencoesAbertas = await tx.ocorrencia.count({
      where: { equipamentoId: id, status: 'ABERTO', tipo: 'MANUTENCAO' },
    });
    const ocorrenciasQuebradasAbertas = await tx.ocorrencia.count({
      where: { equipamentoId: id, status: 'ABERTO', tipo: 'QUEBRADO' },
    });
    const quantidadeEmprestada = emprestados._sum.quantidade ?? 0;

    if (quebradaFinal < ocorrenciasQuebradasAbertas ||
        disponivelFinal + quebradaFinal + quantidadeEmprestada + manutencoesAbertas > totalFinal) {
      throw new AppError(409, 'backend.equipamentos.quantidade_em_uso');
    }

    return tx.equipamento.update({
      where: { id },
      data: { quantidadeTotal, quantidadeDisponivel, quantidadeQuebrada },
      include: { categoria: true },
    });
  });
}
