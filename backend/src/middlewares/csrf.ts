import type { NextFunction, Request, Response } from 'express';
import { getRuntimeConfig } from '../config/runtimeConfig.js';

export function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return false;
  const config = getRuntimeConfig();
  if (config.corsOrigins.includes(origin)) return true;

  const isLocalDevelopment = config.nodeEnv === 'development' &&
    ['localhost', '127.0.0.1', '::1'].includes(config.host);
  if (!isLocalDevelopment) return false;

  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function requireTrustedOriginForCookieMode(req: Request, res: Response, next: NextFunction): void {
  if (req.get('x-auth-mode')?.toLowerCase() !== 'cookie' || isTrustedOrigin(req.get('origin'))) {
    next();
    return;
  }
  res.status(403).json({ erro: 'backend.auth.origem_nao_permitida' });
}
