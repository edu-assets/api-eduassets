import type { Request, Response } from 'express';
import { syncEstadoQuerySchema } from '../schemas/sync.schema.js';
import * as syncService from '../services/sync.service.js';

export async function estado(req: Request, res: Response): Promise<void> {
  const query = syncEstadoQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({
      erro: 'backend.validacao.dados_invalidos',
      detalhes: query.error.issues.map((issue) => ({ campo: issue.path.join('.'), mensagem: issue.message })),
    });
    return;
  }
  const { cursor, entidades } = await syncService.obterEstadoSync(query.data.desde);
  // Computed as late as possible so clients can estimate their clock offset from the response.
  res.json({ serverTime: new Date().toISOString(), cursor, entidades });
}
