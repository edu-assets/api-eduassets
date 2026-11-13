import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-sync-ratelimit-secret-0123456789';

let server: Server;
let baseUrl: string;

before(async () => {
  const { globalRateLimiter } = await import('../src/middlewares/rateLimit.js');
  const { syncRouter } = await import('../src/routes/sync.js');
  // Faithful to app.ts ordering: sync router first, then the global limiter, then everything else and the 404.
  const app = express();
  app.use('/sync', syncRouter);
  app.use(globalRateLimiter);
  app.get('/outra', (_req, res) => { res.json({ ok: true }); });
  app.use((_req, res) => { res.status(404).json({ erro: 'nao_encontrado' }); });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function disparar(path: string, quantidade: number): Promise<number[]> {
  const status: number[] = [];
  for (let inicio = 0; inicio < quantidade; inicio += 100) {
    const lote = await Promise.all(
      Array.from({ length: Math.min(100, quantidade - inicio) }, () => fetch(`${baseUrl}${path}`).then((r) => r.status)),
    );
    status.push(...lote);
  }
  return status;
}

// One process and one in-memory limiter store per file: the steps below depend on each other and run in order.
describe('rate limiting of GET /sync/estado', () => {
  it('the dedicated limiter allows 900 requests per IP and then answers 429 with the standard error', async () => {
    // Unauthenticated requests are enough: the limiter runs before authentication.
    const status = await disparar('/sync/estado', 900);
    assert.ok(status.every((s) => s === 401), 'first 900 requests reach the route (401 without a token)');
    const res = await fetch(`${baseUrl}/sync/estado`);
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { erro: 'backend.seguranca.muitas_requisicoes' });
    assert.equal((await fetch(`${baseUrl}/sync/estado/`)).status, 429, 'trailing slash shares the same quota');
  });

  it('the global limiter does not count sync polling but still limits other paths at 1200', async () => {
    // 900+ sync requests were made above; none of them may have consumed the global quota.
    const status = await disparar('/outra', 1200);
    assert.ok(status.every((s) => s === 200), 'the full global quota (1200) is still available after sync polling');
    assert.equal((await fetch(`${baseUrl}/outra`)).status, 429);
  });

  it('other methods and unmatched /sync paths are subject to the global limiter', async () => {
    // The global quota is exhausted by the previous step.
    assert.equal((await fetch(`${baseUrl}/sync/estado`, { method: 'POST' })).status, 429);
    assert.equal((await fetch(`${baseUrl}/sync/outro`)).status, 429);
  });
});
