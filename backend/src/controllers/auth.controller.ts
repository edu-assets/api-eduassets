import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { clearSessionCookie, setSessionCookie } from '../lib/sessionCookie.js';
import { consumeRfidLoginCode } from '../lib/rfidLoginCode.js';
import { isMailConfigured } from '../lib/mailer.js';
import { logger } from '../lib/logger.js';
import * as passwordRecovery from '../services/passwordRecovery.service.js';

export function sessionCapabilities(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ cookieSession: true, passwordRecovery: isMailConfigured() });
}

/** Always 202 with the same body, answered before any lookup, so the response never reveals whether the account exists. */
export async function solicitarRecuperacaoSenha(req: Request, res: Response): Promise<void> {
  if (!isMailConfigured()) {
    res.status(503).json({ erro: 'backend.auth.recuperacao_indisponivel' });
    return;
  }
  const { login, idioma } = req.body;
  res.setHeader('Cache-Control', 'no-store');
  res.status(202).json({ mensagem: 'backend.auth.recuperacao_solicitada' });
  passwordRecovery.solicitarRecuperacao(login, idioma).catch((error: unknown) => {
    logger.error('Falha ao processar pedido de recuperação de senha.', { error: error instanceof Error ? error.message : 'erro desconhecido' });
  });
}

export async function redefinirSenhaComToken(req: Request, res: Response): Promise<void> {
  const { token, senha } = req.body;
  await passwordRecovery.redefinirSenhaComToken(token, senha);
  clearSessionCookie(req, res);
  res.status(204).send();
}

export async function login(req: Request, res: Response): Promise<void> {
  const { login, password } = req.body;
  const resultado = await authService.login(login, password);
  setSessionCookie(req, res, resultado.token);
  res.json({ user: resultado.user });
}

export async function me(req: Request, res: Response): Promise<void> {
  const perfil = await authService.obterPerfil(req.user!.sub);
  res.json(perfil);
}

export async function alterarSenha(req: Request, res: Response): Promise<void> {
  const { senhaAtual, novaSenha } = req.body;
  const token = await authService.alterarSenha(req.user!.sub, senhaAtual, novaSenha);
  setSessionCookie(req, res, token);
  res.status(204).send();
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.user!.sub);
  clearSessionCookie(req, res);
  res.status(204).send();
}

export async function loginRfid(req: Request, res: Response): Promise<void> {
  const { token } = req.body;
  const bridgeSecretHeader = req.headers['x-rfid-bridge-secret'] as string | undefined;
  await authService.loginRfid(token, req.socket.remoteAddress, bridgeSecretHeader);
  res.status(204).send();
}

export async function loginRfidSession(req: Request, res: Response): Promise<void> {
  const token = consumeRfidLoginCode(req.body.code);
  if (!token) {
    res.status(401).json({ erro: 'backend.auth.token_invalido' });
    return;
  }
  setSessionCookie(req, res, token);
  res.status(204).send();
}
