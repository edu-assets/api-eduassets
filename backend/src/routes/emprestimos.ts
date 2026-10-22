import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth.js';
import { validateBody, requireIntParam } from '../middlewares/validate.js';
import { emprestimoCreateSchema, emprestimoUpdateItensSchema, emprestimoReturnSchema } from '../schemas/index.js';
import * as emprestimosController from '../controllers/emprestimos.controller.js';

export const emprestimosRouter = Router();

emprestimosRouter.get('/', optionalAuth, emprestimosController.listar);
emprestimosRouter.post(
  '/',
  requireAuth,
  validateBody(emprestimoCreateSchema),
  emprestimosController.criar
);
emprestimosRouter.patch(
  '/:id',
  requireAuth,
  requireIntParam('id'),
  validateBody(emprestimoUpdateItensSchema),
  emprestimosController.atualizarItens
);
emprestimosRouter.patch(
  '/:id/devolver',
  requireAuth,
  requireIntParam('id'),
  validateBody(emprestimoReturnSchema),
  emprestimosController.devolver
);