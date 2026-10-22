import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { AppError } from '../errors/AppError.js';

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
    logger.warn(`Prisma known error [${err.code}] em ${req.method} ${req.originalUrl}: ${err.message}`);

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
      default:
        res.status(400).json({ erro: 'backend.geral.erro_processar_requisicao' });
        return;
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error(`Prisma não conseguiu inicializar em ${req.method} ${req.originalUrl}`, { error: err.message });
    res.status(503).json({ erro: 'backend.geral.banco_indisponivel' });
    return;
  }

  // Erros inesperados: loga stack completa, responde mensagem genérica segura
  const erroFormatado = err instanceof Error
    ? { message: err.message, stack: err.stack }
    : { message: String(err) };

  logger.error(`Erro não tratado em ${req.method} ${req.originalUrl}`, { error: erroFormatado });
  res.status(500).json({ erro: 'backend.geral.erro_interno' });
}
