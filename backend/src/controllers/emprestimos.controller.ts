import type { Request, Response } from 'express';
import { publicLoan } from '../lib/publicDto.js';
import * as emprestimosService from '../services/emprestimo.service.js';
import { dispararNotificacao } from '../services/notificacao.service.js';
import { emprestimoListQuerySchema } from '../schemas/emprestimo.schema.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const query = emprestimoListQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({
      erro: 'backend.validacao.dados_invalidos',
      detalhes: query.error.issues.map((issue) => ({ campo: issue.path.join('.'), mensagem: issue.message })),
    });
    return;
  }
  if (req.user) {
    res.json(await emprestimosService.listarEmprestimos());
    return;
  }
  const page = await emprestimosService.listarPaginaPublicaEmprestimos(query.data.limit, query.data.cursor);
  res.json({ items: page.items.map(publicLoan), nextCursor: page.nextCursor, limit: query.data.limit });
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criado = await emprestimosService.criarEmprestimo(req.body, req.user!.sub);
  // Post-commit and fire-and-forget: push delivery can never delay or fail the request.
  dispararNotificacao({
    tipo: 'EMPRESTIMO_CRIADO',
    autorId: req.user!.sub,
    entidadeId: criado.id,
    solicitanteNome: criado.solicitanteNome,
    itens: criado.itens.map((item) => ({ equipamentoId: item.equipamentoId, quantidade: item.quantidade })),
  });
  res.status(201).json(criado);
}

export async function atualizarItens(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const atualizado = await emprestimosService.atualizarItensEmprestimo(id, req.body.itens, req.user!.sub);
  res.json(atualizado);
}

export async function devolver(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const devolvido = await emprestimosService.devolverEmprestimo(id, req.body.dataDevolucao, req.user!.sub);
  dispararNotificacao({
    tipo: 'DEVOLUCAO_REGISTRADA',
    autorId: req.user!.sub,
    entidadeId: devolvido.id,
    solicitanteNome: devolvido.solicitanteNome,
    itens: devolvido.itens.map((item) => ({ equipamentoId: item.equipamentoId, quantidade: item.quantidade })),
  });
  res.json(devolvido);
}
