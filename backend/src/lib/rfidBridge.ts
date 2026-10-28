import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { createRfidLoginCode } from './rfidLoginCode.js';
import { isTrustedOrigin } from '../middlewares/csrf.js';
import { isRfidSocketRequestAllowed } from './rfidPolicy.js';

interface RfidLoginEvent {
  token: string;
}

let wss: WebSocketServer | null = null;

function ehLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
}

export function initRfidBridge(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const authMode = url.searchParams.get('auth');
      const hasExpectedRouteAndMode = url.pathname === '/ws/rfid' && authMode === 'cookie';
      const originTrusted = hasExpectedRouteAndMode && isTrustedOrigin(req.headers.origin);
      if (!isRfidSocketRequestAllowed(url.pathname, authMode, originTrusted)) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }

    // Accepts only connections from localhost (loopback) for security reasons
    if (!ehLoopback(req.socket.remoteAddress)) {
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('error', () => ws.close());
  });
}

export function publicarLoginRfid(evento: RfidLoginEvent): void {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({ code: createRfidLoginCode(evento.token) }));
  });
}
