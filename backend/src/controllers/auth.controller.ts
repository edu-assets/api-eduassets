import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';

export async function login(req: Request, res: Response): Promise<void> {
  const { login, password } = req.body;
  const resultado = await authService.login(login, password);
  res.json(resultado);
}

export async function me(req: Request, res: Response): Promise<void> {
  const perfil = await authService.obterPerfil(req.user!.sub);
  res.json(perfil);
}

export async function alterarSenha(req: Request, res: Response): Promise<void> {
  const { senhaAtual, novaSenha } = req.body;
  const token = await authService.alterarSenha(req.user!.sub, senhaAtual, novaSenha);
  res.json({ token });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.user!.sub);
  res.status(204).send();
}

export async function loginRfid(req: Request, res: Response): Promise<void> {
  const { token } = req.body;
  const bridgeSecretHeader = req.headers['x-rfid-bridge-secret'] as string | undefined;
  await authService.loginRfid(token, req.socket.remoteAddress, bridgeSecretHeader);
  res.status(204).send();
}
