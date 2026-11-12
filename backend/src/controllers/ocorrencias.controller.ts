import type { Request, Response } from 'express';
import { publicOccurrence } from '../lib/publicDto.js';
import * as ocorrenciasService from '../services/ocorrencia.service.js';
import { dispararNotificacao } from '../services/notificacao.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const ocorrencias = await ocorrenciasService.listarOcorrencias();
  res.json(req.user ? ocorrencias : ocorrencias.map(publicOccurrence));
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criadas = await ocorrenciasService.criarOcorrencias(req.body, req.user!.sub);
  // One notification per request, however many patrimony numbers it carried (they are never sent).
  const primeira = criadas[0];
  if (primeira) {
    dispararNotificacao({
      tipo: 'OCORRENCIA_REGISTRADA',
      autorId: req.user!.sub,
      entidadeId: primeira.id,
      itens: [{ equipamentoId: primeira.equipamentoId, quantidade: criadas.length }],
      tipoOcorrencia: primeira.tipo,
    });
  }
  res.status(201).json(criadas);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizada = await ocorrenciasService.atualizarOcorrencia(id, req.body, req.user!.sub);
  res.json(atualizada);
}

export async function resolver(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { medidasTomadas } = req.body;
  const resolvida = await ocorrenciasService.resolverOcorrencia(id, medidasTomadas, req.user!.sub);
  res.json(resolvida);
}

export async function excluir(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await ocorrenciasService.excluirOcorrencia(id, req.user!.sub);
  res.status(204).send();
}
