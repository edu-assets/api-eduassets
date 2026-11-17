import type { Prisma } from '@prisma/client';
import { anotarMudanca } from './changeFeed.js';

/**
 * Persist metadata only; never include record values in audit entries.
 * Also reports the entity to the in-memory change feed (GET /sync/estado), which publishes it after commit.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  actorId: number,
  action: string,
  entity: string,
  entityId: number | string,
  changedFields: string[],
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId: String(entityId),
      changedFields,
    },
  });
  anotarMudanca(entity);
}
