import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_requisicoes' },
});

export const changePasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user ? `user:${req.user.sub}` : ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_tentativas_senha' },
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // Hash the normalized identifier so the in-memory limiter never retains raw email/login values.
  keyGenerator: (req) => {
    const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase() : '';
    const loginHash = createHash('sha256').update(login).digest('hex');
    return `ip:${ipKeyGenerator(req.ip ?? '')}:login:${loginHash}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_tentativas_login' },
});

/** Coarse per-IP backstop; per-account limiting above avoids locking out an entire NAT after 10 attempts. */
export const loginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_tentativas_login' },
});

export const rfidLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_tentativas_rfid' },
});

export const rfidProvisionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `admin:${req.user?.sub ?? 'unknown'}:ip:${ipKeyGenerator(req.ip ?? '')}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'backend.seguranca.muitas_provisionamentos_rfid' },
});
