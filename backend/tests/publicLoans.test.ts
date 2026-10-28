import assert from 'node:assert/strict';
import test from 'node:test';
import { emprestimoListQuerySchema } from '../src/schemas/emprestimo.schema.js';
import { agruparQuantidades } from '../src/services/estoque.service.js';

test('anonymous loan page query has a bounded default and rejects invalid limits or cursors', () => {
  assert.deepEqual(emprestimoListQuerySchema.parse({}), { limit: 50 });
  assert.deepEqual(emprestimoListQuerySchema.parse({ limit: '100', cursor: '42' }), { limit: 100, cursor: 42 });
  assert.equal(emprestimoListQuerySchema.safeParse({ limit: '101' }).success, false);
  assert.equal(emprestimoListQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(emprestimoListQuerySchema.safeParse({ cursor: '-1' }).success, false);
  assert.equal(emprestimoListQuerySchema.safeParse({ pageSize: '1000000' }).success, false);
});

test('equipment aggregation sums duplicates and locks IDs in ascending order', () => {
  const quantities = agruparQuantidades([
    { equipamentoId: 9, quantidade: 1 },
    { equipamentoId: 3, quantidade: 2 },
    { equipamentoId: 9, quantidade: 4 },
  ]);
  assert.deepEqual([...quantities.entries()], [[3, 2], [9, 5]]);
});
