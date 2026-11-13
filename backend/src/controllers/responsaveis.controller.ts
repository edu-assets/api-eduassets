import type { Request, Response } from 'express';
import * as responsaveisService from '../services/responsavel.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  // ?incluirInativos=true is honoured for administrators only; for editors it is silently ignored (active only).
  const incluirInativos = req.query.incluirInativos === 'true' && req.user?.nivelAcesso === 'ADMINISTRADOR';
  const responsaveis = await responsaveisService.listarResponsaveis(incluirInativos);
  res.json(responsaveis);
}

export async function criar(req: Request, res: Response): Promise<void> {
  const { nome, cargo } = req.body;
  const criado = await responsaveisService.criarResponsavel(nome, cargo, req.user!.sub);
  res.status(201).json(criado);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const atualizado = await responsaveisService.atualizarResponsavel(Number(req.params.id), req.body, req.user!.sub);
  res.json(atualizado);
}
