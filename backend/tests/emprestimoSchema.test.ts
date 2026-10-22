import assert from 'node:assert/strict';
import test from 'node:test';
import { emprestimoReturnSchema } from '../src/schemas/emprestimo.schema.js';

test('return date accepts an offset-aware timestamp and omits it for legacy clients', () => {
  assert.equal(emprestimoReturnSchema.parse({ dataDevolucao: '2026-10-22T14:00:00.000Z' }).dataDevolucao, '2026-10-22T14:00:00.000Z');
  assert.deepEqual(emprestimoReturnSchema.parse({}), {});
  assert.equal(emprestimoReturnSchema.safeParse({ dataDevolucao: '22/10/2026 14:00' }).success, false);
});
