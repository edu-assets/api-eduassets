import type { Prisma } from '@prisma/client';

type PublicEquipment = Prisma.EquipamentoGetPayload<{ include: { categoria: true } }>;
type PublicLoan = Prisma.EmprestimoGetPayload<{
  include: { responsavel: true; itens: { include: { equipamento: { include: { categoria: true } } } } };
}>;
type PublicOccurrence = Prisma.OcorrenciaGetPayload<{
  include: { equipamento: { include: { categoria: true } } };
}>;

/** Deliberate Guest Mode projections: never serialize Prisma objects wholesale. */
export function publicEquipment(value: PublicEquipment) {
  return {
    id: value.id, modelo: value.modelo,
    quantidadeTotal: value.quantidadeTotal,
    quantidadeDisponivel: value.quantidadeDisponivel,
    quantidadeQuebrada: value.quantidadeQuebrada,
    categoria: value.categoria ? { id: value.categoria.id, nome: value.categoria.nome } : null,
  };
}

export function publicLoan(value: PublicLoan) {
  return {
    id: value.id, status: value.status, dataRetirada: value.dataRetirada,
    dataDevolucao: value.dataDevolucao, createdAt: value.createdAt,
    // Personal names, free-text notes and staff identifiers are intentionally withheld.
    solicitanteNome: 'Convidado', observacao: null, responsavelId: null,
    responsavel: null,
    itens: value.itens.map((item) => ({
      id: item.id, quantidade: item.quantidade,
      equipamentoId: item.equipamentoId,
      equipamento: item.equipamento ? {
        id: item.equipamento.id, modelo: item.equipamento.modelo,
        categoria: item.equipamento.categoria ? { nome: item.equipamento.categoria.nome } : null,
      } : null,
    })),
  };
}

export function publicOccurrence(value: PublicOccurrence) {
  return {
    id: value.id, tipo: value.tipo, status: value.status,
    createdAt: value.createdAt, resolvidoEm: value.resolvidoEm,
    equipamentoId: value.equipamentoId,
    equipamento: value.equipamento ? {
      id: value.equipamento.id, modelo: value.equipamento.modelo,
      categoria: value.equipamento.categoria ? { nome: value.equipamento.categoria.nome } : null,
    } : null,
    // Incident text, inventory serials and remediation notes are potentially sensitive.
    numero: null, problema: 'Detalhes restritos', descricao: '', medidasTomadas: null,
  };
}
