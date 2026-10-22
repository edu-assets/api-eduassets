import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app.js';
import { initRfidBridge } from './lib/rfidBridge.js';
import { logger } from './lib/logger.js';

const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT) || 3000;
const HOST = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const server = createServer(app);
if (process.env.RFID_BRIDGE_ENABLED === 'true') {
  initRfidBridge(server);
}

server.listen(PORT, HOST, () => {
  logger.info(`Servidor rodando em http://${HOST}:${PORT}`);
});