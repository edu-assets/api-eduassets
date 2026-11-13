import type { Request, Response } from 'express';
import { publicCategory } from '../lib/publicDto.js';
import * as categoriasService from '../services/categoria.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  if (req.user) {
    res.json(await categoriasService.listarCategorias());
    return;
  }
  // Guest Mode: { id, nome } only, never authorship.
  res.json((await categoriasService.listarCategoriasPublicas()).map(publicCategory));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const { nome } = req.body;
  const criada = await categoriasService.criarCategoria(nome, req.user!.sub);
  res.status(201).json(criada);
}
