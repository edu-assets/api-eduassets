import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaEquipamentoInclude } from '../lib/authorship.js';
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
    include: { categoria: true, ...autoriaEquipamentoInclude },
    orderBy: { categoria: { nome: 'asc' } },
  });
}

/** Guest Mode list: never loads authorship (projected by publicEquipment). */
export async function listarEquipamentosPublicos() {
  return prisma.equipamento.findMany({
    include: { categoria: true },
    orderBy: { categoria: { nome: 'asc' } },
  });
}

export async function criarEquipamento(dados: EquipamentoCreateInput, actorId: number) {
  const { categoriaId, modelo, quantidadeTotal } = dados;
  return runTransaction(async (tx) => {
    const criado = await tx.equipamento.create({
      data: { categoriaId, modelo, quantidadeTotal, quantidadeDisponivel: quantidadeTotal, criadoPorId: actorId },
      include: { categoria: true, ...autoriaEquipamentoInclude },
    });
    await writeAuditLog(tx, actorId, 'CREATE', 'Equipamento', criado.id,
      ['categoriaId', 'modelo', 'quantidadeTotal', 'quantidadeDisponivel']);
    return criado;
  });
}

export async function atualizarEquipamento(id: number, dados: EquipamentoUpdateInput, actorId: number) {
  const { quantidadeTotal, quantidadeDisponivel, quantidadeQuebrada } = dados;

  return runTransaction(async (tx) => {
    // Serialize admin stock edits with loan and occurrence inventory updates.
    await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "Equipamento" WHERE id = ${id} FOR UPDATE`;
    const atual = await tx.equipamento.findUnique({ where: { id } });
    if (!atual) throw new AppError(404, 'backend.equipamentos.nao_encontrado');

    const totalFinal = quantidadeTotal ?? atual.quantidadeTotal;
    // Total sent without Disponivel: apply the delta to Disponivel here, on the locked row, so concurrent loans cannot be lost.
    const ajusteAutomatico = quantidadeTotal !== undefined && quantidadeDisponivel === undefined;
    const disponivelFinal = ajusteAutomatico
      ? atual.quantidadeDisponivel + (quantidadeTotal - atual.quantidadeTotal)
      : quantidadeDisponivel ?? atual.quantidadeDisponivel;
    if (disponivelFinal < 0) throw new AppError(409, 'backend.equipamentos.quantidade_em_uso');
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

    const atualizado = await tx.equipamento.update({
      where: { id },
      // Only this explicit edit (audited as UPDATE) sets atualizadoPorId; stock moves caused by loans and occurrences
      // are audited on those records and leave the equipment's editor untouched.
      data: { quantidadeTotal, quantidadeDisponivel: ajusteAutomatico ? disponivelFinal : quantidadeDisponivel, quantidadeQuebrada, atualizadoPorId: actorId },
      include: { categoria: true, ...autoriaEquipamentoInclude },
    });
    const campos = Object.keys(dados);
    if (ajusteAutomatico && disponivelFinal !== atual.quantidadeDisponivel) campos.push('quantidadeDisponivel');
    await writeAuditLog(tx, actorId, 'UPDATE', 'Equipamento', id, campos);
    return atualizado;
  });
}
