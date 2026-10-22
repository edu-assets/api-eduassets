import express from 'express';
import cors from 'cors';
import { routes } from './routes/index.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { securityHeaders, globalRateLimiter } from './middlewares/security.js';
import { getRuntimeConfig } from './config/runtimeConfig.js';
import { prisma } from './lib/prisma.js';
import { checkReadiness } from './lib/readiness.js';

export const app = express();

const runtimeConfig = getRuntimeConfig();
const isLocalDevelopment = runtimeConfig.nodeEnv === 'development' &&
  ['localhost', '127.0.0.1', '::1'].includes(runtimeConfig.host);
app.set('trust proxy', runtimeConfig.trustProxy);

app.use(securityHeaders);

const allowedOrigins = runtimeConfig.corsOrigins;

app.use(
  cors({
    origin: isLocalDevelopment ? true : allowedOrigins,
  })
);

app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(globalRateLimiter);

// Liveness: process is running; deliberately does not depend on PostgreSQL.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Readiness: bounded, minimal dependency check; never returns database details.
app.get('/ready', async (_req, res) => {
  const ready = await checkReadiness(() => prisma.$queryRaw`SELECT 1`);
  if (ready) res.json({ status: 'ready' });
  else res.status(503).json({ status: 'unavailable', erro: 'backend.geral.banco_indisponivel' });
});

app.get('/', (_req, res) => {
  res.send('eduAssets API running.');
});

// Rotas da aplicação
app.use(routes);

// Tratamento de 404 e erros centralizados
app.use(notFoundHandler);
app.use(errorHandler);
