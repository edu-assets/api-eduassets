import { Router } from 'express';
import { optionalAuth, requireAdmin } from '../middlewares/auth.js';
import { validateBody, requireIntParam } from '../middlewares/validate.js';
import { equipamentoCreateSchema, equipamentoUpdateSchema } from '../schemas/index.js';
import * as equipamentosController from '../controllers/equipamentos.controller.js';

export const equipamentosRouter = Router();

equipamentosRouter.get('/', optionalAuth, equipamentosController.listar);
equipamentosRouter.post(
  '/',
  requireAdmin,
  validateBody(equipamentoCreateSchema),
  equipamentosController.criar
);
equipamentosRouter.patch(
  '/:id',
  requireAdmin,
  requireIntParam('id'),
  validateBody(equipamentoUpdateSchema),
  equipamentosController.atualizar
);