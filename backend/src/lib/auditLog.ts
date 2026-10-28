import type { Prisma } from '@prisma/client';

/** Persist metadata only; never include record values in audit entries. */
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
}
