import { AppError } from '../errors/AppError.js';
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

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

/** Renames a category. Categoria has no editor column (only criadoPorId), so the edit is traced only in the AuditLog. */
export async function atualizarCategoria(id: number, nome: string, actorId: number) {
  try {
    return await runTransaction(async (tx) => {
      const atual = await tx.categoria.findUnique({ where: { id }, select: { id: true } });
      if (!atual) throw new AppError(404, 'backend.categorias.nao_encontrada');
      const atualizada = await tx.categoria.update({ where: { id }, data: { nome }, include: autoriaCategoriaInclude });
      await writeAuditLog(tx, actorId, 'UPDATE', 'Categoria', id, ['nome']);
      return atualizada;
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new AppError(409, 'backend.categorias.nome_duplicado');
    throw error;
  }
}
