import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { criarCacheUsuarioSessao, TTL_CACHE_USUARIO_MS, type UsuarioSessao } from '../src/lib/sessionUserCache.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-session-cache-test-secret-0123456789';

const realNow = Date.now;
let offsetMs = 0;
const avancar = (ms: number) => { offsetMs += ms; };

const admin = (extra: Partial<UsuarioSessao> = {}): UsuarioSessao =>
  ({ id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 0, ativo: true, ...extra });

beforeEach(() => {
  offsetMs = 0;
  const congelado = realNow(); // frozen clock: TTL boundaries are checked to the millisecond
  Date.now = () => congelado + offsetMs;
});
afterEach(() => { Date.now = realNow; });

describe('criarCacheUsuarioSessao', () => {
  it('the TTL is longer than the ~5 min Neon suspend window, otherwise the cache would still wake the database', () => {
    assert.ok(TTL_CACHE_USUARIO_MS > 5 * 60 * 1000);
  });

  it('serves repeated reads from memory until the TTL expires', async () => {
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao(async () => { chamadas += 1; return admin(); }, 1000);
    await cache.obter(1);
    await cache.obter(1);
    assert.equal(chamadas, 1);
    avancar(999);
    await cache.obter(1);
    assert.equal(chamadas, 1);
    avancar(1);
    await cache.obter(1);
    assert.equal(chamadas, 2);
  });

  it('fresco always reads the database and refreshes the entry', async () => {
    let atual = admin();
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao(async () => { chamadas += 1; return atual; });
    await cache.obter(1);
    atual = admin({ ativo: false });
    assert.equal((await cache.obter(1, { fresco: true }))?.ativo, false);
    assert.equal((await cache.obter(1))?.ativo, false, 'the fresh read replaced the cached entry');
    assert.equal(chamadas, 2);
  });

  it('invalidar makes the next read hit the database (revocation is immediate)', async () => {
    let atual = admin();
    const cache = criarCacheUsuarioSessao(async () => atual);
    await cache.obter(1);
    atual = admin({ sessionVersion: 1 });
    assert.equal((await cache.obter(1))?.sessionVersion, 0, 'without invalidation the TTL applies');
    cache.invalidar(1);
    assert.equal((await cache.obter(1))?.sessionVersion, 1);
  });

  it('a read that started before an invalidation does not store the stale value', async () => {
    let liberar!: (u: UsuarioSessao) => void;
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao((id) => {
      chamadas += 1;
      if (chamadas === 1) return new Promise((resolve) => { liberar = resolve; });
      return Promise.resolve(admin({ id, ativo: false }));
    });
    const leituraAntiga = cache.obter(1);
    cache.invalidar(1); // e.g. the user is deactivated while the read is in flight
    liberar(admin()); // the in-flight read resolves with the pre-revocation row
    assert.equal((await leituraAntiga)?.ativo, true);
    assert.equal((await cache.obter(1))?.ativo, false, 'the next read must go to the database');
    assert.equal(chamadas, 2);
  });

  it('limpar also discards reads that were in flight', async () => {
    let liberar!: (u: UsuarioSessao) => void;
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao(() => {
      chamadas += 1;
      return chamadas === 1 ? new Promise((resolve) => { liberar = resolve; }) : Promise.resolve(admin());
    });
    const leitura = cache.obter(1);
    cache.limpar();
    liberar(admin());
    await leitura;
    assert.equal(cache.tamanho(), 0);
  });

  it('caches unknown users too, so a token for a deleted account cannot force one query per request', async () => {
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao(async () => { chamadas += 1; return null; });
    assert.equal(await cache.obter(99), null);
    assert.equal(await cache.obter(99), null);
    assert.equal(chamadas, 1);
  });

  it('expired entries are never served and are refreshed on the next read', async () => {
    let chamadas = 0;
    const cache = criarCacheUsuarioSessao(async (id) => { chamadas += 1; return admin({ id }); }, 1000);
    await cache.obter(1);
    avancar(1000);
    await cache.obter(1);
    assert.equal(chamadas, 2);
    assert.equal(cache.tamanho(), 1);
  });
});

describe('requireAuth with the session user cache', () => {
  type Modules = {
    prisma: typeof import('../src/lib/prisma.js')['prisma'];
    signToken: typeof import('../src/lib/jwt.js')['signToken'];
    requireAuth: typeof import('../src/middlewares/auth.js')['requireAuth'];
    cache: typeof import('../src/lib/sessionUserCache.js');
  };
  let m: Modules;
  let server: Server;
  let baseUrl: string;
  let usuario: UsuarioSessao | null;
  let consultas: number;
  let original: unknown;

  before(async () => {
    const [{ prisma }, { signToken }, auth, cache] = await Promise.all([
      import('../src/lib/prisma.js'),
      import('../src/lib/jwt.js'),
      import('../src/middlewares/auth.js'),
      import('../src/lib/sessionUserCache.js'),
    ]);
    m = { prisma, signToken, requireAuth: auth.requireAuth, cache };
    const app = express();
    app.get('/leitura', m.requireAuth, (_req, res) => { res.json({ ok: true }); });
    app.post('/escrita', m.requireAuth, (_req, res) => { res.json({ ok: true }); });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  beforeEach(() => {
    usuario = admin({ nivelAcesso: 'EDITOR' });
    consultas = 0;
    m.cache.limparCacheUsuariosSessao();
    original = (m.prisma as unknown as Record<string, unknown>).usuario;
    Object.defineProperty(m.prisma, 'usuario', {
      value: { findUnique: async () => { consultas += 1; return usuario; } },
      configurable: true, writable: true, enumerable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(m.prisma, 'usuario', { value: original, configurable: true, writable: true, enumerable: true });
  });

  const token = () => m.signToken({ sub: 1, nivelAcesso: 'EDITOR' });
  const pedir = (metodo: 'GET' | 'POST', caminho: string, t: string) =>
    fetch(`${baseUrl}${caminho}`, { method: metodo, headers: { authorization: `Bearer ${t}` } });

  it('repeated authenticated reads query the user only once', async () => {
    const t = token();
    for (let i = 0; i < 5; i += 1) assert.equal((await pedir('GET', '/leitura', t)).status, 200);
    assert.equal(consultas, 1);
  });

  it('writes always re-check the database, so a deactivated user cannot write from a stale entry', async () => {
    const t = token();
    assert.equal((await pedir('GET', '/leitura', t)).status, 200);
    usuario = admin({ nivelAcesso: 'EDITOR', ativo: false }); // changed outside the API, no invalidation
    assert.equal((await pedir('POST', '/escrita', t)).status, 401);
    assert.equal((await pedir('GET', '/leitura', t)).status, 401, 'the fresh read also refreshed the cache');
  });

  it('after invalidation a revoked session is rejected on the next read', async () => {
    const t = token();
    assert.equal((await pedir('GET', '/leitura', t)).status, 200);
    usuario = admin({ nivelAcesso: 'EDITOR', sessionVersion: 1 });
    m.cache.invalidarUsuarioSessao(1);
    assert.equal((await pedir('GET', '/leitura', t)).status, 401);
  });
});
