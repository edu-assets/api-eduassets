import { Prisma, PrismaClient } from '@prisma/client';

/** Shared typed Prisma client. Database failures propagate to the request error handler. */
export const prisma = new PrismaClient();
export const TRANSACTION_TIMEOUT_MS = 15000;
export const TRANSACTION_MAX_WAIT_MS = 5000;
export type TransactionClient = Prisma.TransactionClient;

/** Execute an interactive transaction with the application's standard timeouts. */
export function runTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: options?.timeout ?? TRANSACTION_TIMEOUT_MS,
    maxWait: options?.maxWait ?? TRANSACTION_MAX_WAIT_MS,
    isolationLevel: options?.isolationLevel,
  });
}
