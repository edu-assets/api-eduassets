import { z } from 'zod';
import { MAX_DATABASE_INT } from './common.schema.js';

/**
 * `desde` is the opaque cursor returned by the previous call (an in-memory sequence, see lib/changeFeed.ts; it is
 * not an AuditLog id). Only plain decimal integers are accepted
 * (an empty value, signs, decimals and repeated parameters are rejected instead of being coerced to 0).
 */
export const syncEstadoQuerySchema = z.object({
  desde: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(MAX_DATABASE_INT))
    .optional(),
}).strict();

export type SyncEstadoQuerySchemaInput = z.infer<typeof syncEstadoQuerySchema>;
