import assert from 'node:assert/strict';
import test from 'node:test';
import { redactLogRecord, sanitizeUrlForLog } from '../src/lib/logRedaction.js';

test('redacts nested credentials and personal identifiers in structured logs', () => {
  const record = redactLogRecord({
    message: 'Request to /auth?token=header-secret by person@example.invalid',
    authorization: 'Bearer header-secret',
    user: { login: 'person@example.invalid', email: 'person@example.invalid', password: 'private-password', name: 'Synthetic User' },
    error: new Error('Failure for /auth?password=private-password'),
  });
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /header-secret|person@example\.invalid|private-password/);
  assert.match(serialized, /Synthetic User/);
  assert.match(serialized, /REDACTED/);
});

test('removes one-time codes and PII from logged URL queries but keeps harmless filters', () => {
  const safe = sanitizeUrlForLog('/auth/rfid/session?code=one-time-secret&email=person%40example.invalid&limit=10');
  assert.doesNotMatch(safe, /one-time-secret|person|example\.invalid/);
  assert.match(safe, /limit=10/);
});
