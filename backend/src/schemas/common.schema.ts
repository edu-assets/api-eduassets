import { z } from 'zod';

export const MAX_DATABASE_INT = 2_147_483_647;
export const MAX_INVENTORY_UNITS = 1_000_000;

export const positiveDatabaseIdSchema = z.number().int().positive().max(MAX_DATABASE_INT, 'Identificador fora do limite.');
export const positiveInventoryCountSchema = z.number().int().positive().max(MAX_INVENTORY_UNITS, 'A quantidade excede o limite permitido.');
export const nonNegativeInventoryCountSchema = z.number().int().nonnegative().max(MAX_INVENTORY_UNITS, 'A quantidade excede o limite permitido.');
