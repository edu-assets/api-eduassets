import type { Request, Response } from 'express';
import { publicEquipment } from '../lib/publicDto.js';
import * as equipamentosService from '../services/equipamento.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  if (req.user) {
    res.json(await equipamentosService.listarEquipamentos());
    return;
  }
  // Guests never load authorship; the allowlist projection is applied on top.
  res.json((await equipamentosService.listarEquipamentosPublicos()).map(publicEquipment));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criado = await equipamentosService.criarEquipamento(req.body, req.user!.sub);
  res.status(201).json(criado);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizado = await equipamentosService.atualizarEquipamento(id, req.body, req.user!.sub);
  res.json(atualizado);
}
