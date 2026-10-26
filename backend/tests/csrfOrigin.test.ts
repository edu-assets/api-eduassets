import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrustedOrigin, requireTrustedOriginForCookieMode } from '../src/middlewares/csrf.js';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'https://app.eduassets.tech';

test('trusts only configured application origins outside local development', () => {
  assert.equal(isTrustedOrigin('https://app.eduassets.tech'), true);
  assert.equal(isTrustedOrigin('https://attacker.example'), false);
  assert.equal(isTrustedOrigin(undefined), false);
  assert.equal(isTrustedOrigin('null'), false);
});

test('requires a trusted Origin for cookie-mode login and allows legacy callers', () => {
  let nextCalled = false;
  let responseStatus = 0;
  let responseBody: unknown;
  const res = {
    status(status: number) { responseStatus = status; return this; },
    json(body: unknown) { responseBody = body; return this; },
  } as any;
  const req = (mode: string | undefined, origin: string | undefined) => ({
    get(name: string) {
      if (name.toLowerCase() === 'x-auth-mode') return mode;
      if (name.toLowerCase() === 'origin') return origin;
      return undefined;
    },
  } as any);

  requireTrustedOriginForCookieMode(req('cookie', 'https://attacker.example'), res, () => { nextCalled = true; });
  assert.equal(responseStatus, 403);
  assert.deepEqual(responseBody, { erro: 'backend.auth.origem_nao_permitida' });
  assert.equal(nextCalled, false);

  requireTrustedOriginForCookieMode(req('cookie', 'https://app.eduassets.tech'), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  nextCalled = false;
  requireTrustedOriginForCookieMode(req(undefined, undefined), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
