import type { Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { getVapidPublicKey, isPushConfigured } from '../lib/webPush.js';
import * as notificacaoService from '../services/notificacao.service.js';

function exigirPushConfigurado(): void {
  if (!isPushConfigured()) throw new AppError(503, 'backend.notificacoes.push_indisponivel');
}

export function config(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ habilitado: isPushConfigured(), chavePublica: getVapidPublicKey() });
}

export async function salvarInscricao(req: Request, res: Response): Promise<void> {
  exigirPushConfigurado();
  const { inscricao, preferencias } = req.body;
  const salvas = await notificacaoService.salvarInscricao(req.user!.sub, inscricao, preferencias);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ preferencias: salvas });
}

export async function removerInscricao(req: Request, res: Response): Promise<void> {
  await notificacaoService.removerInscricao(req.user!.sub, req.body.endpoint);
  res.status(204).send();
}

export function enviarTeste(req: Request, res: Response): void {
  exigirPushConfigurado();
  notificacaoService.dispararTeste(req.user!.sub);
  res.status(202).send();
}
