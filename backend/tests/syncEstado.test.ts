import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { ATRASO_CURSOR_MS, ENTIDADES_SINCRONIZADAS, LIMITE_VARREDURA } from '../src/services/sync.service.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-sync-test-secret-0123456789abcdef';

type Modules = {
  prisma: typeof import('../src/lib/prisma.js')['prisma'];
  signToken: typeof import('../src/lib/jwt.js')['signToken'];
  requireAuth: typeof import('../src/middlewares/auth.js')['requireAuth'];
  marcarPassivo: typeof import('../src/middlewares/auth.js')['marcarPassivo'];
  syncRouter: typeof import('../src/routes/sync.js')['syncRouter'];
};
let m: Modules;
let server: Server;
let baseUrl: string;

const realNow = Date.now;
let offsetMs = 0;
let usuario: { id: number; nivelAcesso: 'ADMINISTRADOR' | 'EDITOR'; sessionVersion: number; ativo: boolean } | null;
let ultimoMax: number | null;
let gruposDoBanco: Array<Record<string, unknown>>;
let ultimoAntigo: number | null;
let findFirstCalls: unknown[];
let aggregateCalls: unknown[];
let groupByCalls: unknown[];
const restauracoes: Array<() => void> = [];

/** Prisma delegates are lazy proxies that node:test cannot spy on, so the whole delegate is swapped and restored. */
function substituir(alvo: object, chave: string, valor: unknown): void {
  const original = (alvo as Record<string, unknown>)[chave];
  Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  restauracoes.push(() => { Object.defineProperty(alvo, chave, { value: original, configurable: true, writable: true, enumerable: true }); });
}

before(async () => {
  const [{ prisma }, { signToken }, auth, { syncRouter }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/lib/jwt.js'),
    import('../src/middlewares/auth.js'),
    import('../src/routes/sync.js'),
  ]);
  m = { prisma, signToken, requireAuth: auth.requireAuth, marcarPassivo: auth.marcarPassivo, syncRouter };

  const app = express();
  app.get('/ativa', m.requireAuth, (_req, res) => { res.json({ ok: true }); });
  app.get('/marcada', m.marcarPassivo, m.requireAuth, (_req, res) => { res.json({ ok: true }); });
  app.use('/sync', m.syncRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  offsetMs = 0;
  usuario = { id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 0, ativo: true };
  ultimoMax = 1842;
  ultimoAntigo = 1840;
  findFirstCalls = [];
  gruposDoBanco = [];
  aggregateCalls = [];
  groupByCalls = [];
  Date.now = () => realNow() + offsetMs;
  substituir(m.prisma, 'usuario', { findUnique: async () => usuario });
  substituir(m.prisma, 'auditLog', {
    findFirst: async (args: unknown) => {
      findFirstCalls.push(args);
      return ultimoAntigo === null ? null : { id: ultimoAntigo };
    },
    aggregate: async (args: unknown) => {
      aggregateCalls.push(args);
      return { _max: { id: ultimoMax } };
    },
    groupBy: async (args: unknown) => {
      groupByCalls.push(args);
      return gruposDoBanco;
    },
  });
});

afterEach(() => {
  Date.now = realNow;
  while (restauracoes.length) restauracoes.pop()!();
});

function get(path: string, token: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
}
const avancarMinutos = (minutos: number) => { offsetMs += minutos * 60_000; };
const novoToken = (nivel: 'ADMINISTRADOR' | 'EDITOR' = 'ADMINISTRADOR') => m.signToken({ sub: 1, nivelAcesso: nivel });

describe('passive requests (X-EduAssets-Atividade)', () => {
  it('passive header does not renew the admin idle timer, so the session still expires 30 min after the last real activity', async () => {
    const token = novoToken();
    avancarMinutos(29);
    assert.equal((await get('/ativa', token, { 'X-EduAssets-Atividade': 'passiva' })).status, 200);
    avancarMinutos(2); // 31 min since login; the passive call at minute 29 must not have extended the session
    const expirada = await get('/ativa', token, { 'X-EduAssets-Atividade': 'passiva' });
    assert.equal(expirada.status, 401);
    assert.deepEqual(await expirada.json(), { erro: 'backend.auth.sessao_expirada', sessaoExpirada: true });
  });

  it('the header value is case-insensitive and tolerates surrounding spaces', async () => {
    const token = novoToken();
    avancarMinutos(29);
    assert.equal((await get('/ativa', token, { 'x-eduassets-atividade': ' PaSsIvA ' })).status, 200);
    avancarMinutos(2);
    assert.equal((await get('/ativa', token, { 'x-eduassets-atividade': 'passiva' })).status, 401);
  });

  it('without the header (or with another value) activity is still registered and extends the session', async () => {
    const token = novoToken();
    avancarMinutos(29);
    assert.equal((await get('/ativa', token)).status, 200);
    avancarMinutos(29); // 58 min after login, 29 after the registered activity
    assert.equal((await get('/ativa', token, { 'X-EduAssets-Atividade': 'ativa' })).status, 200);
    avancarMinutos(29);
    assert.equal((await get('/ativa', token)).status, 200);
  });

  it('marcarPassivo makes a route passive even without the header', async () => {
    const token = novoToken();
    avancarMinutos(29);
    assert.equal((await get('/marcada', token)).status, 200);
    avancarMinutos(2);
    assert.equal((await get('/marcada', token)).status, 401);
  });

  it('an already expired admin session is rejected with sessaoExpirada even when the request is passive', async () => {
    const token = novoToken();
    avancarMinutos(31);
    const res = await get('/ativa', token, { 'X-EduAssets-Atividade': 'passiva' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).sessaoExpirada, true);
  });

  it('passive requests keep the user, active and sessionVersion checks', async () => {
    const token = novoToken();
    const headers = { 'X-EduAssets-Atividade': 'passiva' };
    usuario = null;
    assert.equal((await get('/ativa', token, headers)).status, 401);
    usuario = { id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 0, ativo: false };
    assert.equal((await get('/ativa', token, headers)).status, 401);
    usuario = { id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 1, ativo: true };
    assert.equal((await get('/ativa', token, headers)).status, 401);
    const semToken = await fetch(`${baseUrl}/ativa`, { headers });
    assert.equal(semToken.status, 401);
  });
});

describe('GET /sync/estado', () => {
  it('without desde returns an empty entity list, a string cursor and only the documented fields', async () => {
    const res = await get('/sync/estado', novoToken('EDITOR'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['cursor', 'entidades', 'serverTime']);
    assert.equal(body.cursor, '1840');
    assert.deepEqual(body.entidades, []);
    assert.ok(Math.abs(Date.parse(body.serverTime) - Date.now()) < 5000);
    assert.equal(new Date(body.serverTime).toISOString(), body.serverTime);
    assert.equal(groupByCalls.length, 0);
    assert.equal(aggregateCalls.length, 0);
  });

  it('returns "0" when the audit log is empty', async () => {
    ultimoMax = null;
    ultimoAntigo = null;
    const body = await (await get('/sync/estado?desde=0', novoToken())).json();
    assert.equal(body.cursor, '0');
    assert.deepEqual(body.entidades, []);
    assert.equal(groupByCalls.length, 0);
  });

  it('with desde returns the distinct entities changed after it, bounded by the cursor, and never leaks audit fields', async () => {
    gruposDoBanco = [
      { entity: 'Equipamento', actorId: 9, entityId: '55', changedFields: ['quantidadeDisponivel'] },
      { entity: 'Emprestimo', actorId: 9, entityId: '7', changedFields: ['itens'] },
    ];
    const res = await get('/sync/estado?desde=1800', novoToken('EDITOR'));
    assert.equal(res.status, 200);
    const texto = await res.text();
    const body = JSON.parse(texto);
    assert.deepEqual(Object.keys(body).sort(), ['cursor', 'entidades', 'serverTime']);
    assert.deepEqual(body.entidades, ['Emprestimo', 'Equipamento']);
    assert.equal(body.cursor, '1840');
    for (const proibido of ['actorId', 'entityId', 'changedFields', 'quantidadeDisponivel']) {
      assert.ok(!texto.includes(proibido), `response leaked ${proibido}`);
    }
    assert.deepEqual(groupByCalls, [{ by: ['entity'], where: { id: { gt: 1800 }, entity: { in: [...ENTIDADES_SINCRONIZADAS] } } }]);
  });

  it('skips the entity scan when nothing is newer than desde', async () => {
    const body = await (await get('/sync/estado?desde=1842', novoToken())).json();
    assert.deepEqual(body.entidades, []);
    assert.equal(body.cursor, '1840');
    assert.equal(groupByCalls.length, 0);
  });

  it('rejects an invalid desde with the standard 400 validation error', async () => {
    for (const desde of ['-1', 'abc', '', '1.5', '1e3', '+5', '99999999999', '1&desde=2']) {
      const res = await get(`/sync/estado?desde=${desde}`, novoToken());
      assert.equal(res.status, 400, `desde=${desde}`);
      const body = await res.json();
      assert.equal(body.erro, 'backend.validacao.dados_invalidos');
      assert.ok(Array.isArray(body.detalhes));
    }
    assert.equal(groupByCalls.length, 0);
  });

  it('is always passive: it never renews the admin idle timer, with or without the header', async () => {
    const token = novoToken();
    avancarMinutos(29);
    assert.equal((await get('/sync/estado', token)).status, 200);
    avancarMinutos(2);
    const res = await get('/sync/estado', token);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).sessaoExpirada, true);
  });

  it('requires authentication', async () => {
    assert.equal((await fetch(`${baseUrl}/sync/estado`)).status, 401);
  });
});

describe('GET /sync/estado change feed', () => {
  it('computes the lagged cursor from rows at least ATRASO_CURSOR_MS old', async () => {
    const antes = Date.now();
    await get('/sync/estado', novoToken());
    const depois = Date.now();
    assert.equal(findFirstCalls.length, 1);
    const chamada = findFirstCalls[0] as { where: { createdAt: { lte: Date } }; orderBy: unknown; select: unknown };
    assert.deepEqual(chamada.orderBy, { id: 'desc' });
    assert.deepEqual(chamada.select, { id: true });
    const lte = chamada.where.createdAt.lte.getTime();
    assert.ok(lte >= antes - ATRASO_CURSOR_MS && lte <= depois - ATRASO_CURSOR_MS);
  });

  it('returns cursor "0" when no row is old enough', async () => {
    ultimoAntigo = null;
    const body = await (await get('/sync/estado?desde=1800', novoToken())).json();
    assert.equal(body.cursor, '0');
  });

  it('never asks for or returns Usuario', async () => {
    gruposDoBanco = [{ entity: 'Equipamento' }];
    const body = await (await get('/sync/estado?desde=1800', novoToken())).json();
    assert.ok(!(ENTIDADES_SINCRONIZADAS as readonly string[]).includes('Usuario'));
    const where = (groupByCalls[0] as { where: { entity: { in: string[] } } }).where;
    assert.deepEqual(where.entity.in, ['Categoria', 'Emprestimo', 'Equipamento', 'Ocorrencia', 'Responsavel']);
    assert.deepEqual(body.entidades, ['Equipamento']);
  });

  it('reports every synchronized entity without scanning when the client is far behind', async () => {
    ultimoMax = 5000;
    const body = await (await get(`/sync/estado?desde=${5000 - LIMITE_VARREDURA - 1}`, novoToken())).json();
    assert.deepEqual(body.entidades, ['Categoria', 'Emprestimo', 'Equipamento', 'Ocorrencia', 'Responsavel']);
    assert.equal(groupByCalls.length, 0);
    await get(`/sync/estado?desde=${5000 - LIMITE_VARREDURA}`, novoToken());
    assert.equal(groupByCalls.length, 1, 'exactly LIMITE_VARREDURA behind is still scanned');
  });

  it('returns an empty list without scanning when desde is at or beyond the newest id', async () => {
    const body = await (await get('/sync/estado?desde=1900', novoToken())).json();
    assert.deepEqual(body.entidades, []);
    assert.equal(groupByCalls.length, 0);
  });

  it('rejects unknown query parameters with 400', async () => {
    const res = await get('/sync/estado?desde=1&outro=2', novoToken());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).erro, 'backend.validacao.dados_invalidos');
  });
});
