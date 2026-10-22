import type { Request, Response } from 'express';
import { publicEquipment } from '../lib/publicDto.js';
import * as equipamentosService from '../services/equipamento.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const equipamentos = await equipamentosService.listarEquipamentos();
  res.json(req.user ? equipamentos : equipamentos.map(publicEquipment));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criado = await equipamentosService.criarEquipamento(req.body);
  res.status(201).json(criado);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizado = await equipamentosService.atualizarEquipamento(id, req.body);
  res.json(atualizado);
}
