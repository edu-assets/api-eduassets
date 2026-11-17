import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { ENTIDADES_SINCRONIZADAS } from '../src/services/sync.service.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-sync-test-secret-0123456789abcdef';

type Modules = {
  prisma: typeof import('../src/lib/prisma.js')['prisma'];
  signToken: typeof import('../src/lib/jwt.js')['signToken'];
  requireAuth: typeof import('../src/middlewares/auth.js')['requireAuth'];
  marcarPassivo: typeof import('../src/middlewares/auth.js')['marcarPassivo'];
  syncRouter: typeof import('../src/routes/sync.js')['syncRouter'];
  cacheUsuarios: typeof import('../src/lib/sessionUserCache.js');
  feed: typeof import('../src/lib/changeFeed.js');
  writeAuditLog: typeof import('../src/lib/auditLog.js')['writeAuditLog'];
};
let m: Modules;
let server: Server;
let baseUrl: string;

const realNow = Date.now;
let offsetMs = 0;
let usuario: { id: number; nivelAcesso: 'ADMINISTRADOR' | 'EDITOR'; sessionVersion: number; ativo: boolean } | null;
let consultasUsuario: number;
let consultasAuditLog: number;
/** Cursor values observed inside the mutation handler, before the response was sent. */
let cursorDuranteMutacao: string | undefined;
let escritaTardiaConcluida: (() => void) | undefined;
const restauracoes: Array<() => void> = [];

/** Prisma delegates are lazy proxies that node:test cannot spy on, so the whole delegate is swapped and restored. */
function substituir(alvo: object, chave: string, valor: unknown): void {
  const original = (alvo as Record<string, unknown>)[chave];
  Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  restauracoes.push(() => { Object.defineProperty(alvo, chave, { value: original, configurable: true, writable: true, enumerable: true }); });
}

/** Stand-in for a Prisma transaction client: only auditLog.create is used by writeAuditLog. */
const txFalso = { auditLog: { create: async () => ({}) } } as unknown as Parameters<Modules['writeAuditLog']>[0];

before(async () => {
  const [{ prisma }, { signToken }, auth, { syncRouter }, cacheUsuarios, feed, { writeAuditLog }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/lib/jwt.js'),
    import('../src/middlewares/auth.js'),
    import('../src/routes/sync.js'),
    import('../src/lib/sessionUserCache.js'),
    import('../src/lib/changeFeed.js'),
    import('../src/lib/auditLog.js'),
  ]);
  m = { prisma, signToken, requireAuth: auth.requireAuth, marcarPassivo: auth.marcarPassivo, syncRouter, cacheUsuarios, feed, writeAuditLog };

  // Same middleware order as app.ts: body parser, then the change collector.
  const app = express();
  app.use(express.json());
  app.use(m.feed.coletarMudancasDaRequisicao);
  app.get('/ativa', m.requireAuth, (_req, res) => { res.json({ ok: true }); });
  app.get('/marcada', m.marcarPassivo, m.requireAuth, (_req, res) => { res.json({ ok: true }); });
  // Simulates a service: writes audit rows (inside its "transaction"), then optionally fails.
  app.post('/mutacao', async (req, res) => {
    const { entidades, falhar } = req.body as { entidades: string[]; falhar?: boolean };
    await new Promise((resolve) => setTimeout(resolve, 5)); // async gap, like a real database round trip
    for (const entidade of entidades) await m.writeAuditLog(txFalso, 1, 'UPDATE', entidade, 1, ['x']);
    cursorDuranteMutacao = m.feed.obterEstadoFeed().cursor;
    if (falhar) { res.status(500).json({ erro: 'rollback' }); return; }
    res.json({ ok: true });
  });
  // Responds first, then writes (202 pattern): there is no later commit signal for this request.
  app.post('/mutacao-depois-da-resposta', async (req, res) => {
    res.status(202).end();
    await new Promise((resolve) => res.once('finish', resolve));
    for (const entidade of (req.body as { entidades: string[] }).entidades) await m.writeAuditLog(txFalso, 1, 'UPDATE', entidade, 1, ['x']);
    escritaTardiaConcluida?.();
  });
  // The client disconnects while the "transaction" is still running.
  app.post('/mutacao-lenta', async (req, res) => {
    await new Promise((resolve) => req.socket.once('close', resolve));
    for (const entidade of (req.body as { entidades: string[] }).entidades) await m.writeAuditLog(txFalso, 1, 'UPDATE', entidade, 1, ['x']);
    escritaTardiaConcluida?.();
    if (!res.writableEnded) res.end();
  });
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
  consultasUsuario = 0;
  consultasAuditLog = 0;
  cursorDuranteMutacao = undefined;
  Date.now = () => realNow() + offsetMs;
  m.cacheUsuarios.limparCacheUsuariosSessao();
  substituir(m.prisma, 'usuario', { findUnique: async () => { consultasUsuario += 1; return usuario; } });
  const contarAuditLog = async () => { consultasAuditLog += 1; return null; };
  substituir(m.prisma, 'auditLog', { findFirst: contarAuditLog, aggregate: contarAuditLog, groupBy: contarAuditLog });
});

afterEach(() => {
  Date.now = realNow;
  while (restauracoes.length) restauracoes.pop()!();
});

function get(path: string, token: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}`, ...headers } });
}
function mutar(entidades: string[], falhar = false) {
  return fetch(`${baseUrl}/mutacao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entidades, falhar }),
  });
}
const avancarMinutos = (minutos: number) => { offsetMs += minutos * 60_000; };
const novoToken = (nivel: 'ADMINISTRADOR' | 'EDITOR' = 'ADMINISTRADOR') => m.signToken({ sub: 1, nivelAcesso: nivel });
const cursorAtual = async () => (await (await get('/sync/estado', novoToken('EDITOR'))).json()).cursor as string;
const estado = async (desde: string | number) => (await get(`/sync/estado?desde=${desde}`, novoToken('EDITOR'))).json();

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
    // Each change goes through invalidarUsuarioSessao, as the services do after their transactions.
    const alterarUsuario = (novo: typeof usuario) => { usuario = novo; m.cacheUsuarios.invalidarUsuarioSessao(1); };
    alterarUsuario(null);
    assert.equal((await get('/ativa', token, headers)).status, 401);
    alterarUsuario({ id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 0, ativo: false });
    assert.equal((await get('/ativa', token, headers)).status, 401);
    alterarUsuario({ id: 1, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 1, ativo: true });
    assert.equal((await get('/ativa', token, headers)).status, 401);
    const semToken = await fetch(`${baseUrl}/ativa`, { headers });
    assert.equal(semToken.status, 401);
  });
});

describe('GET /sync/estado', () => {
  it('without desde returns an empty entity list, a decimal string cursor and only the documented fields', async () => {
    const res = await get('/sync/estado', novoToken('EDITOR'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['cursor', 'entidades', 'serverTime']);
    assert.match(body.cursor, /^\d{1,10}$/);
    assert.deepEqual(body.entidades, []);
    assert.ok(Math.abs(Date.parse(body.serverTime) - Date.now()) < 5000);
    assert.equal(new Date(body.serverTime).toISOString(), body.serverTime);
  });

  it('never queries the database: polling must let the Neon compute scale to zero', async () => {
    const token = novoToken('EDITOR');
    const cursor = await cursorAtual();
    for (let i = 0; i < 5; i += 1) assert.equal((await get(`/sync/estado?desde=${cursor}`, token)).status, 200);
    assert.equal(consultasAuditLog, 0);
    assert.equal(consultasUsuario, 1, 'the user is read once, then served by the session cache');
  });

  it('reports the distinct entities changed after desde and advances the cursor, without leaking audit fields', async () => {
    const antes = await cursorAtual();
    assert.equal((await mutar(['Equipamento', 'Emprestimo', 'Equipamento'])).status, 200);
    const res = await get(`/sync/estado?desde=${antes}`, novoToken('EDITOR'));
    const texto = await res.text();
    const body = JSON.parse(texto);
    assert.deepEqual(body.entidades, ['Emprestimo', 'Equipamento']);
    assert.ok(Number(body.cursor) > Number(antes));
    for (const proibido of ['actorId', 'entityId', 'changedFields']) {
      assert.ok(!texto.includes(proibido), `response leaked ${proibido}`);
    }
    assert.deepEqual((await estado(body.cursor)).entidades, [], 'nothing new after the returned cursor');
  });

  it('publishes a change only after the response is finished (after the transaction committed)', async () => {
    const antes = await cursorAtual();
    await mutar(['Ocorrencia']);
    assert.equal(cursorDuranteMutacao, antes, 'the cursor must not move while the request is still running');
    assert.deepEqual((await estado(antes)).entidades, ['Ocorrencia']);
  });

  it('a failed request still reports what it touched (over-reporting is safe, missing a change is not)', async () => {
    const antes = await cursorAtual();
    assert.equal((await mutar(['Categoria'], true)).status, 500);
    assert.deepEqual((await estado(antes)).entidades, ['Categoria']);
  });

  it('a write after the response was sent is still reported (registered without waiting for a commit signal)', async () => {
    const antes = await cursorAtual();
    const concluida = new Promise<void>((resolve) => { escritaTardiaConcluida = resolve; });
    const res = await fetch(`${baseUrl}/mutacao-depois-da-resposta`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entidades: ['Responsavel'] }),
    });
    assert.equal(res.status, 202);
    await concluida;
    assert.deepEqual((await estado(antes)).entidades, ['Responsavel']);
  });

  it('a client disconnecting mid-transaction does not publish early and the change is not lost', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const antes = await cursorAtual();
    const concluida = new Promise<void>((resolve) => { escritaTardiaConcluida = resolve; });
    const abortar = new AbortController();
    const pedido = fetch(`${baseUrl}/mutacao-lenta`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entidades: ['Equipamento'] }),
      signal: abortar.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve)); // let the request reach the handler
    await new Promise((resolve) => setImmediate(resolve));
    abortar.abort();
    await pedido;
    await concluida;
    assert.equal(m.feed.obterEstadoFeed().cursor, antes, 'nothing is published right after the disconnect');
    t.mock.timers.tick(m.feed.ATRASO_REGISTRO_SEM_SINAL_MS);
    assert.deepEqual(m.feed.obterEstadoFeed(Number(antes)).entidades, ['Equipamento']);
  });

  it('never reports Usuario', async () => {
    const antes = await cursorAtual();
    await mutar(['Usuario']);
    assert.ok(!(ENTIDADES_SINCRONIZADAS as readonly string[]).includes('Usuario'));
    const body = await estado(antes);
    assert.deepEqual(body.entidades, []);
    assert.equal(body.cursor, antes, 'a Usuario-only change does not move the cursor');
  });

  it('a cursor from the old AuditLog-id scheme or from before this boot gets every entity (one full reload)', async () => {
    const body = await estado(1840);
    assert.deepEqual(body.entidades, ['Categoria', 'Emprestimo', 'Equipamento', 'Ocorrencia', 'Responsavel']);
  });

  it('a cursor ahead of this process (e.g. after a restart) gets every entity and a lower cursor, so the client reloads', async () => {
    const atual = await cursorAtual();
    const body = await estado(Number(atual) + 1000);
    assert.deepEqual(body.entidades, [...ENTIDADES_SINCRONIZADAS]);
    assert.ok(Number(body.cursor) < Number(atual) + 1000);
  });

  it('rejects an invalid desde with the standard 400 validation error', async () => {
    for (const desde of ['-1', 'abc', '', '1.5', '1e3', '+5', '99999999999', '1&desde=2']) {
      const res = await get(`/sync/estado?desde=${desde}`, novoToken());
      assert.equal(res.status, 400, `desde=${desde}`);
      const body = await res.json();
      assert.equal(body.erro, 'backend.validacao.dados_invalidos');
      assert.ok(Array.isArray(body.detalhes));
    }
  });

  it('rejects unknown query parameters with 400', async () => {
    const res = await get('/sync/estado?desde=1&outro=2', novoToken());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).erro, 'backend.validacao.dados_invalidos');
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

describe('criarFeedMudancas', () => {
  it('keeps the cursor increasing and reports only changes after desde', () => {
    const feed = m.feed.criarFeedMudancas();
    const inicio = Number(feed.estado().cursor);
    feed.registrar(['Equipamento']);
    const depoisEquipamento = Number(feed.estado().cursor);
    feed.registrar(['Responsavel', 'Responsavel']);
    assert.ok(depoisEquipamento > inicio);
    assert.deepEqual(feed.estado(inicio).entidades, ['Equipamento', 'Responsavel']);
    assert.deepEqual(feed.estado(depoisEquipamento).entidades, ['Responsavel']);
  });

  it('advances with the clock so a restarted process starts above the previous cursors', () => {
    const feed = m.feed.criarFeedMudancas();
    feed.registrar(['Equipamento']);
    const antes = Number(feed.estado().cursor);
    offsetMs += 600_000; // well past the initial gap, so the clock (not the +1 step) drives the sequence
    feed.registrar(['Equipamento']);
    assert.ok(Number(feed.estado().cursor) >= antes + 400);
    const reiniciado = m.feed.criarFeedMudancas();
    assert.ok(Number(reiniciado.estado().cursor) > antes, 'a new process starts above cursors issued before it');
  });

  it("the app's first-cursor margin (MARGEM_CURSOR_INICIAL = 50) after a quiet boot is not mistaken for a pre-boot cursor", () => {
    const feed = m.feed.criarFeedMudancas();
    const inicial = Number(feed.estado().cursor);
    assert.deepEqual(feed.estado(inicial - 50).entidades, [], 'no forced full reload for new sessions');
    feed.registrar(['Ocorrencia']);
    assert.deepEqual(feed.estado(inicial - 50).entidades, ['Ocorrencia']);
  });

  it('a client behind the oldest kept change gets every entity', () => {
    const feed = m.feed.criarFeedMudancas(3);
    const inicio = Number(feed.estado().cursor);
    feed.registrar(['Equipamento']);
    const primeiro = Number(feed.estado().cursor);
    for (const e of ['Categoria', 'Ocorrencia', 'Responsavel']) feed.registrar([e]); // drops the Equipamento entry
    assert.deepEqual(feed.estado(inicio).entidades, [...ENTIDADES_SINCRONIZADAS]);
    assert.deepEqual(feed.estado(primeiro).entidades, ['Categoria', 'Ocorrencia', 'Responsavel']);
  });

  it('writes outside a request are registered immediately (no commit signal is available)', async () => {
    const antes = await cursorAtual();
    await m.writeAuditLog(txFalso, 1, 'CREATE', 'Responsavel', 1, ['nome']);
    assert.deepEqual(m.feed.obterEstadoFeed(Number(antes)).entidades, ['Responsavel']);
  });
});
