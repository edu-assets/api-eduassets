import type { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';

type TxClient = Prisma.TransactionClient;

export interface ItemInsuficiente {
  equipamentoId: number;
  nome: string;
  categoria: string;
  solicitado: number;
  disponivel: number;
}

export class EstoqueInsuficienteError extends AppError {
  readonly itens: ItemInsuficiente[];

  constructor(itens: ItemInsuficiente[]) {
    super(400, `Estoque insuficiente para ${itens.length} equipamento(s).`, { itens });
    this.name = 'EstoqueInsuficienteError';
    this.itens = itens;
  }
}

export function agruparQuantidades(
  itens: Array<{ equipamentoId: number; quantidade: number }>
): Map<number, number> {
  const mapa = new Map<number, number>();
  for (const item of itens) {
    mapa.set(item.equipamentoId, (mapa.get(item.equipamentoId) ?? 0) + item.quantidade);
  }
  return new Map([...mapa.entries()].sort(([idA], [idB]) => idA - idB));
}

export async function validarEstoqueDisponivel(
  tx: TxClient,
  quantidadesSolicitadas: Map<number, number>,
  quantidadesDevolvidas: Map<number, number> = new Map()
): Promise<void> {
  const equipamentoIds = [...quantidadesSolicitadas.keys()].sort((a, b) => a - b);

  const equipamentos = await tx.equipamento.findMany({
    where: { id: { in: equipamentoIds } },
    include: { categoria: true },
  });

  const insuficientes: ItemInsuficiente[] = [];

  for (const [equipamentoId, solicitado] of quantidadesSolicitadas) {
    const equipamento = equipamentos.find((e) => e.id === equipamentoId);

    if (!equipamento) {
      insuficientes.push({
        equipamentoId,
        nome: 'Equipamento não encontrado',
        categoria: '',
        solicitado,
        disponivel: 0,
      });
      continue;
    }

    const devolvido = quantidadesDevolvidas.get(equipamentoId) ?? 0;
    const disponivelEfetivo = equipamento.quantidadeDisponivel + devolvido;

    if (solicitado > disponivelEfetivo) {
      insuficientes.push({
        equipamentoId,
        nome: equipamento.modelo,
        categoria: equipamento.categoria.nome,
        solicitado,
        disponivel: disponivelEfetivo,
      });
    }
  }

  if (insuficientes.length > 0) {
    throw new EstoqueInsuficienteError(insuficientes);
  }
}

async function decrementarDisponivelAtomic(
  tx: TxClient,
  equipamentoId: number,
  quantidade: number
): Promise<boolean> {
  const resultado = await tx.equipamento.updateMany({
    where: { id: equipamentoId, quantidadeDisponivel: { gte: quantidade } },
    data: { quantidadeDisponivel: { decrement: quantidade } },
  });
  return resultado.count === 1;
}

export async function decrementarComSeguranca(
  tx: TxClient,
  quantidadesSolicitadas: Map<number, number>
): Promise<void> {
  const falhas: number[] = [];

  for (const [equipamentoId, quantidade] of [...quantidadesSolicitadas.entries()].sort(([idA], [idB]) => idA - idB)) {
    const ok = await decrementarDisponivelAtomic(tx, equipamentoId, quantidade);
    if (!ok) falhas.push(equipamentoId);
  }

  if (falhas.length > 0) {
    const equipamentos = await tx.equipamento.findMany({
      where: { id: { in: falhas } },
      include: { categoria: true },
    });

    const itens: ItemInsuficiente[] = falhas.map((id) => {
      const equipamento = equipamentos.find((e) => e.id === id);
      return {
        equipamentoId: id,
        nome: equipamento?.modelo ?? 'Equipamento não encontrado',
        categoria: equipamento?.categoria.nome ?? '',
        solicitado: quantidadesSolicitadas.get(id) ?? 0,
        disponivel: equipamento?.quantidadeDisponivel ?? 0,
      };
    });

    throw new EstoqueInsuficienteError(itens);
  }
}
