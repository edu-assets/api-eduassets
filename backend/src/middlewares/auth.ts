import type { NextFunction, Request, Response } from 'express';
import { verifyToken, AppJwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import {
  registrarAtividadeAdmin,
  sessaoAdminExpirada,
  limparAtividadeAdmin,
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

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'backend.auth.autenticacao_necessaria' });
    return;
  }

  let payload: AppJwtPayload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    res.status(401).json({ erro: 'backend.auth.token_invalido' });
    return;
  }

  // Verifica se o usuário ainda existe no banco de dados e obtém o nível de acesso atual
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, nivelAcesso: true },
  });

  if (!usuario) {
    res.status(401).json({ erro: 'backend.auth.usuario_nao_existe' });
    return;
  }

  // Se o nível atual no banco é ADMINISTRADOR, aplica o timeout de 30 minutos de inatividade
  if (usuario.nivelAcesso === 'ADMINISTRADOR') {
    if (sessaoAdminExpirada(usuario.id)) {
      limparAtividadeAdmin(usuario.id);
      res.status(401).json({ erro: 'backend.auth.sessao_expirada', sessaoExpirada: true });
      return;
    }
    registrarAtividadeAdmin(usuario.id);
  }

  // Armazena no req.user o sub e o nível de acesso fresco do banco
  req.user = {
    sub: usuario.id,
    nivelAcesso: usuario.nivelAcesso,
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
