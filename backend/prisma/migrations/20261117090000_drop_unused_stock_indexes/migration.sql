-- Drop two indexes that no query uses (idx_scan = 0 in production; the only stock filter,
-- estoque.service.ts, looks rows up by primary key). Both columns change on every loan, return and
-- occurrence, so these indexes only added write work and prevented cheaper HOT updates.
-- The CHECK constraint "Equipamento_stock_quantities_check" is unaffected.
DROP INDEX IF EXISTS "Equipamento_quantidadeDisponivel_idx";
DROP INDEX IF EXISTS "Equipamento_quantidadeQuebrada_idx";
