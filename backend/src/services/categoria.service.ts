import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaCategoriaInclude } from '../lib/authorship.js';

export async function listarCategorias() {
  return prisma.categoria.findMany({
    include: autoriaCategoriaInclude,
    orderBy: { nome: 'asc' },
  });
}

/** Guest Mode list: only id and nome (no authorship). */
export async function listarCategoriasPublicas() {
  return prisma.categoria.findMany({
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  });
}

export async function criarCategoria(nome: string, actorId: number) {
  return runTransaction(async (tx) => {
    const criada = await tx.categoria.create({ data: { nome, criadoPorId: actorId }, include: autoriaCategoriaInclude });
    await writeAuditLog(tx, actorId, 'CREATE', 'Categoria', criada.id, ['nome']);
    return criada;
  });
}
