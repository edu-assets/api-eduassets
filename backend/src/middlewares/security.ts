import helmet from 'helmet';
import cors from 'cors';

export const securityHeaders = helmet({
  frameguard: { action: 'deny' },
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

export function configureCors(options?: { isLocalDevelopment: boolean; allowedOrigins: string[] }) {
  const isLocalDevelopment = options?.isLocalDevelopment ?? true;
  const allowedOrigins = options?.allowedOrigins ?? [];

  return cors({
    origin: isLocalDevelopment ? true : (allowedOrigins.length > 0 ? allowedOrigins : false),
  });
}

// Re-exporta rate limiters para compatibilidade
export * from './rateLimit.js';
