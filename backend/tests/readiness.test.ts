import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReadiness } from '../src/lib/readiness.js';

test('readiness reports available dependencies without exposing query details', async () => {
  assert.equal(await checkReadiness(async () => 1), true);
});

test('readiness reports unavailable dependency failures and times out boundedly', async () => {
  assert.equal(await checkReadiness(async () => { throw new Error('private database detail'); }), false);
  const started = Date.now();
  assert.equal(await checkReadiness(() => new Promise(() => {}), 15), false);
  assert.ok(Date.now() - started < 250);
});
