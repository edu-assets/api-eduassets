import { prisma } from '../lib/prisma.js';

export interface EstadoSync {
  cursor: string;
  entidades: string[];
}

/**
 * Entities clients may be told about. 'Usuario' is deliberately absent: it would leak logout/password-reset timing
 * to every authenticated user.
 */
export const ENTIDADES_SINCRONIZADAS = ['Categoria', 'Emprestimo', 'Equipamento', 'Ocorrencia', 'Responsavel'] as const;

/** The cursor only advances over rows at least this old (see obterEstadoSync). */
export const ATRASO_CURSOR_MS = 10_000;

/** When the client is further behind than this many ids, everything is reported without scanning. */
export const LIMITE_VARREDURA = 1000;

/**
 * Lightweight change feed backed by AuditLog (written inside the transaction of every mutation).
 * Only the cursor and entity names are exposed; actorId, entityId and changedFields never leave this function.
 *
 * AuditLog ids are assigned at insert time but transactions may commit out of order, so MAX(id) is not a safe
 * cursor: a row committed later with a lower id would be skipped. Instead the cursor is the id of the newest row
 * older than ATRASO_CURSOR_MS (monotonic). Rows newer than that are still reported in `entidades` (the scan has no
 * upper bound) and are reported again on the next poll, which only costs the client one extra reload. This closes
 * the gap for transactions shorter than ATRASO_CURSOR_MS; a longer one could still be missed, and the app's
 * 5-minute full reload covers that case.
 *
 * Without `desde` no entities are reported. If the client is more than LIMITE_VARREDURA ids behind, all synchronized
 * entities are returned without grouping the (large) range.
 */
export async function obterEstadoSync(desde?: number, agora: Date = new Date()): Promise<EstadoSync> {
  const limite = new Date(agora.getTime() - ATRASO_CURSOR_MS);
  const antigo = await prisma.auditLog.findFirst({
    where: { createdAt: { lte: limite } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const cursor = String(antigo?.id ?? 0);

  if (desde === undefined) return { cursor, entidades: [] };

  const maximo = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0;
  if (maximo <= desde) return { cursor, entidades: [] };
  if (maximo - desde > LIMITE_VARREDURA) return { cursor, entidades: [...ENTIDADES_SINCRONIZADAS] };

  const grupos = await prisma.auditLog.groupBy({
    by: ['entity'],
    where: { id: { gt: desde }, entity: { in: [...ENTIDADES_SINCRONIZADAS] } },
  });
  return { cursor, entidades: grupos.map((grupo) => grupo.entity).sort() };
}
