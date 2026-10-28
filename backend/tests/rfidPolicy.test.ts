import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors/AppError.js';
import { assertRfidAllowedForAccount, isRfidSocketRequestAllowed } from '../src/lib/rfidPolicy.js';

test('RFID policy permits editor accounts', () => {
  assert.doesNotThrow(() => assertRfidAllowedForAccount('EDITOR'));
});

test('RFID policy requires password-based login for administrators', () => {
  assert.throws(
    () => assertRfidAllowedForAccount('ADMINISTRADOR'),
    (error: unknown) => error instanceof AppError && error.status === 403 && error.chaveI18n === 'backend.usuarios.rfid_admin_password_only'
  );
});

test('RFID WebSocket requires the expected path, cookie mode, and a trusted Origin', () => {
  assert.equal(isRfidSocketRequestAllowed('/ws/rfid', 'cookie', true), true);
  assert.equal(isRfidSocketRequestAllowed('/other', 'cookie', true), false);
  assert.equal(isRfidSocketRequestAllowed('/ws/rfid', 'token', true), false);
  assert.equal(isRfidSocketRequestAllowed('/ws/rfid', 'cookie', false), false);
  assert.equal(isRfidSocketRequestAllowed('/ws/rfid', null, false), false);
});
