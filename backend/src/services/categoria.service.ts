import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';

export async function listarCategorias() {
  return prisma.categoria.findMany({
    orderBy: { nome: 'asc' },
  });
}

export async function criarCategoria(nome: string, actorId: number) {
  return runTransaction(async (tx) => {
    const criada = await tx.categoria.create({ data: { nome } });
    await writeAuditLog(tx, actorId, 'CREATE', 'Categoria', criada.id, ['nome']);
    return criada;
  });
}
