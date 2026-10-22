import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { classifyDatabaseError } from '../src/middlewares/errorHandler.js';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('synthetic database error', {
    code,
    clientVersion: '6.19.3',
  });
}

test('classifies Prisma connection failures as database unavailable', () => {
  assert.equal(classifyDatabaseError(knownError('P1001')), 'unavailable');
  assert.equal(classifyDatabaseError(knownError('P2024')), 'unavailable');
  assert.equal(
    classifyDatabaseError(new Prisma.PrismaClientInitializationError('synthetic initialization error', '6.19.3')),
    'unavailable',
  );
});

test('classifies missing Prisma tables or columns as an uninitialized schema', () => {
  assert.equal(classifyDatabaseError(knownError('P2021')), 'schema');
  assert.equal(classifyDatabaseError(knownError('P2022')), 'schema');
});

test('does not classify ordinary Prisma business errors as database availability failures', () => {
  assert.equal(classifyDatabaseError(knownError('P2002')), null);
  assert.equal(classifyDatabaseError(new Error('ordinary application error')), null);
});
