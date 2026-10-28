import type { NextFunction, Request, Response } from 'express';
import { verifyToken, AppJwtPayload } from '../lib/jwt.js';
import { clearSessionCookie, getSessionCookieToken } from '../lib/sessionCookie.js';
import { isTrustedOrigin } from './csrf.js';
import { prisma } from '../lib/prisma.js';
import {
  registrarAtividadeAdmin,
  sessaoAdminExpirada,
} from '../lib/adminActivity.js';

declare global {
  namespace Express {
    interface Request {
      user?: AppJwtPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = getSessionCookieToken(req);
  const usingCookie = cookieToken !== null;
  const token = cookieToken ?? bearerToken;

  if (!token) {
    res.status(401).json({ erro: 'backend.auth.autenticacao_necessaria' });
    return;
  }

  const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (usingCookie && isMutatingMethod && !isTrustedOrigin(req.get('origin'))) {
    res.status(403).json({ erro: 'backend.auth.origem_nao_permitida' });
    return;
  }

  let payload: AppJwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    if (usingCookie) clearSessionCookie(req, res);
    res.status(401).json({ erro: 'backend.auth.token_invalido' });
    return;
  }

  // Verifica se o usuário ainda existe no banco de dados e obtém o nível de acesso atual
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, nivelAcesso: true, sessionVersion: true, ativo: true },
  });

  if (!usuario) {
    if (usingCookie) clearSessionCookie(req, res);
    res.status(401).json({ erro: 'backend.auth.usuario_nao_existe' });
    return;
  }

  if (!usuario.ativo) {
    if (usingCookie) clearSessionCookie(req, res);
    res.status(401).json({ erro: 'backend.auth.usuario_inativo' });
    return;
  }

  if (payload.sessionVersion !== usuario.sessionVersion) {
    if (usingCookie) clearSessionCookie(req, res);
    res.status(401).json({ erro: 'backend.auth.token_invalido' });
    return;
  }

  // Se o nível atual no banco é ADMINISTRADOR, aplica o timeout de 30 minutos de inatividade
  if (usuario.nivelAcesso === 'ADMINISTRADOR') {
    if (sessaoAdminExpirada(payload.jti, payload.iat)) {
      if (usingCookie) clearSessionCookie(req, res);
      res.status(401).json({ erro: 'backend.auth.sessao_expirada', sessaoExpirada: true });
      return;
    }
    registrarAtividadeAdmin(payload.jti);
  }

  // Armazena no req.user o sub e o nível de acesso fresco do banco
  req.user = {
    sub: usuario.id,
    nivelAcesso: usuario.nivelAcesso,
    sessionVersion: usuario.sessionVersion,
    jti: payload.jti,
    iat: payload.iat,
    exp: payload.exp,
  };

  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.user?.nivelAcesso !== 'ADMINISTRADOR') {
      res.status(403).json({ erro: 'backend.auth.acesso_restrito_admin' });
      return;
    }
    next();
  });
}

/** Authenticate requests that supply a bearer token while retaining Guest Mode for anonymous reads. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.headers.authorization && !getSessionCookieToken(req)) {
    next();
    return;
  }
  await requireAuth(req, res, next);
}
