import { prisma, runTransaction } from '../lib/prisma.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { autoriaResponsavelInclude } from '../lib/authorship.js';

export async function listarResponsaveis() {
  return prisma.responsavel.findMany({
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
