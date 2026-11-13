import { AppError } from '../errors/AppError.js';
import type { ResponsavelUpdateSchemaInput } from '../schemas/responsavel.schema.js';
import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaResponsavelInclude } from '../lib/authorship.js';

/** Active responsible people only; `incluirInativos` (admins only, enforced by the controller) lists everyone. */
export async function listarResponsaveis(incluirInativos = false) {
  return prisma.responsavel.findMany({
    where: incluirInativos ? undefined : { ativo: true },
    include: autoriaResponsavelInclude,
    orderBy: { nome: 'asc' },
  });
}

export async function criarResponsavel(nome: string, cargo: string, actorId: number) {
  return runTransaction(async (tx) => {
    const criado = await tx.responsavel.create({ data: { nome, cargo, criadoPorId: actorId }, include: autoriaResponsavelInclude });
    await writeAuditLog(tx, actorId, 'CREATE', 'Responsavel', criado.id, ['nome', 'cargo']);
    return criado;
  });
}

/** Partial update. Responsavel has no editor column (only criadoPorId), so the edit is traced only in the AuditLog. */
export async function atualizarResponsavel(id: number, dados: ResponsavelUpdateSchemaInput, actorId: number) {
  const data = {
    ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
    ...(dados.cargo !== undefined ? { cargo: dados.cargo } : {}),
    ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
  };
  return runTransaction(async (tx) => {
    const atual = await tx.responsavel.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new AppError(404, 'backend.responsaveis.nao_encontrado');
    const atualizado = await tx.responsavel.update({ where: { id }, data, include: autoriaResponsavelInclude });
    await writeAuditLog(tx, actorId, 'UPDATE', 'Responsavel', id, Object.keys(data));
    return atualizado;
  });
}
