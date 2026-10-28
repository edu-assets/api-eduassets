import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { AppError } from '../errors/AppError.js';
import { sanitizeUrlForLog } from '../lib/logRedaction.js';

const DATABASE_UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1017', 'P2024']);
const DATABASE_SCHEMA_CODES = new Set(['P2021', 'P2022']);

export function classifyDatabaseError(err: unknown): 'unavailable' | 'schema' | null {
  if (err instanceof Prisma.PrismaClientInitializationError) return 'unavailable';
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (DATABASE_UNAVAILABLE_CODES.has(err.code)) return 'unavailable';
  if (DATABASE_SCHEMA_CODES.has(err.code)) return 'schema';
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const safePath = sanitizeUrlForLog(req.originalUrl);

  // Erro de parse de JSON malformado
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status: unknown }).status === 400 &&
    'body' in err
  ) {
    res.status(400).json({ erro: 'backend.geral.json_invalido' });
    return;
  }

  // Erros operacionais/de negócio da aplicação
  if (err instanceof AppError) {
    res.status(err.status).json({
      erro: err.chaveI18n,
      ...(err.extra ?? {}),
    });
    return;
  }

  // Erros conhecidos do Prisma
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.warn('Prisma known error', { code: err.code, method: req.method, path: safePath });

    const databaseError = classifyDatabaseError(err);
    if (databaseError === 'unavailable') {
      res.status(503).json({ erro: 'backend.geral.banco_indisponivel' });
      return;
    }
    if (databaseError === 'schema') {
      res.status(503).json({ erro: 'backend.geral.banco_nao_inicializado' });
      return;
    }

    switch (err.code) {
      case 'P2025':
        res.status(404).json({ erro: 'backend.geral.registro_nao_encontrado' });
        return;
      case 'P2003':
        res.status(400).json({ erro: 'backend.geral.referencia_invalida' });
        return;
      case 'P2002':
        res.status(409).json({ erro: 'backend.geral.registro_duplicado' });
        return;
      case 'P2034':
        res.status(409).json({ erro: 'backend.emprestimos.conflito_concorrencia' });
        return;
      default:
        res.status(400).json({ erro: 'backend.geral.erro_processar_requisicao' });
        return;
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error('Prisma initialization failure', { method: req.method, path: safePath, errorName: err.name });
    res.status(503).json({ erro: 'backend.geral.banco_indisponivel' });
    return;
  }

  // Do not log exception messages/stacks: drivers may include query or credential data.
  const errorName = err instanceof Error ? err.name : 'UnknownError';
  logger.error('Unexpected API error', { method: req.method, path: safePath, errorName });
  res.status(500).json({ erro: 'backend.geral.erro_interno' });
}
