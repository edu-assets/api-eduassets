import helmet from 'helmet';

export const securityHeaders = helmet({
  frameguard: { action: 'deny' },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// Re-exporta rate limiters para compatibilidade
export * from './rateLimit.js';
