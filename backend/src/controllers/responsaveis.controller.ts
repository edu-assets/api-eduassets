import type { Request, Response } from 'express';
import * as responsaveisService from '../services/responsavel.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const responsaveis = await responsaveisService.listarResponsaveis();
  res.json(responsaveis);
}

export async function criar(req: Request, res: Response): Promise<void> {
  const { nome, cargo } = req.body;
  const criado = await responsaveisService.criarResponsavel(nome, cargo, req.user!.sub);
  res.status(201).json(criado);
}
