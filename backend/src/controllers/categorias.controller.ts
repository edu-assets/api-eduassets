import type { Request, Response } from 'express';
import * as categoriasService from '../services/categoria.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const categorias = await categoriasService.listarCategorias();
  res.json(categorias);
}

export async function criar(req: Request, res: Response): Promise<void> {
  const { nome } = req.body;
  const criada = await categoriasService.criarCategoria(nome, req.user!.sub);
  res.status(201).json(criada);
}
