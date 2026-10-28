import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import WebSocket from 'ws';
import { initRfidBridge, publicarLoginRfid } from '../src/lib/rfidBridge.js';

process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3000';
process.env.CORS_ORIGIN = 'http://127.0.0.1';
process.env.TRUST_PROXY = '0';
process.env.JWT_SECRET = 'synthetic-rfid-bridge-test-secret-0123456789';

test('RFID bridge rejects untrusted upgrades and sends only a one-time code to trusted cookie clients', async () => {
  const server = createServer();
  initRfidBridge(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const baseUrl = `ws://127.0.0.1:${address.port}`;

  const expectRejected = async (path: string, origin?: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const headers = origin ? { origin } : {};
      const client = new WebSocket(`${baseUrl}${path}`, { headers });
      const timer = setTimeout(() => {
        client.terminate();
        reject(new Error(`Expected WebSocket upgrade rejection for ${path}`));
      }, 2_000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      client.once('error', finish);
      client.once('close', finish);
      client.once('open', () => {
        clearTimeout(timer);
        client.close();
        reject(new Error(`Unexpectedly accepted WebSocket upgrade for ${path}`));
      });
    });
  };

  let accepted: WebSocket | undefined;
  try {
    await expectRejected('/ws/rfid?auth=cookie');
    await expectRejected('/ws/rfid?auth=cookie', 'https://untrusted.example');
    await expectRejected('/other?auth=cookie', 'http://127.0.0.1');
    await expectRejected('/ws/rfid?auth=token', 'http://127.0.0.1');

    accepted = new WebSocket(`${baseUrl}/ws/rfid?auth=cookie`, { headers: { origin: 'http://127.0.0.1' } });
    await new Promise<void>((resolve, reject) => {
      accepted!.once('open', resolve);
      accepted!.once('error', reject);
    });

    const message = once(accepted, 'message');
    publicarLoginRfid({ token: 'synthetic-jwt-not-for-production' });
    const [raw] = await message;
    const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload), ['code']);
    assert.match(String(payload.code), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(payload).includes('synthetic-jwt-not-for-production'), false);
  } finally {
    if (accepted?.readyState === WebSocket.OPEN) {
      const closed = once(accepted, 'close');
      accepted.close();
      await closed;
    }
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
