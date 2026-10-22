import type { Request, Response } from 'express';
import { publicLoan } from '../lib/publicDto.js';
import * as emprestimosService from '../services/emprestimo.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const emprestimos = await emprestimosService.listarEmprestimos();
  res.json(req.user ? emprestimos : emprestimos.map(publicLoan));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criado = await emprestimosService.criarEmprestimo(req.body);
  res.status(201).json(criado);
}

export async function atualizarItens(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizado = await emprestimosService.atualizarItensEmprestimo(id, req.body.itens);
  res.json(atualizado);
}

export async function devolver(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const devolvido = await emprestimosService.devolverEmprestimo(id, req.body.dataDevolucao);
  res.json(devolvido);
}
