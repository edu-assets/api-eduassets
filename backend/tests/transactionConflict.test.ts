import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { AppError } from '../src/errors/AppError.js';
import { normalizeTransactionError } from '../src/lib/prisma.js';

test('maps Prisma P2034 serialization conflicts to the explicit 409 application error', () => {
  const conflict = new Prisma.PrismaClientKnownRequestError('transaction conflict', {
    code: 'P2034',
    clientVersion: '6.19.3',
  });
  const mapped = normalizeTransactionError(conflict);
  assert.ok(mapped instanceof AppError);
  assert.equal(mapped.status, 409);
  assert.equal(mapped.chaveI18n, 'backend.emprestimos.conflito_concorrencia');
});

test('preserves unrelated transaction errors unchanged', () => {
  const original = new Error('database connection failure');
  assert.equal(normalizeTransactionError(original), original);
});
