import type { Request, Response } from 'express';
import { publicOccurrence } from '../lib/publicDto.js';
import * as ocorrenciasService from '../services/ocorrencia.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const ocorrencias = await ocorrenciasService.listarOcorrencias();
  res.json(req.user ? ocorrencias : ocorrencias.map(publicOccurrence));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criadas = await ocorrenciasService.criarOcorrencias(req.body);
  res.status(201).json(criadas);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizada = await ocorrenciasService.atualizarOcorrencia(id, req.body);
  res.json(atualizada);
}

export async function resolver(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { medidasTomadas } = req.body;
  const resolvida = await ocorrenciasService.resolverOcorrencia(id, medidasTomadas);
  res.json(resolvida);
}

export async function excluir(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await ocorrenciasService.excluirOcorrencia(id);
  res.status(204).send();
}
