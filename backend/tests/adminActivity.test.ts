import assert from 'node:assert/strict';
import test from 'node:test';
import { registrarAtividadeAdmin, sessaoAdminExpirada } from '../src/lib/adminActivity.js';

test('admin inactivity expires at 30 minutes and does not revive without cache state', () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const jti = 'test-jti-' + now;
    const issuedAt = Math.floor(now / 1000);
    assert.equal(sessaoAdminExpirada(jti, issuedAt), false);
    registrarAtividadeAdmin(jti);
    now += 30 * 60 * 1000 - 1;
    assert.equal(sessaoAdminExpirada(jti, issuedAt), false);
    now += 1;
    assert.equal(sessaoAdminExpirada(jti, issuedAt), true);
    // Rechecking the same JTI remains expired; the failed check cannot erase state.
    assert.equal(sessaoAdminExpirada(jti, issuedAt), true);
    // With process-local state lost, an old token fails closed using iat.
    assert.equal(sessaoAdminExpirada('lost-cache-jti', issuedAt), true);
  } finally {
    Date.now = originalNow;
  }
});

test('admin session without iat or cache state fails closed', () => {
  assert.equal(sessaoAdminExpirada('missing-iat-' + Math.random(), undefined), true);
});
