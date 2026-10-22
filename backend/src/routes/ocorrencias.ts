import { Router } from 'express';
import { optionalAuth, requireAuth, requireAdmin } from '../middlewares/auth.js';
import { validateBody, requireIntParam } from '../middlewares/validate.js';
import {
  ocorrenciaCreateSchema,
  ocorrenciaUpdateSchema,
  ocorrenciaResolverSchema,
} from '../schemas/index.js';
import * as ocorrenciasController from '../controllers/ocorrencias.controller.js';

export const ocorrenciasRouter = Router();

ocorrenciasRouter.get('/', optionalAuth, ocorrenciasController.listar);
ocorrenciasRouter.post(
  '/',
  requireAuth,
  validateBody(ocorrenciaCreateSchema),
  ocorrenciasController.criar
);
ocorrenciasRouter.patch(
  '/:id',
  requireAuth,
  requireIntParam('id'),
  validateBody(ocorrenciaUpdateSchema),
  ocorrenciasController.atualizar
);
ocorrenciasRouter.patch(
  '/:id/resolver',
  requireAuth,
  requireIntParam('id'),
  validateBody(ocorrenciaResolverSchema),
  ocorrenciasController.resolver
);
ocorrenciasRouter.delete(
  '/:id',
  requireAdmin,
  requireIntParam('id'),
  ocorrenciasController.excluir
);