import express from 'express';
import cors from 'cors';
import { routes } from './routes/index.js';
import { notFoundHandler } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { securityHeaders, globalRateLimiter } from './middlewares/security.js';

export const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST ?? '127.0.0.1';
const isLoopbackHost = HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '::1';
const isLocalDevelopment = process.env.NODE_ENV === 'development' && isLoopbackHost;

/**
 * Trust proxy:
 * - TRUST_PROXY explícito sempre prevalece.
 * - Em produção sem TRUST_PROXY, assume 1 hop como padrão seguro.
 * - Em desenvolvimento local, false.
 */
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined) {
  const asNumber = Number(trustProxyEnv);
  app.set('trust proxy', Number.isNaN(asNumber) ? trustProxyEnv : asNumber);
} else if (isProduction) {
  app.set('trust proxy', 1);
} else {
  app.set('trust proxy', false);
}

app.use(securityHeaders);

const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (!isLocalDevelopment && allowedOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN não definida fora do desenvolvimento local. Configure a variável de ambiente com as origens permitidas (ex: https://eduassets.vercel.app) antes de iniciar o servidor.'
  );
}

app.use(
  cors({
    origin: isLocalDevelopment ? true : (allowedOrigins.length > 0 ? allowedOrigins : false),
  })
);

app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(globalRateLimiter);

// Endpoint de verificação de integridade / monitoramento
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.send('eduAssets API running.');
});

// Rotas da aplicação
app.use(routes);

// Tratamento de 404 e erros centralizados
app.use(notFoundHandler);
app.use(errorHandler);
