import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeRfidLoginCode, createRfidLoginCode } from '../src/lib/rfidLoginCode.js';

test('RFID login codes are random, one-time, and expire after 30 seconds', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 10_000;
    const code = createRfidLoginCode('synthetic-jwt');
    assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(consumeRfidLoginCode(code), 'synthetic-jwt');
    assert.equal(consumeRfidLoginCode(code), null);

    const expiredCode = createRfidLoginCode('expired-synthetic-jwt');
    Date.now = () => 40_001;
    assert.equal(consumeRfidLoginCode(expiredCode), null);
  } finally {
    Date.now = originalNow;
  }
});
