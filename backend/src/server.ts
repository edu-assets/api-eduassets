import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app.js';
import { initRfidBridge } from './lib/rfidBridge.js';
import { logger } from './lib/logger.js';
import { getRuntimeConfig } from './config/runtimeConfig.js';
import { prisma } from './lib/prisma.js';

const { port: PORT, host: HOST } = getRuntimeConfig();

const server = createServer(app);
if (process.env.RFID_BRIDGE_ENABLED === 'true') {
  initRfidBridge(server);
}

server.listen(PORT, HOST, () => {
  logger.info(`Servidor rodando em http://${HOST}:${PORT}`);
});

function shutdown(signal: string): void {
  logger.info(`Encerrando servidor após ${signal}.`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));