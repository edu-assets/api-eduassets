import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSeedConfig } from '../prisma/seedConfig.js';

const validEnv = {
  SEED_ADMIN_EMAIL: 'Admin@Example.invalid',
  SEED_ADMIN_PASSWORD: 'Synthetic-Admin-Password-01',
};

test('seed requires an explicit valid administrator email and strong password', () => {
  assert.throws(() => readSeedConfig({}), /SEED_ADMIN_EMAIL/);
  assert.throws(() => readSeedConfig({ ...validEnv, SEED_ADMIN_EMAIL: 'not-an-email' }), /SEED_ADMIN_EMAIL/);
  assert.throws(() => readSeedConfig({ ...validEnv, SEED_ADMIN_PASSWORD: 'short' }), /SEED_ADMIN_PASSWORD/);
  assert.throws(() => readSeedConfig({ ...validEnv, SEED_ADMIN_PASSWORD: 'ü'.repeat(37) }), /72 UTF-8 bytes/);
});

test('seed normalizes admin email and leaves optional editor unset', () => {
  assert.deepEqual(readSeedConfig(validEnv), {
    adminEmail: 'admin@example.invalid',
    adminPassword: validEnv.SEED_ADMIN_PASSWORD,
  });
});

test('optional editor email and password must be supplied as a valid pair', () => {
  assert.throws(() => readSeedConfig({ ...validEnv, SEED_EDITOR_PASSWORD: 'Synthetic-Editor-Password-01' }), /both be set/);
  assert.throws(() => readSeedConfig({ ...validEnv, SEED_EDITOR_EMAIL: 'editor@example.invalid' }), /both be set/);
  assert.deepEqual(readSeedConfig({
    ...validEnv,
    SEED_EDITOR_EMAIL: 'Editor@Example.invalid',
    SEED_EDITOR_PASSWORD: 'Synthetic-Editor-Password-01',
  }), {
    adminEmail: 'admin@example.invalid',
    adminPassword: validEnv.SEED_ADMIN_PASSWORD,
    editorEmail: 'editor@example.invalid',
    editorPassword: 'Synthetic-Editor-Password-01',
  });
});

test('administrator and editor seed identities must be distinct after email normalization', () => {
  assert.throws(() => readSeedConfig({
    ...validEnv,
    SEED_EDITOR_EMAIL: ' ADMIN@example.invalid ',
    SEED_EDITOR_PASSWORD: 'Synthetic-Editor-Password-01',
  }), /different accounts/);
});
