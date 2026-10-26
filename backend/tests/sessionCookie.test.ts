import assert from 'node:assert/strict';
import test from 'node:test';

function responseDouble(): { response: any; cookies: string[]; headers: Map<string, unknown> } {
  const cookies: string[] = [];
  const headers = new Map<string, unknown>();
  return {
    cookies,
    headers,
    response: {
      append: (name: string, value: string) => {
        if (name.toLowerCase() === 'set-cookie') cookies.push(value);
      },
      setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    },
  };
}

test('sets a host-only HttpOnly Secure Lax cookie expiring with the JWT', async () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'cookie-session-test-secret-at-least-32-characters';
  const { signToken } = await import('../src/lib/jwt.js');
  const { setSessionCookie } = await import('../src/lib/sessionCookie.js');
  const token = signToken({ sub: 5, nivelAcesso: 'EDITOR' });
  const { response, cookies, headers } = responseDouble();
  const request = { secure: true, headers: {} } as any;

  setSessionCookie(request, response, token);

  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^__Host-eduassets_session=/);
  assert.match(cookies[0], /; HttpOnly(?:;|$)/);
  assert.match(cookies[0], /; Secure(?:;|$)/);
  assert.match(cookies[0], /; SameSite=Lax(?:;|$)/);
  assert.match(cookies[0], /; Path=\/(?:;|$)/);
  assert.match(cookies[0], /; Max-Age=\d+/);
  assert.doesNotMatch(cookies[0], /; Domain=/i);
  assert.equal(headers.get('cache-control'), 'no-store');
});

test('reads only the expected host-only session cookie', async () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'cookie-session-test-secret-at-least-32-characters';
  const { signToken } = await import('../src/lib/jwt.js');
  const { getSessionCookieToken } = await import('../src/lib/sessionCookie.js');
  const token = signToken({ sub: 7, nivelAcesso: 'ADMINISTRADOR' });
  const request = {
    secure: true,
    headers: { cookie: `other=value; __Host-eduassets_session=${encodeURIComponent(token)}` },
  } as any;
  assert.equal(getSessionCookieToken(request), token);
  assert.equal(getSessionCookieToken({ headers: { cookie: 'eduassets_session=legacy' } } as any), null);
});

test('clears the cookie with matching security attributes', async () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'cookie-session-test-secret-at-least-32-characters';
  const { clearSessionCookie } = await import('../src/lib/sessionCookie.js');
  const { response, cookies } = responseDouble();
  clearSessionCookie({ secure: true, headers: {} } as any, response);
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^__Host-eduassets_session=;/);
  assert.match(cookies[0], /; Max-Age=0/);
  assert.match(cookies[0], /; HttpOnly/);
  assert.match(cookies[0], /; Secure/);
  assert.match(cookies[0], /; SameSite=Lax/);
  assert.match(cookies[0], /; Path=\//);
  assert.doesNotMatch(cookies[0], /; Domain=/i);
});
