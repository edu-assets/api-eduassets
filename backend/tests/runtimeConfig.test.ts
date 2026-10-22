import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeConfig, parsePort, parseTrustProxy } from '../src/config/runtimeConfig.js';

test('port parsing validates each candidate and PORT has precedence', () => {
  assert.equal(parsePort('4100', 'PORT'), 4100);
  assert.throws(() => parsePort('invalid', 'PORT'), /porta inteira/);
  assert.throws(() => parsePort('65536', 'PORT'), /porta inteira/);
  assert.equal(getRuntimeConfig({ NODE_ENV: 'development', PORT: '4100', BACKEND_PORT: '4200', DATABASE_URL: 'postgresql://synthetic/test' }).port, 4100);
  assert.equal(getRuntimeConfig({ NODE_ENV: 'development', BACKEND_PORT: '4200', DATABASE_URL: 'postgresql://synthetic/test' }).port, 4200);
});

test('trust proxy rejects unsafe boolean and invalid values', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy('0'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.deepEqual(parseTrustProxy('127.0.0.1,::1'), ['127.0.0.1', '::1']);
  assert.throws(() => parseTrustProxy('true'), /não é permitido/);
  assert.throws(() => parseTrustProxy('999'), /entre 0 e 10/);
  assert.throws(() => parseTrustProxy('garbage'), /IP\/CIDR válida/);
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'development' }), /DATABASE_URL é obrigatório/);
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'development', DATABASE_URL: 'mysql://host/db' }), /DATABASE_URL deve ser uma URL PostgreSQL/);
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://db.example/test', CORS_ORIGIN: 'https://app.example/path' }), /CORS_ORIGIN deve conter origens/);
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'development', PORT: '3000', BACKEND_PORT: 'invalid', DATABASE_URL: 'postgresql://db.example/test' }), /BACKEND_PORT deve ser uma porta/);
});

test('production config requires explicit security and DB configuration', () => {
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://synthetic:pass@127.0.0.1/test' }), /JWT_SECRET/);
  assert.throws(() => getRuntimeConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), DATABASE_URL: 'postgresql://synthetic:pass@127.0.0.1/test', CORS_ORIGIN: 'https://example.test' }), /TRUST_PROXY/);
  const config = getRuntimeConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), DATABASE_URL: 'postgresql://synthetic:pass@127.0.0.1/test', CORS_ORIGIN: 'https://example.test', TRUST_PROXY: '0' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3000);
});
