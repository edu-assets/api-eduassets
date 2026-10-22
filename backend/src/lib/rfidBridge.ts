import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface RfidLoginEvent {
  token: string;
  user: {
    id: number;
    nome: string;
    login: string;
    nivelAcesso: 'ADMINISTRADOR' | 'EDITOR';
  };
}

let wss: WebSocketServer | null = null;

function ehLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
}

export function initRfidBridge(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/rfid') {
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
  const payload = JSON.stringify(evento);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}