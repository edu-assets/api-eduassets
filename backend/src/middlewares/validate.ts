import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { MAX_DATABASE_INT } from '../schemas/common.schema.js';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        erro: 'backend.validacao.dados_invalidos',
        detalhes: result.error.issues.map((issue) => ({
          campo: issue.path.join('.'),
          mensagem: issue.message,
        })),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

export const validate = validateBody;

export function requireIntParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = Number(req.params[paramName]);

    if (!Number.isInteger(value) || value <= 0 || value > MAX_DATABASE_INT) {
      res.status(400).json({ erro: 'backend.validacao.parametro_invalido', campo: paramName });
      return;
    }

    next();
  };
}
